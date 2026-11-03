import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { glob } from "tinyglobby";
import { type ClassifyContext, classifyFile } from "../classifier/heuristics.js";
import type { TestFileRecord } from "../types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/deps/**",
  "**/third_party/**",
  "**/external/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/target/**", // Rust build
  // Test helpers (fixtures, __mocks__, test-setup.*, ...) are excluded by TEST_IGNORE_REGEX,
  // not here, so they still count towards the typed-code ratio like they do via git.
];

const TEST_IGNORE_REGEX =
  /(?:^|\/)(?:node_modules|vendor|deps|third_party|external|__snapshots__|__mocks__|fixtures|dummy|stubs|test[-_]utils)\/|(?:^|\/)tests?\/common\/|(?:^|\/)test[-_]setup\.[a-z]+$|\.(?:snap|d\.ts)$/i;

const TEST_FILE_REGEX = new RegExp(
  `(?:` +
    // 1. Go: Language specification strictly mandates *_test.go
    `_test\\.go|` +
    // 2. Ruby: minitest/test-unit (*_test.rb) and RSpec (*_spec.rb)
    `_(?:test|spec)\\.rb|` +
    // 3. Python: pytest / unittest standard conventions (test_*.py, *_test.py)
    `(?:^|\\/)test_[a-zA-Z0-9_]+\\.py|[a-zA-Z0-9_]+_test\\.py|` +
    // 4. PHP: PHPUnit (*Test.php), Pest (*.test.php, *.spec.php), and test_*.php
    `[a-zA-Z0-9_]+Test\\.php|[a-zA-Z0-9_]+[._-](?:test|spec)\\.php|(?:^|\\/)test_[a-zA-Z0-9_]+\\.php|` +
    // 5. JS/TS: prefix (test-*, spec-*) inside test/ or tests/ (Node.js core layout), suffix/infix (*.test.*, *-test.*, *.spec.*, etc.), and __tests__/
    `(?:^|\\/)tests?\\/(?:[^\\/]+\\/)*(?:test|spec)[-_][a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)*\\.(?:[jt]sx?|mjs|cjs)|` +
    `[._-](?:test|spec|cy|stories)(?:\\.[a-zA-Z0-9_-]+)*\\.(?:[jt]sx?|mjs|cjs)|` +
    `(?:^|\\/)__tests__\\/.*(?<!\\.d)\\.(?:[jt]sx?|mjs|cjs)|` +
    // 6. Special test DSLs / BDD / Rust
    `\\.feature(?:\\.md)?|` +
    `[._-]test\\.rs|` +
    // 7. Runner-less E2E scripts (scripts/*journey*)
    `(?:^|\\/)scripts\\/[^\\/]*journey[^\\/]*\\.(?:[jt]s|mjs|cjs|sh|py|rb|php|go)` +
    `)$`,
  "i",
);

export function isTestFile(relativePath: string): boolean {
  return !TEST_IGNORE_REGEX.test(relativePath) && TEST_FILE_REGEX.test(relativePath);
}

const TYPED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".go", ".rs"]);
const UNTYPED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".php"]);

/**
 * Lists candidate files. The git index is the fast path (bypasses recursive readdir and
 * honours .gitignore); tinyglobby is the fallback outside git or when --ignore globs are given.
 */
async function listFiles(rootDir: string, customIgnore: string[]): Promise<string[]> {
  if (customIgnore.length === 0) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        { cwd: rootDir, maxBuffer: 50 * 1024 * 1024 },
      );
      return stdout.split("\n").filter(Boolean);
    } catch {
      // not a git repository: fall through to glob
    }
  }
  return glob("**/*", {
    cwd: rootDir,
    ignore: [...DEFAULT_IGNORE_PATTERNS, ...customIgnore],
    dot: false,
  });
}

/**
 * High-performance concurrent worker pool.
 * Automatically adapts concurrency to available hardware parallelism.
 */
async function poolMap<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency?: number,
): Promise<R[]> {
  if (items.length === 0) return [];
  const maxConcurrency =
    concurrency ?? (typeof availableParallelism === "function" ? availableParallelism() * 4 : 32);

  const results: R[] = Array.from({ length: items.length });
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await mapper(item);
      }
    }
  };

  const poolSize = Math.min(maxConcurrency, items.length);
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface ScanResult {
  records: TestFileRecord[];
  scannedFilesCount: number;
  typedRatio: number;
  codeFileCount?: number;
}

async function processTestFile(
  rootDir: string,
  relativeFilePath: string,
  context: ClassifyContext,
): Promise<TestFileRecord> {
  let content = "";
  try {
    content = await readFile(resolve(rootDir, relativeFilePath), "utf-8");
  } catch {
    content = "";
  }

  const { layer, language, testCaseCount, linesOfCode, reasons } = classifyFile(
    relativeFilePath,
    content,
    context,
  );
  return { filePath: relativeFilePath, language, layer, testCaseCount, linesOfCode, reasons };
}

export async function scanRepository(
  rootDir: string,
  customIgnore: string[] = [],
  context: ClassifyContext = {},
): Promise<ScanResult> {
  const files = await listFiles(rootDir, customIgnore);

  // Test discovery and the typed-code ratio share one file list, so --ignore
  // and the git/glob choice can never skew one without the other.
  const testFiles: string[] = [];
  let codeFileCount = 0;
  let typedFileCount = 0;
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (TYPED_EXTENSIONS.has(ext)) {
      codeFileCount++;
      typedFileCount++;
    } else if (UNTYPED_EXTENSIONS.has(ext)) {
      codeFileCount++;
    }
    if (isTestFile(file)) testFiles.push(file);
  }

  const records: TestFileRecord[] = await poolMap(testFiles, (file) =>
    processTestFile(rootDir, file, context),
  );

  return {
    records,
    scannedFilesCount: records.length,
    typedRatio: codeFileCount > 0 ? typedFileCount / codeFileCount : 1.0,
    codeFileCount,
  };
}

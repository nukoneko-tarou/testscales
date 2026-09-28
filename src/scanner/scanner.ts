import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { glob } from "tinyglobby";
import {
  type ClassifyContext,
  classifyByPathOnly,
  classifyFile,
} from "../classifier/heuristics.js";
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
  "**/__snapshots__/**",
  "**/__mocks__/**",
  "**/fixtures/**",
  "**/dummy/**", // Rails engine test dummy apps
  "**/stubs/**", // Test stubs
  "**/test-utils/**",
  "**/test_utils/**",
  "**/common/**", // Node.js test helpers
  "**/test-setup.*", // Test runner bootstrap files
  "**/test_setup.*",
];

export const TEST_FILE_PATTERNS = [
  "**/*[-._]{test,spec}*.{js,jsx,ts,tsx,mjs,cjs}",
  "**/{test,spec}[-_]*.{js,jsx,ts,tsx,mjs,cjs}",
  "**/__tests__/**/*.{js,jsx,ts,tsx,mjs,cjs}",
  "**/*.cy.{js,jsx,ts,tsx}",
  "**/*.stories.{js,jsx,ts,tsx}",
  "**/*_test.go",
  "**/*_{test,spec}.rb",
  "**/test_*.py",
  "**/*_test.py",
  "**/*Test.php",
  "**/*[-._]{test,spec}*.php",
  "**/test_*.php",
  "**/*.feature",
];

const TEST_IGNORE_REGEX =
  /(?:^|\/)(?:node_modules|vendor|deps|third_party|external|__snapshots__|__mocks__|fixtures|dummy|stubs|test[-_]utils|common)\/|(?:^|\/)test[-_]setup\.[a-z]+$|\.(?:snap|d\.ts)$/i;

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
    // 5. JS/TS: prefix (test-*, spec-*), suffix/infix (*.test.*, *-test.*, *.spec.*, etc.), and __tests__/
    `(?:^|\\/)(?:test|spec)[-_][a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)*\\.(?:[jt]sx?|mjs|cjs)|` +
    `[._-](?:test|spec|cy|stories)(?:\\.[a-zA-Z0-9_-]+)*\\.(?:[jt]sx?|mjs|cjs)|` +
    `(?:^|\\/)__tests__\\/.*(?<!\\.d)\\.(?:[jt]sx?|mjs|cjs)|` +
    // 6. Special test DSLs / BDD / Rust
    `\\.feature|` +
    `[._-]test\\.rs` +
    `)$`,
  "i",
);

interface GitDiscoveryResult {
  testFiles: string[];
  typedRatio: number;
}

/**
 * Fast-track: Git index enumeration bypasses recursive filesystem readdirs.
 * Scans 100k+ tracked files in milliseconds. Falls back to tinyglobby if not a git repo.
 */
async function discoverFilesViaGit(rootDir: string): Promise<GitDiscoveryResult | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      {
        cwd: rootDir,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    const lines = stdout.split("\n");
    const testFiles: string[] = [];
    let totalCodeFiles = 0;
    let typedCodeFiles = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      // Measure code file typing ratio (TS, Go, Rust vs JS, Python, Ruby, PHP)
      const dotIdx = line.lastIndexOf(".");
      if (dotIdx !== -1) {
        const ext = line.slice(dotIdx).toLowerCase();
        if (
          ext === ".ts" ||
          ext === ".tsx" ||
          ext === ".mts" ||
          ext === ".cts" ||
          ext === ".go" ||
          ext === ".rs"
        ) {
          totalCodeFiles++;
          typedCodeFiles++;
        } else if (
          ext === ".js" ||
          ext === ".jsx" ||
          ext === ".mjs" ||
          ext === ".cjs" ||
          ext === ".py" ||
          ext === ".rb" ||
          ext === ".php"
        ) {
          totalCodeFiles++;
        }
      }

      if (!TEST_IGNORE_REGEX.test(line) && TEST_FILE_REGEX.test(line)) {
        testFiles.push(line);
      }
    }

    const typedRatio = totalCodeFiles > 0 ? typedCodeFiles / totalCodeFiles : 1.0;
    return { testFiles, typedRatio };
  } catch {
    return null;
  }
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
}

async function processTestFile(
  rootDir: string,
  relativeFilePath: string,
  context: ClassifyContext,
): Promise<TestFileRecord> {
  const fullPath = resolve(rootDir, relativeFilePath);

  // Fast-path path match
  const fastMatch = classifyByPathOnly(relativeFilePath, context);

  let content = "";
  try {
    content = await readFile(fullPath, "utf-8");
  } catch {
    content = "";
  }

  if (fastMatch) {
    const classification = classifyFile(relativeFilePath, content, context);
    return {
      filePath: relativeFilePath,
      language: classification.language,
      layer: fastMatch.layer,
      testCaseCount: classification.testCaseCount,
      linesOfCode: classification.linesOfCode,
      reasons: fastMatch.reasons,
    };
  }

  const classification = classifyFile(relativeFilePath, content, context);

  return {
    filePath: relativeFilePath,
    language: classification.language,
    layer: classification.layer,
    testCaseCount: classification.testCaseCount,
    linesOfCode: classification.linesOfCode,
    reasons: classification.reasons,
  };
}

export async function scanRepository(
  rootDir: string,
  customIgnore: string[] = [],
  context: ClassifyContext = {},
): Promise<ScanResult> {
  let uniqueFiles: string[] = [];
  let typedRatio = 1.0;

  // 1. Try Git Index Fast-Track first (10x faster on monorepos)
  if (customIgnore.length === 0) {
    const gitResult = await discoverFilesViaGit(rootDir);
    if (gitResult !== null) {
      uniqueFiles = gitResult.testFiles;
      typedRatio = gitResult.typedRatio;
    }
  }

  // 2. Fallback to tinyglobby if not a git repository or custom ignore specified
  if (uniqueFiles.length === 0) {
    const ignore = [...DEFAULT_IGNORE_PATTERNS, ...customIgnore];
    const files = await glob(TEST_FILE_PATTERNS, {
      cwd: rootDir,
      ignore,
      absolute: false,
      dot: false,
    });
    uniqueFiles = Array.from(new Set(files));
  }

  // 3. Process files through concurrent worker pool
  const records: TestFileRecord[] = await poolMap(uniqueFiles, (file) =>
    processTestFile(rootDir, file, context),
  );

  return {
    records,
    scannedFilesCount: records.length,
    typedRatio,
  };
}

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
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
    `[._-]test\\.rs|(?:^|\\/)tests\\/[^\\/]+\\.rs|` +
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
 *
 * Untracked files come back separately in `later`: listing them walks the whole work tree
 * (~10x slower than reading the index on large repos), so tracked files are processed
 * while git is still walking.
 */
async function listFiles(
  rootDir: string,
  customIgnore: string[],
): Promise<{ now: string[]; later: Promise<string[]> }> {
  if (customIgnore.length === 0) {
    const gitLsFiles = async (args: string[]) => {
      const { stdout } = await execFileAsync("git", ["ls-files", ...args], {
        cwd: rootDir,
        maxBuffer: 50 * 1024 * 1024,
      });
      return stdout.split("\n").filter(Boolean);
    };
    const untracked = gitLsFiles(["--others", "--exclude-standard"]);
    // Outside git this rejects while --cached is still pending; mark it handled up front.
    untracked.catch(() => {});
    try {
      return { now: await gitLsFiles(["--cached"]), later: untracked };
    } catch {
      // not a git repository: fall through to glob
    }
  }
  const files = await glob("**/*", {
    cwd: rootDir,
    ignore: [...DEFAULT_IGNORE_PATTERNS, ...customIgnore],
    dot: false,
  });
  return { now: files, later: Promise.resolve([]) };
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

const RUST_INLINE_TEST_MARKER = "#[cfg(test)]";

async function processTestFile(
  rootDir: string,
  relativeFilePath: string,
  context: ClassifyContext,
): Promise<TestFileRecord | null> {
  let content = "";
  try {
    content = await readFile(resolve(rootDir, relativeFilePath), "utf-8");
  } catch {
    content = "";
  }

  // Rust keeps unit tests inline in production files: only the #[cfg(test)] part is a test.
  if (/\.rs$/i.test(relativeFilePath) && !isTestFile(relativeFilePath)) {
    const markerIndex = content.indexOf(RUST_INLINE_TEST_MARKER);
    if (markerIndex === -1) return null;
    content = content.slice(markerIndex);
  }

  const { layer, language, testCaseCount, linesOfCode, reasons } = classifyFile(
    relativeFilePath,
    content,
    context,
  );
  return { filePath: relativeFilePath, language, layer, testCaseCount, linesOfCode, reasons };
}

// Classification is CPU-bound regex work, so large suites are split across worker
// threads. A worker costs a module load (~tens of ms), so each must get enough files.
const MIN_FILES_PER_WORKER = 200;
const WORKER_KEY = "testscales:classify";

interface WorkerJob {
  rootDir: string;
  files: string[];
  context: ClassifyContext;
}

function processTestFiles(
  rootDir: string,
  files: string[],
  context: ClassifyContext,
): Promise<(TestFileRecord | null)[]> {
  const workerCount = Math.min(
    availableParallelism(),
    Math.floor(files.length / MIN_FILES_PER_WORKER),
  );
  const inThread = () => poolMap(files, (file) => processTestFile(rootDir, file, context));
  if (workerCount < 2) return inThread();

  // Deal files round-robin so one worker does not get all the giant files of one directory.
  const chunks = Array.from({ length: workerCount }, (_, w) =>
    files.filter((_, i) => i % workerCount === w),
  );
  return Promise.all(chunks.map((chunk) => runWorker({ rootDir, files: chunk, context })))
    .then((results) => files.map((_, i) => results[i % workerCount]![Math.floor(i / workerCount)]!))
    .catch(inThread); // e.g. a runtime that cannot load this module as a worker
}

function runWorker(job: WorkerJob): Promise<(TestFileRecord | null)[]> {
  return new Promise((resolvePromise, reject) => {
    // This very module is the worker entry: see the isMainThread block at the end of the file.
    const worker = new Worker(new URL(import.meta.url), { workerData: { [WORKER_KEY]: job } });
    worker.once("message", resolvePromise);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`classifier worker exited with code ${code}`));
    });
  });
}

async function scanFiles(rootDir: string, files: string[], context: ClassifyContext) {
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
    // .rs files are candidates for inline #[cfg(test)] modules; processTestFile drops the rest.
    if (isTestFile(file) || (ext === ".rs" && !TEST_IGNORE_REGEX.test(file))) {
      testFiles.push(file);
    }
  }
  const records = (await processTestFiles(rootDir, testFiles, context)).filter(
    (r): r is TestFileRecord => r !== null,
  );
  return { records, codeFileCount, typedFileCount };
}

export async function scanRepository(
  rootDir: string,
  customIgnore: string[] = [],
  context: ClassifyContext = {},
): Promise<ScanResult> {
  // Test discovery and the typed-code ratio share one file list, so --ignore
  // and the git/glob choice can never skew one without the other.
  const { now, later } = await listFiles(rootDir, customIgnore);
  const batches = await Promise.all([
    scanFiles(rootDir, now, context),
    later.then((files) => scanFiles(rootDir, files, context)),
  ]);

  const records = batches.flatMap((b) => b.records);
  const codeFileCount = batches.reduce((n, b) => n + b.codeFileCount, 0);
  const typedFileCount = batches.reduce((n, b) => n + b.typedFileCount, 0);
  return {
    records,
    scannedFilesCount: records.length,
    typedRatio: codeFileCount > 0 ? typedFileCount / codeFileCount : 1.0,
    codeFileCount,
  };
}

if (!isMainThread && workerData?.[WORKER_KEY]) {
  const { rootDir, files, context } = workerData[WORKER_KEY] as WorkerJob;
  void poolMap(files, (file) => processTestFile(rootDir, file, context)).then((records) =>
    parentPort?.postMessage(records),
  );
}

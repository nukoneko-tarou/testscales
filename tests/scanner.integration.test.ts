import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { weighRepository } from "../src/index.js";
import { scanRepository } from "../src/scanner/scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("weighRepository", () => {
  it("scans current project directory and returns a valid ScaleResult", async () => {
    const projectRoot = resolve(__dirname, "..");
    const result = await weighRepository(projectRoot);

    expect(result.rootDir).toBe(projectRoot);
    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.totalTests).toBeGreaterThan(0);
    expect(result.verdict).toBeDefined();
    expect(result.verdict.name).toBeTypeOf("string");
    expect(result.layers).toHaveProperty("static");
    expect(result.layers).toHaveProperty("unit");
    expect(result.layers).toHaveProperty("integration");
    expect(result.layers).toHaveProperty("e2e");
  });
});

describe("scanRepository file discovery", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "testscales-scanner-"));
    mkdirSync(join(tempDir, "test"), { recursive: true });
    writeFileSync(join(tempDir, "test/test-setup.ts"), `import '@testing-library/jest-dom/vitest'`);
    writeFileSync(join(tempDir, "sum.test.ts"), `it('adds', () => { expect(1 + 1).toBe(2) })`);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("skips runner setup files when discovering via glob", async () => {
    const { records } = await scanRepository(tempDir);
    expect(records.map((r) => r.filePath)).toEqual(["sum.test.ts"]);
  });

  it("skips runner setup files when discovering via git index", async () => {
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    const { records } = await scanRepository(tempDir);
    expect(records.map((r) => r.filePath)).toEqual(["sum.test.ts"]);
  });

  it("limits the common/ exclusion to test helper directories", async () => {
    mkdirSync(join(tempDir, "src/common"), { recursive: true });
    mkdirSync(join(tempDir, "test/common"), { recursive: true });
    writeFileSync(join(tempDir, "src/common/format.test.ts"), `it('formats', () => {})`);
    writeFileSync(join(tempDir, "test/common/test-helper.js"), `module.exports = {}`);
    const expected = ["src/common/format.test.ts", "sum.test.ts"];

    const viaGlob = await scanRepository(tempDir);
    expect(viaGlob.records.map((r) => r.filePath).sort()).toEqual(expected);

    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    const viaGit = await scanRepository(tempDir);
    expect(viaGit.records.map((r) => r.filePath).sort()).toEqual(expected);
  });

  it("applies the test-* prefix convention only inside test directories", async () => {
    mkdirSync(join(tempDir, "src/support"), { recursive: true });
    mkdirSync(join(tempDir, "test/parallel"), { recursive: true });
    writeFileSync(join(tempDir, "src/support/test-services.ts"), `it('boots', () => {})`);
    writeFileSync(join(tempDir, "test/parallel/test-fs.js"), `it('reads', () => {})`);
    const expected = ["sum.test.ts", "test/parallel/test-fs.js"];

    const viaGlob = await scanRepository(tempDir);
    expect(viaGlob.records.map((r) => r.filePath).sort()).toEqual(expected);

    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    const viaGit = await scanRepository(tempDir);
    expect(viaGit.records.map((r) => r.filePath).sort()).toEqual(expected);
  });
});

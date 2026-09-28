import { resolve } from "node:path";
import { evaluateScale } from "./judge/weigher.js";
import { detectConfigs } from "./scanner/config-detector.js";
import { scanRepository } from "./scanner/scanner.js";
import type { ScaleResult, ScanOptions } from "./types.js";

export * from "./judge/archetypes.js";
export * from "./judge/ci-assert.js";
export * from "./judge/weigher.js";
export * from "./renderer/terminal.js";
export * from "./scanner/config-detector.js";
export * from "./scanner/scanner.js";
export * from "./types.js";

export async function weighRepository(
  targetDir = ".",
  options: ScanOptions = {},
): Promise<ScaleResult> {
  const start = performance.now();
  const rootDir = resolve(process.cwd(), targetDir);

  // 1. Detect configs (static lint/typecheck and test tools)
  const { staticTools, hasCiEnforcement, hasPlaywright, hasCypress } = detectConfigs(rootDir);

  // 2. Scan and classify test files with framework context
  const { records, typedRatio, codeFileCount } = await scanRepository(rootDir, options.ignore, {
    hasPlaywright,
    hasCypress,
  });

  const scanDurationMs = Math.round(performance.now() - start);

  // 3. Weigh layers and determine archetype
  return evaluateScale(rootDir, records, staticTools, scanDurationMs, {
    includeScannedFiles: Boolean(options.verbose),
    typedRatio,
    hasCiEnforcement,
    codeFileCount,
  });
}

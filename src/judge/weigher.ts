import type {
  ArchetypeVerdict,
  LanguageProfile,
  LayerStats,
  ScaleResult,
  StaticAnalysisRecord,
  TestFileRecord,
  TestLayer,
} from "../types.js";
import { ARCHETYPES } from "./archetypes.js";

export interface WeighOptions {
  typedRatio?: number;
  hasCiEnforcement?: boolean;
}

export function calculateStaticCoverage(
  staticTools: StaticAnalysisRecord[],
  records: TestFileRecord[] = [],
  options: WeighOptions = {},
): number {
  if (staticTools.length === 0) {
    return 0;
  }

  // 1. Detect language context from records and tools
  const detectedLangs = new Set<string>();
  for (const r of records) {
    if (r.language) detectedLangs.add(r.language.toLowerCase());
  }
  for (const t of staticTools) {
    const nameLower = t.name.toLowerCase();
    if (nameLower.includes("go")) detectedLangs.add("go");
    if (nameLower.includes("rust")) detectedLangs.add("rust");
    if (nameLower.includes("typescript")) detectedLangs.add("typescript");
    if (["mypy", "pyright", "ruff", "flake8"].some((k) => nameLower.includes(k))) {
      detectedLangs.add("python");
    }
    if (["rubocop", "sorbet", "steep"].some((k) => nameLower.includes(k))) {
      detectedLangs.add("ruby");
    }
  }

  // 2. Identify 3 pillars of static defense
  // A. Type Safety
  const hasNativeCompiler = staticTools.some(
    (t) =>
      t.category === "compiler" || t.name === "Go Type System" || t.name === "Rust Type System",
  );
  const hasTypeChecker = staticTools.some(
    (t) =>
      t.category === "typechecker" ||
      ["TypeScript", "MyPy", "Pyright", "Sorbet", "Steep"].includes(t.name),
  );
  const isStrict = staticTools.some((t) => t.isStrict);

  // B. Code Hygiene (Linter)
  const hasLinter = staticTools.some(
    (t) =>
      t.category === "linter" ||
      ["ESLint", "Biome", "Oxlint", "Ruff", "Flake8", "GolangCI-Lint", "RuboCop"].includes(t.name),
  );

  // C. Format Integrity (Formatter)
  // Biome, Ruff, RuboCop, GolangCI-Lint act as both linter and code style/formatter
  const hasFormatter = staticTools.some(
    (t) =>
      t.category === "formatter" ||
      ["Prettier", "Oxfmt", "Biome", "Ruff", "RuboCop", "GolangCI-Lint"].includes(t.name),
  );

  let typeScore = 0;
  let lintScore = 0;
  let formatScore = 0;

  // Type Safety scoring (max 40)
  if (hasNativeCompiler) {
    // Go, Rust, Java, Kotlin etc. have zero type-leak runtime defects by design
    typeScore = 40;
  } else if (hasTypeChecker) {
    const typedRatio = Math.max(0, Math.min(1.0, options.typedRatio ?? 1.0));
    const base = isStrict ? 40 : 30;
    typeScore = Math.round(base * (0.4 + 0.6 * typedRatio));
  } else if (detectedLangs.has("ruby") && staticTools.some((t) => t.name === "RuboCop")) {
    // Ruby standard ecosystem: RuboCop performs comprehensive AST pattern & safety analysis
    typeScore = 40;
  }

  // Linter scoring (max 35)
  if (hasLinter) {
    lintScore = 35;
  }

  // Formatter scoring (max 25)
  if (hasFormatter) {
    formatScore = 25;
  }

  let total = typeScore + lintScore + formatScore;

  // CI Enforcement bonus (+5, capped at 100)
  if (options.hasCiEnforcement && total < 100) {
    total = Math.min(100, total + 5);
  }

  // If any static tool is detected, provide at least a meaningful baseline score
  return Math.min(100, Math.max(20, total));
}

export function weighLayers(
  records: TestFileRecord[],
  staticTools: StaticAnalysisRecord[],
  options: WeighOptions = {},
): Record<TestLayer, LayerStats> {
  const stats: Record<TestLayer, LayerStats> = {
    static: {
      layer: "static",
      fileCount: staticTools.length,
      testCaseCount: staticTools.length,
      linesOfCode: 0,
      weight: 0,
      percentage: 0,
    },
    unit: {
      layer: "unit",
      fileCount: 0,
      testCaseCount: 0,
      linesOfCode: 0,
      weight: 0,
      percentage: 0,
    },
    integration: {
      layer: "integration",
      fileCount: 0,
      testCaseCount: 0,
      linesOfCode: 0,
      weight: 0,
      percentage: 0,
    },
    e2e: { layer: "e2e", fileCount: 0, testCaseCount: 0, linesOfCode: 0, weight: 0, percentage: 0 },
  };

  for (const record of records) {
    const layerStat = stats[record.layer];
    layerStat.fileCount += 1;
    layerStat.testCaseCount += record.testCaseCount;
    layerStat.linesOfCode += record.linesOfCode;

    // Dynamic layer weighting:
    // E2E covers broader scope per test; Integration covers collaboration; Unit covers isolation
    if (record.layer === "unit") {
      layerStat.weight += record.testCaseCount * 1.0 + Math.min(record.linesOfCode * 0.05, 5);
    } else if (record.layer === "integration") {
      layerStat.weight += record.testCaseCount * 1.8 + Math.min(record.linesOfCode * 0.1, 10);
    } else if (record.layer === "e2e") {
      layerStat.weight += record.testCaseCount * 3.0 + Math.min(record.linesOfCode * 0.15, 15);
    }
  }

  // 1. STATIC layer: Independent 0-100% defense coverage score
  const staticScore = calculateStaticCoverage(staticTools, records, options);
  stats.static.percentage = staticScore;
  stats.static.weight = staticScore;

  // 2. Dynamic test layers: Unit, Integration, and E2E divide 100% of execution test suite
  const dynamicTotal = stats.unit.weight + stats.integration.weight + stats.e2e.weight;

  if (dynamicTotal > 0) {
    const dynamicLayers: TestLayer[] = ["unit", "integration", "e2e"];
    for (const key of dynamicLayers) {
      stats[key].percentage = Math.round((stats[key].weight / dynamicTotal) * 100);
    }
    // Correct rounding errors so dynamic sum is exactly 100
    const currentSum = stats.unit.percentage + stats.integration.percentage + stats.e2e.percentage;
    const diff = 100 - currentSum;
    if (diff !== 0) {
      const dominant = dynamicLayers.reduce((a, b) => (stats[a].weight > stats[b].weight ? a : b));
      stats[dominant].percentage += diff;
    }
  }

  return stats;
}

export function determineArchetype(
  stats: Record<TestLayer, LayerStats>,
  totalTestFiles: number,
): ArchetypeVerdict {
  // 1. If no test files exist at all
  if (totalTestFiles === 0) {
    return {
      type: "void",
      ...ARCHETYPES.void,
    };
  }

  const { static: st, unit, integration, e2e } = stats;
  const dynamicTotal = unit.weight + integration.weight + e2e.weight;

  if (dynamicTotal === 0) {
    return { type: "void", ...ARCHETYPES.void };
  }

  const unitPct = (unit.weight / dynamicTotal) * 100;
  const intPct = (integration.weight / dynamicTotal) * 100;
  const e2ePct = (e2e.weight / dynamicTotal) * 100;

  // 2. Hourglass: Both Unit and E2E are prominent, but Integration is pinched out (<= 15%)
  if (unitPct >= 20 && e2ePct >= 20 && intPct <= 15) {
    return {
      type: "hourglass",
      ...ARCHETYPES.hourglass,
    };
  }

  // 3. Ice Cream Cone: E2E is heavily top-heavy (>= 35%) while Unit is weak (<= 30%)
  if (e2ePct >= 35 && e2ePct > intPct && unitPct <= 30) {
    return {
      type: "ice-cream-cone",
      ...ARCHETYPES["ice-cream-cone"],
    };
  }

  // 4. Classic Pyramid: Unit is the foundation bedrock (Unit > Integration >= E2E, Unit >= 45%)
  // Preserving the tiered triangle hierarchy is the purest Classic Pyramid, even with wide 80%+ base.
  if (unitPct >= 45 && unitPct > intPct && intPct >= e2ePct) {
    return {
      type: "pyramid",
      ...ARCHETYPES.pyramid,
    };
  }

  // 5. Monolith Spike: One layer stands alone while both other dynamic layers are practically absent (< 2%)
  const secondLargestPct = [unitPct, intPct, e2ePct].sort((a, b) => b - a)[1] ?? 0;
  if (secondLargestPct < 2) {
    return {
      type: "monolith-spike",
      ...ARCHETYPES["monolith-spike"],
    };
  }

  // 6. Testing Trophy: Integration is dominant (Integration > Unit, >= 35%), a Unit tier exists (>= 2%), E2E is bounded (<= 25%), and Static foundation exists (>= 5%)
  if (intPct > unitPct && intPct >= 35 && unitPct >= 2 && e2ePct <= 25 && st.percentage >= 5) {
    return {
      type: "trophy",
      ...ARCHETYPES.trophy,
    };
  }

  // 7. Integration Diamond: Integration dominates (>= 55%) over Unit and E2E, or Trophy shape without static foundation
  if (intPct >= 55 || (intPct > unitPct && intPct >= 35 && unitPct >= 2 && e2ePct <= 25)) {
    return {
      type: "diamond",
      ...ARCHETYPES.diamond,
    };
  }

  // 8. Pyramid fallback: Unit dominant over integration and E2E
  if (unitPct >= 40 && unitPct > intPct && unitPct > e2ePct) {
    return {
      type: "pyramid",
      ...ARCHETYPES.pyramid,
    };
  }

  // 9. Balanced: Roughly even distribution
  return {
    type: "balanced",
    ...ARCHETYPES.balanced,
  };
}

export function calculateLanguageProfiles(records: TestFileRecord[]): LanguageProfile[] {
  if (records.length === 0) return [];

  const map = new Map<string, { fileCount: number; testCaseCount: number }>();

  for (const record of records) {
    const lang = record.language || "Other";
    const entry = map.get(lang) ?? { fileCount: 0, testCaseCount: 0 };
    entry.fileCount++;
    entry.testCaseCount += record.testCaseCount;
    map.set(lang, entry);
  }

  const totalFiles = records.length;
  return Array.from(map.entries())
    .map(([language, data]) => ({
      language,
      fileCount: data.fileCount,
      testCaseCount: data.testCaseCount,
      percentage: Math.round((data.fileCount / totalFiles) * 100),
    }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

export interface EvaluateOptions {
  includeScannedFiles?: boolean;
  typedRatio?: number;
  hasCiEnforcement?: boolean;
}

export function evaluateScale(
  rootDir: string,
  records: TestFileRecord[],
  staticTools: StaticAnalysisRecord[],
  scanDurationMs: number,
  optionsOrIncludeScanned: boolean | EvaluateOptions = false,
): ScaleResult {
  const options: EvaluateOptions =
    typeof optionsOrIncludeScanned === "boolean"
      ? { includeScannedFiles: optionsOrIncludeScanned }
      : optionsOrIncludeScanned;

  const { includeScannedFiles = false, typedRatio = 1.0, hasCiEnforcement = false } = options;
  const layers = weighLayers(records, staticTools, { typedRatio, hasCiEnforcement });
  const totalFiles = records.length;
  const totalTests = records.reduce((sum, r) => sum + r.testCaseCount, 0);
  const languageProfiles = calculateLanguageProfiles(records);

  let dominantLayer: TestLayer | "none" = "none";
  if (totalFiles > 0) {
    const dynamicLayers: TestLayer[] = ["unit", "integration", "e2e"];
    dominantLayer = dynamicLayers.reduce((max, key) =>
      layers[key].weight > layers[max].weight ? key : max,
    );
  } else if (staticTools.length > 0) {
    dominantLayer = "static";
  }

  const verdict = determineArchetype(layers, totalFiles);

  return {
    rootDir,
    totalFiles,
    totalTests,
    staticTools,
    typedRatio,
    hasCiEnforcement,
    layers,
    languageProfiles,
    dominantLayer,
    verdict,
    scanDurationMs,
    ...(includeScannedFiles ? { scannedFiles: records } : {}),
  };
}

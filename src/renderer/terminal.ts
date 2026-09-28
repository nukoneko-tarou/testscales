import pc from "picocolors";
import type { ArchetypeType, LayerStats, ScaleResult, TestLayer } from "../types.js";

const LAYER_LABELS: Record<TestLayer, { title: string; color: (s: string) => string }> = {
  e2e: { title: "E2E        ", color: pc.red },
  integration: { title: "INTEGRATION", color: pc.cyan },
  unit: { title: "UNIT       ", color: pc.green },
  static: { title: "STATIC     ", color: pc.magenta },
};

const ARCHETYPE_ICONS: Record<Exclude<ArchetypeType, "void">, Record<TestLayer, string>> = {
  pyramid: {
    e2e: "       ◢◣       ",
    integration: "     ◢████◣     ",
    unit: "   ◢████████◣   ",
    static: " ◢████████████◣ ",
  },
  diamond: {
    e2e: "     .────.     ",
    integration: "  ◢██████████◣  ",
    unit: "    ◥██████◤    ",
    static: "      ◥██◤      ",
  },
  trophy: {
    e2e: "     ◢████◣     ",
    integration: " ◢████████████◣ ",
    unit: "      ████      ",
    static: "  ████████████  ",
  },
  "ice-cream-cone": {
    e2e: " ◢████████████◣ ",
    integration: "   ◥████████◤   ",
    unit: "     ◥████◤     ",
    static: "       ◥◤       ",
  },
  hourglass: {
    e2e: "  ◥██████████◤  ",
    integration: "       ◥◤       ",
    unit: "  ◢██████████◣  ",
    static: "  ████████████  ",
  },
  "monolith-spike": {
    e2e: "       ··       ",
    integration: "       ··       ",
    unit: " ◢████████████◣ ",
    static: "       ··       ",
  },
  balanced: {
    e2e: "   ◖████████◗   ",
    integration: "   ◖████████◗   ",
    unit: "   ◖████████◗   ",
    static: "   ◖████████◗   ",
  },
};

function describeStaticLayer(fileCount: number, staticToolCount?: number): string {
  if (staticToolCount === undefined || staticToolCount >= fileCount) {
    return `${fileCount} config(s)`;
  }
  return `${staticToolCount} config(s), ${fileCount - staticToolCount} stories`;
}

export function renderLiveSilhouette(
  layers: Record<TestLayer, LayerStats>,
  archetypeType: ArchetypeType = "pyramid",
  gaugeLen = 8,
  staticToolCount?: number,
): string[] {
  const layerOrder: TestLayer[] = ["e2e", "integration", "unit", "static"];
  const lines: string[] = [];

  // Determine dominant layer for monolith spike
  let dominantLayer: TestLayer = "unit";
  if (archetypeType === "monolith-spike") {
    let maxPct = -1;
    for (const l of layerOrder) {
      if (layers[l].percentage > maxPct) {
        maxPct = layers[l].percentage;
        dominantLayer = l;
      }
    }
  }

  const icons =
    archetypeType === "void"
      ? ARCHETYPE_ICONS.pyramid
      : ARCHETYPE_ICONS[archetypeType] || ARCHETYPE_ICONS.pyramid;

  for (const layer of layerOrder) {
    const stat = layers[layer];
    const pct = stat.percentage;
    const meta = LAYER_LABELS[layer];

    // Left visual art (iconic archetype silhouette)
    let rawArt = icons[layer];
    if (archetypeType === "monolith-spike") {
      rawArt = layer === dominantLayer ? " ◢████████████◣ " : "       ··       ";
    }

    const art = rawArt.includes("·") || rawArt.includes(".") ? pc.dim(rawArt) : meta.color(rawArt);

    // Right data-faithful elements (progress gauge, pct, stats)
    const filled = Math.round((pct / 100) * gaugeLen);
    const gauge = meta.color("▰".repeat(filled)) + pc.dim("▱".repeat(gaugeLen - filled));

    const pctStr = `${pct}%`.padStart(4, " ");
    const detail =
      layer === "static"
        ? describeStaticLayer(stat.fileCount, staticToolCount)
        : `${stat.fileCount} files, ${stat.testCaseCount} tests`;

    lines.push(
      `  ${art}  ${meta.color(meta.title)}  ${gauge}  ${pc.bold(pctStr)}  ${pc.dim(`(${detail})`)}`,
    );
  }

  return lines;
}

export function renderTerminalReport(result: ScaleResult): string {
  const { rootDir, totalFiles, totalTests, staticTools, layers, verdict, scanDurationMs } = result;

  const lines: string[] = [];
  const separator = pc.dim("─".repeat(70));
  const doubleSep = pc.dim("═".repeat(70));

  lines.push("");
  lines.push(doubleSep);
  lines.push(
    `   ${pc.bold(pc.yellow("⚖️   T E S T S C A L E S"))}   ${pc.dim("—")}   ${pc.italic(pc.white("Weighing the Soul of Your Tests"))}`,
  );
  lines.push(doubleSep);
  lines.push("");
  lines.push(`  ${pc.dim("Target:")}       ${pc.bold(rootDir)}`);
  lines.push(
    `  ${pc.dim("Scanned:")}      ${pc.bold(String(totalFiles))} test files (${pc.bold(String(totalTests))} assertions/cases) ${pc.dim(`[${scanDurationMs}ms]`)}`,
  );

  if (result.languageProfiles && result.languageProfiles.length > 0) {
    const ecoStr = result.languageProfiles
      .map((p) => `${pc.cyan(p.language)} ${pc.dim(`(${p.percentage}%)`)}`)
      .join(", ");
    lines.push(`  ${pc.dim("Ecosystem:")}    ${ecoStr}`);
  }

  if (staticTools.length > 0) {
    const toolNames = staticTools
      .map((t) => {
        const strictBadge = t.isStrict ? pc.yellow(" (strict)") : "";
        return `${pc.magenta(t.name)}${strictBadge}`;
      })
      .join(", ");

    const badges: string[] = [];
    if (result.hasCiEnforcement) {
      badges.push(pc.green("CI Enforced"));
    }
    if (result.typedRatio !== undefined) {
      badges.push(pc.cyan(`${Math.round(result.typedRatio * 100)}% Typed`));
    }

    const badgeStr =
      badges.length > 0 ? ` ${pc.dim("[")}${badges.join(pc.dim(" • "))}${pc.dim("]")}` : "";
    lines.push(`  ${pc.dim("Static Def:")}   ${toolNames}${badgeStr}`);
  } else {
    lines.push(`  ${pc.dim("Static Def:")}   ${pc.dim("No static lint/type configs detected")}`);
  }

  lines.push("");
  lines.push(separator);
  lines.push(`  ${pc.bold("THE VERDICT:")} ${verdict.emoji}  ${pc.bold(pc.yellow(verdict.name))}`);
  lines.push(`  ${pc.italic(pc.cyan(`"${verdict.tagline}"`))}`);
  lines.push(separator);
  lines.push("");

  // Live Archetype Silhouette (proportional geometry reflecting the repo's real shape)
  if (verdict.type === "void") {
    lines.push(pc.yellow(verdict.asciiArt.trimEnd()));
    if (result.codeFileCount === 0) {
      lines.push("");
      lines.push(
        `  ${pc.dim("No source files were found either. This looks like a documentation or configuration repository, so there is nothing to weigh.")}`,
      );
    }
  } else {
    const silhouetteLines = renderLiveSilhouette(layers, verdict.type, 8, staticTools.length);
    for (const s of silhouetteLines) {
      lines.push(s);
    }
  }
  lines.push("");

  // Doctrine
  lines.push(`  ${pc.bold(pc.blue("📜 Doctrine:"))}`);
  lines.push(`     ${pc.white(verdict.philosophy)}`);
  lines.push("");

  // Strengths
  lines.push(`  ${pc.bold(pc.green("✨ Divine Strengths:"))}`);
  for (const strength of verdict.strengths) {
    lines.push(`     ${pc.green("•")} ${strength}`);
  }
  lines.push("");

  // Cautions
  lines.push(`  ${pc.bold(pc.magenta("⚠️  Sacred Cautions:"))}`);
  for (const caution of verdict.cautions) {
    lines.push(`     ${pc.magenta("•")} ${caution}`);
  }
  lines.push("");

  // Humor / Oracle
  lines.push(`  ${pc.bold(pc.yellow("💬 The Oracle's Whisper:"))}`);
  lines.push(`     ${pc.italic(pc.gray(`"${verdict.humor}"`))}`);

  if (result.scannedFiles && result.scannedFiles.length > 0) {
    if (result.languageProfiles && result.languageProfiles.length > 1) {
      lines.push("");
      lines.push(separator);
      lines.push(`  ${pc.bold("POLYGLOT PROFILE (--verbose)")}`);
      lines.push(separator);
      for (const p of result.languageProfiles) {
        lines.push(
          `  ${pc.cyan("•")} ${pc.bold(p.language.padEnd(12, " "))} : ${p.fileCount} files, ${p.testCaseCount} tests ${pc.dim(`(${p.percentage}%)`)}`,
        );
      }
    }

    lines.push("");
    lines.push(separator);
    lines.push(`  ${pc.bold("SCANNED FILES BREAKDOWN (--verbose)")}`);
    lines.push(separator);
    for (const file of result.scannedFiles) {
      const meta = LAYER_LABELS[file.layer];
      const layerTag = meta.color(`[${file.layer.toUpperCase().padEnd(11, " ")}]`);
      const langTag = pc.dim(`[${file.language || "Other"}]`.padEnd(14, " "));
      lines.push(
        `  ${layerTag} ${langTag} ${file.filePath} ${pc.dim(`(${file.testCaseCount} tests)`)}`,
      );
      if (file.reasons.length > 0) {
        lines.push(`    ${pc.dim("└─ " + file.reasons.join(", "))}`);
      }
    }
  }

  lines.push("");
  lines.push(doubleSep);
  lines.push("");

  return lines.join("\n");
}

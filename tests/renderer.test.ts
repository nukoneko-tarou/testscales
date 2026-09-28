import { describe, expect, it } from "@rstest/core";
import { evaluateScale } from "../src/judge/weigher.js";
import { renderLiveSilhouette, renderTerminalReport } from "../src/renderer/terminal.js";
import type { LayerStats, TestLayer } from "../src/types.js";

describe("renderLiveSilhouette", () => {
  it("renders centered block lines for each layer proportionally", () => {
    const layers: Record<TestLayer, LayerStats> = {
      e2e: {
        layer: "e2e",
        percentage: 10,
        fileCount: 2,
        testCaseCount: 10,
        linesOfCode: 100,
        weight: 10,
      },
      integration: {
        layer: "integration",
        percentage: 60,
        fileCount: 10,
        testCaseCount: 150,
        linesOfCode: 1200,
        weight: 60,
      },
      unit: {
        layer: "unit",
        percentage: 20,
        fileCount: 5,
        testCaseCount: 50,
        linesOfCode: 400,
        weight: 20,
      },
      static: {
        layer: "static",
        percentage: 10,
        fileCount: 1,
        testCaseCount: 1,
        linesOfCode: 0,
        weight: 10,
      },
    };

    const lines = renderLiveSilhouette(layers, "pyramid");
    expect(lines.length).toBe(4);

    const textOutput = lines.join("\n");
    expect(textOutput).toContain("INTEGRATION");
    expect(textOutput).toContain("UNIT");
    expect(textOutput).toContain("STATIC");
    expect(textOutput).toContain("E2E");
    expect(textOutput).toContain("◢◣");
    expect(textOutput).toContain("◢████████████◣");
    expect(textOutput).toContain("▰");
  });

  it("renders archetype-specific iconic silhouettes", () => {
    const layers: Record<TestLayer, LayerStats> = {
      e2e: {
        layer: "e2e",
        percentage: 5,
        fileCount: 1,
        testCaseCount: 5,
        linesOfCode: 50,
        weight: 5,
      },
      integration: {
        layer: "integration",
        percentage: 80,
        fileCount: 20,
        testCaseCount: 200,
        linesOfCode: 1500,
        weight: 80,
      },
      unit: {
        layer: "unit",
        percentage: 10,
        fileCount: 5,
        testCaseCount: 20,
        linesOfCode: 150,
        weight: 10,
      },
      static: {
        layer: "static",
        percentage: 5,
        fileCount: 1,
        testCaseCount: 1,
        linesOfCode: 0,
        weight: 5,
      },
    };

    // Diamond silhouette has .────. at top
    const diamondLines = renderLiveSilhouette(layers, "diamond");
    expect(diamondLines.length).toBe(4);
    expect(diamondLines.join("\n")).toContain(".────.");

    // Trophy silhouette has ◢████◣ at top and ◢████████████◣ at middle
    const trophyLines = renderLiveSilhouette(layers, "trophy");
    expect(trophyLines.length).toBe(4);
    expect(trophyLines.join("\n")).toContain("◢████████████◣");

    // Hourglass has top funnel pointing down and bottom base
    const hourglassLines = renderLiveSilhouette(layers, "hourglass");
    expect(hourglassLines.length).toBe(4);
    expect(hourglassLines.join("\n")).toContain("◥██████████◤");

    // Monolith spike highlights dominant layer and dims others with ··
    const spikeLines = renderLiveSilhouette(layers, "monolith-spike");
    expect(spikeLines.length).toBe(4);
    expect(spikeLines.join("\n")).toContain("··");
  });
});

describe("renderLiveSilhouette static layer detail", () => {
  const stat = (layer: TestLayer, fileCount: number): LayerStats => ({
    layer,
    percentage: 25,
    fileCount,
    testCaseCount: fileCount,
    linesOfCode: 0,
    weight: 25,
  });
  const layers: Record<TestLayer, LayerStats> = {
    e2e: stat("e2e", 1),
    integration: stat("integration", 1),
    unit: stat("unit", 1),
    static: stat("static", 256),
  };

  it("reports the whole static count as configs when tool count is unknown", () => {
    expect(renderLiveSilhouette(layers, "pyramid").join("\n")).toContain("256 config(s)");
  });

  it("splits static files into configs and play-less stories", () => {
    const text = renderLiveSilhouette(layers, "pyramid", 8, 3).join("\n");
    expect(text).toContain("3 config(s), 253 stories");
  });
});

describe("renderTerminalReport for repositories without tests", () => {
  it("explains a Void verdict when the repository has no source files", () => {
    const result = evaluateScale("/docs-repo", [], [], 5, { codeFileCount: 0 });
    expect(result.verdict.type).toBe("void");
    expect(renderTerminalReport(result)).toContain("nothing to weigh");
  });

  it("keeps the plain Void verdict when source files exist", () => {
    const result = evaluateScale("/app", [], [], 5, { codeFileCount: 12 });
    expect(renderTerminalReport(result)).not.toContain("nothing to weigh");
  });
});

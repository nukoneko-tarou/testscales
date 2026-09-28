import { describe, expect, it } from "@rstest/core";
import { determineArchetype, weighLayers } from "../src/judge/weigher.js";
import type { TestFileRecord, TestLayer } from "../src/types.js";

describe("determineArchetype", () => {
  it("returns void when there are zero test files", () => {
    const stats = weighLayers([], [{ name: "TypeScript", configFile: "tsconfig.json" }]);
    const verdict = determineArchetype(stats, 0);
    expect(verdict.type).toBe("void");
    expect(verdict.emoji).toBe("🛡️");
  });

  it("detects Classic Pyramid when unit tests dominate", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "math.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 50,
        linesOfCode: 300,
        reasons: [],
      },
      {
        filePath: "string.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 30,
        linesOfCode: 200,
        reasons: [],
      },
      {
        filePath: "api.int.test.ts",
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 10,
        linesOfCode: 100,
        reasons: [],
      },
      {
        filePath: "smoke.e2e.ts",
        language: "TypeScript",
        layer: "e2e",
        testCaseCount: 2,
        linesOfCode: 50,
        reasons: [],
      },
    ];
    const stats = weighLayers(records, []);
    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("pyramid");
    expect(verdict.emoji).toBe("🔺");
  });

  it("classifies broad-base unit suites (85%+ unit) as Classic Pyramid when tiered hierarchy holds", () => {
    // Like Node.js Runtime: 90% unit, 10% integration, 0% e2e
    const records: TestFileRecord[] = [
      {
        filePath: "test-buffer.js",
        language: "JavaScript",
        layer: "unit",
        testCaseCount: 90,
        linesOfCode: 900,
        reasons: [],
      },
      {
        filePath: "test-http.js",
        language: "JavaScript",
        layer: "integration",
        testCaseCount: 10,
        linesOfCode: 100,
        reasons: [],
      },
    ];
    const stats = weighLayers(records, [{ name: "ESLint", configFile: "eslint.config.js" }]);
    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("pyramid");
    expect(verdict.emoji).toBe("🔺");
  });

  it("detects Testing Trophy when integration is golden center with healthy unit and small e2e", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "calc.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 15,
        linesOfCode: 80,
        reasons: [],
      },
      {
        filePath: "form.integration.test.ts",
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 30,
        linesOfCode: 250,
        reasons: [],
      },
      {
        filePath: "checkout.integration.test.ts",
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 20,
        linesOfCode: 180,
        reasons: [],
      },
      {
        filePath: "journey.e2e.ts",
        language: "TypeScript",
        layer: "e2e",
        testCaseCount: 2,
        linesOfCode: 40,
        reasons: [],
      },
    ];
    const stats = weighLayers(records, [{ name: "TypeScript", configFile: "tsconfig.json" }]);
    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("trophy");
    expect(verdict.emoji).toBe("🏆");
  });

  it("detects Ice Cream Cone when E2E is top-heavy", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "calc.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 2,
        linesOfCode: 20,
        reasons: [],
      },
      {
        filePath: "flow1.e2e.ts",
        language: "TypeScript",
        layer: "e2e",
        testCaseCount: 25,
        linesOfCode: 400,
        reasons: [],
      },
      {
        filePath: "flow2.e2e.ts",
        language: "TypeScript",
        layer: "e2e",
        testCaseCount: 20,
        linesOfCode: 350,
        reasons: [],
      },
    ];
    const stats = weighLayers(records, []);
    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("ice-cream-cone");
    expect(verdict.emoji).toBe("🍦");
  });

  it("detects Hourglass when unit and e2e exist but integration is missing", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "math.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 30,
        linesOfCode: 200,
        reasons: [],
      },
      {
        filePath: "flow.e2e.ts",
        language: "TypeScript",
        layer: "e2e",
        testCaseCount: 12,
        linesOfCode: 250,
        reasons: [],
      },
    ];
    const stats = weighLayers(records, []);
    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("hourglass");
    expect(verdict.emoji).toBe("⌛");
  });

  it("keeps stable STATIC foundation percentage even when dynamic test count is huge", () => {
    // Simulate 500 integration and unit tests (thousands of lines of code)
    const records: TestFileRecord[] = [];
    for (let i = 0; i < 200; i++) {
      records.push({
        filePath: `int-${i}.test.ts`,
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 10,
        linesOfCode: 150,
        reasons: [],
      });
    }
    for (let i = 0; i < 100; i++) {
      records.push({
        filePath: `unit-${i}.test.ts`,
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 5,
        linesOfCode: 50,
        reasons: [],
      });
    }

    const staticTools = [
      {
        name: "TypeScript",
        configFile: "tsconfig.json",
        category: "typechecker" as const,
        isStrict: true,
      },
      { name: "ESLint", configFile: "eslint.config.js", category: "linter" as const },
    ];

    const stats = weighLayers(records, staticTools);
    // Static defense coverage is an independent 0-100% score (TypeScript strict 40 + ESLint 35 = 75%)
    // It maintains its 75% defense coverage regardless of how massive the dynamic test suite is
    expect(stats.static.percentage).toBe(75);
  });

  it("yields 0% STATIC when no static analysis tools exist", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "main_test.py",
        language: "Python",
        layer: "unit",
        testCaseCount: 10,
        linesOfCode: 50,
        reasons: [],
      },
    ];
    const stats = weighLayers(records, []);
    expect(stats.static.percentage).toBe(0);
    expect(stats.static.weight).toBe(0);
  });

  it("classifies as Diamond instead of Trophy when static foundation is missing", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "calc.test.ts",
        language: "JavaScript",
        layer: "unit",
        testCaseCount: 15,
        linesOfCode: 80,
        reasons: [],
      },
      {
        filePath: "form.integration.test.ts",
        language: "JavaScript",
        layer: "integration",
        testCaseCount: 30,
        linesOfCode: 250,
        reasons: [],
      },
      {
        filePath: "checkout.integration.test.ts",
        language: "JavaScript",
        layer: "integration",
        testCaseCount: 20,
        linesOfCode: 180,
        reasons: [],
      },
      {
        filePath: "journey.e2e.ts",
        language: "JavaScript",
        layer: "e2e",
        testCaseCount: 2,
        linesOfCode: 40,
        reasons: [],
      },
    ];
    // Without static tools, the trophy base is missing -> classified as Diamond
    const stats = weighLayers(records, []);
    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("diamond");
    expect(verdict.emoji).toBe("💎");
  });

  it("scales STATIC higher when typedRatio is 100% vs 20%", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "api.int.test.ts",
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 20,
        linesOfCode: 150,
        reasons: [],
      },
      {
        filePath: "calc.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 10,
        linesOfCode: 50,
        reasons: [],
      },
    ];
    const staticTools = [
      {
        name: "TypeScript",
        configFile: "tsconfig.json",
        category: "typechecker" as const,
        isStrict: true,
      },
      { name: "ESLint", configFile: "eslint.config.js", category: "linter" as const },
    ];

    // 100% Typed repo
    const fullyTypedStats = weighLayers(records, staticTools, { typedRatio: 1.0 });
    // Only 20% Typed repo (legacy JS dominates)
    const partiallyTypedStats = weighLayers(records, staticTools, { typedRatio: 0.2 });

    expect(fullyTypedStats.static.percentage).toBeGreaterThan(
      partiallyTypedStats.static.percentage,
    );
  });

  it("rewards active CI enforcement with higher static defense weight", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "api.int.test.ts",
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 20,
        linesOfCode: 150,
        reasons: [],
      },
    ];
    const staticTools = [
      { name: "TypeScript", configFile: "tsconfig.json", category: "typechecker" as const },
    ];

    const withoutCi = weighLayers(records, staticTools, { hasCiEnforcement: false });
    const withCi = weighLayers(records, staticTools, { hasCiEnforcement: true });

    expect(withCi.static.percentage).toBeGreaterThan(withoutCi.static.percentage);
  });

  it("achieves 100% STATIC across diverse language ecosystems with adaptive scoring", () => {
    // 1. TypeScript full defense: strict tsconfig + oxlint + oxfmt
    const tsStats = weighLayers(
      [],
      [
        {
          name: "TypeScript",
          category: "typechecker",
          configFile: "tsconfig.json",
          isStrict: true,
        },
        { name: "Oxlint", category: "linter", configFile: ".oxlintrc.json" },
        { name: "Oxfmt", category: "formatter", configFile: ".oxfmtrc.json" },
      ],
    );
    expect(tsStats.static.percentage).toBe(100);

    // 2. Go full defense: compiler types + golangci-lint
    const goStats = weighLayers(
      [
        {
          filePath: "main_test.go",
          language: "Go",
          layer: "unit",
          testCaseCount: 10,
          linesOfCode: 50,
          reasons: [],
        },
      ],
      [
        { name: "Go Type System", category: "compiler", configFile: "go.mod" },
        { name: "GolangCI-Lint", category: "linter", configFile: ".golangci.yml" },
      ],
    );
    expect(goStats.static.percentage).toBe(100);

    // 3. Python full defense: ruff (lint+fmt) + mypy (strict type checker)
    const pyStats = weighLayers(
      [
        {
          filePath: "test_core.py",
          language: "Python",
          layer: "unit",
          testCaseCount: 10,
          linesOfCode: 50,
          reasons: [],
        },
      ],
      [
        { name: "MyPy", category: "typechecker", configFile: "pyproject.toml", isStrict: true },
        { name: "Ruff", category: "linter", configFile: "pyproject.toml" },
      ],
    );
    expect(pyStats.static.percentage).toBe(100);

    // 4. Ruby: RuboCop covers lint + format, type safety needs Sorbet or Steep
    const rubyRecords: TestFileRecord[] = [
      {
        filePath: "spec/core_spec.rb",
        language: "Ruby",
        layer: "unit",
        testCaseCount: 10,
        linesOfCode: 50,
        reasons: [],
      },
    ];
    const rubocopOnly = weighLayers(rubyRecords, [
      { name: "RuboCop", category: "linter", configFile: ".rubocop.yml" },
    ]);
    expect(rubocopOnly.static.percentage).toBe(60);

    const rubocopWithSorbet = weighLayers(rubyRecords, [
      { name: "RuboCop", category: "linter", configFile: ".rubocop.yml" },
      { name: "Sorbet", category: "typechecker", configFile: "sorbet/config", isStrict: true },
    ]);
    expect(rubocopWithSorbet.static.percentage).toBe(100);
  });

  it("divides dynamic tests cleanly to 100% total regardless of static score", () => {
    const records: TestFileRecord[] = [
      {
        filePath: "calc.test.ts",
        language: "TypeScript",
        layer: "unit",
        testCaseCount: 80,
        linesOfCode: 400,
        reasons: [],
      },
      {
        filePath: "api.int.test.ts",
        language: "TypeScript",
        layer: "integration",
        testCaseCount: 20,
        linesOfCode: 200,
        reasons: [],
      },
    ];

    const stats = weighLayers(records, [
      { name: "TypeScript", category: "typechecker", configFile: "tsconfig.json", isStrict: true },
      { name: "Oxlint", category: "linter", configFile: ".oxlintrc.json" },
      { name: "Oxfmt", category: "formatter", configFile: ".oxfmtrc.json" },
    ]);

    expect(stats.static.percentage).toBe(100);
    // Dynamic layers sum up to exactly 100%
    const dynamicSum = stats.unit.percentage + stats.integration.percentage + stats.e2e.percentage;
    expect(dynamicSum).toBe(100);
    expect(stats.unit.percentage).toBeGreaterThan(60);
    expect(stats.integration.percentage).toBeGreaterThan(20);
    expect(stats.e2e.percentage).toBe(0);
  });
});

describe("determineArchetype with a thin unit tier", () => {
  const record = (layer: TestLayer, testCaseCount: number): TestFileRecord => ({
    filePath: `${layer}.test.ts`,
    language: "TypeScript",
    layer,
    testCaseCount,
    linesOfCode: 50,
    reasons: [],
  });
  const staticTools = [{ name: "TypeScript", configFile: "tsconfig.json" }];

  it("detects Testing Trophy when integration dominates and a small unit tier exists", () => {
    const records = [record("integration", 1000), record("unit", 40)];
    const stats = weighLayers(records, staticTools);
    expect(stats.unit.percentage).toBeLessThan(10);

    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("trophy");
  });

  it("detects Monolith Spike only when the other dynamic layers are practically absent", () => {
    const records = [record("integration", 1000), record("unit", 5)];
    const stats = weighLayers(records, staticTools);
    expect(stats.unit.percentage).toBeLessThan(2);

    const verdict = determineArchetype(stats, records.length);
    expect(verdict.type).toBe("monolith-spike");
  });
});

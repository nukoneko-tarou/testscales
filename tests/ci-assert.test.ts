import { describe, expect, it } from "@rstest/core";
import { evaluateCiAssertions } from "../src/judge/ci-assert.js";
import type { ScaleResult } from "../src/types.js";

function createMockScaleResult(
  archetypeType: ScaleResult["verdict"]["type"],
  layers: { static?: number; unit?: number; integration?: number; e2e?: number } = {},
): ScaleResult {
  const s = layers.static ?? 15;
  const u = layers.unit ?? 25;
  const i = layers.integration ?? 50;
  const e = layers.e2e ?? 10;

  return {
    rootDir: "/mock/repo",
    totalFiles: 34,
    totalTests: 162,
    staticTools: [],
    languageProfiles: [],
    dominantLayer: "integration",
    layers: {
      static: {
        layer: "static",
        percentage: s,
        fileCount: 2,
        testCaseCount: 2,
        linesOfCode: 0,
        weight: s,
      },
      unit: {
        layer: "unit",
        percentage: u,
        fileCount: 10,
        testCaseCount: 50,
        linesOfCode: 500,
        weight: u,
      },
      integration: {
        layer: "integration",
        percentage: i,
        fileCount: 20,
        testCaseCount: 100,
        linesOfCode: 1500,
        weight: i,
      },
      e2e: {
        layer: "e2e",
        percentage: e,
        fileCount: 2,
        testCaseCount: 10,
        linesOfCode: 200,
        weight: e,
      },
    },
    verdict: {
      type: archetypeType,
      name: `Mock ${archetypeType}`,
      tagline: "Tagline",
      emoji: "🏆",
      asciiArt: "",
      philosophy: "Philosophy",
      strengths: [],
      cautions: [],
      humor: "Humor",
    },
    scanDurationMs: 12,
  };
}

describe("evaluateCiAssertions", () => {
  describe("--assert / --expect", () => {
    it("passes when actual archetype matches expected single archetype", () => {
      const result = createMockScaleResult("trophy");
      const evaluation = evaluateCiAssertions(result, { assert: "trophy" });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.failures.length).toBe(0);
    });

    it("passes when actual archetype matches one of multiple comma-separated archetypes", () => {
      const result = createMockScaleResult("diamond");
      const evaluation = evaluateCiAssertions(result, { expect: "trophy, diamond, pyramid" });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.failures.length).toBe(0);
    });

    it("fails when actual archetype does not match expected archetypes", () => {
      const result = createMockScaleResult("ice-cream-cone");
      const evaluation = evaluateCiAssertions(result, { assert: "trophy,pyramid" });

      expect(evaluation.passed).toBe(false);
      expect(evaluation.failures.length).toBe(1);
      expect(evaluation.failures[0]?.rule).toBe("assert");
      expect(evaluation.failures[0]?.message).toContain(
        "Expected archetype to be [trophy, pyramid]",
      );
      expect(evaluation.failures[0]?.actual).toBe("ice-cream-cone");
    });

    it("rejects unknown archetype names instead of failing every run", () => {
      const result = createMockScaleResult("trophy");
      expect(() => evaluateCiAssertions(result, { assert: "trophee" })).toThrow(
        "--assert got unknown archetype(s): trophee",
      );
      expect(() => evaluateCiAssertions(result, { forbid: "void,icecream" })).toThrow(
        "--forbid got unknown archetype(s): icecream",
      );
    });
  });

  describe("--forbid", () => {
    it("passes when actual archetype is not in forbidden list", () => {
      const result = createMockScaleResult("trophy");
      const evaluation = evaluateCiAssertions(result, { forbid: "void, ice-cream-cone" });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.failures.length).toBe(0);
    });

    it("fails when actual archetype matches forbidden list", () => {
      const result = createMockScaleResult("ice-cream-cone");
      const evaluation = evaluateCiAssertions(result, { forbid: "void, ice-cream-cone" });

      expect(evaluation.passed).toBe(false);
      expect(evaluation.failures.length).toBe(1);
      expect(evaluation.failures[0]?.rule).toBe("forbid");
      expect(evaluation.failures[0]?.message).toContain("Archetype 'ice-cream-cone'");
    });
  });

  describe("--ci default behavior", () => {
    it("automatically forbids void in --ci mode when no explicit rules provided", () => {
      const voidResult = createMockScaleResult("void");
      const evaluation = evaluateCiAssertions(voidResult, { ci: true });

      expect(evaluation.passed).toBe(false);
      expect(evaluation.failures.length).toBe(1);
      expect(evaluation.failures[0]?.rule).toBe("forbid");
      expect(evaluation.failures[0]?.actual).toBe("void");
    });

    it("passes non-void archetypes in --ci mode when no other rules violated", () => {
      const trophyResult = createMockScaleResult("trophy");
      const evaluation = evaluateCiAssertions(trophyResult, { ci: true });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.failures.length).toBe(0);
    });
  });

  describe("layer percentage threshold guards", () => {
    it("enforces minStatic, maxE2e, minIntegration, and minUnit guards", () => {
      const result = createMockScaleResult("trophy", {
        static: 8, // below minStatic 10
        unit: 15, // below minUnit 20
        integration: 35, // below minIntegration 40
        e2e: 42, // above maxE2e 20
      });

      const evaluation = evaluateCiAssertions(result, {
        minStatic: 10,
        maxE2e: 20,
        minIntegration: 40,
        minUnit: 20,
      });

      expect(evaluation.passed).toBe(false);
      expect(evaluation.failures.length).toBe(4);

      const rules = evaluation.failures.map((f) => f.rule);
      expect(rules).toContain("minStatic");
      expect(rules).toContain("maxE2e");
      expect(rules).toContain("minIntegration");
      expect(rules).toContain("minUnit");
    });

    it("passes when all layer thresholds are respected", () => {
      const result = createMockScaleResult("trophy", {
        static: 15,
        unit: 25,
        integration: 50,
        e2e: 10,
      });

      const evaluation = evaluateCiAssertions(result, {
        minStatic: 10,
        maxE2e: 15,
        minIntegration: 45,
        minUnit: 20,
      });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.failures.length).toBe(0);
    });
  });
});

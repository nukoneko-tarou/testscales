import type { ArchetypeType, ScaleResult } from "../types.js";
import { ARCHETYPES } from "./archetypes.js";

function parseArchetypes(flag: string, list: string): ArchetypeType[] {
  const names = list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const known = Object.keys(ARCHETYPES);
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length > 0) {
    throw new Error(
      `--${flag} got unknown archetype(s): ${unknown.join(", ")}. Valid: ${known.join(", ")}`,
    );
  }
  return names as ArchetypeType[];
}

export interface CiAssertOptions {
  assert?: string; // e.g. "trophy" or "trophy,diamond"
  expect?: string; // alias for assert
  forbid?: string; // e.g. "void,ice-cream-cone"
  ci?: boolean;
  minStatic?: number;
  maxE2e?: number;
  minIntegration?: number;
  minUnit?: number;
}

export interface CiAssertionFailure {
  rule: string;
  message: string;
  expected: string;
  actual: string;
}

export interface CiAssertResult {
  passed: boolean;
  failures: CiAssertionFailure[];
}

export function evaluateCiAssertions(
  result: ScaleResult,
  options: CiAssertOptions,
): CiAssertResult {
  const failures: CiAssertionFailure[] = [];
  const actualType = result.verdict.type;

  // 1. --assert / --expect: Expected allowed archetypes
  const allowedStr = options.assert || options.expect;
  if (allowedStr) {
    const allowed = parseArchetypes(options.assert ? "assert" : "expect", allowedStr);

    if (allowed.length > 0 && !allowed.includes(actualType)) {
      failures.push({
        rule: "assert",
        message: `Expected archetype to be [${allowed.join(", ")}], but determined as '${actualType}' (${result.verdict.name})`,
        expected: allowed.join(", "),
        actual: actualType,
      });
    }
  }

  // 2. --forbid: Disallowed archetypes
  const forbidStr = options.forbid;
  const forbidden: ArchetypeType[] = [];
  if (forbidStr) {
    forbidden.push(...parseArchetypes("forbid", forbidStr));
  }
  // In default --ci mode without explicit assert, forbid void automatically
  if (options.ci && !forbidStr && !allowedStr) {
    forbidden.push("void");
  }

  if (forbidden.includes(actualType)) {
    failures.push({
      rule: "forbid",
      message: `Archetype '${actualType}' (${result.verdict.name}) is forbidden by policy`,
      expected: `NOT in [${forbidden.join(", ")}]`,
      actual: actualType,
    });
  }

  // 3. Layer percentage threshold guards
  if (options.minStatic !== undefined && result.layers.static.percentage < options.minStatic) {
    failures.push({
      rule: "minStatic",
      message: `STATIC layer is ${result.layers.static.percentage}%, below required minimum of ${options.minStatic}%`,
      expected: `>= ${options.minStatic}%`,
      actual: `${result.layers.static.percentage}%`,
    });
  }

  if (options.maxE2e !== undefined && result.layers.e2e.percentage > options.maxE2e) {
    failures.push({
      rule: "maxE2e",
      message: `E2E layer is ${result.layers.e2e.percentage}%, exceeding maximum allowed of ${options.maxE2e}%`,
      expected: `<= ${options.maxE2e}%`,
      actual: `${result.layers.e2e.percentage}%`,
    });
  }

  if (
    options.minIntegration !== undefined &&
    result.layers.integration.percentage < options.minIntegration
  ) {
    failures.push({
      rule: "minIntegration",
      message: `INTEGRATION layer is ${result.layers.integration.percentage}%, below required minimum of ${options.minIntegration}%`,
      expected: `>= ${options.minIntegration}%`,
      actual: `${result.layers.integration.percentage}%`,
    });
  }

  if (options.minUnit !== undefined && result.layers.unit.percentage < options.minUnit) {
    failures.push({
      rule: "minUnit",
      message: `UNIT layer is ${result.layers.unit.percentage}%, below required minimum of ${options.minUnit}%`,
      expected: `>= ${options.minUnit}%`,
      actual: `${result.layers.unit.percentage}%`,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

import { describe, expect, it } from "@rstest/core";
import { classifyFile, countTestCases } from "../src/classifier/heuristics.js";

describe("countTestCases", () => {
  it("counts standard it and test assertions", () => {
    const code = `
      describe('suite', () => {
        it('first test', () => {})
        test('second test', () => {})
        it.skip('skipped test', () => {})
      })
    `;
    expect(countTestCases(code)).toBe(3);
  });

  it("counts cucumber scenarios in feature files", () => {
    const feature = `
      Feature: User login
        Scenario: Success login
        Scenario Outline: Multiple attempts
    `;
    expect(countTestCases(feature)).toBe(2);
  });

  it("counts assertion calls when no test blocks are present", () => {
    const script = `
      const assert = require('assert')
      assert.strictEqual(1, 1)
      assert.deepStrictEqual({ a: 1 }, { a: 1 })
      assert.throws(() => {})
    `;
    expect(countTestCases(script)).toBe(3);
  });

  it("defaults to 1 if no test patterns found in a test file", () => {
    expect(countTestCases("// empty test file")).toBe(1);
  });
});

describe("classifyFile with .spec and naming patterns", () => {
  it("recognizes .spec. extensions across all layers", () => {
    expect(classifyFile("tests/checkout.e2e.spec.ts", "").layer).toBe("e2e");
    expect(classifyFile("src/auth.unit.spec.ts", "").layer).toBe("unit");
    expect(classifyFile("components/modal.integration.spec.tsx", "").layer).toBe("integration");
    expect(classifyFile("components/card.component.spec.tsx", "").layer).toBe("integration");
    expect(classifyFile("specs/integration/api.spec.ts", "").layer).toBe("integration");
  });

  it("recognizes Cypress .cy.ts and cypress directories", () => {
    expect(classifyFile("cypress/e2e/home.cy.ts", "").layer).toBe("e2e");
    expect(classifyFile("specs/checkout.cy.js", "").layer).toBe("e2e");
  });

  it("recognizes Playwright context with default tests/*.spec.ts convention", () => {
    // Without context: defaults to generic unit fallback
    expect(classifyFile("tests/example.spec.ts", 'test("hello", () => {})').layer).toBe("unit");

    // With playwright context: recognizes as Playwright standard E2E
    const res = classifyFile("tests/example.spec.ts", 'test("hello", () => {})', {
      hasPlaywright: true,
    });
    expect(res.layer).toBe("e2e");
    expect(res.reasons).toContain("Playwright config present with default spec path");
  });

  it("recognizes contract and container integration tests", () => {
    const contract = classifyFile(
      "src/api.test.ts",
      `
      import { Pact } from '@pact-foundation/pact'
    `,
    );
    expect(contract.layer).toBe("integration");

    const container = classifyFile(
      "src/db.test.ts",
      `
      import { GenericContainer } from 'testcontainers'
    `,
    );
    expect(container.layer).toBe("integration");
  });

  it("classifies isolated mock specs as unit", () => {
    const res = classifyFile(
      "src/utils/math.spec.ts",
      `
      vi.mock('./dependency')
      it('adds two numbers', () => {
        expect(1 + 1).toBe(2)
      })
    `,
    );
    expect(res.layer).toBe("unit");
  });
});

describe("classifyFile JSX detection", () => {
  it("does not mistake TypeScript generics for component rendering", () => {
    const res = classifyFile(
      "src/models/form.spec.ts",
      `
      const values: Array<FormValues> = []
      const ctx = createContext<ToolContext>(null)
      it('parses form values', () => {
        expect(parse<FormValues>(values)).toEqual([])
      })
    `,
    );
    expect(res.layer).toBe("unit");
    expect(res.reasons).not.toContain("Component DOM rendering API");
  });

  it("recognizes self-closing and paired JSX elements as component rendering", () => {
    const selfClosing = classifyFile(
      "src/card.test.tsx",
      `it('mounts', () => { mount(<Card title="hello" />) })`,
    );
    expect(selfClosing.layer).toBe("integration");
    expect(selfClosing.reasons).toContain("Component DOM rendering API");

    const paired = classifyFile(
      "src/card.test.tsx",
      `it('mounts', () => { mount(<Card>hi</Card>) })`,
    );
    expect(paired.layer).toBe("integration");
  });
});

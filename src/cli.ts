#!/usr/bin/env node
import { cac } from "cac";
import pc from "picocolors";
import { weighRepository } from "./index.js";
import { renderTerminalReport } from "./renderer/terminal.js";

import { evaluateCiAssertions } from "./judge/ci-assert.js";
import pkg from "../package.json" with { type: "json" };

const cli = cac("testscales");

function parsePercent(flag: string, value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === "" || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`--${flag} expects a number between 0 and 100, got '${value}'`);
  }
  return n;
}

cli
  .command("[dir]", "Weigh the testing archetype of a repository")
  .option("--json", "Output results as JSON format")
  .option("--ignore <patterns>", "Comma-separated patterns to ignore")
  .option("--verbose", "Show detailed file classifications")
  .option("--ci", "CI mode: enforces policy rules and exits with code 1 on violations")
  .option("--assert <archetypes>", "Assert archetype matches expected list (e.g. trophy,pyramid)")
  .option("--expect <archetypes>", "Alias for --assert")
  .option(
    "--forbid <archetypes>",
    "Fail if archetype matches forbidden list (e.g. void,ice-cream-cone)",
  )
  .option("--min-static <pct>", "Fail if STATIC percentage is below threshold (e.g. 10)")
  .option("--max-e2e <pct>", "Fail if E2E percentage exceeds threshold (e.g. 25)")
  .option("--min-integration <pct>", "Fail if INTEGRATION percentage is below threshold (e.g. 30)")
  .option("--min-unit <pct>", "Fail if UNIT percentage is below threshold (e.g. 20)")
  .action(
    async (
      dir = ".",
      options: {
        json?: boolean;
        ignore?: string;
        verbose?: boolean;
        ci?: boolean;
        assert?: string;
        expect?: string;
        forbid?: string;
        minStatic?: string | number;
        maxE2e?: string | number;
        minIntegration?: string | number;
        minUnit?: string | number;
      },
    ) => {
      try {
        const customIgnore = options.ignore ? options.ignore.split(",").map((s) => s.trim()) : [];

        const result = await weighRepository(dir, {
          ignore: customIgnore,
          verbose: options.verbose,
          json: options.json,
        });

        // Check if any CI / Policy assertion is requested
        const hasPolicy =
          Boolean(options.ci) ||
          Boolean(options.assert) ||
          Boolean(options.expect) ||
          Boolean(options.forbid) ||
          options.minStatic !== undefined ||
          options.maxE2e !== undefined ||
          options.minIntegration !== undefined ||
          options.minUnit !== undefined;

        let ciResult = undefined;
        if (hasPolicy) {
          ciResult = evaluateCiAssertions(result, {
            assert: options.assert,
            expect: options.expect,
            forbid: options.forbid,
            ci: options.ci,
            minStatic: parsePercent("min-static", options.minStatic),
            maxE2e: parsePercent("max-e2e", options.maxE2e),
            minIntegration: parsePercent("min-integration", options.minIntegration),
            minUnit: parsePercent("min-unit", options.minUnit),
          });
        }

        if (options.json) {
          const jsonOutput = {
            ...result,
            ...(ciResult ? { ciAssertion: ciResult } : {}),
          };
          console.log(JSON.stringify(jsonOutput, null, 2));
          if (ciResult && !ciResult.passed) {
            process.exit(1);
          }
          return;
        }

        console.log(renderTerminalReport(result));

        if (ciResult) {
          const sep = pc.dim("─".repeat(70));
          console.log(sep);
          if (ciResult.passed) {
            console.log(`  ${pc.bold(pc.green("✅ CI POLICY ASSERTION PASSED"))}`);
            console.log(
              `     Archetype ${pc.bold(pc.yellow(`'${result.verdict.name}'`))} satisfies CI constraints.`,
            );
          } else {
            console.log(`  ${pc.bold(pc.red("❌ CI POLICY ASSERTION FAILED"))}`);
            for (const f of ciResult.failures) {
              console.log(`     ${pc.red("•")} ${f.message}`);
            }
            console.log(sep);
            process.exit(1);
          }
          console.log(sep);
        }
      } catch (error) {
        console.error(pc.red(`\n❌ Error during testscales execution:`));
        if (error instanceof Error) {
          console.error(pc.red(`   ${error.message}`));
        } else {
          console.error(pc.red(`   ${String(error)}`));
        }
        process.exit(1);
      }
    },
  );

cli.help();
cli.version(pkg.version);

cli.parse();

import { type Dirent, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StaticAnalysisRecord, StaticToolCategory } from "../types.js";

export interface DetectedConfigs {
  staticTools: StaticAnalysisRecord[];
  hasCiEnforcement: boolean;
  hasPlaywright: boolean;
  hasCypress: boolean;
  hasVitest: boolean;
  hasRstest: boolean;
  hasJest: boolean;
  hasStorybook: boolean;
}

interface StaticPattern {
  name: string;
  files: string[];
  category: StaticToolCategory;
}

const STATIC_CONFIG_PATTERNS: StaticPattern[] = [
  {
    name: "TypeScript",
    files: ["tsconfig.json", "tsconfig.base.json", "tsconfig.app.json"],
    category: "typechecker",
  },
  {
    name: "ESLint",
    files: [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc.yaml",
      ".eslintrc.yml",
    ],
    category: "linter",
  },
  { name: "Biome", files: ["biome.json", "biome.jsonc"], category: "linter" },
  { name: "Oxlint", files: [".oxlintrc.json", "oxlint.json"], category: "linter" },
  { name: "Oxfmt", files: [".oxfmtrc.json", ".oxfmtrc", "oxfmt.json"], category: "formatter" },
  {
    name: "Prettier",
    files: [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"],
    category: "formatter",
  },
  { name: "MyPy", files: ["mypy.ini", ".mypy.ini"], category: "typechecker" },
  { name: "Pyright", files: ["pyrightconfig.json"], category: "typechecker" },
  { name: "Ruff", files: ["ruff.toml", ".ruff.toml"], category: "linter" },
  { name: "Flake8", files: [".flake8"], category: "linter" },
  {
    name: "GolangCI-Lint",
    files: [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"],
    category: "linter",
  },
  { name: "RuboCop", files: [".rubocop.yml"], category: "linter" },
  { name: "Sorbet", files: ["sorbet/config"], category: "typechecker" },
  { name: "Steep", files: ["Steepfile"], category: "typechecker" },
  {
    name: "PHPStan",
    files: ["phpstan.neon", "phpstan.neon.dist", "phpstan.dist.neon"],
    category: "typechecker",
  },
  {
    name: "Psalm",
    files: ["psalm.xml", "psalm.xml.dist", "psalm.dist.xml"],
    category: "typechecker",
  },
  { name: "Pint", files: ["pint.json"], category: "formatter" },
  {
    name: "PHP-CS-Fixer",
    files: [".php-cs-fixer.php", ".php-cs-fixer.dist.php"],
    category: "formatter",
  },
  {
    name: "PHP_CodeSniffer",
    files: ["phpcs.xml", "phpcs.xml.dist", ".phpcs.xml", ".phpcs.xml.dist"],
    category: "linter",
  },
  { name: "Rector", files: ["rector.php"], category: "linter" },
];

const PROJECT_MANIFESTS = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
];
const SKIPPED_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target", "coverage"]);

/**
 * The root plus workspace packages up to two levels deep (packages/foo, apps/web, backend),
 * recognised by a project manifest. Root comes first so its configs take precedence.
 */
function listProjectDirs(rootDir: string): string[] {
  const projectDirs = [""];
  let frontier = [""];
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = [];
    for (const dir of frontier) {
      let entries: Dirent[];
      try {
        entries = readdirSync(join(rootDir, dir), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith(".") && !SKIPPED_DIRS.has(e.name)) {
          next.push(dir ? `${dir}/${e.name}` : e.name);
        }
      }
    }
    for (const dir of next) {
      if (PROJECT_MANIFESTS.some((m) => existsSync(join(rootDir, dir, m)))) projectDirs.push(dir);
    }
    frontier = next;
  }
  return projectDirs;
}

export function detectConfigs(rootDir: string): DetectedConfigs {
  const staticTools: StaticAnalysisRecord[] = [];
  const recordedTools = new Set<string>();

  for (const projectDir of listProjectDirs(rootDir)) {
    const dir = join(rootDir, projectDir);
    const rel = (file: string) => (projectDir ? `${projectDir}/${file}` : file);

    // 1. Check standalone config files
    for (const { name, files, category } of STATIC_CONFIG_PATTERNS) {
      for (const file of files) {
        const fullPath = join(dir, file);
        if (existsSync(fullPath)) {
          let isStrict = false;
          if (name === "TypeScript") {
            try {
              const content = readFileSync(fullPath, "utf8");
              if (
                /"strict"\s*:\s*true/i.test(content) ||
                /"strictNullChecks"\s*:\s*true/i.test(content)
              ) {
                isStrict = true;
              }
            } catch {
              // ignore read error
            }
          } else if (name === "PHPStan") {
            try {
              const content = readFileSync(fullPath, "utf8");
              if (/level:\s*(?:8|9|max)/i.test(content)) {
                isStrict = true;
              }
            } catch {
              // ignore read error
            }
          } else if (name === "Psalm") {
            try {
              const content = readFileSync(fullPath, "utf8");
              if (
                /errorLevel\s*=\s*["']?[12]["']?/i.test(content) ||
                /totallyTyped\s*=\s*["']true["']/i.test(content)
              ) {
                isStrict = true;
              }
            } catch {
              // ignore read error
            }
          }
          // One record per tool; a strict config in any workspace package marks it strict.
          const existing = staticTools.find((t) => t.name === name);
          if (existing) {
            if (isStrict) existing.isStrict = true;
            break;
          }
          staticTools.push({
            name,
            configFile: rel(file),
            category,
            ...(isStrict ? { isStrict: true } : {}),
          });
          recordedTools.add(name);
          break;
        }
      }
    }

    // 2. Check pyproject.toml for inline Python static tools
    const pyprojectPath = join(dir, "pyproject.toml");
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, "utf8");
        if (!recordedTools.has("Ruff") && /\[tool\.ruff/i.test(content)) {
          staticTools.push({ name: "Ruff", configFile: rel("pyproject.toml"), category: "linter" });
          recordedTools.add("Ruff");
        }
        if (!recordedTools.has("MyPy") && /\[tool\.mypy/i.test(content)) {
          const isStrict = /strict\s*=\s*true/i.test(content);
          staticTools.push({
            name: "MyPy",
            configFile: rel("pyproject.toml"),
            category: "typechecker",
            ...(isStrict ? { isStrict: true } : {}),
          });
          recordedTools.add("MyPy");
        }
        if (!recordedTools.has("Pyright") && /\[tool\.pyright/i.test(content)) {
          staticTools.push({
            name: "Pyright",
            configFile: rel("pyproject.toml"),
            category: "typechecker",
          });
          recordedTools.add("Pyright");
        }
        if (!recordedTools.has("Flake8") && /\[tool\.flake8/i.test(content)) {
          staticTools.push({
            name: "Flake8",
            configFile: rel("pyproject.toml"),
            category: "linter",
          });
          recordedTools.add("Flake8");
        }
      } catch {
        // ignore
      }
    }

    // 3. Check package.json for inline eslint, biome, oxlint, or oxfmt
    const pkgJsonPath = join(dir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const content = readFileSync(pkgJsonPath, "utf8");
        if (!recordedTools.has("ESLint") && /"eslintConfig"/i.test(content)) {
          staticTools.push({ name: "ESLint", configFile: rel("package.json"), category: "linter" });
          recordedTools.add("ESLint");
        }
        if (!recordedTools.has("Biome") && /"biome"/i.test(content)) {
          staticTools.push({ name: "Biome", configFile: rel("package.json"), category: "linter" });
          recordedTools.add("Biome");
        }
        if (!recordedTools.has("Oxlint") && /"(?:@oxc-project\/oxlint|oxlint)"/i.test(content)) {
          staticTools.push({ name: "Oxlint", configFile: rel("package.json"), category: "linter" });
          recordedTools.add("Oxlint");
        }
        if (!recordedTools.has("Oxfmt") && /"(?:@oxc-project\/oxfmt|oxfmt)"/i.test(content)) {
          staticTools.push({
            name: "Oxfmt",
            configFile: rel("package.json"),
            category: "formatter",
          });
          recordedTools.add("Oxfmt");
        }
      } catch {
        // ignore
      }
    }

    // 4. Check composer.json for PHP static tools
    const composerJsonPath = join(dir, "composer.json");
    if (existsSync(composerJsonPath)) {
      try {
        const content = readFileSync(composerJsonPath, "utf8");
        if (!recordedTools.has("PHPStan") && /"phpstan\/phpstan"/i.test(content)) {
          staticTools.push({
            name: "PHPStan",
            configFile: rel("composer.json"),
            category: "typechecker",
          });
          recordedTools.add("PHPStan");
        }
        if (!recordedTools.has("Psalm") && /"vimeo\/psalm"/i.test(content)) {
          staticTools.push({
            name: "Psalm",
            configFile: rel("composer.json"),
            category: "typechecker",
          });
          recordedTools.add("Psalm");
        }
        if (!recordedTools.has("Pint") && /"laravel\/pint"/i.test(content)) {
          staticTools.push({
            name: "Pint",
            configFile: rel("composer.json"),
            category: "formatter",
          });
          recordedTools.add("Pint");
        }
        if (!recordedTools.has("PHP-CS-Fixer") && /"friendsofphp\/php-cs-fixer"/i.test(content)) {
          staticTools.push({
            name: "PHP-CS-Fixer",
            configFile: rel("composer.json"),
            category: "formatter",
          });
          recordedTools.add("PHP-CS-Fixer");
        }
        if (
          !recordedTools.has("PHP_CodeSniffer") &&
          /"squizlabs\/php_codesniffer"/i.test(content)
        ) {
          staticTools.push({
            name: "PHP_CodeSniffer",
            configFile: rel("composer.json"),
            category: "linter",
          });
          recordedTools.add("PHP_CodeSniffer");
        }
      } catch {
        // ignore
      }
    }

    // 5. Native statically-typed language indicators (Go, Rust)
    if (existsSync(join(dir, "go.mod")) && !recordedTools.has("Go Type System")) {
      staticTools.push({ name: "Go Type System", configFile: rel("go.mod"), category: "compiler" });
      recordedTools.add("Go Type System");
    }
    if (existsSync(join(dir, "Cargo.toml")) && !recordedTools.has("Rust Type System")) {
      staticTools.push({
        name: "Rust Type System",
        configFile: rel("Cargo.toml"),
        category: "compiler",
      });
      recordedTools.add("Rust Type System");
    }
  }

  const hasPlaywright = [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
  ].some((f) => existsSync(join(rootDir, f)));

  const hasCypress = ["cypress.config.ts", "cypress.config.js", "cypress.json"].some((f) =>
    existsSync(join(rootDir, f)),
  );

  const hasVitest = ["vitest.config.ts", "vitest.config.js", "vitest.config.mjs"].some((f) =>
    existsSync(join(rootDir, f)),
  );

  const hasRstest = ["rstest.config.ts", "rstest.config.js", "rstest.config.mjs"].some((f) =>
    existsSync(join(rootDir, f)),
  );

  const hasJest = ["jest.config.ts", "jest.config.js", "jest.config.mjs", "jest.config.json"].some(
    (f) => existsSync(join(rootDir, f)),
  );

  const hasStorybook = [
    ".storybook/main.ts",
    ".storybook/main.js",
    ".storybook/main.mjs",
    ".storybook/main.cjs",
  ].some((f) => existsSync(join(rootDir, f)));

  const hasCiEnforcement = checkCiEnforcement(rootDir);

  return {
    staticTools,
    hasCiEnforcement,
    hasPlaywright,
    hasCypress,
    hasVitest,
    hasRstest,
    hasJest,
    hasStorybook,
  };
}

function checkCiEnforcement(rootDir: string): boolean {
  // 1. Check GitHub Actions workflows
  const workflowsDir = join(rootDir, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    try {
      const entries = readdirSync(workflowsDir);
      for (const entry of entries) {
        if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
          const content = readFileSync(join(workflowsDir, entry), "utf8");
          if (
            /\b(?:typecheck|tsc\b|eslint\b|oxlint\b|biome\s+check|ruff\s+check|mypy\b|golangci-lint\b|rubocop\b|phpstan\b|psalm\b|pint\b|phpcs\b|cargo\s+(?:check|clippy))\b/i.test(
              content,
            )
          ) {
            return true;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Check pre-commit hooks: they only count when they actually run a static check
  //    (a .pre-commit-config.yaml with just trailing-whitespace does not).
  for (const hookFile of [".pre-commit-config.yaml", join(".husky", "pre-commit")]) {
    try {
      const content = readFileSync(join(rootDir, hookFile), "utf8");
      if (
        /\b(?:lint|typecheck|tsc|oxlint|eslint|biome|ruff|mypy|pyright|flake8|golangci-lint|rubocop|phpstan|psalm|pint|clippy)\b/i.test(
          content,
        )
      ) {
        return true;
      }
    } catch {
      // hook file absent or unreadable
    }
  }

  return false;
}

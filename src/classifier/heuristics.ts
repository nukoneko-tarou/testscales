import type { TestLayer } from "../types.js";
import { goClassifier } from "./languages/go.js";
import { phpClassifier } from "./languages/php.js";
import { pythonClassifier } from "./languages/python.js";
import { rubyClassifier } from "./languages/ruby.js";
import { analyzeStorybook, isStorybookFile } from "./storybook.js";

const LANGUAGE_CLASSIFIERS = [pythonClassifier, goClassifier, rubyClassifier, phpClassifier];

export interface ClassifyContext {
  hasPlaywright?: boolean;
  hasCypress?: boolean;
}

export interface ClassifyResult {
  layer: TestLayer;
  language: string;
  testCaseCount: number;
  linesOfCode: number;
  reasons: string[];
}

export function detectFileLanguage(filePath: string): string {
  if (filePath.toLowerCase().endsWith(".feature.md")) return "Cucumber";
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return "Other";
  const ext = filePath.slice(dotIndex).toLowerCase();

  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "TypeScript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "JavaScript";
    case ".py":
      return "Python";
    case ".go":
      return "Go";
    case ".rb":
      return "Ruby";
    case ".php":
      return "PHP";
    case ".rs":
      return "Rust";
    case ".feature":
      return "Cucumber";
    default:
      return "Other";
  }
}

// 1. Path Regex Patterns
const E2E_PATH_REGEX =
  /(?:^|\/)(?:e2e|cypress|playwright|tests?\/e2e|specs?\/e2e|specs?\/smoke|tests?\/smoke)(?:\/|$)|(?:\.|\/)(?:e2e|system|smoke)[._-](?:test|spec)\.[a-zA-Z0-9]+$|\.cy\.[a-zA-Z0-9]+$|\.feature(?:\.md)?$|(?:^|\/)scripts\/[^/]*journey[^/]*$/i;

const INTEGRATION_PATH_REGEX =
  /(?:^|\/)(?:integration|int|tests?\/integration|specs?\/integration|contract)(?:\/|$)|(?:\.|\/)(?:integration|int|component|contract|api)[._-](?:test|spec)\.[a-zA-Z0-9]+$/i;

const UNIT_PATH_REGEX =
  /(?:^|\/)(?:unit|tests?\/unit|specs?\/unit|isolated)(?:\/|$)|(?:\.|\/)(?:unit|isolated)[._-](?:test|spec)\.[a-zA-Z0-9]+$/i;

// 2. Content Indicators
const E2E_INDICATORS = [
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"]@playwright\/test['"]|const\b[\s\S]*?=\s*require\(['"]@playwright\/test['"]\))/i,
    reason: "Playwright test runner import",
  },
  { pattern: /\bcy\.(?:visit|get|contains|intercept)\b/i, reason: "Cypress API commands" },
  {
    pattern: /\bpage\.(?:goto|click|fill|waitForSelector|screenshot|locator)\b/i,
    reason: "Browser page navigation API",
  },
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"](?:puppeteer|selenium-webdriver|webdriverio|@wdio\/[a-z0-9-]+|testcafe)['"]|const\b[\s\S]*?=\s*require\(['"](?:puppeteer|selenium-webdriver|webdriverio|@wdio\/[a-z0-9-]+|testcafe)['"]\))/i,
    reason: "Browser automation framework import",
  },
];

const INTEGRATION_INDICATORS = [
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"]@testing-library\/(?:react-native|react|vue|svelte|angular|dom|user-event)['"]|const\b[\s\S]*?=\s*require\(['"]@testing-library)/i,
    reason: "Testing Library import",
  },
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"](?:@vue\/test-utils|enzyme)['"]|const\b[\s\S]*?=\s*require\(['"](?:@vue\/test-utils|enzyme)['"]\))/i,
    reason: "Component testing framework import",
  },
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"](?:supertest|nock|msw(?:\/node)?)['"]|const\b[\s\S]*?=\s*require\(['"](?:supertest|nock|msw(?:\/node)?)['"]\))/i,
    reason: "Network/HTTP endpoint integration tool",
  },
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"](?:testcontainers|@testcontainers\/[a-z0-9-]+|mongodb-memory-server)['"]|const\b[\s\S]*?=\s*require\(['"](?:testcontainers|@testcontainers\/[a-z0-9-]+|mongodb-memory-server)['"]\))/i,
    reason: "Container/DB integration setup",
  },
  {
    pattern:
      /(?:^|\n)\s*(?:import\b[\s\S]*?from\s+['"]@pact-foundation\/pact['"]|const\b[\s\S]*?=\s*require\(['"]@pact-foundation\/pact['"]\))/i,
    reason: "Pact contract testing import",
  },
  {
    pattern: /\brender\s*\(|<[A-Za-z][A-Za-z0-9]*(?:\s[^<>]*)?\/>|<\/[A-Za-z][A-Za-z0-9]*>/i,
    reason: "Component DOM rendering API",
  },
  { pattern: /\bscreen\.(?:getBy|findBy|queryBy)[A-Za-z]+\s*\(/i, reason: "DOM screen queries" },
];

// 3. Side-effect indicators: real filesystem I/O or child processes make a test
// integration regardless of path. Applied per language; only ever upgrades unit → integration.
const FS_REASON = "Real filesystem I/O (temp dir / file write)";
const PROC_REASON = "Child process execution";
const JS_SIDE_EFFECTS = [
  {
    pattern: /\bmkdtemp(?:Sync)?\s*\(|\b(?:writeFile|appendFile)(?:Sync)?\s*\(/,
    reason: FS_REASON,
  },
  {
    pattern:
      /(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|fork)\s*\(|\bBun\.spawn(?:Sync)?\s*\(|\bchild_process\.\w+\s*\(/,
    reason: PROC_REASON,
  },
];
const SIDE_EFFECT_INDICATORS: Record<string, { pattern: RegExp; reason: string }[]> = {
  TypeScript: JS_SIDE_EFFECTS,
  JavaScript: JS_SIDE_EFFECTS,
  Python: [
    {
      pattern:
        /\btempfile\.(?:mkdtemp|mkstemp|TemporaryDirectory|NamedTemporaryFile)\b|\b(?:tmp_path|tmpdir)\b|\.write_(?:text|bytes)\s*\(|\bopen\s*\([^)]*['"][wax]b?\+?['"]/,
      reason: FS_REASON,
    },
    {
      pattern:
        /\bsubprocess\.(?:run|Popen|call|check_call|check_output)\b|\bos\.(?:system|popen)\s*\(/,
      reason: PROC_REASON,
    },
  ],
  Go: [
    {
      pattern:
        /\b(?:os\.(?:MkdirTemp|CreateTemp|WriteFile)|ioutil\.(?:TempDir|TempFile|WriteFile)|t\.TempDir)\s*\(/,
      reason: FS_REASON,
    },
    { pattern: /\bexec\.Command(?:Context)?\s*\(/, reason: PROC_REASON },
  ],
  Ruby: [
    {
      pattern:
        /\bDir\.mktmpdir\b|\bTempfile\.(?:new|create)\b|\bFile\.(?:write|binwrite)\b|\bFile\.open\s*\([^)]*['"][wa]b?\+?['"]/,
      reason: FS_REASON,
    },
    {
      pattern: /\bOpen3\.\w+|\bIO\.popen\b|(?<![.\w])(?:system|spawn)\s*\(/,
      reason: PROC_REASON,
    },
  ],
  PHP: [
    {
      pattern: /\b(?:sys_get_temp_dir|tempnam|tmpfile|file_put_contents)\s*\(/,
      reason: FS_REASON,
    },
    {
      pattern:
        /(?<![.\w>$:])(?:exec|shell_exec|system|passthru|proc_open|popen)\s*\(|\bnew\s+(?:\\?Symfony\\Component\\Process\\)?Process\s*\(/,
      reason: PROC_REASON,
    },
  ],
};

const UNIT_INDICATORS = [
  { pattern: /\bvi\.mock\s*\(|\bjest\.mock\s*\(/i, reason: "Heavy module mocking" },
  { pattern: /\bsinon\.(?:spy|stub|mock)\s*\(/i, reason: "Test double spy/stub" },
  {
    pattern: /\bassert\.(?:deepStrictEqual|strictEqual|equal)\b/i,
    reason: "Strict unit assertion",
  },
];

const TEST_CASE_PATTERNS = [
  /(?:^|\n|\s)\b(?:it|test|describe\.each|test\.each)\s*(?:\.(?:only|skip|todo|concurrent|each))?\s*[(`]/g, // Jest / Vitest, including .each tagged templates
  /(?:^|\n)\s*def\s+test_[a-zA-Z0-9_]+\b/g, // Python pytest / Ruby test-unit
  /(?:^|\n)\s*func\s+Test[a-zA-Z0-9_]+\s*\(/g, // Go test
  /#\[test\]/g, // Rust test
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:Scenario(?:\s+Outline|\s+Template)?|シナリオ(?:アウトライン|テンプレート)?)\s*:/g, // Gherkin scenario (en/ja), plain or Markdown heading
  /(?:^|\n)\s*(?:it|specify|scenario)\s+['"][^'"]+['"]\s+do\b/g, // Ruby RSpec
  /(?:^|\n)\s*(?:public\s+)?function\s+test[a-zA-Z0-9_]+\s*\(/g, // PHPUnit test methods
  /(?:^|\n)\s*#\[(?:\\PHPUnit\\Framework\\Attributes\\)?Test\]/g, // PHP 8 test attributes
];

const ASSERTION_FALLBACK_PATTERNS = [
  /\bassert\.(?:strictEqual|deepStrictEqual|throws|rejects|ok|equal|notEqual|match|fail)\s*\(/g,
  /\bmustCall(?:AtLeast)?\s*\(/g,
  /\bexpect\s*\(/g,
];

export function countTestCases(content: string): number {
  let count = 0;
  for (const pattern of TEST_CASE_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  if (count === 0) {
    for (const pattern of ASSERTION_FALLBACK_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        count += matches.length;
      }
    }
  }
  return Math.max(count, 1);
}

export function classifyByPathOnly(
  filePath: string,
  context: ClassifyContext = {},
): { layer: TestLayer; reasons: string[] } | null {
  const normalizedPath = filePath.replace(/\\/g, "/");

  // 1. Path-based classification (strong explicit signal)
  if (E2E_PATH_REGEX.test(normalizedPath)) {
    return {
      layer: "e2e",
      reasons: ["File path or extension matches E2E pattern (*.e2e.*, *.cy.*, etc.)"],
    };
  }

  if (INTEGRATION_PATH_REGEX.test(normalizedPath)) {
    return {
      layer: "integration",
      reasons: ["File path matches Integration pattern (*.integration.*, *.component.*, etc.)"],
    };
  }

  if (UNIT_PATH_REGEX.test(normalizedPath)) {
    return {
      layer: "unit",
      reasons: ["File path matches Unit pattern (*.unit.*, etc.)"],
    };
  }

  // 2. Project config context correlation
  if (
    context.hasPlaywright &&
    /(?:^|\/)(?:tests?|specs?)\/.*\.spec\.[a-zA-Z0-9]+$/i.test(normalizedPath)
  ) {
    return {
      layer: "e2e",
      reasons: ["Playwright config present with default spec path"],
    };
  }

  if (context.hasCypress && /(?:^|\/)cypress\//i.test(normalizedPath)) {
    return {
      layer: "e2e",
      reasons: ["Cypress config present in cypress directory"],
    };
  }

  return null;
}

/**
 * Zero-allocation non-empty line counter.
 * Scans byte-by-byte without string splitting or array creation,
 * eliminating garbage collection overhead on massive codebases.
 */
export function countNonEmptyLines(content: string): number {
  let count = 0;
  let lineHasChar = false;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code === 10) {
      // \n
      if (lineHasChar) {
        count++;
        lineHasChar = false;
      }
    } else if (code > 32) {
      // Non-whitespace
      lineHasChar = true;
    }
  }
  if (lineHasChar) count++;
  return count;
}

export function classifyFile(
  filePath: string,
  content: string,
  context: ClassifyContext = {},
): ClassifyResult {
  const linesOfCode = countNonEmptyLines(content);
  const language = detectFileLanguage(filePath);

  // Storybook Coverage Depth Analysis
  if (isStorybookFile(filePath)) {
    const sb = analyzeStorybook(filePath, content);
    const testCaseCount =
      sb.depthLevel >= 3 ? Math.max(sb.assertionCount, sb.playCount) : sb.playCount;
    return {
      layer: sb.layer,
      language,
      testCaseCount,
      linesOfCode,
      reasons: sb.reasons,
    };
  }

  const testCaseCount = countTestCases(content);
  const { layer, reasons } = classifyLayer(filePath, content, context);
  if (layer === "unit") {
    const sideEffect = SIDE_EFFECT_INDICATORS[language]?.find((i) => i.pattern.test(content));
    if (sideEffect) {
      return {
        layer: "integration",
        language,
        testCaseCount,
        linesOfCode,
        reasons: [sideEffect.reason],
      };
    }
  }
  return { layer, language, testCaseCount, linesOfCode, reasons };
}

function classifyLayer(
  filePath: string,
  content: string,
  context: ClassifyContext,
): { layer: TestLayer; reasons: string[] } {
  // 1. Path heuristics (explicit signal)
  const fastPath = classifyByPathOnly(filePath, context);
  if (fastPath) return fastPath;

  // 2. Multi-language classifiers (Python, Go, Ruby, PHP)
  for (const classifier of LANGUAGE_CLASSIFIERS) {
    if (classifier.supports(filePath)) {
      const langResult = classifier.classify(filePath, content);
      if (langResult) return langResult;
      break;
    }
  }

  // 3. Content-based heuristic classification
  for (const indicator of E2E_INDICATORS) {
    if (indicator.pattern.test(content)) return { layer: "e2e", reasons: [indicator.reason] };
  }

  for (const indicator of INTEGRATION_INDICATORS) {
    if (indicator.pattern.test(content)) {
      return { layer: "integration", reasons: [indicator.reason] };
    }
  }

  const reasons = UNIT_INDICATORS.filter((i) => i.pattern.test(content)).map((i) => i.reason);
  reasons.push("Isolated specification without DOM/network integration markers");
  return { layer: "unit", reasons };
}

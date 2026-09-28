export type TestLayer = "static" | "unit" | "integration" | "e2e";

export interface TestFileRecord {
  filePath: string;
  language?: string;
  layer: TestLayer;
  testCaseCount: number;
  linesOfCode: number;
  reasons: string[];
}

export interface LanguageProfile {
  language: string;
  fileCount: number;
  testCaseCount: number;
  percentage: number;
}

export type StaticToolCategory = "typechecker" | "linter" | "formatter" | "compiler";

export interface StaticAnalysisRecord {
  name: string;
  configFile: string;
  category?: StaticToolCategory;
  isStrict?: boolean;
}

export interface LayerStats {
  layer: TestLayer;
  fileCount: number;
  testCaseCount: number;
  linesOfCode: number;
  weight: number;
  percentage: number;
}

export type ArchetypeType =
  | "trophy"
  | "pyramid"
  | "diamond"
  | "ice-cream-cone"
  | "hourglass"
  | "monolith-spike"
  | "balanced"
  | "void";

export interface ArchetypeVerdict {
  type: ArchetypeType;
  name: string;
  tagline: string;
  emoji: string;
  asciiArt: string;
  philosophy: string;
  strengths: string[];
  cautions: string[];
  humor: string;
}

export interface StaticEnvironment {
  staticTools: StaticAnalysisRecord[];
  typedRatio: number;
  hasCiEnforcement: boolean;
}

export interface ScaleResult {
  rootDir: string;
  totalFiles: number;
  totalTests: number;
  staticTools: StaticAnalysisRecord[];
  typedRatio?: number;
  hasCiEnforcement?: boolean;
  layers: Record<TestLayer, LayerStats>;
  languageProfiles: LanguageProfile[];
  dominantLayer: TestLayer | "none";
  verdict: ArchetypeVerdict;
  scanDurationMs: number;
  codeFileCount?: number;
  scannedFiles?: TestFileRecord[];
}

export interface ScanOptions {
  cwd?: string;
  ignore?: string[];
  verbose?: boolean;
  json?: boolean;
}

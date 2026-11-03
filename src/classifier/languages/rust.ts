import type { TestLayer } from "../../types.js";

// Cargo builds every file directly under a crate's tests/ directory as a separate
// integration test crate that only sees the public API.
const CARGO_INTEGRATION_PATH_REGEX = /(?:^|\/)tests\/[^/]+\.rs$/i;

export const rustClassifier = {
  language: "Rust",
  supports(filePath: string): boolean {
    return /\.rs$/i.test(filePath);
  },
  classify(filePath: string, _content: string): { layer: TestLayer; reasons: string[] } | null {
    if (CARGO_INTEGRATION_PATH_REGEX.test(filePath.replace(/\\/g, "/"))) {
      return { layer: "integration", reasons: ["Cargo integration test crate (tests/*.rs)"] };
    }
    return null;
  },
};

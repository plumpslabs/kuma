// ============================================================
// KUMA LANGUAGE SUPPORT — Multi-language registry (P1)
// ============================================================
// Single source of truth for per-language metadata so Kuma works
// with ANY codebase, not just TypeScript/JavaScript:
//   - Source file extensions per language
//   - Test file detection (cross-language conventions)
//   - Test file candidate generation (for contracts)
//   - Import/require patterns (for import whitelist validation)
//
// Used by: kumaCodeScanner, kumaGraph (impact fallback),
//          kumaContractEngine, kumaAstValidator
// ============================================================

import path from "node:path";

// ============================================================
// LANGUAGE REGISTRY
// ============================================================

export interface LanguageInfo {
  name: string;
  extensions: string[];
  /** Test file conventions: prefixes/suffixes applied to the basename */
  testPrefixes: string[];
  testSuffixes: string[];
  /** Directory names conventionally holding tests */
  testDirs: string[];
}

const LANGUAGES: LanguageInfo[] = [
  {
    name: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    testPrefixes: [],
    testSuffixes: [".test", ".spec"],
    testDirs: ["__tests__", "tests", "test", "spec"],
  },
  {
    name: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    testPrefixes: [],
    testSuffixes: [".test", ".spec"],
    testDirs: ["__tests__", "tests", "test", "spec"],
  },
  {
    name: "python",
    extensions: [".py", ".pyw"],
    testPrefixes: ["test_"],
    testSuffixes: ["_test"],
    testDirs: ["tests", "test"],
  },
  {
    name: "go",
    extensions: [".go"],
    testPrefixes: [],
    testSuffixes: ["_test"],
    testDirs: ["testdata"],
  },
  {
    name: "rust",
    extensions: [".rs"],
    testPrefixes: [],
    testSuffixes: ["_test"],
    testDirs: ["tests"],
  },
  {
    name: "java",
    extensions: [".java"],
    testPrefixes: ["Test"],
    testSuffixes: ["Test", "Tests"],
    testDirs: ["src/test", "test", "tests"],
  },
  {
    name: "kotlin",
    extensions: [".kt", ".kts"],
    testPrefixes: ["Test"],
    testSuffixes: ["Test", "Tests"],
    testDirs: ["src/test"],
  },
  {
    name: "csharp",
    extensions: [".cs"],
    testPrefixes: [],
    testSuffixes: ["Tests", "Test"],
    testDirs: ["Tests", "test", "tests"],
  },
  {
    name: "ruby",
    extensions: [".rb"],
    testPrefixes: [],
    testSuffixes: ["_spec", "_test"],
    testDirs: ["spec", "test", "tests"],
  },
  {
    name: "php",
    extensions: [".php"],
    testPrefixes: [],
    testSuffixes: ["Test"],
    testDirs: ["tests", "test"],
  },
  {
    name: "cpp",
    extensions: [".c", ".cc", ".cpp", ".h", ".hpp", ".hxx"],
    testPrefixes: [],
    testSuffixes: ["_test"],
    testDirs: ["tests", "test"],
  },
  {
    name: "swift",
    extensions: [".swift"],
    testPrefixes: [],
    testSuffixes: ["Tests"],
    testDirs: ["Tests", "test"],
  },
  {
    name: "scala",
    extensions: [".scala"],
    testPrefixes: [],
    testSuffixes: ["Spec", "Test", "Tests"],
    testDirs: ["src/test"],
  },
  {
    name: "dart",
    extensions: [".dart"],
    testPrefixes: [],
    testSuffixes: ["_test"],
    testDirs: ["test", "tests"],
  },
  {
    name: "shell",
    extensions: [".sh", ".bash", ".zsh"],
    testPrefixes: [],
    testSuffixes: [],
    testDirs: ["test", "tests"],
  },
];

// ============================================================
// DERIVED CONSTANTS
// ============================================================

/** All source file extensions across every supported language */
export const SOURCE_EXTENSIONS: string[] = [
  ...new Set(LANGUAGES.flatMap((l) => l.extensions)),
];

/** fast-glob friendly extension set, e.g. "{ts,tsx,js,jsx,py,...}" */
export const SOURCE_EXT_GLOB: string = `{${SOURCE_EXTENSIONS.map((e) => e.slice(1)).join(",")}}`;

/** Default source include patterns for scanning (any language) */
export const DEFAULT_SOURCE_INCLUDES: string[] = [
  `src/**/*.${SOURCE_EXT_GLOB}`,
  `app/**/*.${SOURCE_EXT_GLOB}`,
  `lib/**/*.${SOURCE_EXT_GLOB}`,
  `packages/**/*.${SOURCE_EXT_GLOB}`,
  `server/**/*.${SOURCE_EXT_GLOB}`,
  `api/**/*.${SOURCE_EXT_GLOB}`,
];

/** grep --include flags for shell-based searches (impact fallback) */
export function grepIncludeFlags(): string {
  return SOURCE_EXTENSIONS.map((e) => `--include="*${e}"`).join(" ");
}

// ============================================================
// FILE PREDICATES
// ============================================================

/** True if the path has a known source file extension */
export function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_EXTENSIONS.includes(ext);
}

/** True if the path is conventionally a test file in ANY language */
export function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const base = path.basename(filePath);
  const ext = path.extname(base);
  // Original-case stem — test conventions are case-distinctive:
  // lowercase-delimited (foo_test.go, foo.test.ts, test_foo.py) vs
  // PascalCase (FooTest.java, FooTests.kt). Case-sensitive matching
  // avoids flagging latest.java / contest.cs as test files.
  const stem = ext ? base.slice(0, -ext.length) : base;
  const segments = lower.split(/[\\/]/);

  for (const lang of LANGUAGES) {
    if (!lang.extensions.includes(ext.toLowerCase())) continue;

    // Prefix conventions: test_foo.py, TestFoo.java
    for (const p of lang.testPrefixes) {
      if (p && stem.startsWith(p)) return true;
    }
    // Suffix conventions: foo_test.go, foo.test.ts, FooTest.java
    for (const s of lang.testSuffixes) {
      if (s && stem.endsWith(s)) return true;
    }
    // Directory conventions: __tests__/, tests/, spec/, src/test/...
    for (const d of lang.testDirs) {
      const dLower = d.toLowerCase();
      // Match any path segment (handles both / and \ separators)
      if (dLower.includes("/")) {
        if (lower.includes(`${dLower}/`) || lower.includes(`${dLower}\\`)) return true;
      } else if (segments.includes(dLower)) {
        return true;
      }
    }
  }

  // Generic fallback (extension-agnostic, matches existing Kuma behavior)
  return (
    /(\.test\.|\.spec\.|_test\.|_spec\.)/.test(lower) ||
    /(\/|^)(__tests__|tests?|specs?)(\/|$)/.test(lower)
  );
}

// ============================================================
// TEST FILE CANDIDATES — for contract has_test_file checks
// ============================================================

/**
 * Generate plausible test file paths for a given source file,
 * covering per-language conventions (foo.test.ts, test_foo.py,
 * foo_test.go, FooTest.java, __tests__/foo.ts, tests/foo.py, ...).
 */
export function getTestCandidates(sourcePath: string): string[] {
  const ext = path.extname(sourcePath).toLowerCase();
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, ext);

  const lang = LANGUAGES.find((l) => l.extensions.includes(ext));
  const candidates = new Set<string>();

  const push = (p: string) => {
    if (p && !candidates.has(p)) candidates.add(p);
  };

  if (lang) {
    for (const suffix of lang.testSuffixes) {
      if (!suffix) continue;
      // Suffixes already carry their delimiter: login.test.ts, login_test.go,
      // LoginTest.java, LoginTests.swift — no extra separator needed.
      push(path.join(dir, `${base}${suffix}${ext}`));
    }
    for (const prefix of lang.testPrefixes) {
      if (prefix) push(path.join(dir, `${prefix}${base}${ext}`));
    }
    for (const td of lang.testDirs) {
      // Simple dir names only (tests/, __tests__, spec/, ...); nested paths
      // like "src/test" can't be derived from the source location reliably.
      if (!td.includes("/")) {
        push(path.join(dir, td, `${base}${ext}`));
      }
    }
  }

  // Generic fallbacks
  push(path.join(dir, `${base}.test${ext}`));
  push(path.join(dir, `${base}.spec${ext}`));
  push(path.join(dir, `${base}_test${ext}`));
  push(path.join(dir, `test_${base}${ext}`));
  push(path.join(dir, "__tests__", `${base}${ext}`));
  push(path.join(dir, "tests", `${base}${ext}`));

  return [...candidates];
}

// ============================================================
// IMPORT PATTERNS — multi-language import/require detection
// ============================================================

/**
 * Regexes that extract the imported module string. Ordered by language.
 * Used by kumaAstValidator's import whitelist so blocked packages are
 * caught in Python, Go, Rust, C/C++, Ruby, PHP, Java, C#, and JS/TS.
 */
export const IMPORT_PATTERNS: RegExp[] = [
  // JS/TS: import x from 'y' | import {a} from 'y' | import * as x from 'y'
  /import\s+(?:\{[^}]*\}\s+from\s+)?(?:[^'"\n]*\s+from\s+)?['"]([^'"]+)['"]/,
  // JS/TS (CJS): const x = require('y')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  // Python: import y | import y.z | from y import x | from .y import x
  /^\s*(?:from\s+([.\w]+)\s+import\s+\S+|import\s+([.\w]+))/m,
  // Go: import "y" | import alias "y"
  /^\s*import\s+(?:\w+\s+)?"([^"]+)"/m,
  // Rust: use y::z | extern crate y
  /^\s*use\s+([\w:]+)/m,
  // C/C++: #include <y> | #include "y"
  /^\s*#\s*include\s*[<"]([^>"]+)[>"]/m,
  // Ruby: require 'y' | require_relative 'y'
  /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/m,
  // PHP: require 'y' | include 'y' | use y\z;
  /^\s*(?:require(?:_once)?|include(?:_once)?)\s*\(?\s*['"]([^'"]+)['"]/m,
  // Java: import y.z.w;
  /^\s*import\s+([\w.]+)\s*;/m,
  // C#: using y.z.w;
  /^\s*using\s+([\w.]+)\s*;/m,
];

/** Extract the imported module path from a line of code (null if none). */
export function matchImportPath(line: string): string | null {
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (m) return (m[1] || m[2] || "").trim();
  }
  return null;
}

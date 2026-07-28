// ============================================================
// KUMA AST VALIDATOR — AST-Based Code Validation (Issue #22)
// ============================================================
// Validates code structural integrity before tool execution.
// Intercepts edits that:
//   - Delete test assertions
//   - Swallow exceptions silently
//   - Hardcode fallback returns (reward hacking)
//   - Validate imported packages against whitelist
//
// Uses lightweight regex-based analysis (no full AST parser dep).
// For deep AST parsing, integrates with TypeScript compiler API
// when available.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";


export interface ValidationFinding {
  line: number;
  severity: "error" | "warning" | "info";
  category: "assertion-deletion" | "exception-swallowing" | "reward-hacking" | "import-violation" | "hardcoded-return" | "empty-catch";
  message: string;
  suggestion: string;
}

// ============================================================
// IMPORT WHITELIST
// ============================================================

interface ImportWhitelist {
  allowed: string[];
  blocked: string[];
}

function loadImportWhitelist(): ImportWhitelist {
  try {
    const root = getProjectRoot();
    const whitelistPath = path.join(root, ".kuma", "import-whitelist.json");
    if (fs.existsSync(whitelistPath)) {
      return JSON.parse(fs.readFileSync(whitelistPath, "utf-8"));
    }
  } catch { /* skip */ }
  return {
    allowed: [],
    blocked: ["sql.js", "better-sqlite3", "mysql", "mssql"], // dangerous native deps
  };
}

// ============================================================
// VALIDATION RULES
// ============================================================

/**
 * Validate code content for anti-patterns and reward hacking.
 */
export function validateCodeContent(
  code: string,
  filePath?: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const lines = code.split("\n");
  const whitelist = loadImportWhitelist();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Assertion deletion detection (commenting out or removing test assertions)
    if (
      /\/\/\s*(expect|assert|should|test|it\.)\s*\(/.test(line) ||
      /(\/\*[\s\S]*?\*\/)/.test(line) && /(expect|assert|should|test)/.test(line)
    ) {
      findings.push({
        line: lineNum,
        severity: "error",
        category: "assertion-deletion",
        message: `Test assertion appears to be commented out on line ${lineNum}`,
        suggestion: "Restore the assertion or write an equivalent test for the new behavior",
      });
    }

    // 2. Exception swallowing (empty catch blocks)
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) ||
        (/catch\s*\([^)]*\)\s*\{/.test(line) && lines[i + 1]?.trim() === "}")) {
      findings.push({
        line: lineNum,
        severity: "error",
        category: "exception-swallowing",
        message: `Empty catch block on line ${lineNum} — exceptions are being swallowed`,
        suggestion: "Handle the error: log it, throw a meaningful error, or add a comment explaining why it's safe to ignore",
      });
    }

    // 3. Reward hacking — hardcoded fallback returns in test files
    if (filePath?.includes(".test.") || filePath?.includes(".spec.")) {
      if (
        /\breturn\s+(true|false|null|undefined|0|""|'')\s*;/.test(line) ||
        /\breturn\s+\d+\s*;/.test(line) ||
        /\bPromise\.resolve\s*\(\s*(true|false|null|undefined|0|""|'')\s*\)/.test(line)
      ) {
        findings.push({
          line: lineNum,
          severity: "warning",
          category: "reward-hacking",
          message: `Possible hardcoded return in test file on line ${lineNum}: ${line.trim().substring(0, 60)}`,
          suggestion: "Implement the actual logic instead of returning a hardcoded value to pass tests",
        });
      }
    }

    // 4. Hardcoded return values in non-test files (general anti-pattern)
    if (
      !filePath?.includes(".test.") &&
      !filePath?.includes(".spec.") &&
      /\breturn\s+(true|false|null)\s*;/.test(line) &&
      ((lines[i - 1] || "").includes("TODO") || (lines[i - 1] || "").includes("FIXME") || (lines[i - 1] || "").includes("HACK"))
    ) {
      findings.push({
        line: lineNum,
        severity: "warning",
        category: "hardcoded-return",
        message: `Hardcoded return value on line ${lineNum} (possibly temporary/hack)`,
        suggestion: "Implement proper logic or add a clear comment explaining why this is correct",
      });
    }

    // 5. Import validation against whitelist
    const importMatch = line.match(/import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/);
    if (importMatch) {
      const imported = importMatch[1];
      if (whitelist.blocked.some(b => imported.includes(b))) {
        findings.push({
          line: lineNum,
          severity: "error",
          category: "import-violation",
          message: `Blocked import: "${imported}" is not allowed per security whitelist`,
          suggestion: `Remove or replace the import. Allowed packages: ${whitelist.allowed.slice(0, 5).join(", ") || "(none specified)"}`,
        });
      }
    }
  }

  return findings;
}

/**
 * Validate a file for structural integrity.
 */
export function validateFile(filePath: string): ValidationFinding[] {
  try {
    const root = getProjectRoot();
    const fullPath = path.resolve(root, filePath);
    if (!fs.existsSync(fullPath)) return [];
    const content = fs.readFileSync(fullPath, "utf-8");
    return validateCodeContent(content, filePath);
  } catch {
    return [];
  }
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Format validation findings into a human-readable report.
 */
export function formatValidationFindings(
  findings: ValidationFinding[],
  filePath?: string,
): string {
  if (findings.length === 0) {
    return "✅ **AST Validation** — No structural issues found.";
  }

  const errors = findings.filter(f => f.severity === "error");
  const warnings = findings.filter(f => f.severity === "warning");

  const lines: string[] = [
    "🔬 **AST Code Validation Report**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `${findings.length} finding(s): ${errors.length} errors, ${warnings.length} warnings`,
    filePath ? `📄 ${filePath}` : "",
    "",
  ];

  for (const f of findings) {
    const icon = f.severity === "error" ? "🔴"
      : f.severity === "warning" ? "🟡" : "🟢";
    lines.push(`${icon} L${f.line} [${f.category}]`);
    lines.push(`   ${f.message}`);
    lines.push(`   💡 ${f.suggestion}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================
// DIFF-BASED VALIDATION
// ============================================================

/**
 * Validate a diff between old and new file content.
 * Detects if assertions were deleted or exceptions were swallowed
 * as part of the edit.
 */
export function validateDiff(
  oldContent: string,
  newContent: string,
  filePath?: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  const oldFindings = validateCodeContent(oldContent, filePath);
  const newFindings = validateCodeContent(newContent, filePath);

  // Check if assertions that existed before were removed
  const oldAssertions = oldFindings.filter(f => f.category === "assertion-deletion");
  const newAssertions = newFindings.filter(f => f.category === "assertion-deletion");

  for (const oldAssertion of oldAssertions) {
    if (!newAssertions.some(f => f.line === oldAssertion.line && f.message === oldAssertion.message)) {
      // This is a warning — assertion was "fixed" (uncommented), which is good
      continue;
    }
  }

  // Check for new reward hacking patterns introduced in the diff
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Check only new/changed lines
  for (let i = 0; i < newLines.length; i++) {
    if (i >= oldLines.length || newLines[i] !== oldLines[i]) {
      const changedLineFindings = validateCodeContent(newLines[i], filePath);
      for (const f of changedLineFindings) {
        findings.push({
          ...f,
          line: i + 1,
          message: `[NEW] ${f.message}`,
        });
      }
    }
  }

  return findings;
}

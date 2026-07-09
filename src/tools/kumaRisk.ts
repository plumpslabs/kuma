import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";
import { createRegex, isBinaryFile } from "./smartGrep.js";
import fg from "fast-glob";
import fs from "node:fs";

// ============================================================
// KUMA RISK — Predict impact of changes before editing
// ============================================================

interface RiskParams {
  symbol?: string;
  filePath?: string;
  depth?: number;
}

interface RiskCategory {
  label: string;
  count: number;
  files: string[];
}

interface RiskReport {
  symbol: string;
  totalReferences: number;
  totalFiles: number;
  categories: RiskCategory[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  suggestion: string;
}

/**
 * Analyze the potential impact of a change to a symbol or file.
 * Uses smart_grep + conventions to categorize references.
 */
export async function handleKumaRisk(params: RiskParams): Promise<string> {
  const { symbol, filePath, depth = 2 } = params;

  if (!symbol && !filePath) {
    return "Error: Either 'symbol' or 'filePath' is required.";
  }

  sessionMemory.recordToolCall("kuma_risk", { symbol, filePath });

  const root = getProjectRoot();

  // Search for the symbol across the codebase
  const searchPattern = symbol || filePath || "";
  const ignorePatterns = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/.kuma/backups/**",
    "**/*.min.js",
    "**/*.bundle.js",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/*.svg",
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.ico",
    "**/*.woff",
    "**/*.woff2",
    "**/*.ttf",
    "**/*.eot",
    "**/coverage/**",
  ];

  let entries: string[] = [];

  try {
    entries = await fg("**/*.{ts,tsx,js,jsx,mjs,cjs}", {
      cwd: root,
      ignore: ignorePatterns,
      onlyFiles: true,
      absolute: false,
      deep: depth * 3,
    });
  } catch {
    return `Error scanning project for references to "${symbol}".`;
  }

  if (entries.length === 0) {
    return `⚠️ No source files found to analyze for "${symbol}".`;
  }

  // Search for the symbol/reference
  const regex = createRegex(searchPattern);
  const results: Array<{ file: string; line: number; content: string }> = [];
  const maxResults = 200;

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    try {
      const fullPath = path.join(root, entry);
      const stat = fs.statSync(fullPath);
      if (stat.size > 500_000) continue;

      // Skip binary files
      if (isBinaryFile(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break;
        if (regex.test(lines[i])) {
          results.push({ file: entry, line: i + 1, content: lines[i].substring(0, 200) });
        }
      }
    } catch {
      continue;
    }
  }

  if (results.length === 0) {
    return `🔍 **Risk Analysis for "${symbol}"** — No references found.\n\nThis symbol has no references in the codebase. Risk: **LOW**\n\n✅ Safe to rename or modify without impact.`;
  }

  // Categorize results
  const testFiles: string[] = [];
  const sourceFiles: string[] = [];
  const configFiles: string[] = [];
  const apiRoutes: string[] = [];
  const uniqueFiles = new Set<string>();

  const fileSet = new Set(results.map((r) => r.file));
  for (const file of fileSet) {
    uniqueFiles.add(file);

    if (
      file.includes(".test.") ||
      file.includes(".spec.") ||
      file.includes("__tests__") ||
      file.includes("test/") ||
      file.includes("tests/")
    ) {
      testFiles.push(file);
    } else if (
      file.includes("route") ||
      file.includes("api") ||
      file.includes("controller") ||
      file.includes("handler")
    ) {
      apiRoutes.push(file);
    } else if (
      file.endsWith(".config.ts") ||
      file.endsWith(".config.js") ||
      file.includes("config/")
    ) {
      configFiles.push(file);
    } else {
      sourceFiles.push(file);
    }
  }

  const categories: RiskCategory[] = [];
  if (sourceFiles.length > 0) {
    categories.push({ label: "Source Files", count: sourceFiles.length, files: sourceFiles.slice(0, 10) });
  }
  if (testFiles.length > 0) {
    categories.push({ label: "Test Files", count: testFiles.length, files: testFiles.slice(0, 10) });
  }
  if (apiRoutes.length > 0) {
    categories.push({ label: "API Routes / Controllers", count: apiRoutes.length, files: apiRoutes.slice(0, 10) });
  }
  if (configFiles.length > 0) {
    categories.push({ label: "Config / Definition Files", count: configFiles.length, files: configFiles.slice(0, 5) });
  }

  // Determine risk level
  let risk: "LOW" | "MEDIUM" | "HIGH";
  let suggestion: string;

  if (uniqueFiles.size > 20) {
    risk = "HIGH";
    suggestion = `This symbol has ${uniqueFiles.size} references across the project. Consider:\n  1. Use lsp_query with action:'refs' for precise references\n  2. Check test files for expected behavior changes\n  3. Make the change in small, verified increments`;
  } else if (uniqueFiles.size > 5) {
    risk = "MEDIUM";
    suggestion = `This symbol has ${uniqueFiles.size} references. Review the affected files before making changes.`;
  } else {
    risk = "LOW";
    suggestion = `Only ${uniqueFiles.size} reference(s) found. Safe to modify — verify with a typecheck afterward.`;
  }

  // Check for circular dependencies in affected files
  const summary = sessionMemory.getSummary();
  const rawGraph = summary.dependencyGraph as Array<[string, string[]]> | undefined;
  let circularDepWarning = "";
  if (rawGraph) {
    const depMap = new Map(rawGraph);
    const affectedFiles = Array.from(uniqueFiles);
    for (const file of affectedFiles) {
      const deps = depMap.get(file);
      if (deps && deps.some((d) => affectedFiles.includes(d) && d !== file)) {
        circularDepWarning = `⚠️ Possible circular dependencies detected among affected files. Use lsp_query for detailed analysis.`;
        break;
      }
    }
  }

  // Store in session memory
  sessionMemory.addSearchResult(`risk:${symbol}`, Array.from(uniqueFiles));

  // Build report
  const report: RiskReport = {
    symbol: symbol || filePath || "unknown",
    totalReferences: results.length,
    totalFiles: uniqueFiles.size,
    categories,
    risk,
    suggestion,
  };

  return formatRiskReport(report, circularDepWarning);
}

function formatRiskReport(report: RiskReport, circularDepWarning: string): string {
  const riskEmoji =
    report.risk === "LOW" ? "🟢" :
    report.risk === "MEDIUM" ? "🟡" : "🔴";

  const lines: string[] = [
    `🔍 **Risk Analysis** — "${report.symbol}" ${riskEmoji}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 **Impact:** ${report.totalReferences} references in ${report.totalFiles} files`,
    `📈 **Risk Level:** ${riskEmoji} ${report.risk}`,
    "",
    "**Breakdown:**",
  ];

  for (const cat of report.categories) {
    lines.push(`  • ${cat.label}: ${cat.count} file(s)`);
    for (const file of cat.files.slice(0, 4)) {
      lines.push(`    — ${file}`);
    }
    if (cat.files.length > 4) {
      lines.push(`    — ... and ${cat.files.length - 4} more`);
    }
  }

  if (circularDepWarning) {
    lines.push("", circularDepWarning);
  }

  lines.push(
    "",
    "💡 **Suggestion:**",
    `  ${report.suggestion}`,
    "",
    "💡 Use lsp_query({ filePath, line, character, action: 'refs' }) for precise reference navigation.",
  );

  return lines.join("\n");
}

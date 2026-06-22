import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "./sessionMemory.js";

// ============================================================
// MANDATE INJECTOR — Injects Ponytail + Caveman AI doctrine
// ============================================================

interface MandateResult {
  ponytailRules: string[];
  cavemanRules: string[];
  projectConventions?: Record<string, unknown>;
  coreMandates: string[];
}

export async function injectMandates(): Promise<string> {
  const projectRoot = getProjectRoot();
  const result: MandateResult = {
    ponytailRules: [],
    cavemanRules: [],
    coreMandates: [],
  };

  // 1. Read Ponytail doctrine
  result.ponytailRules = await loadDoctrineFile("ponytail-doctrine.md", [
    "✅ Use standard library before adding dependencies",
    "✅ Ask first: 'Is std library enough?' before adding packages",
    "✅ Minimal code: as few as possible, not fewer",
    "✅ No over-engineering: don't create abstractions not yet needed",
    "✅ Reuse existing code patterns in the project",
    "✅ One function = one responsibility",
    "✅ Clear variable names, minimal comments",
  ]);

  // 2. Read Caveman doctrine
  result.cavemanRules = await loadDoctrineFile("caveman-doctrine.md", [
    "✅ Compress text: short, dense, clear",
    "✅ Unnecessary tool output: don't send to AI",
    "✅ Use bullet points, not long paragraphs",
    "✅ Error log: only 3 lines of context, don't send 500 lines of stack trace",
    "✅ Prioritize actionable information",
    "✅ If it's already successful, no need to explain at length",
    "✅ Token = money. Save tokens = save cost.",
  ]);

  // 3. Core mandates
  result.coreMandates = [
    "🔴 READ BEFORE WRITE: Read the file before editing. 90% of errors come from AI editing without reading.",
    "🔴 QUALITY OVER SPEED: Prioritize correctness, not speed. A wrong AI is more expensive than a slow AI.",
    "🔴 VALIDATE ASSUMPTIONS: Don't assume a library/framework exists. Check package.json first.",
    "🔴 CONVENTIONS: Follow existing coding style in the project. Don't create new patterns.",
    "🔴 PARALLELIZE: Gather context from multiple sources at once, don't go sequential.",
    "🔴 MINIMAL CHANGES: Edit as little as possible. Every existing line of code has a purpose.",
    "🔴 TEST YOUR WORK: If you make changes, run typecheck/test. Don't just assume it works.",
    "🔴 NO 'ANY' TYPE: Don't use type casting to 'any' in TypeScript.",
    "🔴 ERROR IS OK: Error is not failure. Error is information. Report with details and fix suggestions.",
    "🔴 LOOP DETECTION: If calling the same tool >3x, stop and try a different approach.",
  ];

  // 4. Try to load project conventions
  try {
    const conventionsPath = path.join(projectRoot, "tsconfig.json");
    if (fs.existsSync(conventionsPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(conventionsPath, "utf-8"));
      result.projectConventions = {
        strict: tsconfig.compilerOptions?.strict ?? false,
        target: tsconfig.compilerOptions?.target ?? "unknown",
        module: tsconfig.compilerOptions?.module ?? "unknown",
      };
    }
  } catch {
    // Ignore
  }

  // Store in session memory
  sessionMemory.setConventions(result.projectConventions ?? {});

  return formatMandateOutput(result);
}

async function loadDoctrineFile(filename: string, defaults: string[]): Promise<string[]> {
  const projectRoot = getProjectRoot();
  const filePath = path.join(projectRoot, "prompts", filename);

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const rules = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("-") || l.startsWith("*") || l.startsWith("✅"))
        .map((l) => l.replace(/^[-*]\s*/, "✅ "));
      return rules.length > 0 ? rules : defaults;
    }
  } catch {
    // Fallback to defaults
  }

  return defaults;
}

function formatMandateOutput(result: MandateResult): string {
  const lines: string[] = [
    "==============================================",
    "🧠 CORE MANDATES — SYSTEM DOCTRINE ACTIVATED",
    "==============================================",
    "",
    "📜 **10 Core Mandates (MUST BE FOLLOWED):**",
    ...result.coreMandates.map((m) => `  ${m}`),
    "",
    "🎀 **Ponytail Doctrine (Minimalism & Standard Library):**",
    ...result.ponytailRules.map((r) => `  ${r}`),
    "",
    "🦴 **Caveman Doctrine (Token Efficiency & Compression):**",
    ...result.cavemanRules.map((r) => `  ${r}`),
    "",
  ];

  if (result.projectConventions) {
    lines.push("📋 **Detected Project Conventions:**");
    for (const [key, value] of Object.entries(result.projectConventions)) {
      lines.push(`  - ${key}: ${value}`);
    }
    lines.push("");
  }

  lines.push("==============================================");

  return lines.join("\n");
}

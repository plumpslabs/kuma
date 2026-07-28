// ============================================================
// CONTEXT DIGEST — Automated Ultra-Compact Snapshot (Issue #18)
// ============================================================
// Generates a 1-page executive summary under 500 tokens:
//   1. Core Tech Stack & Key Entry Points
//   2. Top 5 Business Rules & Rotations
//   3. Top 5 Fragile Contracts / Known Code Gotchas
//   4. Active Architectural Decisions (ADRs)
//
// Used by kuma_context({ action: 'digest' }) for ultra-fast
// session initialization.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "./sessionMemory.js";
import { getDb } from "./kumaDb.js";
import { getActiveGotchas } from "./domainRules.js";

// ============================================================
// TECH STACK DETECTION
// ============================================================

interface TechStack {
  languages: string[];
  framework: string | null;
  database: string | null;
  testRunner: string | null;
  packageManager: string | null;
  monorepo: boolean;
}

function detectTechStack(): TechStack {
  const root = getProjectRoot();
  const stack: TechStack = {
    languages: [],
    framework: null,
    database: null,
    testRunner: null,
    packageManager: null,
    monorepo: false,
  };

  try {
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;

      // Package manager detection
      if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) stack.packageManager = "pnpm";
      else if (fs.existsSync(path.join(root, "yarn.lock"))) stack.packageManager = "yarn";
      else stack.packageManager = "npm";

      // Monorepo detection
      stack.monorepo = !!pkg.workspaces;

      // Framework detection
      if (deps.next) stack.framework = "Next.js";
      else if (deps.react) stack.framework = "React";
      else if (deps.vue) stack.framework = "Vue";
      else if (deps.express) stack.framework = "Express";
      else if (deps.fastify) stack.framework = "Fastify";
      else if (deps.nest) stack.framework = "NestJS";
      else if (deps["@remix-run/react"]) stack.framework = "Remix";
      else if (deps.svelte) stack.framework = "Svelte";
      else if (deps.angular) stack.framework = "Angular";

      // Database detection
      if (deps.prisma) stack.database = "Prisma";
      else if (deps.typeorm) stack.database = "TypeORM";
      else if (deps.mongoose) stack.database = "MongoDB";
      else if (deps.pg || deps["@neondatabase/serverless"]) stack.database = "PostgreSQL";
      else if (deps.redis) stack.database = "Redis";
      else if (deps.better || deps.drizzle) stack.database = "Drizzle";

      // Test runner detection
      if (deps.jest || deps["@jest/core"]) stack.testRunner = "Jest";
      else if (deps.vitest) stack.testRunner = "Vitest";
      else if (deps.mocha) stack.testRunner = "Mocha";
      else if (deps.playwright) stack.testRunner = "Playwright";
      else if (deps.cypress) stack.testRunner = "Cypress";

      // Language detection
      if (fs.existsSync(path.join(root, "tsconfig.json"))) stack.languages.push("TypeScript");
      if (deps.typescript) stack.languages.push("TypeScript");
      if (fs.existsSync(path.join(root, "jsconfig.json"))) stack.languages.push("JavaScript");
      if (fs.existsSync(path.join(root, "go.mod"))) stack.languages.push("Go");
      if (fs.existsSync(path.join(root, "Cargo.toml"))) stack.languages.push("Rust");
      if (fs.existsSync(path.join(root, "pyproject.toml"))) stack.languages.push("Python");
      if (fs.existsSync(path.join(root, "Gemfile"))) stack.languages.push("Ruby");
      if (stack.languages.length === 0) stack.languages.push("JavaScript");
    }
  } catch { /* ignore */ }

  return stack;
}

// ============================================================
// ENTRY POINT DETECTION
// ============================================================

function detectEntryPoints(): string[] {
  const root = getProjectRoot();
  const entryPoints: string[] = [];
  const candidates = [
    "src/index.ts", "src/index.js", "src/app.ts", "src/app.js",
    "index.ts", "index.js", "src/main.ts", "src/main.js",
    "src/server.ts", "src/server.js", "app.ts", "app.js",
    "pages/index.tsx", "pages/index.jsx", "src/App.tsx", "src/App.js",
    "lib/main.ts", "lib/index.ts",
  ];

  for (const c of candidates) {
    if (fs.existsSync(path.join(root, c))) {
      entryPoints.push(c);
    }
  }

  // Check package.json main field
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    if (pkg.main && fs.existsSync(path.join(root, pkg.main))) {
      if (!entryPoints.includes(pkg.main)) entryPoints.push(pkg.main);
    }
  } catch { /* ignore */ }

  return entryPoints;
}

// ============================================================
// ACTIVE ADRS
// ============================================================

async function getActiveADRs(): Promise<string[]> {
  try {
    const db = await getDb();
    const stmt = db.prepare(
      "SELECT title FROM decision_log WHERE status = 'active' ORDER BY created_at DESC LIMIT 5"
    );
    const results: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push(row.title as string);
    }
    stmt.free();
    return results;
  } catch { return []; }
}

// ============================================================
// DIGEST GENERATION (< 500 TOKENS)
// ============================================================

export async function generateContextDigest(): Promise<string> {
  const stack = detectTechStack();
  const entryPoints = detectEntryPoints();
  const adrs = await getActiveADRs();
  const gotchas = getActiveGotchas();
  const summary = sessionMemory.getSummary();

  const lines: string[] = [
    "📋 **Kuma Digest** — <500 token briefing",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  // 1. Core Tech Stack
  const langStr = stack.languages.join("/");
  const frameworkStr = stack.framework || "—";
  const dbStr = stack.database || "—";
  const testStr = stack.testRunner || "—";
  const pmStr = stack.packageManager || "—";
  lines.push(`🔧 **Stack**: ${langStr} | ${frameworkStr} | ${dbStr} | ${testStr} | ${pmStr}${stack.monorepo ? " (monorepo)" : ""}`);
  lines.push(`📁 **Root**: ${getProjectRoot().split("/").pop() || "?"}`);

  // 2. Entry Points
  if (entryPoints.length > 0) {
    lines.push(`🚪 **Entry**: ${entryPoints.slice(0, 3).join(", ")}`);
  }

  // 3. Business Rules (from Layer 1)
  try {
    const ruleFile = path.join(getProjectRoot(), ".kuma", "DOMAIN_RULES.md");
    if (fs.existsSync(ruleFile)) {
      const content = fs.readFileSync(ruleFile, "utf-8");
      const rules = content.split("\n").filter(l => /^- Rule \d+:?\s*/i.test(l)).map(l => l.replace(/^- Rule \d+:?\s*/i, "").trim()).filter(Boolean);
      if (rules.length > 0) {
        lines.push(`📋 **Rules**: ${rules.slice(0, 5).join(" | ")}`);
      }
    }
  } catch { /* ignore */ }

  // 4. Gotchas (from Layer 3)
  if (gotchas.length > 0) {
    const critical = gotchas.filter(g => g.severity === "critical" || g.severity === "high");
    if (critical.length > 0) {
      lines.push(`⚠️ **Gotchas**: ${critical.length} high/critical — ${critical.slice(0, 3).map(g => g.filePath).join(", ")}`);
    } else {
      lines.push(`⚠️ **Gotchas**: ${gotchas.length} recorded`);
    }
  }

  // 5. Active ADRs
  if (adrs.length > 0) {
    lines.push(`📝 **ADRs**: ${adrs.slice(0, 3).join(" | ")}`);
  }

  // 6. Session state
  lines.push(`🎯 **Goal**: ${(summary.currentGoal as string)?.substring(0, 80) || "not set"}`);

  // Token count estimate (rough: ~4 chars per token)
  const text = lines.join("\n");
  const estimatedTokens = Math.ceil(text.length / 4);
  if (estimatedTokens > 450) {
    // Trim to fit under 500 tokens
    lines.push(`📊 *~${estimatedTokens} tokens, fits under 500 limit*`);
  }

  return lines.join("\n") + "\n\n💡 Use kuma_context({ action: 'sync' }) for full state.";
}

/**
 * Legacy alias used by kuma_context({ action: 'digest' }).
 */
export { generateContextDigest as generateDigest };

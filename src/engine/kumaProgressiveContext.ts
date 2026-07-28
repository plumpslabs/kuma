// ============================================================
// KUMA PROGRESSIVE CONTEXT — Progressive Disclosure (Issue #25)
// ============================================================
// Implements progressive context loading to prevent context bloat:
//   1. Lightweight metadata preload (<100 tokens)
//   2. Sectional deep-load on demand (by scope/skill boundary)
//   3. Skill boundary isolation — only load context relevant to
//      the active skill area
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { getDb } from "./kumaDb.js";
import { getActiveGotchas, readLayer } from "./domainRules.js";

// ============================================================
// LIGHTWEIGHT METADATA PRELOAD (<100 tokens)
// ============================================================

export interface ProjectMeta {
  name: string;
  stack: string[];
  entryPoints: string[];
  nodeCount: number;
  edgeCount: number;
  layerStatus: {
    domainRules: boolean;
    archFlow: boolean;
    gotchas: number;
  };
  hasDecisions: boolean;
  hasTodos: boolean;
}

/**
 * Generate ultra-lightweight project metadata (<100 tokens).
 * This is the initial load — minimal context cost.
 */
export async function getProjectMeta(): Promise<ProjectMeta> {
  const root = getProjectRoot();
  const name = root.split("/").pop() || "unknown";

  // Stack detection
  const stack: string[] = [];
  if (fs.existsSync(path.join(root, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
      if (pkg.dependencies?.next) stack.push("Next.js");
      else if (pkg.dependencies?.react) stack.push("React");
      if (pkg.devDependencies?.typescript) stack.push("TypeScript");
      if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) stack.push("pnpm");
      else if (fs.existsSync(path.join(root, "yarn.lock"))) stack.push("yarn");
    } catch {}
  }
  if (fs.existsSync(path.join(root, "go.mod"))) stack.push("Go");
  if (fs.existsSync(path.join(root, "Cargo.toml"))) stack.push("Rust");
  if (fs.existsSync(path.join(root, "pyproject.toml"))) stack.push("Python");

  // Graph stats
  let nodeCount = 0;
  let edgeCount = 0;
  try {
    const db = await getDb();
    const nodeRes = db.exec("SELECT COUNT(*) as c FROM nodes");
    nodeCount = (nodeRes[0]?.values[0]?.[0] as number) ?? 0;
    const edgeRes = db.exec("SELECT COUNT(*) as c FROM edges");
    edgeCount = (edgeRes[0]?.values[0]?.[0] as number) ?? 0;
  } catch {}

  // Layer status
  const kumaDir = path.join(root, ".kuma");
  const layerStatus = {
    domainRules: fs.existsSync(path.join(kumaDir, "DOMAIN_RULES.md")),
    archFlow: fs.existsSync(path.join(kumaDir, "ARCHITECTURE_FLOW.md")),
    gotchas: getActiveGotchas().length,
  };

  // Decisions & todos
  let hasDecisions = false;
  let hasTodos = false;
  try {
    const db = await getDb();
    const decRes = db.exec("SELECT COUNT(*) as c FROM decision_log");
    hasDecisions = ((decRes[0]?.values[0]?.[0] as number) ?? 0) > 0;
    const todoRes = db.exec("SELECT COUNT(*) as c FROM todos WHERE status != 'done'");
    hasTodos = ((todoRes[0]?.values[0]?.[0] as number) ?? 0) > 0;
  } catch {}

  return { name, stack, entryPoints: [], nodeCount, edgeCount, layerStatus, hasDecisions, hasTodos };
}

/**
 * Format project meta as <100 token string.
 */
export function formatProjectMeta(meta: ProjectMeta): string {
  const parts: string[] = [
    `📁 ${meta.name}`,
    meta.stack.length > 0 ? `⚡ ${meta.stack.join("/")}` : "",
    `📊 ${meta.nodeCount}n/${meta.edgeCount}e`,
    meta.layerStatus.domainRules ? "📋R" : "",
    meta.layerStatus.archFlow ? "🏗️A" : "",
    meta.layerStatus.gotchas > 0 ? `⚠️${meta.layerStatus.gotchas}g` : "",
    meta.hasDecisions ? "📝D" : "",
    meta.hasTodos ? "📌T" : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

// ============================================================
// SECTIONAL CONTEXT LOADING
// ============================================================

export type ContextSection =
  | "domain_rules"
  | "architecture"
  | "gotchas"
  | "decisions"
  | "graph"
  | "changes"
  | "health";

/**
 * Load a specific context section on demand.
 * This is the progressive disclosure mechanism — only load
 * what the agent actually needs.
 */
export async function loadSection(section: ContextSection, scope?: string): Promise<string> {
  switch (section) {
    case "domain_rules": {
      try {
        const content = readLayer("domain_rules");
        const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("<!--"));
        return `📋 **Domain Rules**\n${lines.slice(0, 20).join("\n")}`;
      } catch {
        return "📋 **Domain Rules**: not configured";
      }
    }

    case "architecture": {
      try {
        const content = readLayer("arch_flow");
        const relevant = scope
          ? content.split("\n").filter(l => l.toLowerCase().includes(scope.toLowerCase())).slice(0, 15)
          : content.split("\n").filter(l => l.trim() && !l.startsWith("<!--")).slice(0, 20);
        return `🏗️ **Architecture${scope ? `: ${scope}` : ""}**\n${relevant.join("\n")}`;
      } catch {
        return "🏗️ **Architecture**: not documented";
      }
    }

    case "gotchas": {
      const gotchas = getActiveGotchas();
      if (gotchas.length === 0) return "⚠️ **Gotchas**: none recorded";
      const filtered = scope
        ? gotchas.filter(g => g.filePath.toLowerCase().includes(scope.toLowerCase()))
        : gotchas;
      const lines = filtered.slice(0, 5).map(g => {
        const icon = g.severity === "critical" ? "🔴" : g.severity === "high" ? "🟠" : "🟡";
        return `${icon} ${g.filePath}: ${g.description.substring(0, 80)}`;
      });
      return `⚠️ **Gotchas** (${filtered.length} active)\n${lines.join("\n")}`;
    }

    case "decisions": {
      try {
        const db = await getDb();
        const stmt = db.prepare(
          `SELECT title, status, created_at FROM decision_log ORDER BY created_at DESC LIMIT 10`,
        );
        const results: Array<Record<string, unknown>> = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        if (results.length === 0) return "📝 **Decisions**: none recorded";
        const lines = results.map(d =>
          `  ${d.status === "active" ? "✅" : "📝"} ${d.title} (${d.status})`,
        );
        return `📝 **Decisions** (${results.length})\n${lines.join("\n")}`;
      } catch {
        return "📝 **Decisions**: unavailable";
      }
    }

    case "graph": {
      try {
        const db = await getDb();
        const nodeRes = db.exec("SELECT type, COUNT(*) as cnt FROM nodes GROUP BY type ORDER BY cnt DESC LIMIT 8");
        if (!nodeRes[0]?.values) return "📊 **Graph**: empty";
        const lines = nodeRes[0].values.map(r => `  ${r[0]}: ${r[1]}`);
        return `📊 **Knowledge Graph**\n${lines.join("\n")}`;
      } catch {
        return "📊 **Graph**: unavailable";
      }
    }

    case "changes": {
      try {
        const db = await getDb();
        const stmt = db.prepare("SELECT file_path, change_type FROM change_log ORDER BY id DESC LIMIT 8");
        const results: Array<Record<string, unknown>> = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        if (results.length === 0) return "📝 **Changes**: none in this session";
        const lines = results.map(r =>
          `  ${r.change_type === "modified" ? "📝" : r.change_type === "created" ? "✨" : "❌"} ${r.file_path}`,
        );
        return `📝 **Recent Changes** (${results.length})\n${lines.join("\n")}`;
      } catch {
        return "📝 **Changes**: unavailable";
      }
    }

    case "health": {
      try {
        const { computeSafetyScore } = await import("./safetyScore.js");
        const score = await computeSafetyScore();
        return `🏥 **Health**: ${score.score}/100 (${score.risk})`;
      } catch {
        return "🏥 **Health**: unavailable";
      }
    }

    default:
      return `Unknown section: ${section}`;
  }
}

// ============================================================
// SKILL BOUNDARY ISOLATION
// ============================================================

export interface SkillBoundary {
  name: string;
  relatedSections: ContextSection[];
  relatedPaths: string[];
  description: string;
}

/**
 * Determine which sections are relevant for a given skill area.
 * This prevents loading architecture context for a test change, etc.
 */
export function getSkillBoundary(skillArea: string): SkillBoundary {
  const area = skillArea.toLowerCase();

  if (area.includes("auth") || area.includes("login") || area.includes("security")) {
    return {
      name: "auth",
      relatedSections: ["domain_rules", "architecture", "gotchas", "decisions"],
      relatedPaths: ["src/auth", "src/middleware", "src/guards"],
      description: "Authentication & authorization context",
    };
  }

  if (area.includes("test") || area.includes("spec")) {
    return {
      name: "testing",
      relatedSections: ["gotchas", "health"],
      relatedPaths: ["__tests__", "*.test.*", "*.spec.*"],
      description: "Testing & verification context",
    };
  }

  if (area.includes("db") || area.includes("database") || area.includes("schema")) {
    return {
      name: "database",
      relatedSections: ["architecture", "gotchas", "decisions"],
      relatedPaths: ["prisma", "src/db", "schema", "migrations"],
      description: "Database & schema context",
    };
  }

  if (area.includes("api") || area.includes("route") || area.includes("endpoint")) {
    return {
      name: "api",
      relatedSections: ["architecture", "gotchas", "decisions", "changes"],
      relatedPaths: ["src/api", "src/routes", "src/controllers"],
      description: "API & routing context",
    };
  }

  // Default: load everything lightweight
  return {
    name: "general",
    relatedSections: ["domain_rules", "gotchas"],
    relatedPaths: [],
    description: "General project context",
  };
}

/**
 * Generate a progressive context payload based on skill area.
 * First returns lightweight meta, then deep sections on demand.
 */
export async function getProgressiveContext(skillArea?: string): Promise<{
  meta: string;
  sections: Array<{ name: ContextSection; content: string }>;
  boundary: SkillBoundary;
}> {
  const meta = await getProjectMeta();
  const boundary = getSkillBoundary(skillArea || "general");

  // Load only the relevant sections
  const sections = await Promise.all(
    boundary.relatedSections.map(async (section) => ({
      name: section,
      content: await loadSection(section, skillArea),
    })),
  );

  return {
    meta: formatProjectMeta(meta),
    sections,
    boundary,
  };
}

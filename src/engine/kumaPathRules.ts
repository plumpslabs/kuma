// ============================================================
// KUMA PATH RULES — Path-Scoped On-Demand Rules (P2)
// ============================================================
// Inspired by Claude Code's .claude/rules/. Users drop markdown
// rule files into `.kuma/rules/*.md` with YAML frontmatter:
//
//   ---
//   description: Auth middleware conventions
//   paths:
//     - "src/auth/**"
//     - "src/middleware/**"
//   ---
//   Always validate the JWT before mutating req.user...
//
// Rules load ON-DEMAND — only those matching the current research
// scope / file path are injected. This keeps context lean while
// ensuring the agent gets area-specific rules exactly when needed.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

export interface PathRule {
  id: string;            // filename (without .md)
  description: string;
  paths: string[];       // glob-ish patterns
  content: string;       // body (frontmatter stripped)
  filePath: string;
}

const RULES_DIR = ".kuma/rules";

function rulesDir(): string {
  return path.join(getProjectRoot(), RULES_DIR);
}

/** Ensure the rules directory exists (silent). */
export function ensureRulesDir(): void {
  try {
    const dir = rulesDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* non-critical */ }
}

/**
 * Parse YAML frontmatter (description + paths list) from a rule file.
 * Very small hand-rolled parser — no external YAML dependency,
 * consistent with Kuma's "practical over complex" principle.
 */
function parseRuleFile(filePath: string): PathRule | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const id = path.basename(filePath, ".md");

    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!fm) {
      // No frontmatter → treat whole file as a rule applying to everything
      return { id, description: id, paths: ["*"], content: raw.trim(), filePath };
    }

    const meta = fm[1];
    const body = fm[2].trim();

    const description = meta.match(/description:\s*(.+)/)?.[1]?.trim() || id;

    // Parse paths list: lines starting with "- " after "paths:"
    const paths: string[] = [];
    const pathSection = meta.match(/paths:\s*\r?\n([\s\S]*?)(?=\r?\n\S|$)/);
    if (pathSection) {
      for (const line of pathSection[1].split("\n")) {
        const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
        if (m) paths.push(m[1].trim());
      }
    }

    return { id, description, paths: paths.length ? paths : ["*"], content: body, filePath };
  } catch {
    return null;
  }
}

/** Load all rule files from .kuma/rules/. */
export function loadPathRules(): PathRule[] {
  ensureRulesDir();
  try {
    const dir = rulesDir();
    return fs
      .readdirSync(dir)
      .filter(f => f.endsWith(".md"))
      .map(f => parseRuleFile(path.join(dir, f)))
      .filter((r): r is PathRule => r !== null);
  } catch {
    return [];
  }
}

/**
 * Minimal glob matcher — supports `*` (within segment), `**` (any depth),
 * and `?`. Not a full glob engine; covers 95% of rule-path use cases.
 *
 * Semantics:
 *  - `src/auth/**` → prefix match: matches `src/auth` itself and everything under it
 *  - `src/*`       → full match on exactly one path segment (does NOT cross `/`)
 *  - `src/auth`    → plain dir path: matches the dir itself + everything under it
 *  - `*` / `**`    → matches everything
 */
export function matchRulePath(pattern: string, target: string): boolean {
  if (pattern === "*" || pattern === "**") return true;

  const p = pattern.replace(/\\/g, "/").toLowerCase();
  const t = target.replace(/\\/g, "/").toLowerCase();

  // `dir/**` → prefix match on the directory portion
  if (p.endsWith("/**")) {
    const prefix = p.slice(0, -3);
    return t === prefix || t.startsWith(prefix + "/");
  }

  // Plain directory path without glob chars → matches dir + descendants
  if (!/[*?]/.test(p) && (t === p || t.startsWith(p + "/"))) return true;

  // Convert glob to a fully-anchored regex
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        // Leading `**/` should also match top-level files (zero dirs)
        re += i === 0 ? "(?:.*/)?" : ".*";
        if (p[i + 2] === "/") i += 2; // consume trailing slash
      } else {
        re += "[^/]*"; // single star never crosses '/'
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.()*+?^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }

  try {
    const rx = new RegExp(`^${re}$`);
    return rx.test(t);
  } catch {
    return t === p;
  }
}

/**
 * Get rules matching a scope / file path.
 * Scope examples: "auth", "src/auth/login.ts", "api routes".
 */
export function getRulesForScope(scope?: string): PathRule[] {
  const rules = loadPathRules();
  if (rules.length === 0) return [];

  const target = (scope || "").toLowerCase();
  if (!target) return rules.filter(r => r.paths.includes("*"));

  return rules.filter(rule => rule.paths.some(p => matchRulePath(p, target)));
}

/**
 * Format matching path rules as an injectable context block.
 * Returns empty string when nothing matches (so callers can skip cleanly).
 */
export function formatPathRules(scope?: string): string {
  const matches = getRulesForScope(scope);
  if (matches.length === 0) return "";

  const lines: string[] = [
    `📌 **Path Rules** (${matches.length} rule(s) apply to "${scope || "project"}")`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  for (const rule of matches) {
    lines.push(`**${rule.description}**`);
    // Compact: first 6 non-empty lines of content
    const bodyLines = rule.content.split("\n").filter(l => l.trim()).slice(0, 6);
    for (const bl of bodyLines) {
      lines.push(`  ${bl.substring(0, 140)}`);
    }
    if (rule.content.split("\n").filter(l => l.trim()).length > 6) {
      lines.push(`  … (full rule in ${rule.filePath})`);
    }
    lines.push("");
  }

  lines.push(`💡 Path rules load on-demand from ${RULES_DIR}/ — add/remove .md files anytime.`);
  return lines.join("\n");
}

/**
 * Quick check — are there ANY path rules configured?
 * Used to skip empty sections in compact outputs.
 */
export function hasPathRules(): boolean {
  return loadPathRules().length > 0;
}

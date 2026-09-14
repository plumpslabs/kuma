// ============================================================
// KUMA CODE REUSE & ANTI-DUPLICATION ENGINE
// ============================================================
// Prevents dead code and duplicate utility functions.
// Searches the knowledge graph for existing helper functions,
// classes, and types matching the agent's intent before new code is written.
// ============================================================

import { getDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import path from "node:path";
import fs from "node:fs";

export interface ReusableCandidate {
  name: string;
  kind: string;
  filePath: string;
  line?: number;
  signature?: string;
  description?: string;
  relevanceScore: number; // 0.00 to 1.00
  usageCount: number;
}

export interface ReuseSearchResult {
  query: string;
  foundMatches: boolean;
  candidates: ReusableCandidate[];
  recommendedDirectory?: string;
  formattedOutput: string;
}

/**
 * Searches the knowledge graph and codebase for existing reusable utilities.
 */
export async function findReusableSymbols(query: string, scope?: string): Promise<ReuseSearchResult> {
  const cleanQuery = query.trim().toLowerCase();
  const searchTokens = cleanQuery
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);

  const db = await getDb();

  // 1. Fetch relevant nodes from knowledge graph
  const nodeStmt = db.prepare(`
    SELECT id, name, type, file_path, metadata 
    FROM nodes 
    WHERE type IN ('function', 'class', 'interface', 'type', 'component')
  `);

  const rawCandidates: ReusableCandidate[] = [];

  while (nodeStmt.step()) {
    const row = nodeStmt.getAsObject() as {
      id: string;
      name: string;
      type: string;
      file_path: string | null;
      metadata: string | null;
    };

    if (!row.name || !row.file_path) continue;

    let meta: Record<string, any> = {};
    try {
      if (row.metadata) meta = JSON.parse(row.metadata);
    } catch {}

    const nameLower = row.name.toLowerCase();
    const nameTokens = splitIdentifierTokens(row.name);
    const descLower = (meta.description || "").toLowerCase();
    const sigLower = (meta.signature || "").toLowerCase();

    // Scoring logic
    let score = 0;

    // Exact name match
    if (nameLower === cleanQuery) {
      score = 1.0;
    } else if (nameLower.includes(cleanQuery)) {
      score = 0.85;
    } else {
      let matchedTokens = 0;
      for (const token of searchTokens) {
        if (nameTokens.includes(token)) matchedTokens += 1.5;
        else if (nameLower.includes(token)) matchedTokens += 1.0;
        else if (descLower.includes(token)) matchedTokens += 0.5;
        else if (sigLower.includes(token)) matchedTokens += 0.4;
      }

      if (matchedTokens > 0) {
        score = Math.min(0.9, (matchedTokens / Math.max(1, searchTokens.length)) * 0.75);
      }
    }

    // Filter by scope if provided
    if (scope && row.file_path && !row.file_path.toLowerCase().includes(scope.toLowerCase())) {
      score *= 0.8;
    }

    if (score >= 0.45) {
      rawCandidates.push({
        name: row.name,
        kind: row.type,
        filePath: row.file_path,
        line: meta.line,
        signature: meta.signature,
        description: meta.description,
        relevanceScore: Math.round(score * 100) / 100,
        usageCount: 0,
      });
    }
  }
  nodeStmt.free();

  // 2. Count incoming usages if available
  for (const c of rawCandidates) {
    try {
      const edgeStmt = db.prepare(`SELECT COUNT(*) as cnt FROM edges WHERE target_id LIKE ?`);
      edgeStmt.bind([`%${c.name}%`]);
      if (edgeStmt.step()) {
        const erow = edgeStmt.getAsObject() as { cnt: number };
        c.usageCount = erow.cnt || 0;
      }
      edgeStmt.free();
    } catch {}
  }

  // 3. Sort candidates by score descending, then usage count
  rawCandidates.sort((a, b) => b.relevanceScore - a.relevanceScore || b.usageCount - a.usageCount);
  const candidates = rawCandidates.slice(0, 5);
  const foundMatches = candidates.length > 0;

  // 4. Recommend standard directory for new utilities if not found
  const recommendedDirectory = detectRecommendedUtilDirectory();

  // 5. Build formatted markdown output
  const lines: string[] = [
    `🔍 **Kuma — Code Reuse & Anti-Duplication Engine**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🎯 **Intent**: "${query}"${scope ? ` (scope: \`${scope}\`)` : ""}`,
    "",
  ];

  if (foundMatches) {
    lines.push(`✨ **Existing helpers found in repository (REUSE these to avoid duplicate code):**`, "");
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const lineTag = c.line ? `#L${c.line}` : "";
      const sigDisplay = c.signature || `${c.name}(...)`;
      const usageTag = c.usageCount > 0 ? ` · 🔗 ${c.usageCount} active usages` : "";

      lines.push(`${i + 1}. \`${sigDisplay}\` (${c.kind})`);
      lines.push(`   📁 \`${c.filePath}${lineTag}\`${usageTag}`);
      if (c.description) {
        lines.push(`   📝 "${c.description}"`);
      }
      lines.push("");
    }
    lines.push(`💡 **Action**: Import and use the existing helper above instead of writing a new implementation.`);
  } else {
    lines.push(`✅ **No existing duplicate detected.** Safe to implement a new utility.`);
    if (recommendedDirectory) {
      lines.push(`📁 **Recommended location**: \`${recommendedDirectory}\` (standard directory for utilities in this project).`);
    }
    lines.push(`💡 **Agent Tip**: Keep the new function modular and export it so future tasks can discover and reuse it.`);
  }

  return {
    query,
    foundMatches,
    candidates,
    recommendedDirectory,
    formattedOutput: lines.join("\n"),
  };
}

/**
 * Split camelCase, PascalCase, or snake_case identifiers into individual words.
 */
function splitIdentifierTokens(id: string): string[] {
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-:]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/**
 * Detect where utility files belong in the current project structure.
 */
function detectRecommendedUtilDirectory(): string {
  const root = getProjectRoot();
  const candidates = [
    "src/utils",
    "src/lib",
    "src/common",
    "packages/utils",
    "lib/utils",
    "utils",
  ];

  for (const c of candidates) {
    if (fs.existsSync(path.resolve(root, c))) {
      return c;
    }
  }

  return "src/utils";
}

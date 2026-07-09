// ============================================================
// KUMA DNA — Project DNA (Phase 7.4)
// ============================================================
// One-page project fingerprint: architecture, conventions,
// health, history, ownership, risk areas, trends.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";
import { getDb } from "./kumaDb.js";
import { getGitDiffStat } from "../utils/kumaShared.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import path from "node:path";

interface DNAReport {
  projectName: string;
  architecture: string;
  totalFiles: number;
  totalFunctions: number;
  totalTests: number;
  topDirs: string[];
  conventions: Record<string, unknown>;
  healthScore: number;
  riskAreas: string[];
  trends: string[];
}

/**
 * Generate project DNA fingerprint.
 */
export async function generateDNA(): Promise<string> {
  try {
    const db = await getDb();
    const summary = sessionMemory.getSummary();
    const root = getProjectRoot();
    const projectName = path.basename(root);

    // Gather stats from graph
    let totalFiles = 0, totalFunctions = 0, totalTests = 0;
    try {
      const filesR = db.exec("SELECT COUNT(*) as c FROM nodes WHERE type = 'file'");
      totalFiles = (filesR[0]?.values[0][0] as number) || 0;
      const funcsR = db.exec("SELECT COUNT(*) as c FROM nodes WHERE type = 'function'");
      totalFunctions = (funcsR[0]?.values[0][0] as number) || 0;
      const testsR = db.exec("SELECT COUNT(*) as c FROM nodes WHERE type = 'test'");
      totalTests = (testsR[0]?.values[0][0] as number) || 0;
    } catch {}

    // Top directories
    const topDirs: string[] = [];
    try {
      const dirStmt = db.prepare(`SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL LIMIT 20`);
      const dirs = new Set<string>();
      while (dirStmt.step()) {
        const row = dirStmt.getAsObject() as Record<string, unknown>;
        const fp = row.file_path as string;
        if (fp) dirs.add(fp.split("/")[0] || fp);
      }
      dirStmt.free();
      topDirs.push(...dirs);
    } catch {}

    // Conventions
    const conventions = summary.conventions as Record<string, unknown> || {};

    // Health score from git
    let healthScore = 85;
    try {
      const stat = getGitDiffStat();
      const changedFiles = stat ? stat.split("\n").length : 0;
      healthScore -= Math.min(20, changedFiles * 2);
    } catch {}

    // Risk areas & trends
    const riskAreas: string[] = [];
    const trends: string[] = [];
    try {
      const failStmt = db.prepare(`SELECT file_path FROM nodes WHERE type = 'file' ORDER BY updated_at DESC LIMIT 5`);
      while (failStmt.step()) {
        const row = failStmt.getAsObject() as Record<string, unknown>;
        const fp = row.file_path as string;
        if (fp) trends.push(`📄 ${fp} — recently modified`);
      }
      failStmt.free();

      const sessionCount = (db.exec("SELECT COUNT(*) as c FROM sessions")[0]?.values[0][0] as number) || 0;
      if (sessionCount > 5) trends.push(`📊 ${sessionCount} total sessions recorded`);
    } catch {}

    if (totalTests === 0 && totalFunctions > 5) {
      riskAreas.push("🧪 No test nodes in knowledge graph");
    }

    // Architecture detection
    let architecture = "Standard";
    try {
      const modStmt = db.prepare(`SELECT DISTINCT file_path FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.type = 'imports' LIMIT 10`);
      let hasMvc = false, hasClean = false;
      while (modStmt.step()) {
        const row = modStmt.getAsObject() as Record<string, unknown>;
        const fp = row.file_path as string || "";
        if (fp.includes("controller")) hasMvc = true;
        if (fp.includes("usecase") || fp.includes("service")) hasClean = true;
      }
      modStmt.free();
      if (hasClean) architecture = "Clean Architecture";
      else if (hasMvc) architecture = "MVC-like";
    } catch {}

    const report: DNAReport = {
      projectName, architecture, totalFiles, totalFunctions, totalTests,
      topDirs, conventions, healthScore, riskAreas, trends,
    };

    return formatDNA(report);
  } catch (err) {
    return `Error generating DNA: ${err}`;
  }
}

function formatDNA(d: DNAReport): string {
  const lines: string[] = [
    `🧬 **Project DNA** — ${d.projectName}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `🏗️ **Architecture:** ${d.architecture}`,
    `📊 **Size:** ${d.totalFiles} files, ${d.totalFunctions} functions, ${d.totalTests} tests`,
    `🩺 **Health:** ${d.healthScore}/100`,
    "",
  ];

  if (d.topDirs.length > 0) {
    lines.push("**📁 Modules:**");
    for (const dir of d.topDirs.slice(0, 8)) lines.push(`  • ${dir}`);
    lines.push("");
  }

  if (Object.keys(d.conventions).length > 0) {
    lines.push("**📐 Conventions:**");
    const keys = ["framework", "testRunner", "packageManager", "projectType", "codeStyle"];
    for (const key of keys) {
      if (d.conventions[key]) lines.push(`  • **${key}:** ${d.conventions[key]}`);
    }
    lines.push("");
  }

  if (d.trends.length > 0) {
    lines.push("**📈 Trends:**");
    for (const t of d.trends) lines.push(`  ${t}`);
    lines.push("");
  }
  if (d.riskAreas.length > 0) {
    lines.push("**⚠️ Risk Areas:**");
    for (const r of d.riskAreas) lines.push(`  ${r}`);
    lines.push("");
  }

  lines.push("💡 DNA auto-updates as the Knowledge Graph grows.");
  return lines.join("\n");
}

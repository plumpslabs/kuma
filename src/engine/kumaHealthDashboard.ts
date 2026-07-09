// ============================================================
// KUMA HEALTH — Code Health Dashboard (Phase 4.3)
// ============================================================

import { sessionMemory } from "./sessionMemory.js";
import { computeAnalytics } from "./kumaAnalytics.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { getGitDiffStat } from "../utils/kumaShared.js";
import fs from "node:fs";
import path from "node:path";

interface DirectoryHealth {
  dir: string; fragilityScore: number; editCount: number; failureCount: number; fileCount: number; warnings: string[];
}
interface ProjectHealthReport {
  score: number; label: string; directories: DirectoryHealth[];
  signals: { totalFiles: number; totalEdits: number; totalFailures: number; gitChanges: number; backupCount: number };
  keyFindings: string[];
}

export function computeHealthDashboard(): ProjectHealthReport {
  const analytics = computeAnalytics();
  const root = getProjectRoot();
  const gitStat = getGitDiffStat();
  const gitChanges = gitStat ? gitStat.split("\n").filter(l => l.includes("|")).length : 0;

  let backupCount = 0;
  try {
    const bd = path.join(root, ".kuma", "backups");
    if (fs.existsSync(bd)) backupCount = fs.readdirSync(bd).filter(d => /^\d+$/.test(d)).length;
  } catch {}

  // Count files per directory
  const dirFileCounts = new Map<string, number>();
  try {
    const walk = (dir: string, base: string) => {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full, base);
          else if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) {
            const rel = path.dirname(path.relative(base, full));
            dirFileCounts.set(rel, (dirFileCounts.get(rel) || 0) + 1);
          }
        }
      } catch {}
    };
    walk(path.join(root, "src"), root);
  } catch {}

  // Build directory health
  const dirMap = new Map<string, { edits: number; failures: number }>();
  for (const call of sessionMemory.getToolCallHistory(100)) {
    if (call.toolName === "precise_diff_editor") {
      const fp = (call.params as any)?.filePath as string;
      if (fp) {
        const dir = path.dirname(fp) || ".";
        const e = dirMap.get(dir) || { edits: 0, failures: 0 };
        e.edits++;
        if ((call.params as any)?.success === false) e.failures++;
        dirMap.set(dir, e);
      }
    }
  }

  const directories: DirectoryHealth[] = [];
  for (const [dir, data] of dirMap) {
    const fc = dirFileCounts.get(dir) || 1;
    const fsScore = Math.min(100, Math.round(
      (data.failures / Math.max(data.edits, 1)) * 50 +
      (data.edits / Math.max(fc, 1)) * 30 +
      (data.failures > 0 ? 20 : 0)
    ));
    const warnings: string[] = [];
    if (data.failures > 0) warnings.push(`${data.failures} failure(s)`);
    if (data.edits > fc * 3) warnings.push("High edit density");
    directories.push({ dir, fragilityScore: fsScore, editCount: data.edits, failureCount: data.failures, fileCount: fc, warnings });
  }
  directories.sort((a, b) => b.fragilityScore - a.fragilityScore);

  // Overall score
  let score = 100;
  const highFrag = directories.filter(d => d.fragilityScore > 50);
  score -= Math.min(30, highFrag.length * 10);
  const totalFailures = directories.reduce((a, d) => a + d.failureCount, 0);
  score -= Math.min(20, totalFailures * 5);
  if (gitChanges > 10) score -= 15;
  else if (gitChanges > 5) score -= 8;
  if (analytics.session.testCount === 0 && analytics.session.editCount > 0) score -= 15;
  if (analytics.patterns.driftDetected) score -= 10;
  const finalScore = Math.max(0, Math.min(100, score));

  const label = finalScore >= 85 ? "Healthy" : finalScore >= 65 ? "Needs Attention" : finalScore >= 40 ? "Fragile" : "Critical";

  const findings: string[] = [];
  if (highFrag.length > 0) findings.push(`🔴 Fragile: ${highFrag.map(d => d.dir).join(", ")}`);
  if (analytics.session.rollbackCount > 2) findings.push(`🔄 ${analytics.session.rollbackCount} rollbacks`);
  if (analytics.patterns.editToTestRatio > 5) findings.push(`🧪 Low test coverage`);
  if (analytics.session.editCount > 10 && analytics.session.reviewCount === 0) findings.push(`👀 No code reviews`);
  if (backupCount > 10) findings.push(`💾 ${backupCount} backups available`);
  if (findings.length === 0) findings.push("✅ All healthy");

  return {
    score: finalScore, label, directories,
    signals: {
      totalFiles: dirFileCounts.size, totalEdits: analytics.session.editCount, totalFailures,
      gitChanges, backupCount,
    },
    keyFindings: findings,
  };
}

export function formatHealthDashboard(r: ProjectHealthReport): string {
  const bar = "█".repeat(Math.round(r.score / 10)) + "░".repeat(Math.round(10 - r.score / 10));
  const emoji = r.label === "Healthy" ? "🟢" : r.label === "Needs Attention" ? "🟡" : r.label === "Fragile" ? "🟠" : "🔴";
  const lines = [
    `${emoji} **Code Health Dashboard** — ${r.label}`, `   ${bar} ${r.score}/100`, `━━━━━━━━━━━━━━━━━━━━━━━━━`, "",
    `📁 ${r.signals.totalFiles} dirs | ✏️ ${r.signals.totalEdits} edits | ❌ ${r.signals.totalFailures} failures | 📝 ${r.signals.gitChanges} git | 💾 ${r.signals.backupCount} backups`, "",
  ];

  if (r.directories.length > 0) {
    lines.push("**Directory Fragility:**");
    for (const d of r.directories.slice(0, 10)) {
      const fb = "█".repeat(Math.round(d.fragilityScore / 10)) + "░".repeat(Math.round(10 - d.fragilityScore / 10));
      const c = d.fragilityScore > 50 ? "🔴" : d.fragilityScore > 25 ? "🟡" : "🟢";
      lines.push(`  ${c} **${d.dir}** ${fb} ${d.fragilityScore}/100 (${d.editCount}e, ${d.failureCount}f, ${d.fileCount} files)`);
      for (const w of d.warnings) lines.push(`     ⚠️ ${w}`);
    }
    lines.push("");
  }

  lines.push("**Findings:**");
  for (const f of r.keyFindings) lines.push(`  ${f}`);
  lines.push("", "💡 Use kuma_analytics() for detailed session stats.");

  return lines.join("\n");
}

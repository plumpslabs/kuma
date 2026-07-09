// ============================================================
// KUMA CONFIDENCE — AI Confidence Engine (Phase 7.3)
// ============================================================
// Estimates how confident AI should be about its answer
// based on files read, references checked, tests reviewed,
// and graph completeness.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";
import { getDb } from "./kumaDb.js";

interface ConfidenceReport {
  score: number;
  label: string;
  factors: Array<{ name: string; weight: number; score: number; detail: string }>;
  suggestions: string[];
}

/**
 * Compute confidence for a given context/task.
 */
export async function computeConfidence(target?: string): Promise<string> {
  try {
    const history = sessionMemory.getToolCallHistory(50);
    const db = await getDb();
    const factors: ConfidenceReport["factors"] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    // Factor 1: Has read files?
    const readFiles = history.filter(c => c.toolName === "smart_file_picker" || c.toolName === "read_files").length;
    const f1Score = Math.min(1, readFiles / 5);
    factors.push({ name: "Files Read", weight: 25, score: f1Score, detail: `${readFiles} file(s) read` });
    totalWeight += 25;
    weightedScore += 25 * f1Score;

    // Factor 2: Has run tests?
    const testCount = history.filter(c => c.toolName === "execute_safe_test").length;
    const hasTests = testCount > 0;
    factors.push({ name: "Tests Run", weight: 20, score: hasTests ? 1 : 0, detail: hasTests ? `${testCount} test(s) run` : "No tests run" });
    totalWeight += 20;
    weightedScore += 20 * (hasTests ? 1 : 0);

    // Factor 3: Has searched/referenced?
    const searchCount = history.filter(c => c.toolName === "smart_grep" || c.toolName === "lsp_query").length;
    const f3Score = Math.min(1, searchCount / 8);
    factors.push({ name: "Context Searched", weight: 20, score: f3Score, detail: `${searchCount} search/reference call(s)` });
    totalWeight += 20;
    weightedScore += 20 * f3Score;

    // Factor 4: Graph completeness for target
    if (target) {
      let graphCompleteness = 0;
      try {
        const stmt = db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE name LIKE ?`);
        stmt.bind([`%${target}%`]);
        if (stmt.step()) {
          const row = stmt.getAsObject() as Record<string, unknown>;
          const count = (row.c as number) || 0;
          graphCompleteness = Math.min(1, count / 3);
        }
        stmt.free();
      } catch {}
      factors.push({ name: "Graph Coverage", weight: 15, score: graphCompleteness, detail: `Target "${target}" has ${Math.round(graphCompleteness * 3)} related node(s) in graph` });
      totalWeight += 15;
      weightedScore += 15 * graphCompleteness;
    }

    // Factor 5: Has reviewed/reflected?
    const reviewCount = history.filter(c => c.toolName === "code_reviewer").length;
    const reflectCount = history.filter(c => c.toolName === "kuma_reflect").length;
    const reviewed = reviewCount > 0 || reflectCount > 0;
    factors.push({ name: "Review & Reflect", weight: 10, score: reviewed ? 1 : 0, detail: reviewed ? `${reviewCount} review(s), ${reflectCount} reflection(s)` : "No reviews yet" });
    totalWeight += 10;
    weightedScore += 10 * (reviewed ? 1 : 0);

    // Factor 6: Has goal?
    const summary = sessionMemory.getSummary();
    const hasGoal = !!(summary.currentGoal as string);
    factors.push({ name: "Goal Set", weight: 10, score: hasGoal ? 1 : 0, detail: hasGoal ? `Goal: "${(summary.currentGoal as string).substring(0, 50)}"` : "No goal set" });
    totalWeight += 10;
    weightedScore += 10 * (hasGoal ? 1 : 0);

    // Calculate final score
    const finalScore = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
    const label = finalScore >= 80 ? "High" : finalScore >= 50 ? "Medium" : finalScore >= 25 ? "Low" : "Very Low";

    // Suggestions
    const suggestions: string[] = [];
    if (readFiles < 3) suggestions.push("Read more files with smart_file_picker");
    if (!hasTests) suggestions.push("Run tests to validate your changes");
    if (searchCount < 3) suggestions.push("Use smart_grep or lsp_query to gather more context");
    if (!reviewed) suggestions.push("Use code_reviewer to verify your approach");
    if (!hasGoal) suggestions.push("Set a goal to track intent");

    const report: ConfidenceReport = { score: finalScore, label, factors, suggestions };
    return formatConfidence(report, target);
  } catch (err) {
    return `Error computing confidence: ${err}`;
  }
}

function formatConfidence(report: ConfidenceReport, target?: string): string {
  const emoji = report.label === "High" ? "🟢" : report.label === "Medium" ? "🟡" : report.label === "Low" ? "🟠" : "🔴";
  const bar = "█".repeat(Math.round(report.score / 10)) + "░".repeat(Math.round(10 - report.score / 10));

  const lines: string[] = [
    `${emoji} **AI Confidence** — ${report.label} (${report.score}%)`,
    `   ${bar}`,
    target ? `🎯 Target: "${target}"` : "",
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    "**Factors:**",
  ].filter(Boolean);

  for (const f of report.factors) {
    const fBar = "█".repeat(Math.round(f.score * 10)) + "░".repeat(Math.round(10 - f.score * 10));
    lines.push(`  • **${f.name}** (${f.weight}%) ${fBar} ${Math.round(f.score * 100)}%`);
    lines.push(`    ${f.detail}`);
  }

  if (report.suggestions.length > 0) {
    lines.push("", "**💡 To improve confidence:**");
    for (const s of report.suggestions) lines.push(`  • ${s}`);
  }

  return lines.join("\n");
}

// ============================================================
// KUMA ANALYTICS — AI Behavior Analytics (Phase 4.2)
// ============================================================

import { sessionMemory } from "./sessionMemory.js";

interface SessionAnalytics {
  session: { duration: string; toolCallCount: number; editCount: number; testCount: number; rollbackCount: number; searchCount: number; lspCount: number; reviewCount: number };
  files: { mostEdited: Array<{ filePath: string; edits: number }>; mostRead: Array<{ filePath: string; reads: number }>; totalModified: number };
  search: { topQueries: Array<{ query: string; count: number }>; totalSearches: number };
  domains: Array<{ name: string; editCount: number; successRate: number; failureCount: number }>;
  patterns: { editToTestRatio: number; readBeforeEdit: boolean; hasGoal: boolean; driftDetected: boolean };
  performance: { avgEditDurationMs: number; avgSearchDurationMs: number; totalDurationMs: number; fastestTool: string; slowestTool: string };
}

export function computeAnalytics(): SessionAnalytics {
  const history = sessionMemory.getToolCallHistory(100);
  const modifiedFiles = sessionMemory.getModifiedFiles();
  const summary = sessionMemory.getSummary();
  const duration = (summary.sessionDuration as string) || "0s";

  const editCount = history.filter(c => c.toolName === "precise_diff_editor").length;
  const testCount = history.filter(c => c.toolName === "execute_safe_test").length;
  const searchCount = history.filter(c => c.toolName === "smart_grep").length;
  const lspCount = history.filter(c => c.toolName === "lsp_query").length;
  const reviewCount = history.filter(c => c.toolName === "code_reviewer").length;
  const rollbackCount = history.filter(c => (c.params as any)?.action === "rollback").length;

  // Most edited files
  const fileEdits = new Map<string, number>();
  const fileReads = new Map<string, number>();
  for (const call of history) {
    const p = call.params as Record<string, unknown>;
    if (p.filePath && typeof p.filePath === 'string') {
      if (call.toolName === "precise_diff_editor") fileEdits.set(p.filePath, (fileEdits.get(p.filePath) || 0) + 1);
      if (call.toolName === "smart_file_picker") fileReads.set(p.filePath, (fileReads.get(p.filePath) || 0) + 1);
    }
  }
  const mostEdited = [...fileEdits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, c]) => ({ filePath: f, edits: c }));
  const mostRead = [...fileReads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, c]) => ({ filePath: f, reads: c }));

  // Top search queries
  const searchQueries = new Map<string, number>();
  for (const call of history) {
    if (call.toolName === "smart_grep") {
      const q = (call.params as any)?.query;
      if (typeof q === 'string' && q.length > 2) searchQueries.set(q, (searchQueries.get(q) || 0) + 1);
    }
  }
  const topQueries = [...searchQueries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, c]) => ({ query: q, count: c }));

  // Domain analysis (group files by top directory)
  const domainEdits = new Map<string, { edits: number; failures: number }>();
  for (const call of history) {
    if (call.toolName === "precise_diff_editor") {
      const fp = (call.params as any)?.filePath as string;
      if (fp) {
        const domain = fp.split("/")[0] || fp;
        const e = domainEdits.get(domain) || { edits: 0, failures: 0 };
        e.edits++;
        if ((call.params as any)?.success === false) e.failures++;
        domainEdits.set(domain, e);
      }
    }
  }
  const domains = [...domainEdits.entries()].map(([name, data]) => ({
    name, editCount: data.edits,
    successRate: data.edits > 0 ? (data.edits - data.failures) / data.edits : 0,
    failureCount: data.failures,
  })).sort((a, b) => b.editCount - a.editCount);

  // Performance (from session memory params, if recorded)
  const toolDurations = new Map<string, number[]>();
  let totalDurationMs = 0;
  for (const call of history) {
    const dur = (call.params as any)?.durationMs;
    if (typeof dur === 'number') {
      totalDurationMs += dur;
      const existing = toolDurations.get(call.toolName) || [];
      existing.push(dur);
      toolDurations.set(call.toolName, existing);
    }
  }

  const toolAvgDurations: Array<[string, number]> = [];
  for (const [tool, durs] of toolDurations) {
    if (durs.length > 0) toolAvgDurations.push([tool, durs.reduce((a, b) => a + b, 0) / durs.length]);
  }
  toolAvgDurations.sort((a, b) => a[1] - b[1]);
  const fastestTool = toolAvgDurations[0]?.[0] || "—";
  const slowestTool = toolAvgDurations[toolAvgDurations.length - 1]?.[0] || "—";

  // Patterns
  const hasGoal = !!(summary.currentGoal as string);
  const editToTestRatio = testCount > 0 ? +(editCount / testCount).toFixed(1) : editCount > 0 ? Infinity : 0;

  const editDirs = new Set<string>();
  for (const call of history) {
    if (call.toolName === "precise_diff_editor") {
      const fp = (call.params as any)?.filePath as string;
      if (fp) editDirs.add(fp.split("/")[0] || fp);
    }
  }
  const driftDetected = editDirs.size > 3 && editCount > 5;

  const readFiles = new Set<string>();
  const editFilesSet = new Set<string>();
  for (const call of history) {
    const fp = (call.params as any)?.filePath as string;
    if (!fp) continue;
    if (call.toolName === "smart_file_picker") readFiles.add(fp);
    if (call.toolName === "precise_diff_editor") editFilesSet.add(fp);
  }
  const readBeforeEdit = [...editFilesSet].filter(f => !readFiles.has(f)).length === 0 || editFilesSet.size === 0;

  return {
    session: { duration, toolCallCount: history.length, editCount, testCount, rollbackCount, searchCount, lspCount, reviewCount },
    files: { mostEdited, mostRead, totalModified: modifiedFiles.length },
    search: { topQueries, totalSearches: searchCount },
    domains,
    patterns: { editToTestRatio, readBeforeEdit, hasGoal, driftDetected },
    performance: { avgEditDurationMs: 0, avgSearchDurationMs: 0, totalDurationMs, fastestTool, slowestTool },
  };
}

export function formatAnalytics(a: SessionAnalytics): string {
  const lines = [
    `📊 **AI Behavior Analytics**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`, "",
    `**Session:** ${a.session.duration} | 🛠️ ${a.session.toolCallCount} calls | ✏️ ${a.session.editCount} edits | 🧪 ${a.session.testCount} tests`,
    `🔄 ${a.session.rollbackCount} rollbacks | 🔎 ${a.session.searchCount} searches | 📋 ${a.session.lspCount} LSP | 👀 ${a.session.reviewCount} reviews`, "",
  ];

  if (a.performance.totalDurationMs > 0) {
    lines.push(`**Performance:** ⚡ ${a.performance.fastestTool} | 🐢 ${a.performance.slowestTool}`, "");
  }

  if (a.files.mostEdited.length > 0) {
    lines.push("**Most Edited Files:**");
    for (const f of a.files.mostEdited) lines.push(`  ✏️ ${f.filePath} — ${f.edits}x`);
    lines.push("");
  }
  if (a.files.mostRead.length > 0) {
    lines.push("**Most Read Files:**");
    for (const f of a.files.mostRead) lines.push(`  📖 ${f.filePath} — ${f.reads}x`);
    lines.push("");
  }
  if (a.search.topQueries.length > 0) {
    lines.push("**Top Searches:**");
    for (const q of a.search.topQueries) lines.push(`  🔎 "${q.query}" — ${q.count}x`);
    lines.push("");
  }
  if (a.domains.length > 0) {
    lines.push("**Domain Success Rates:**");
    for (const d of a.domains) {
      const bar = "█".repeat(Math.round(d.successRate * 10)) + "░".repeat(Math.round((1 - d.successRate) * 10));
      lines.push(`  ${d.name} — ${bar} ${(d.successRate * 100).toFixed(0)}% (${d.editCount} edits, ${d.failureCount} failures)`);
    }
    lines.push("");
  }

  lines.push("**Patterns:**");
  if (!a.patterns.hasGoal) lines.push(`  ⚠️ No goal set`);
  if (a.patterns.editToTestRatio > 5) lines.push(`  ⚠️ Edit:Test ratio ${a.patterns.editToTestRatio}:1 — test more`);
  else if (a.patterns.editToTestRatio > 0) lines.push(`  ✅ Edit:Test ratio ${a.patterns.editToTestRatio}:1`);
  if (a.patterns.driftDetected) lines.push(`  ⚠️ Context drift — ${a.domains.length} areas touched`);
  if (!a.patterns.readBeforeEdit && a.files.mostEdited.length > 0) lines.push(`  ⚠️ Editing without reading first`);
  lines.push("");

  return lines.join("\n");
}

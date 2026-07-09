// ============================================================
// KUMA REPLAY — AI Replay (Phase 6.2)
// ============================================================
// Replays what AI did in a previous session — tool calls
// transformed into a human-readable narrative with key insights.
// ============================================================

import { sessionMemory } from "./sessionMemory.js";

interface ReplayEntry {
  step: number;
  toolName: string;
  params: Record<string, unknown>;
  timestamp: number;
}

interface ReplayReport {
  sessionDate: string;
  totalSteps: number;
  entries: ReplayEntry[];
  keyFiles: string[];
  keyInsight: string;
  diffSummary: string;
}

/**
 * Replay the current session's activity.
 */
export function replaySession(): string {
  try {
    const calls = sessionMemory.getToolCallHistory(100);
    if (calls.length === 0) {
      return "🎬 **AI Replay** — No tool calls recorded in this session.";
    }

    // Build replay entries
    const entries: ReplayEntry[] = calls.map((c, i) => ({
      step: i + 1,
      toolName: c.toolName,
      params: c.params,
      timestamp: c.timestamp || Date.now(),
    }));

    // Extract key files (most accessed)
    const fileCount = new Map<string, number>();
    for (const e of entries) {
      const fp = (e.params.filePath as string) || (e.params.file as string) || "";
      if (fp) fileCount.set(fp, (fileCount.get(fp) || 0) + 1);
    }
    const keyFiles = [...fileCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);

    // Key insight: what was the most impactful action?
    const edits = entries.filter(e => e.toolName === "precise_diff_editor");
    const findings = entries.filter(e => e.toolName === "smart_grep");
    const insight = edits.length > 0
      ? `✏️ ${edits.length} edits across ${keyFiles.length} files`
      : findings.length > 0
        ? `🔎 ${findings.length} searches performed`
        : `📖 ${entries.length} exploration steps`;

    // Diff summary
    const summary = sessionMemory.getSummary();
    const modified = (summary.modifiedFiles as Array<unknown> | undefined)?.length || 0;
    const diffSummary = `📝 ${modified} files modified`;

    const report: ReplayReport = {
      sessionDate: new Date(entries[0]?.timestamp || Date.now()).toISOString().split("T")[0],
      totalSteps: entries.length,
      entries,
      keyFiles,
      keyInsight: insight,
      diffSummary,
    };

    return formatReplay(report);
  } catch (err) {
    return `Error replaying session: ${err}`;
  }
}

function formatReplay(report: ReplayReport): string {
  const lines: string[] = [
    `🎬 **AI Replay** — ${report.sessionDate}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📊 ${report.totalSteps} steps | ${report.keyInsight} | ${report.diffSummary}`,
    "",
  ];

  // Replay narrative
  lines.push("**Session Timeline:**");
  lines.push("");
  for (const e of report.entries.slice(0, 30)) {
    const ts = new Date(e.timestamp).toLocaleTimeString();
    const p = e.params;
    const fp = (p.filePath as string) || (p.file as string) || "";
    const q = p.query as string || "";

    const emoji = e.toolName === "smart_grep" ? "🔎" :
      e.toolName === "smart_file_picker" || e.toolName === "read_files" ? "📖" :
      e.toolName === "precise_diff_editor" ? "✏️" :
      e.toolName === "execute_safe_test" ? "🧪" :
      e.toolName === "code_reviewer" ? "👀" :
      e.toolName === "batch_file_writer" ? "📝" :
      e.toolName === "lsp_query" ? "🔍" :
      "🛠️";

    const detail = fp ? `\`${fp}\`` : q ? `"${q.substring(0, 40)}${q.length > 40 ? "..." : ""}"` : "";
    lines.push(`  ${emoji} **[${ts}]** ${e.toolName} ${detail}`);
  }
  if (report.entries.length > 30) {
    lines.push(`  ... +${report.entries.length - 30} more steps`);
  }
  lines.push("");

  // Key files
  if (report.keyFiles.length > 0) {
    lines.push("**Key Files:**");
    for (const f of report.keyFiles) lines.push(`  📄 ${f}`);
    lines.push("");
  }

  lines.push("💡 Run kuma_analytics for detailed session metrics.");
  return lines.join("\n");
}

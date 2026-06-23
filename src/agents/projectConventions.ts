import { detectConventions } from "../utils/conventionsDetector.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// PROJECT CONVENTIONS AGENT — Detect project configuration
// ============================================================

interface ProjectConventionsParams {
  forceRescan?: boolean;
}

export async function handleProjectConventions(params: ProjectConventionsParams): Promise<string> {
  const { forceRescan = false } = params;

  try {
    const conventions = await detectConventions(forceRescan);
    const conventionsRecord = conventions as unknown as Record<string, unknown>;

    sessionMemory.setConventions(conventionsRecord);
    sessionMemory.recordToolCall("project_conventions", { forceRescan });

    return formatConventionsOutput(conventionsRecord);
  } catch (err) {
    return `Error detecting conventions: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatConventionsOutput(conventions: Record<string, unknown>): string {
  const lines: string[] = [
    "📋 **Project Conventions Detected**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `🏗️ **Framework:** ${conventions.framework || "unknown"}`,
    `🎯 **Project Type:** ${conventions.projectType || "unknown"}`,
    `🧪 **Test Runner:** ${conventions.testRunner || "unknown"}`,
    `🎨 **Styling:** ${conventions.styling || "unknown"}`,
    `📦 **Package Manager:** ${conventions.packageManager || "unknown"}`,
    `🔤 **Module System:** ${conventions.moduleSystem || "unknown"}`,
    `💻 **Language:** ${conventions.language || "unknown"}`,
    "",
    conventions.importAlias
      ? `🔗 **Import Alias:** \`${conventions.importAlias}\``
      : "🔗 **Import Alias:** Not detected (use relative imports)",
    "",
  ];

  if (conventions.isMonorepo && Array.isArray(conventions.workspaces) && conventions.workspaces.length > 0) {
    lines.push(`🧩 **Monorepo:** yes — ${conventions.workspaces.length} workspace(s)`);
    for (const ws of conventions.workspaces as Array<{ path: string; name: string; framework: string }>) {
      lines.push(`  - \`${ws.path}\` (${ws.name}) — ${ws.framework}`);
    }
    lines.push("");
  }

  if (conventions.features && Array.isArray(conventions.features) && conventions.features.length > 0) {
    lines.push("⭐ **Key Features:**");
    for (const feature of conventions.features as string[]) {
      lines.push(`  - ${feature}`);
    }
    lines.push("");
  }

  if (conventions.lintRules && Array.isArray(conventions.lintRules) && conventions.lintRules.length > 0) {
    lines.push("📐 **Lint/Format Tools:**");
    for (const rule of conventions.lintRules as string[]) {
      lines.push(`  - ${rule}`);
    }
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("💡 Use these conventions to keep code consistent.");
  lines.push("💡 Re-run with forceRescan: true after adding new dependencies.");

  return lines.join("\n");
}

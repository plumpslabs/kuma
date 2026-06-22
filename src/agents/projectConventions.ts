import { detectConventions } from "../utils/conventionsDetector.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// PROJECT CONVENTIONS AGENT — Deteksi konvensi proyek
// ============================================================

interface ProjectConventionsParams {
  forceRescan?: boolean;
}

export async function handleProjectConventions(params: ProjectConventionsParams): Promise<string> {
  const { forceRescan = false } = params;

  try {
    const conventions = await detectConventions(forceRescan);
    const conventionsRecord = conventions as unknown as Record<string, unknown>;

    // Simpan di session memory
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
    `🧪 **Test Runner:** ${conventions.testRunner || "unknown"}`,
    `🎨 **Styling:** ${conventions.styling || "unknown"}`,
    `📦 **Package Manager:** ${conventions.packageManager || "unknown"}`,
    `🔤 **Module System:** ${conventions.moduleSystem || "unknown"}`,
    `💻 **Language:** ${conventions.language || "unknown"}`,
    "",
    conventions.importAlias
      ? `🔗 **Import Alias:** \`${conventions.importAlias}\``
      : "🔗 **Import Alias:** Tidak terdeteksi (gunakan relative imports)",
    "",
  ];

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
  lines.push("💡 Conventions ini otomatis dipakai untuk menjaga konsistensi kode.");
  lines.push("💡 Jalankan ulang dengan forceRescan: true jika menambah dependensi baru.");

  return lines.join("\n");
}

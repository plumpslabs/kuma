// ============================================================
// KUMA CHECKPOINT — Atomic Sandbox Checkpoint & Rollback (Issue #29)
// ============================================================
// Enables safe experimental refactoring by capturing atomic
// snapshots before high-risk edits and restoring on failure.
//
// Features:
//   1. checkpoint(label) — snapshots files + DB state
//   2. rollback(label) — instantly restores from snapshot
//   3. list — shows all checkpoints
//   4. GC — prune old checkpoints
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getDb, resetDbInstance } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "./sessionMemory.js";

const CHECKPOINT_DIR = ".kuma/checkpoints";

interface CheckpointManifest {
  label: string;
  timestamp: number;
  files: Array<{ path: string; hash: string }>;
  dbSnapshot: boolean;
  description?: string;
}

// ============================================================
// CREATE CHECKPOINT
// ============================================================

export async function createCheckpoint(
  label: string,
  description?: string,
): Promise<string> {
  try {
    const root = getProjectRoot();
    const cpDir = path.join(root, CHECKPOINT_DIR, sanitizeLabel(label));
    if (fs.existsSync(cpDir)) {
      return `⚠️ Checkpoint "${label}" already exists. Use a different label or remove it first.`;
    }
    fs.mkdirSync(cpDir, { recursive: true });

    // 1. Snapshot tracked files from change_log
    const db = await getDb();
    const filesStmt = db.prepare(
      "SELECT DISTINCT file_path FROM change_log ORDER BY id DESC LIMIT 100",
    );
    const files: Array<{ path: string; hash: string }> = [];
    while (filesStmt.step()) {
      const row = filesStmt.getAsObject() as Record<string, unknown>;
      const fp = row.file_path as string;
      const fullPath = path.resolve(root, fp);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const hash = simpleHash(content);
        // Save file copy to checkpoint dir
        const fileDir = path.dirname(path.join(cpDir, "files", fp));
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(path.join(cpDir, "files", fp), content, "utf-8");
        files.push({ path: fp, hash });
      }
    }
    filesStmt.free();

    // 2. Snapshot DB state
    const dbData = db.export();
    fs.writeFileSync(path.join(cpDir, "kuma.db"), Buffer.from(dbData));

    // 3. Write manifest
    const manifest: CheckpointManifest = {
      label,
      timestamp: Date.now(),
      files,
      dbSnapshot: true,
      description,
    };
    fs.writeFileSync(
      path.join(cpDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    sessionMemory.recordToolCall("kuma_checkpoint_create", {
      label,
      filesCount: files.length,
    });

    return [
      `✅ **Checkpoint Created**: "${label}"`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📦 **${files.length} file(s)** snapshotted`,
      `🗄️  **Database** snapshotted`,
      `📍 ${cpDir}`,
      ``,
      `💡 To restore: kuma_safety({ action: 'rollback_label', label: '${label}' })`,
      description ? `📝 ${description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    return `❌ Checkpoint failed: ${err}`;
  }
}

// ============================================================
// ROLLBACK TO CHECKPOINT
// ============================================================

export async function rollbackToCheckpoint(label: string): Promise<string> {
  try {
    const root = getProjectRoot();
    const cpDir = path.join(root, CHECKPOINT_DIR, sanitizeLabel(label));
    const manifestPath = path.join(cpDir, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
      return `❌ Checkpoint "${label}" not found. Available checkpoints:\n\n${listCheckpoints()}`;
    }

    const manifest: CheckpointManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    );

    // 1. Restore files
    let restored = 0;
    let failed = 0;
    for (const f of manifest.files) {
      const snapshotPath = path.join(cpDir, "files", f.path);
      if (fs.existsSync(snapshotPath)) {
        try {
          const content = fs.readFileSync(snapshotPath, "utf-8");
          const targetPath = path.resolve(root, f.path);
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(targetPath, content, "utf-8");
          restored++;
        } catch {
          failed++;
        }
      }
    }

  // 2. Restore DB state
    const dbSnapshotPath = path.join(cpDir, "kuma.db");
    if (fs.existsSync(dbSnapshotPath)) {
      // 🔴 CRITICAL: Write snapshot to disk and invalidate in-memory dbInstance
      const kumaDir = path.join(root, ".kuma");
      const dbPath = path.join(kumaDir, "kuma.db");
      const snapshotData = fs.readFileSync(dbSnapshotPath);
      fs.writeFileSync(dbPath, snapshotData);
      // Reset in-memory dbInstance so next getDb() reloads from disk
      resetDbInstance();
    }

    sessionMemory.recordToolCall("kuma_checkpoint_rollback", {
      label,
      restored,
      failed,
    });

    return [
      `🔄 **Rollback Complete**: "${label}"`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `✅ Restored **${restored} file(s)**`,
      failed > 0 ? `⚠️ ${failed} file(s) failed to restore` : "",
      `🗄️  Database restored to checkpoint state`,
      ``,
      `💡 You may need to restart your language server for full effect.`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    return `❌ Rollback failed: ${err}`;
  }
}

// ============================================================
// LIST CHECKPOINTS
// ============================================================

export function listCheckpoints(): string {
  try {
    const root = getProjectRoot();
    const cpDir = path.join(root, CHECKPOINT_DIR);
    if (!fs.existsSync(cpDir)) {
      return "📭 No checkpoints found. Use kuma_safety({ action: 'checkpoint', label: 'pre-feature-x' }) to create one.";
    }

    const entries = fs.readdirSync(cpDir);
    const checkpoints: Array<{ label: string; manifest: CheckpointManifest }> = [];

    for (const entry of entries) {
      const manifestPath = path.join(cpDir, entry, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest: CheckpointManifest = JSON.parse(
            fs.readFileSync(manifestPath, "utf-8"),
          );
          checkpoints.push({ label: entry, manifest });
        } catch { /* skip corrupted */ }
      }
    }

    if (checkpoints.length === 0) {
      return "📭 No valid checkpoints found.";
    }

    const lines: string[] = [
      "📦 **Checkpoints**",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const cp of checkpoints) {
      const time = new Date(cp.manifest.timestamp).toLocaleString();
      lines.push(`  📌 **${cp.manifest.label}**`);
      lines.push(`     🕐 ${time} | 📁 ${cp.manifest.files.length} files | 💾 ${cp.manifest.dbSnapshot ? "DB included" : "no DB"}`);
      if (cp.manifest.description) {
        lines.push(`     📝 ${cp.manifest.description}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err}`;
  }
}

// ============================================================
// PRUNE OLD CHECKPOINTS
// ============================================================

export function pruneCheckpoints(keep: number = 5): string {
  try {
    const root = getProjectRoot();
    const cpDir = path.join(root, CHECKPOINT_DIR);
    if (!fs.existsSync(cpDir)) return "📭 No checkpoints to prune.";

    const entries = fs.readdirSync(cpDir)
      .map(e => ({ name: e, time: fs.statSync(path.join(cpDir, e)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    let removed = 0;
    for (let i = keep; i < entries.length; i++) {
      fs.rmSync(path.join(cpDir, entries[i].name), { recursive: true, force: true });
      removed++;
    }

    return removed > 0
      ? `🧹 Pruned **${removed} old checkpoint(s)**. Kept ${Math.min(keep, entries.length)} most recent.`
      : "✅ No checkpoints needed pruning.";
  } catch (err) {
    return `Error: ${err}`;
  }
}

// ============================================================
// HELPERS
// ============================================================

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

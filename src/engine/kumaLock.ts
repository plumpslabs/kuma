// ============================================================
// KUMA LOCK — Multi-Agent Lock (Phase 6.1)
// ============================================================
// Prevents multiple AI agents from editing the same file.
// File lock registry with acquire/release protocol.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

interface LockEntry {
  filePath: string;
  agentId: string;
  acquiredAt: number;
  status: "locked" | "pending_release";
}

const LOCKS_DIR = ".kuma/locks";

function locksDir(): string {
  return path.join(getProjectRoot(), LOCKS_DIR);
}

function ensureLocksDir(): void {
  const dir = locksDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function lockPath(filePath: string): string {
  const safeName = filePath.replace(/[^a-zA-Z0-9_./-]/g, "_");
  return path.join(locksDir(), `${safeName}.lock.json`);
}

/**
 * Acquire a lock on a file.
 */
export function acquireLock(filePath: string, agentId?: string): string {
  ensureLocksDir();
  const lp = lockPath(filePath);
  const id = agentId || `agent-${process.pid}`;

  // Check if already locked
  if (fs.existsSync(lp)) {
    try {
      const existing: LockEntry = JSON.parse(fs.readFileSync(lp, "utf-8"));
      if (existing.agentId === id) {
        return `🔒 **Already locked** by you (${id}) on ${new Date(existing.acquiredAt).toISOString()}`;
      }
      const elapsed = Math.floor((Date.now() - existing.acquiredAt) / 1000);
      if (elapsed > 300) {
        // Stale lock (>5 min) — auto-release
        fs.unlinkSync(lp);
      } else {
        return `🔒 **Locked** by ${existing.agentId} since ${new Date(existing.acquiredAt).toISOString()} (${elapsed}s ago)`;
      }
    } catch { fs.unlinkSync(lp); }
  }

  const entry: LockEntry = { filePath, agentId: id, acquiredAt: Date.now(), status: "locked" };
  fs.writeFileSync(lp, JSON.stringify(entry, null, 2), "utf-8");
  return `🔓 **Lock acquired** on \`${filePath}\` by ${id}`;
}

/**
 * Release a lock on a file.
 */
export function releaseLock(filePath: string, agentId?: string): string {
  ensureLocksDir();
  const lp = lockPath(filePath);
  const id = agentId || `agent-${process.pid}`;

  if (!fs.existsSync(lp)) {
    return `⚠️ No lock found for \`${filePath}\``;
  }

  try {
    const existing: LockEntry = JSON.parse(fs.readFileSync(lp, "utf-8"));
    if (existing.agentId !== id) {
      return `⚠️ Cannot release lock held by ${existing.agentId}. Use force:true to override.`;
    }
    fs.unlinkSync(lp);
    return `🔓 **Lock released** on \`${filePath}\``;
  } catch {
    fs.unlinkSync(lp);
    return `🔓 **Lock released** (force cleanup) on \`${filePath}\``;
  }
}

/**
 * List all active locks.
 */
export function listLocks(): string {
  ensureLocksDir();
  const dir = locksDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".lock.json"));
  if (files.length === 0) return "🔓 No active locks.";

  const lines: string[] = ["🔒 **Active Locks:**", ""];
  for (const f of files) {
    try {
      const entry: LockEntry = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      const elapsed = Math.floor((Date.now() - entry.acquiredAt) / 1000);
      lines.push(`  • \`${entry.filePath}\` — locked by ${entry.agentId} (${elapsed}s ago)`);
    } catch {}
  }
  lines.push("", "💡 Locks older than 5 minutes are auto-released on acquire attempt.");
  return lines.join("\n");
}

/**
 * Check if a file is locked.
 */
export function isLocked(filePath: string): { locked: boolean; by?: string; since?: number } {
  const lp = lockPath(filePath);
  if (!fs.existsSync(lp)) return { locked: false };
  try {
    const entry: LockEntry = JSON.parse(fs.readFileSync(lp, "utf-8"));
    return { locked: true, by: entry.agentId, since: entry.acquiredAt };
  } catch {
    return { locked: false };
  }
}

/**
 * Force-release all stale locks (>5 min).
 */
export function cleanStaleLocks(): string {
  ensureLocksDir();
  const dir = locksDir();
  let count = 0;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".lock.json"))) {
    try {
      const entry: LockEntry = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      if (Date.now() - entry.acquiredAt > 300000) {
        fs.unlinkSync(path.join(dir, f));
        count++;
      }
    } catch {
      try { fs.unlinkSync(path.join(dir, f)); count++; } catch {}
    }
  }
  return count > 0 ? `🧹 Cleaned ${count} stale lock(s).` : "✅ No stale locks found.";
}

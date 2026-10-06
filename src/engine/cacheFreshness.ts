// ============================================================
// CACHE FRESHNESS — Issue #38 (decay contract: TTL + dirty flags)
// ============================================================
// Cached artifacts carry TTL + dirty flags; consumers see freshness,
// never silent staleness. Hook-safe: dirty.json is append-simple JSON,
// never the shared DB.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

export const RESEARCH_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAP_TTL_MS = 24 * 3600 * 1000;

const DIRTY_FILE = ".kuma/dirty.json";

/** True when a timestamp is older than its TTL (consumers must refresh). */
export function isStale(savedAtMs: number, ttlMs: number, nowMs = Date.now()): boolean {
  if (!savedAtMs) return true;
  return nowMs - savedAtMs > ttlMs;
}

export function formatAge(savedAtMs: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - savedAtMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function dirtyPath(): string {
  return path.join(getProjectRoot(), DIRTY_FILE);
}

function loadDirty(): Record<string, number> {
  try {
    const fp = dirtyPath();
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf-8"));
      if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
    }
  } catch { /* fresh */ }
  return {};
}

/** Mark a file dirty at pre-edit time (called by the pre-edit hook). */
export function markDirty(filePath: string): void {
  try {
    const fp = dirtyPath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dirty = loadDirty();
    dirty[filePath] = Date.now();
    // Bound the file: keep only the 200 most recent entries.
    const keys = Object.keys(dirty).sort((a, b) => dirty[b] - dirty[a]).slice(0, 200);
    const bounded: Record<string, number> = {};
    for (const k of keys) bounded[k] = dirty[k];
    fs.writeFileSync(fp, JSON.stringify(bounded), "utf-8");
  } catch { /* non-critical */ }
}

/** Files touched since the last map sync. */
export function getDirtyFiles(): string[] {
  return Object.keys(loadDirty());
}

/** Clear dirty flags after the map was patched (called post-sync). */
export function clearDirty(): void {
  try {
    const fp = dirtyPath();
    if (fs.existsSync(fp)) fs.rmSync(fp, { force: true });
  } catch { /* non-critical */ }
}

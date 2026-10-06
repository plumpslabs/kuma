// ============================================================
// ISSUE #38 — Decay contract: TTL + dirty flags
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../src/utils/pathValidator.js";
import {
  isStale,
  formatAge,
  markDirty,
  getDirtyFiles,
  clearDirty,
  RESEARCH_TTL_MS,
} from "../src/engine/cacheFreshness.js";

describe("issue #38 decay contract", () => {
  test("TTL: fresh vs stale", () => {
    expect(isStale(Date.now(), RESEARCH_TTL_MS)).toBe(false);
    expect(isStale(Date.now() - 8 * 24 * 3600 * 1000, RESEARCH_TTL_MS)).toBe(true);
    expect(isStale(0, RESEARCH_TTL_MS)).toBe(true);
  });

  test("formatAge buckets", () => {
    const now = Date.now();
    expect(formatAge(now - 30 * 1000, now)).toBe("30s");
    expect(formatAge(now - 5 * 60 * 1000, now)).toBe("5m");
    expect(formatAge(now - 3 * 3600 * 1000, now)).toBe("3h");
    expect(formatAge(now - 2 * 86400 * 1000, now)).toBe("2d");
  });

  test("dirty roundtrip (cleans up after itself)", () => {
    const marker = `eval38-${Date.now()}.ts`;
    markDirty(marker);
    expect(getDirtyFiles()).toContain(marker);
    // Remove only our marker, keep the helper honest for other entries
    const fp = path.join(getProjectRoot(), ".kuma", "dirty.json");
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8"));
    delete parsed[marker];
    fs.writeFileSync(fp, JSON.stringify(parsed), "utf-8");
    expect(getDirtyFiles()).not.toContain(marker);
    clearDirty();
  });
});

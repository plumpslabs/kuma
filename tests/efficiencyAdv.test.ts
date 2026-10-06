// ============================================================
// EFFICIENCY — briefs, cost ledger, predictor, compaction,
// microcompact (usage instrumentation)
// ============================================================

import { briefFreshness, readBrief } from "../src/engine/packageBriefs.js";
import { recordCost, getCostStats, formatCostStats } from "../src/engine/costLedger.js";
import { fileSig, rankTestsByHistory } from "../src/engine/testHistory.js";
import { getCompactionContext } from "../src/engine/compactionContext.js";
import { sessionMemory } from "../src/engine/sessionMemory.js";
import { isStale, RESEARCH_TTL_MS } from "../src/engine/cacheFreshness.js";

describe("package briefs (zero-LLM pre-computed context)", () => {
  test("missing brief → honest missing state (never silent)", () => {
    const f = briefFreshness(`no-such-pkg-${Date.now()}`);
    expect(f.exists).toBe(false);
    expect(f.fresh).toBe(false);
    expect(readBrief(`no-such-pkg-${Date.now()}`)).toBeNull();
  });

  test("research TTL: fresh vs stale boundary", () => {
    expect(isStale(Date.now(), RESEARCH_TTL_MS)).toBe(false);
    expect(isStale(Date.now() - 8 * 86400 * 1000, RESEARCH_TTL_MS)).toBe(true);
  });
});

describe("cost ledger (cost-per-success, not token counts)", () => {
  test("record → aggregate roundtrip", async () => {
    const tool = `eval-cost-${Date.now()}`;
    await recordCost({ tool, action: "verify", durationMs: 120, outputChars: 500, outcome: "ok" });
    await recordCost({ tool, action: "verify", durationMs: 80, outputChars: 300, outcome: "error" });
    const stats = await getCostStats(50);
    const row = stats.find((s) => s.tool === tool);
    expect(row).toBeDefined();
    expect(row!.calls).toBe(2);
    expect(row!.errors).toBe(1);
    expect(row!.avgMs).toBe(100);
    expect(formatCostStats([row!])).toContain(tool);
  });

  test("empty ledger → honest empty message", () => {
    expect(formatCostStats([])).toContain("no tool calls recorded");
  });
});

describe("predictive test selection lite", () => {
  test("fileSig coarse signature", () => {
    expect(fileSig("backend/routes/auth.ts")).toBe("backend/routes/auth");
    expect(fileSig("a.test.ts")).toBe("/a");
  });

  test("no history → static order preserved", async () => {
    const ranked = await rankTestsByHistory(`never-seen-${Date.now()}.ts`, ["b.test.ts", "a.test.ts"]);
    expect(ranked.map((r) => r.path)).toEqual(["b.test.ts", "a.test.ts"]);
    expect(ranked[0].reason).toBe("static match");
  });
});

describe("compaction survival set", () => {
  test("returns a bounded string, never throws", async () => {
    const ctx = await getCompactionContext();
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeLessThanOrEqual(600 + 1);
  });
});

describe("microcompact (no repeat injects per server run)", () => {
  test("mark → wasShown roundtrip", () => {
    const key = `eval-micro-${Date.now()}`;
    expect(sessionMemory.wasShown("gotcha", key)).toBe(false);
    sessionMemory.markShown("gotcha", [key]);
    expect(sessionMemory.wasShown("gotcha", key)).toBe(true);
  });
});

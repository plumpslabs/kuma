// ============================================================
// ISSUE #36 — Behavioral eval suite for the harness itself
// Discrete observable assertions (not composite benchmarks).
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { detectTestWeakening, buildDriftMessages } from "../src/utils/kumaShared.js";
import {
  recordGuardFlag,
  recordGuardFeedback,
  getRulePrecision,
  getDowntieredRules,
  demoteSeverity,
  formatPrecisionLedger,
} from "../src/engine/guardLedger.js";
import { classifyDiffShape } from "../src/engine/impactAnalysis.js";

function git(cwd: string, cmd: string): void {
  execSync(cmd, { cwd, stdio: "pipe", timeout: 8000 });
}

describe("issue #36 behavioral evals", () => {
  test("comment-only fixture → LOW shape (no CRITICAL)", () => {
    const { shape } = classifyDiffShape("backend/.env.example");
    expect(shape).toBe("config-or-docs");
  });

  test("healthy branch state (nothing uncommitted) → no drift", () => {
    expect(buildDriftMessages(0, false, 0, "")).toEqual([]);
  });

  test("test-weakening diff → escalate", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-eval36-"));
    try {
      git(cwd, "git init -b main && git config user.email t@t.t && git config user.name t");
      fs.writeFileSync(path.join(cwd, "a.test.ts"), "test('x', () => { expect(1).toBe(1); });\n", "utf-8");
      git(cwd, "git add -A && git commit -qm init");
      fs.writeFileSync(path.join(cwd, "a.test.ts"), "test('x', () => { console.log('weak'); });\n", "utf-8");
      expect(detectTestWeakening(["a.test.ts"], cwd)).toHaveLength(1);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("non-test diff removing asserts → no fire", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-eval36b-"));
    try {
      git(cwd, "git init -b main && git config user.email t@t.t && git config user.name t");
      fs.writeFileSync(path.join(cwd, "a.ts"), "export const x = 1;\n", "utf-8");
      git(cwd, "git add -A && git commit -qm init");
      fs.writeFileSync(path.join(cwd, "a.ts"), "export const x = 2;\n", "utf-8");
      expect(detectTestWeakening(["a.ts"], cwd)).toEqual([]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("precision ledger: rule over FP budget → downtiered", async () => {
    const rule = `eval-fixture-${Date.now()}`;
    await recordGuardFlag(rule);
    for (let i = 0; i < 5; i++) await recordGuardFeedback(rule, true);
    const precision = await getRulePrecision();
    const row = precision.find((p) => p.rule === rule);
    expect(row).toBeDefined();
    expect(row!.feedbacks).toBe(5);
    expect(row!.fpRate).toBe(1);
    expect(row!.overBudget).toBe(true);
    const downtiered = await getDowntieredRules();
    expect(downtiered.has(rule)).toBe(true);
  });

  test("demoteSeverity steps down one level", () => {
    expect(demoteSeverity("high")).toBe("medium");
    expect(demoteSeverity("medium")).toBe("low");
    expect(demoteSeverity("low")).toBe("low");
  });

  test("formatPrecisionLedger marks over-budget rules", () => {
    const out = formatPrecisionLedger([
      { rule: "x", flags: 3, feedbacks: 5, falsePositives: 4, fpRate: 0.8, overBudget: true },
    ]);
    expect(out).toContain("OVER BUDGET");
  });
});

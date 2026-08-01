// ============================================================
// KUMA AUTO-GOTCHA TESTS — Self-learning loop (P1)
// ============================================================

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock pathValidator so getProjectRoot() points to a temp dir
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-autogotcha-test-"));

jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: () => tmpRoot,
}));

// Mock kumaGotchas so the dynamic addGotcha import doesn't hit sql.js WASM
jest.unstable_mockModule("../src/engine/kumaGotchas.js", () => ({
  addGotcha: jest.fn(async (entry: unknown) => `✅ Gotcha recorded: ${JSON.stringify(entry)}`),
}));

const {
  loadAutoGotchaState,
  saveAutoGotchaState,
  resetScopeFailures,
  trackVerificationResult,
  AUTO_GOTCHA_THRESHOLD,
} = await import("../src/engine/kumaAutoGotcha.js");

// Grab the mocked addGotcha to assert calls
const kumaGotchasMock = await import("../src/engine/kumaGotchas.js");

const stateFile = path.join(tmpRoot, ".kuma", "auto-gotcha.json");

afterEach(() => {
  try { fs.rmSync(path.dirname(stateFile), { recursive: true, force: true }); } catch {}
  (kumaGotchasMock.addGotcha as jest.Mock).mockClear();
});

describe("loadAutoGotchaState", () => {
  test("returns empty state when no file exists", () => {
    expect(loadAutoGotchaState()).toEqual({ failures: {}, lastRecorded: {} });
  });

  test("loads persisted state", () => {
    saveAutoGotchaState({ failures: { auth: 2 }, lastRecorded: {} });
    expect(loadAutoGotchaState()).toEqual({ failures: { auth: 2 }, lastRecorded: {} });
  });

  test("returns empty state on corrupt file", () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, "{ not json", "utf-8");
    expect(loadAutoGotchaState()).toEqual({ failures: {}, lastRecorded: {} });
  });
});

describe("trackVerificationResult", () => {
  test("ignores session-impact scope (no per-scope tracking)", async () => {
    const res = await trackVerificationResult("session-impact", false);
    expect(res.recorded).toBe(false);
  });

  test("records failure but does NOT create gotcha below threshold", async () => {
    const res = await trackVerificationResult("auth", false);
    expect(res.recorded).toBe(false);
    expect(res.failureCount).toBe(1);
    expect(kumaGotchasMock.addGotcha).not.toHaveBeenCalled();
  });

  test("creates auto-gotcha when threshold crossed (2 consecutive failures)", async () => {
    await trackVerificationResult("auth", false);
    const res = await trackVerificationResult("auth", false);
    expect(res.recorded).toBe(true);
    expect(res.failureCount).toBe(2);
    expect(kumaGotchasMock.addGotcha).toHaveBeenCalledTimes(1);

    const entry = (kumaGotchasMock.addGotcha as jest.Mock).mock.calls[0][0] as {
      filePath: string;
      description: string;
      workaround: string;
      severity: string;
    };
    expect(entry.filePath).toBe("auth");
    // Description is count-independent (so addGotcha's LIKE-dedup upgrades
    // the same row at the next threshold instead of inserting duplicates).
    expect(entry.description).toBe('Verification keeps failing for scope "auth"');
    expect(entry.description).not.toContain("2 consecutive failures");
    expect(entry.workaround).toContain("2 consecutive failures");
    expect(entry.severity).toBe("medium");
  });

  test("escalates severity at the exact escalate threshold (4)", async () => {
    // 1 → no | 2 → medium (recorded) | 3 → no | 4 → high (recorded)
    for (let i = 0; i < 4; i++) {
      await trackVerificationResult("payments", false);
    }
    expect(kumaGotchasMock.addGotcha).toHaveBeenCalledTimes(2);
    const entries = (kumaGotchasMock.addGotcha as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(entries[0].severity).toBe("medium");
    expect(entries[1].severity).toBe("high");
  });

  test("does not re-record below the next threshold (no flood)", async () => {
    await trackVerificationResult("auth", false); // count 1
    await trackVerificationResult("auth", false); // count 2 → record medium
    const next = await trackVerificationResult("auth", false); // count 3 → no record
    expect(next.recorded).toBe(false);
    expect(next.failureCount).toBe(3);
    expect(kumaGotchasMock.addGotcha).toHaveBeenCalledTimes(1);
  });

  test("passing verification resets the counter", async () => {
    await trackVerificationResult("auth", false);
    const res = await trackVerificationResult("auth", true);
    expect(res.recorded).toBe(false);
    expect(res.failureCount).toBe(0);
    // Counter cleared → next failure starts at 1 again
    const next = await trackVerificationResult("auth", false);
    expect(next.failureCount).toBe(1);
  });
});

describe("resetScopeFailures", () => {
  test("clears counter for a specific scope", () => {
    saveAutoGotchaState({ failures: { auth: 3, db: 1 }, lastRecorded: {} });
    resetScopeFailures("auth");
    const state = loadAutoGotchaState();
    expect(state.failures).toEqual({ db: 1 });
  });

  test("no-op for unknown scope", () => {
    saveAutoGotchaState({ failures: {}, lastRecorded: {} });
    resetScopeFailures("nope");
    expect(loadAutoGotchaState()).toEqual({ failures: {}, lastRecorded: {} });
  });
});

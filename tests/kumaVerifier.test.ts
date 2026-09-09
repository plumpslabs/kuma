import { describe, test, expect } from "@jest/globals";
import { detectTestRunner } from "../src/engine/kumaVerifier.js";
import { handleSafety } from "../src/tools/kumaSafetyTool.js";

describe("kumaVerifier (Proposal 1: Integrated Auto-Verification)", () => {
  test("detectTestRunner identifies package.json test runner", () => {
    const runnerInfo = detectTestRunner(process.cwd());
    expect(runnerInfo.runner).toBeDefined();
    expect(runnerInfo.baseCommand).toContain("test");
  });

  test("handleSafety with action 'verify' executes verification", async () => {
    const result = await handleSafety({
      action: "verify",
      scope: "kumaLock",
      force: true,
    });

    expect(result).toContain("Verification");
    expect(result).toContain("Runner");
  }, 40000);

  test("handleSafety with action 'verify' resolves targeted test file via target parameter", async () => {
    const result = await handleSafety({
      action: "verify",
      target: "tests/kumaVerifier.test.ts",
      force: true,
      timeoutMs: 60000,
    });

    expect(result).toContain("Verification");
    expect(result).toContain("tests/kumaVerifier.test.ts");
    expect(result).toContain("1 file(s) matched");
  }, 40000);
});

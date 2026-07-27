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
    });

    expect(result).toContain("Auto-Verification");
    expect(result).toContain("Runner");
  }, 40000);
});

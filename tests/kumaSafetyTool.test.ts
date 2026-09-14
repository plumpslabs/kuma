import { handleSafety } from "../src/tools/kumaSafetyTool.js";

describe("kumaSafetyTool — Decoupled from Test Execution", () => {
  it("verify without target returns clear scope notice", async () => {
    const res = await handleSafety({ action: "verify" });
    expect(res).toContain("Test execution is outside Kuma's scope");
    expect(res).toContain("native test runner directly");
  });

  it("verify with target provides post-edit blast radius without running test subprocesses", async () => {
    const res = await handleSafety({
      action: "verify",
      target: "src/tools/kumaSafetyTool.ts",
    });
    expect(res).toContain("Post-Edit Blast Radius & Dependency Impact");
    expect(res).toContain("Test execution is outside Kuma's scope");
  });

  it("returns help for unknown action", async () => {
    const res = await handleSafety({ action: "invalid_action" as any });
    expect(res).toContain("Unknown action");
  });
});

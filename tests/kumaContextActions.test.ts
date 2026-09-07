import { handleContext } from "../src/tools/kumaContextTool.js";

describe("Kuma Context Actions (Map & Impact)", () => {
  it("executes action: 'map' and returns repository workspace map", async () => {
    const res = await handleContext({ action: "map" });
    expect(res).toContain("Workspace Repository Map");
    expect(res).toContain("@kuma/studio");
  });

  it("executes action: 'impact' and returns blast radius analysis", async () => {
    const res = await handleContext({ action: "impact", target: "src/engine/sessionMemory.ts" });
    expect(res).toContain("Blast Radius");
    expect(res).toContain("Risk Level");
  });

  it("executes action: 'init' and includes workspace summary when present", async () => {
    const res = await handleContext({ action: "init" });
    expect(res).toContain("Workspace");
    expect(res).toContain("@kuma/studio");
  });

  it("executes action: 'research' and includes Step 4 Blast Radius", async () => {
    const res = await handleContext({ action: "research", scope: "sessionMemory" });
    expect(res).toContain("Step 4/5: Impact Analysis (Blast Radius)");
  });
});

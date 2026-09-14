import { handleContext } from "../src/tools/kumaContextTool.js";
import { scanCodebase } from "../src/engine/kumaCodeScanner.js";

describe("kumaContextTool — Subsystem Clustering & Context Actions", () => {
  beforeAll(async () => {
    await scanCodebase({ maxFiles: 40 });
  });

  it("handles action: 'cluster' returning concept subsystems and relations", async () => {
    const res = await handleContext({ action: "cluster" });
    expect(res).toContain("Codebase Architecture Subsystems");
    expect(res).toContain("Role");
  });

  it("handles action: 'map' returning package boundaries", async () => {
    const res = await handleContext({ action: "map" });
    expect(res).toContain("Workspace Repository Map");
  });

  it("handles aliases for cluster action e.g. 'subsystems'", async () => {
    const res = await handleContext({ action: "subsystems" });
    expect(res).toContain("Codebase Architecture Subsystems");
  });
});

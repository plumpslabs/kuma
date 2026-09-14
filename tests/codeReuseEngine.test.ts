import { findReusableSymbols } from "../src/engine/codeReuseEngine.js";
import { handleContext } from "../src/tools/kumaContextTool.js";
import { scanCodebase } from "../src/engine/kumaCodeScanner.js";

describe("Kuma Code Reuse & Anti-Duplication Engine", () => {
  beforeAll(async () => {
    await scanCodebase({ maxFiles: 35 });
  });

  it("finds existing reusable symbols matching a query", async () => {
    const result = await findReusableSymbols("impact", "src/engine");
    expect(result.query).toBe("impact");
    expect(result.foundMatches).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.formattedOutput).toContain("Existing helpers found in repository");
  });

  it("recommends standard directory when no duplicate helper is found", async () => {
    const result = await findReusableSymbols("super_rare_unseen_custom_widget_xyz");
    expect(result.foundMatches).toBe(false);
    expect(result.formattedOutput).toContain("No existing duplicate detected");
    expect(result.recommendedDirectory).toBeDefined();
  });

  it("handles action: 'reuse' in handleContext", async () => {
    const res = await handleContext({ action: "reuse", target: "impact" });
    expect(res).toContain("Code Reuse & Anti-Duplication Engine");
  });

  it("handles action: 'skeleton' in handleContext", async () => {
    const res = await handleContext({ action: "skeleton", target: "src/engine/kumaGraph.ts" });
    expect(res).toContain("AST Code Skeleton");
    expect(res).toContain("token reduction");
  });
});

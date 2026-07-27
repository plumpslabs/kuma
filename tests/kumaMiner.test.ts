import { describe, test, expect } from "@jest/globals";
import { mineHistoricalDecisions } from "../src/engine/kumaMiner.js";
import { handleMemory } from "../src/tools/kumaMemoryTool.js";

describe("kumaMiner (Proposal 2: Decision Mining from Git History)", () => {
  test("mineHistoricalDecisions scans git log and inline comments", async () => {
    const result = await mineHistoricalDecisions({ limit: 5 });
    expect(result).toContain("Decision Mining");
  });

  test("handleMemory with action 'mine' executes decision miner", async () => {
    const result = await handleMemory({
      action: "mine",
      limit: 3,
    });
    expect(result).toContain("Decision Mining");
  });
});

import { computeGraphCentrality, getNodeCentrality, formatCentralityWarning } from "../src/engine/graphCentrality.js";
import { scanCodebase } from "../src/engine/kumaCodeScanner.js";

describe("Kuma Graph Centrality & PageRank Engine", () => {
  beforeAll(async () => {
    await scanCodebase({ maxFiles: 35 });
  });

  it("computes PageRank scores across knowledge graph nodes", async () => {
    const overview = await computeGraphCentrality(true);
    expect(overview.totalNodes).toBeGreaterThan(0);
    expect(overview.topHubs.length).toBeGreaterThan(0);

    const top1 = overview.topHubs[0];
    expect(top1.score).toBeGreaterThan(0);
    expect(top1.rank).toBe(1);
  });

  it("returns centrality for a specific file or symbol", async () => {
    const c = await getNodeCentrality("src/index.ts");
    if (c) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.totalNodes).toBeGreaterThan(0);
    }
  });

  it("formats centrality warning when node is a hub", async () => {
    const overview = await computeGraphCentrality();
    if (overview.topHubs.length > 0) {
      const hub = overview.topHubs[0];
      const warning = await formatCentralityWarning(hub.name);
      if (warning) {
        expect(warning).toContain("Centrality");
      }
    }
  });
});

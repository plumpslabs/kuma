import { buildSubsystemClusters } from "../src/engine/domainClusterEngine.js";
import { scanCodebase } from "../src/engine/kumaCodeScanner.js";

describe("Kuma Domain Cluster Engine — Concept-Level Subsystems", () => {
  beforeAll(async () => {
    // Ensure repository is indexed
    await scanCodebase({ maxFiles: 50 });
  });

  it("aggregates files into high-level concept clusters", async () => {
    const res = await buildSubsystemClusters();
    expect(res.subsystemCount).toBeGreaterThan(0);
    expect(res.subsystemCount).toBeLessThanOrEqual(15);
    expect(res.totalFiles).toBeGreaterThan(0);

    // Each cluster must have complete concept metadata
    for (const cluster of res.clusters) {
      expect(cluster.id).toMatch(/^feature_domain::/);
      expect(cluster.name.length).toBeGreaterThan(2);
      expect(cluster.fileCount).toBeGreaterThan(0);
      expect(cluster.role.length).toBeGreaterThan(10);
      expect(cluster.entrypoints.length).toBeGreaterThan(0);
    }
  });

  it("discovers typed relationship verbs between subsystems", async () => {
    const res = await buildSubsystemClusters();
    const allRelations = res.clusters.flatMap((c) => c.relations);

    if (allRelations.length > 0) {
      const verbs = allRelations.map((r) => r.verb);
      const validVerbs = ["uses", "produces", "validates", "routes_to", "configures"];
      for (const v of verbs) {
        expect(validVerbs).toContain(v);
      }
    }
  });

  it("formats a concise, decision-grade markdown overview for agents", async () => {
    const res = await buildSubsystemClusters();
    expect(res.formattedOutput).toContain("Codebase Architecture Subsystems");
    expect(res.formattedOutput).toContain("Role");
    expect(res.formattedOutput).toContain("Navigation Tip");
  });
});

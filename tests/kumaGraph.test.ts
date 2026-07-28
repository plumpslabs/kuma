import { describe, test, expect } from "@jest/globals";
import { recordDomainFlow, queryGraph } from "../src/engine/kumaGraph.js";
import { handleMemory } from "../src/tools/kumaMemoryTool.js";

describe("kumaGraph Domain Flow (V4)", () => {
  test("recordDomainFlow creates interconnected domain nodes and edges", async () => {
    const result = await recordDomainFlow({
      domain: "TestOmnichannel",
      hops: [
        { from: "LeadPage", to: "ProspectService", relation: "calls", description: "Start conversation" },
        { from: "ProspectService", to: "Database", relation: "queries", description: "Find contact" },
      ],
      gotchas: ["display_contact must be synced"],
      decisions: ["Use Prospect.contact as fallback"],
      filePaths: ["src/pages/lead.tsx", "services/ProspectService.js"],
    });

    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);

    const graphOutput = await queryGraph({ query: "TestOmnichannel" });
    expect(graphOutput).toContain("TestOmnichannel");
  });

  test("handleMemory arch_flow with structured input records domain flow", async () => {
    const result = await handleMemory({
      action: "arch_flow",
      content: "domain: UserManagement | hops: Settings.tsx → userTabel.tsx → RolePermissions | gotchas: Require admin role | files: Settings.tsx, userTabel.tsx",
    });

    expect(result).toContain("Domain flow \"UserManagement\" recorded");
    expect(result).toContain("UserManagement");
  });
});

import { describe, test, expect } from "@jest/globals";
import {
  upsertStudioNode,
  getNodeDetail,
  createStudioEdge,
  deleteStudioEdge,
  deleteStudioNode,
} from "../packages/ide/studio/src/db.js";

describe("Kuma Studio APIs — Knowledge Graph CRUD", () => {
  test("upsertStudioNode creates and retrieves a rich custom node", async () => {
    const testNode = {
      type: "feature_domain",
      name: "PaymentGatewayV2",
      description: "Handles external credit card processing and webhooks securely.",
      file_path: "src/services/payment.ts",
      metadata: {
        provider: "stripe",
        slaMs: 150,
      },
    };

    const saved = await upsertStudioNode(testNode);
    expect(saved.id).toBe("feature_domain::PaymentGatewayV2");
    expect(saved.type).toBe("feature_domain");
    expect(saved.metadata.description).toBe(testNode.description);

    const detail = await getNodeDetail(saved.id);
    expect(detail).toBeDefined();
    expect(detail?.node.name).toBe("PaymentGatewayV2");

    const meta = JSON.parse(detail?.node.metadata);
    expect(meta.description).toContain("Handles external credit card");
  });

  test("createStudioEdge connects nodes and reflects in incoming/outgoing relations", async () => {
    const nodeA = await upsertStudioNode({
      type: "workflow",
      name: "CheckoutFlow",
      description: "User checkout checkout wizard.",
    });

    const nodeB = await upsertStudioNode({
      type: "feature_domain",
      name: "InventoryService",
      description: "Manages product stock.",
    });

    await createStudioEdge({
      source: nodeA.id,
      target: nodeB.id,
      type: "depends_on",
      weight: 2.0,
    });

    const detailA = await getNodeDetail(nodeA.id);
    expect(detailA?.outgoing.some((e: any) => e.target === nodeB.id && e.relation === "depends_on")).toBe(true);

    const detailB = await getNodeDetail(nodeB.id);
    expect(detailB?.incoming.some((e: any) => e.source === nodeA.id && e.relation === "depends_on")).toBe(true);

    // Cleanup edge
    await deleteStudioEdge(nodeA.id, nodeB.id, "depends_on");
    const detailAAfter = await getNodeDetail(nodeA.id);
    expect(detailAAfter?.outgoing.some((e: any) => e.target === nodeB.id)).toBe(false);

    // Cleanup nodes
    await deleteStudioNode(nodeA.id);
    await deleteStudioNode(nodeB.id);
  });

  test("deleteStudioNode removes node and associated edges", async () => {
    const tempNode = await upsertStudioNode({
      type: "decision",
      name: "UseSqliteWasm",
      description: "Decision to use sql.js for zero native compilation.",
    });

    let detail = await getNodeDetail(tempNode.id);
    expect(detail).not.toBeNull();

    await deleteStudioNode(tempNode.id);

    detail = await getNodeDetail(tempNode.id);
    expect(detail).toBeNull();
  });
});

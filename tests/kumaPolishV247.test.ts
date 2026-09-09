import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../src/utils/pathValidator.js";
import { addGotcha, resolveGotcha, deprecateGotcha, syncGotchaStatusToMarkdown } from "../src/engine/kumaGotchas.js";
import { getActiveGotchas } from "../src/engine/domainRules.js";
import { recordDomainFlow } from "../src/engine/kumaGraph.js";
import { getFreshDomainFlow } from "../src/engine/kumaFlowCache.js";
import { handleContext } from "../src/tools/kumaContextTool.js";
import { recordDecision } from "../src/engine/kumaMemory.js";
import { createCheckpoint, listCheckpoints } from "../src/engine/kumaCheckpoint.js";
import { sessionMemory } from "../src/engine/sessionMemory.js";

describe("Kuma v2.4.7 Polish & Real-World Edge Cases", () => {
  const root = getProjectRoot();
  const gotchasMdPath = path.join(root, ".kuma", "KNOWN_GOTCHAS.md");
  const decisionsMdPath = path.join(root, ".kuma", "memories", "decisions.md");

  // ============================================================
  // 1. gotcha_resolve updates DB AND syncs to KNOWN_GOTCHAS.md
  // ============================================================
  it("resolves gotchas in DB and synchronizes - **Status**: resolved to KNOWN_GOTCHAS.md", async () => {
    const testFile = "src/services/notification_service_test.ts";
    await addGotcha({
      filePath: testFile,
      description: "Argument swap in NotificationService",
      severity: "high",
      status: "active",
      workaround: "Pass (userId, options)",
    });

    // Check that markdown contains active status
    let md = fs.readFileSync(gotchasMdPath, "utf-8");
    expect(md).toContain(testFile);
    expect(md).toContain("Argument swap in NotificationService");

    // Resolve gotcha
    const res = await resolveGotcha(testFile, "Fixed argument order in commit abc1234");
    expect(res.resolved).toBeGreaterThanOrEqual(1);

    // Markdown should now have resolved status
    md = fs.readFileSync(gotchasMdPath, "utf-8");
    expect(md).toContain("Status**: resolved");

    // getActiveGotchas() should exclude this resolved gotcha
    const active = getActiveGotchas();
    const stillActive = active.find((g) => g.filePath.includes(testFile));
    expect(stillActive).toBeUndefined();
  });

  // ============================================================
  // 2. kuma_context({ action: "flow" }) displays hops sequence
  // ============================================================
  it("displays hops sequence in kuma_context flow output", async () => {
    const domain = "WhatsApp Omnichannel Polish Test";
    await recordDomainFlow({
      domain,
      hops: [
        { from: "Webhook Inbound", to: "ProspectService", relation: "calls API" },
        { from: "ProspectService", to: "crm_conversations", relation: "queries DB" },
        { from: "crm_conversations", to: "Redux Panel Sync", relation: "syncs state" },
      ],
      filePaths: ["src/services/ProspectService.ts"],
    });

    const flowOutput = await getFreshDomainFlow(domain);
    expect(flowOutput).toContain("Flow: WhatsApp Omnichannel Polish Test");
    expect(flowOutput).toContain("Flow Sequence (Hops):");
    expect(flowOutput).toContain("1. Webhook Inbound →");
    expect(flowOutput).toContain("2. ProspectService (calls API) →");
    expect(flowOutput).toContain("3. crm_conversations (queries DB) →");
    expect(flowOutput).toContain("4. Redux Panel Sync (syncs state)");

    // Tool call delegation test
    const toolRes = await handleContext({ action: "flow", target: domain });
    expect(toolRes).toContain("Flow Sequence (Hops):");
    expect(toolRes).toContain("ProspectService");
  });

  // ============================================================
  // 3. kuma_context({ action: "history" }) aggregates git, gotchas & decisions
  // ============================================================
  it("aggregates git log fallback, active gotchas, and decisions in file history", async () => {
    const targetFile = "src/tools/kumaContextTool.ts";

    // Record an ADR decision mentioning this component
    recordDecision({
      title: "Context History Polish ADR",
      context: "Need comprehensive file history for kumaContextTool.ts",
      options: ["db-only", "git+db+markdown"],
      rationale: "Combining git log, gotchas, and decisions provides full context",
      outcome: "Implemented multi-source aggregation",
      timestamp: "2026-09-09",
    });

    const historyRes = await handleContext({ action: "history", target: targetFile });
    expect(historyRes).toContain(`File History: ${targetFile}`);
    // Should contain git log fallback or recorded trace
    expect(historyRes).toMatch(/(Git Commit History|changes recorded)/i);
    // Should contain relevant decisions section
    expect(historyRes).toContain("Relevant decisions");
    expect(historyRes).toContain("Context History Polish ADR");
  });

  // ============================================================
  // 4. Checkpoint snapshots files and SessionMemory resets idle
  // ============================================================
  it("creates a checkpoint with DB snapshot and handles session idle duration reset", async () => {
    const cpLabel = `polish_test_${Date.now()}`;
    const res = await createCheckpoint(cpLabel, "Verification checkpoint for polish");
    expect(res).toContain("Checkpoint Created");
    expect(res).toContain(cpLabel);

    const list = listCheckpoints();
    expect(list).toContain(cpLabel);

    // Verify session duration is concise
    const metrics = sessionMemory.getMetricsSummary();
    expect(metrics.sessionDuration).toBeDefined();
    expect(typeof metrics.sessionDuration).toBe("string");
    // Should not show ancient hours like 700h
    expect(metrics.sessionDuration).not.toMatch(/\b[5-9]\d{2}h/);
  });
});

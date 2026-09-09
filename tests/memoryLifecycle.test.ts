import {
  addGotcha,
  setGotchaStatus,
  getGotchasByStatus,
} from "../src/engine/kumaGotchas.js";
import { getDb } from "../src/engine/kumaDb.js";

describe("Memory Lifecycle & Curation (DISCUSS.md)", () => {
  it("records a gotcha with candidate status", async () => {
    const filePath = "src/services/billing.ts";
    const desc = "Invoice status mismatch across consumers";
    await addGotcha({
      filePath,
      description: desc,
      severity: "high",
      status: "candidate",
      scopePackage: "@company/billing",
    });

    const candidates = await getGotchasByStatus("candidate");
    const found = candidates.find((g) => g.file_path === filePath && (g.description as string).includes("Invoice status"));
    expect(found).toBeDefined();
    expect(found?.status).toBe("candidate");
    expect(found?.scope_package).toBe("@company/billing");

    // Promote to verified
    if (found) {
      const ok = await setGotchaStatus(found.id as number, "verified", "lead-dev");
      expect(ok).toBe(true);

      const verifiedList = await getGotchasByStatus("verified");
      const verifiedFound = verifiedList.find((g) => g.id === found.id);
      expect(verifiedFound).toBeDefined();
      expect(verifiedFound?.status).toBe("verified");
      expect(verifiedFound?.verified_by).toBe("lead-dev");
    }
  });

  it("resolves and deprecates gotchas using resolveGotcha and deprecateGotcha", async () => {
    const { resolveGotcha, deprecateGotcha } = await import("../src/engine/kumaGotchas.js");

    const filePath = "src/services/auth_legacy.ts";
    await addGotcha({
      filePath,
      description: "Legacy auth token signature flaw",
      severity: "critical",
      status: "active",
    });

    // Resolve by scope
    const resolveRes = await resolveGotcha("src/services/auth_legacy.ts", "Migrated to OAuth 2.1");
    expect(resolveRes.resolved).toBeGreaterThanOrEqual(1);
    expect(resolveRes.message).toContain("Resolved");

    const resolvedList = await getGotchasByStatus("resolved");
    const foundResolved = resolvedList.find((g) => g.file_path === filePath);
    expect(foundResolved).toBeDefined();
    expect(foundResolved?.status).toBe("resolved");

    // Add another gotcha and deprecate it
    const deadPath = "src/legacy/removed_module.ts";
    await addGotcha({
      filePath: deadPath,
      description: "Deprecated module memory leak",
      severity: "low",
      status: "active",
    });

    const deprecateRes = await deprecateGotcha(deadPath, "Module deleted from codebase");
    expect(deprecateRes.deprecated).toBeGreaterThanOrEqual(1);

    const deprecatedList = await getGotchasByStatus("deprecated");
    const foundDeprecated = deprecatedList.find((g) => g.file_path === deadPath);
    expect(foundDeprecated).toBeDefined();
    expect(foundDeprecated?.status).toBe("deprecated");
  });

  it("resolves gotchas via handleMemory tool action", async () => {
    const { handleMemory } = await import("../src/tools/kumaMemoryTool.js");

    const filePath = "src/database/pool_fix.ts";
    await addGotcha({
      filePath,
      description: "Connection pool timeout under high concurrency",
      severity: "high",
      status: "active",
    });

    // Resolve via handleMemory with status: "resolved"
    const response = await handleMemory({
      action: "gotcha",
      scope: filePath,
      status: "resolved",
      content: "Switched to non-blocking pool with health-check ping",
    });

    expect(response).toContain("Resolved");
    expect(response).toContain("pool_fix.ts");

    const resolvedList = await getGotchasByStatus("resolved");
    const found = resolvedList.find((g) => g.file_path === filePath);
    expect(found).toBeDefined();
    expect(found?.status).toBe("resolved");
  });

  it("auto-deprecates gotchas whose files are missing from disk", async () => {
    const { autoDeprecateStaleGotchas } = await import("../src/engine/kumaSelfHeal.js");

    const nonExistentFile = "src/completely/fake_ghost_file_12345.ts";
    await addGotcha({
      filePath: nonExistentFile,
      description: "Ghost file issue that no longer exists",
      severity: "medium",
      status: "active",
    });

    const result = await autoDeprecateStaleGotchas();
    expect(result.deprecated).toBeGreaterThanOrEqual(1);
    expect(result.details.some((d) => d.includes("fake_ghost_file_12345.ts"))).toBe(true);

    const deprecatedList = await getGotchasByStatus("deprecated");
    const found = deprecatedList.find((g) => g.file_path === nonExistentFile);
    expect(found).toBeDefined();
    expect(found?.status).toBe("deprecated");
  });

  it("handles decision with fallback parameters when title is omitted", async () => {
    const { handleMemory } = await import("../src/tools/kumaMemoryTool.js");

    // Case 1: target + rationale without title
    const res1 = await handleMemory({
      action: "decision",
      target: "auth-service",
      rationale: "Use JWT over sessions for stateless scalability",
    });
    expect(res1).toContain("Decision");
    expect(res1).toContain("recorded");
    expect(res1).toContain("Decision regarding auth-service");

    // Case 2: content only without title or rationale
    const res2 = await handleMemory({
      action: "decision",
      content: "Adopt PostgreSQL as primary relational store",
      description: "Better JSONB support and concurrency control",
    });
    expect(res2).toContain("Decision");
    expect(res2).toContain("recorded");
    expect(res2).toContain("Adopt PostgreSQL as primary relational store");
  });
});

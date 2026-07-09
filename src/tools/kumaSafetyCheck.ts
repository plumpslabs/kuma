// ============================================================
// KUMA SAFETY CHECK — Unified safety tool
// ============================================================
// Called via kuma_router or directly as an MCP tool.
// Groups all safety features under one action enum.
//
// Actions:
//   check     — Run full safety check on an action/file/command
//   policy    — Check file or command against .kuma/policy.yml
//   audit     — Query the safety audit trail
//   stats     — Get safety audit statistics
//   override  — Temporarily bypass safety (logged in audit)
// ============================================================

import { queryAudit, auditStats } from "../engine/safetyAudit.js";
import { sessionMemory } from "../engine/sessionMemory.js";

export interface SafetyCheckParams {
  action: "check" | "policy" | "audit" | "stats" | "override" | "guard";
  tool?: string;
  filePath?: string;
  command?: string;
  checkType?: string;
  goal?: string;
  reason?: string;
  limit?: number;
  since?: number;
}

/**
 * Handle kuma_safety unified tool.
 * Note: only 'audit' and 'stats' route through this function.
 * Other actions (check, policy, guard, override) are dispatched
 * directly by the router to their respective handlers.
 */
export async function handleSafetyCheck(params: SafetyCheckParams): Promise<string> {
  const { action } = params;
  sessionMemory.recordToolCall("kuma_safety", params as unknown as Record<string, unknown>);

  switch (action) {
    case "audit":
      return await queryAudit({
        toolName: params.tool,
        riskLevel: params.checkType,
        limit: params.limit || 20,
        since: params.since,
      });

    case "stats":
      return await auditStats();

    default:
      return `⚠️ Unknown action "${action}". Use: audit, stats`;
  }
}

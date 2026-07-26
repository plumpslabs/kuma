import { sessionMemory } from "../engine/sessionMemory.js";
import { safetyCheck, safetyOverride } from "../engine/kumaSafetyLayer.js";
import { queryAudit, auditStats } from "../engine/safetyAudit.js";
import { acquireLock, releaseLock, listLocks, cleanStaleLocks } from "../engine/kumaLock.js";
import { computeSafetyScore, formatSafetyScore } from "../engine/safetyScore.js";
import { getLatestHealthSnapshot, saveHealthSnapshot } from "../engine/kumaDb.js";
import { getGraphStats } from "../engine/kumaGraph.js";
import { handleKumaGuard } from "../tools/kumaGuard.js";

type SafetyAction = "guard" | "check" | "audit" | "lock" | "health" | "override";

interface SafetyParams {
  action: SafetyAction;

  guardGoal?: string;
  guardCheck?: string;

  filePath?: string;
  command?: string;

  limit?: number;
  since?: number;
  toolName?: string;
  riskLevel?: string;
  allowed?: boolean;

  lockAction?: "acquire" | "release" | "list" | "clean";
  lockFilePath?: string;
  agentId?: string;

  reason?: string;
}

export async function handleSafety(params: SafetyParams): Promise<string> {
  const { action } = params;
  sessionMemory.recordToolCall("kuma_safety", { action });

  switch (action) {
    case "guard": return handleGuard(params);
    case "check": return handleCheck(params);
    case "audit": return handleAudit(params);
    case "lock": return handleLock(params);
    case "health": return handleHealth(params);
    case "override": return handleOverride(params);
    default: return `Unknown action "${action}". Use: guard, check, audit, lock, health, override`;
  }
}

// ============================================================
// GUARD — Anti-pattern detection, drift check
// ============================================================

async function handleGuard(params: SafetyParams): Promise<string> {
  return await handleKumaGuard({
    goal: params.guardGoal,
    check: params.guardCheck || "all",
  });
}

// ============================================================
// CHECK — Pre-execution safety check
// ============================================================

async function handleCheck(params: SafetyParams): Promise<string> {
  const action = "check";
  const filePath = params.filePath;
  const command = params.command;
  return await safetyCheck(action, filePath, command);
}

// ============================================================
// AUDIT — Query audit trail
// ============================================================

async function handleAudit(params: SafetyParams): Promise<string> {
  if (params.limit === 0) {
    return await auditStats();
  }

  return await queryAudit({
    toolName: params.toolName,
    riskLevel: params.riskLevel,
    allowed: params.allowed,
    limit: params.limit || 20,
    since: params.since,
  });
}

// ============================================================
// LOCK — Multi-agent coordination
// ============================================================

async function handleLock(params: SafetyParams): Promise<string> {
  const lockAction = params.lockAction || "list";
  const filePath = params.lockFilePath || params.filePath;

  switch (lockAction) {
    case "acquire":
      if (!filePath) return "⚠️ filePath required for acquire.";
      return acquireLock(filePath, params.agentId);
    case "release":
      if (!filePath) return "⚠️ filePath required for release.";
      return releaseLock(filePath, params.agentId);
    case "list":
      return listLocks();
    case "clean":
      return cleanStaleLocks();
    default:
      return listLocks();
  }
}

// ============================================================
// HEALTH — Project health dashboard (0-100 score)
// ============================================================

async function handleHealth(_params: SafetyParams): Promise<string> {
  try {
    const score = await computeSafetyScore();
    const checksStr = JSON.stringify(score.checks);
    await saveHealthSnapshot(score.score, score.risk, checksStr, score.summary);
    return formatSafetyScore(score);
  } catch (err) {
    return `Error computing health: ${err}`;
  }
}

// ============================================================
// OVERRIDE — Bypass safety (logged)
// ============================================================

function handleOverride(params: SafetyParams): string {
  const tool = params.toolName || "unknown";
  return safetyOverride(tool, params.reason);
}

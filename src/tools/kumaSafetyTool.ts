import { sessionMemory } from "../engine/sessionMemory.js";
import { handleKumaGuard } from "../tools/kumaGuard.js";

type SafetyAction = "guard" | "verify" | "checkpoint" | "rollback_label";

interface SafetyParams {
  action: SafetyAction;
  guardGoal?: string;
  guardCheck?: string;
  scope?: string;
  target?: string;
  command?: string;
  force?: boolean;
  label?: string;
  description?: string;
  timeoutMs?: number;
  timeout?: number;
}

export async function handleSafety(params: SafetyParams): Promise<string> {
  const { action } = params;
  sessionMemory.recordToolCall("kuma_safety", { action });

  switch (action) {
    case "guard": return handleGuard(params);
    case "verify": return handleVerify(params);
    case "checkpoint": return handleCheckpoint(params);
    case "rollback_label": return handleRollbackLabel(params);
    default: return `Unknown action "${action}". Use: guard, verify, checkpoint, rollback_label`;
  }
}

// ============================================================
// GUARD — Anti-pattern detection, drift check
// ============================================================

async function handleGuard(params: SafetyParams): Promise<string> {
  return await handleKumaGuard({
    goal: params.guardGoal,
    check: (params.guardCheck as "all" | "anti-pattern" | "loop" | "drift" | "context" | "architecture") || "all",
  });
}

// ============================================================
// CHECKPOINT — Atomic Sandbox Checkpoint & Rollback (one mechanism)
// ============================================================

async function handleCheckpoint(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_checkpoint", { label: params.label });
  if (!params.label) return "⚠️ label parameter required. Example: kuma_safety({ action: 'checkpoint', label: 'pre-feature-x' })";
  const { createCheckpoint } = await import("../engine/kumaCheckpoint.js");
  return await createCheckpoint(params.label, params.description);
}

// ============================================================
// ROLLBACK_LABEL — Restore from labeled snapshot
// ============================================================

async function handleRollbackLabel(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_rollback_label", { label: params.label });
  if (!params.label) return "⚠️ label parameter required. Example: kuma_safety({ action: 'rollback_label', label: 'pre-feature-x' })";
  const { rollbackToCheckpoint } = await import("../engine/kumaCheckpoint.js");
  return await rollbackToCheckpoint(params.label);
}

// ============================================================
// VERIFY — Scoped test verification
// ============================================================

const VERIFY_COOLDOWN_MS = 30_000;
let _lastVerifyCall = 0;

async function handleVerify(params: SafetyParams): Promise<string> {
  const now = Date.now();
  if (now - _lastVerifyCall < VERIFY_COOLDOWN_MS && !params.force) {
    const remaining = Math.ceil((VERIFY_COOLDOWN_MS - (now - _lastVerifyCall)) / 1000);
    return `⏳ Verification cooldown active. Please wait ${remaining}s before calling verify again, or use force: true.`;
  }
  _lastVerifyCall = now;

  const recordingSummary = sessionMemory.getRecordingSummary();
  const stats = sessionMemory.getSummary();
  const toolCallCount = (stats.toolCallCount as number) || 0;
  let recordingWarning = "";
  if (toolCallCount >= 5 && !recordingSummary.hasAnyRecordings) {
    recordingWarning = `\n\n⚠️ **RECORDING MISSING:** You made ${toolCallCount} tool calls with 0 recordings. Before switching tasks, record what you learned:\n- kuma_memory({ action: 'research_save', scope: '<file>' })\n- kuma_memory({ action: 'gotcha', ... }) if you found bugs\n- kuma_memory({ action: 'arch_flow', ... }) if you traced a flow`;
  } else if (recordingSummary.total > 0) {
    recordingWarning = `\n\n✅ **Recordings:** ${recordingSummary.total} total (${recordingSummary.archFlows} arch_flow, ${recordingSummary.gotchas} gotcha, ${recordingSummary.decisions} decision, ${recordingSummary.researchSaves} research_save)`;
  }

  const effectiveScope = params.scope || params.target;
  const timeoutMs = typeof params.timeoutMs === "number" && params.timeoutMs > 0
    ? params.timeoutMs
    : (typeof params.timeout === "number" && params.timeout > 0
        ? params.timeout * 1000
        : (process.env.KUMA_VERIFY_TIMEOUT_MS ? parseInt(process.env.KUMA_VERIFY_TIMEOUT_MS, 10) : 60000));

  sessionMemory.recordToolCall("kuma_safety_verify", { scope: effectiveScope, timeoutMs });
  const { runAutoVerification } = await import("../engine/kumaVerifier.js");
  const verifyResult = await runAutoVerification({
    scope: effectiveScope,
    target: params.target,
    command: params.command,
    force: params.force,
    timeoutMs,
  });
  return verifyResult + recordingWarning;
}

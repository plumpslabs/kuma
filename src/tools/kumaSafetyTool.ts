import { sessionMemory } from "../engine/sessionMemory.js";
import { safetyCheck } from "../engine/kumaSafetyLayer.js";
import { queryAudit, auditStats } from "../engine/safetyAudit.js";
import { getSecurityFindings, addSecurityFinding, runGarbageCollection } from "../engine/kumaDb.js";
import { handleKumaGuard } from "../tools/kumaGuard.js";

type SafetyAction = "guard" | "check" | "audit" | "security" | "gc" | "verify" | "ast" | "validate" | "checkpoint" | "rollback_label" | "checkpoint_list" | "gotcha_staleness";

interface SafetyParams {
  action: SafetyAction;
  guardGoal?: string;
  guardCheck?: string;
  filePath?: string;
  command?: string;
  scope?: string;
  force?: boolean;
  limit?: number;
  since?: number;
  toolName?: string;
  riskLevel?: string;
  allowed?: boolean;
  label?: string;
  description?: string;
}

export async function handleSafety(params: SafetyParams): Promise<string> {
  const { action } = params;
  sessionMemory.recordToolCall("kuma_safety", { action });

  switch (action) {
    case "guard": return handleGuard(params);
    case "verify": return handleVerify(params);
    case "check": return handleCheck(params);
    case "audit": return handleAudit(params);
    case "security": return handleSecurity(params);
    case "gc": return handleGc(params);
    case "ast":
    case "validate": return handleAstValidation(params);
    case "checkpoint": return handleCheckpoint(params);
    case "rollback_label": return handleRollbackLabel(params);
    case "checkpoint_list": return handleCheckpointList(params);
    case "gotcha_staleness": return handleGotchaStaleness(params);
    default: return `Unknown action "${action}".`;
  }
}

// ============================================================
// GUARD — Anti-pattern detection, drift check
// ============================================================

async function handleGuard(params: SafetyParams): Promise<string> {
  return await handleKumaGuard({
    goal: params.guardGoal,
    check: (params.guardCheck as "all" | "anti-pattern" | "loop" | "drift" | "context") || "all",
  });
}

// ============================================================
// CHECK — Pre-execution safety check
// ============================================================

async function handleCheck(params: SafetyParams): Promise<string> {
  return await safetyCheck("check", params.filePath, params.command);
}

// ============================================================
// AUDIT — Query audit trail
// ============================================================

async function handleAudit(params: SafetyParams): Promise<string> {
  if (params.limit === 0) return await auditStats();
  return await queryAudit({
    toolName: params.toolName,
    riskLevel: params.riskLevel,
    allowed: params.allowed,
    limit: params.limit || 20,
    since: params.since,
  });
}

// ============================================================
// SECURITY — Security Leak Scanner
// ============================================================

async function handleSecurity(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_security", {});
  if (params.filePath) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const root = process.cwd();
      const fullPath = path.resolve(root, params.filePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const findings: Array<{ line: number; pattern: string; severity: string; message: string }> = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lc = line.toLowerCase();
          if (lc.includes("credentials: true")) {
            findings.push({ line: i + 1, pattern: "credentials-leak", severity: "high", message: "`credentials: true` in Prisma select may leak sensitive fields" });
          }
          if (lc.includes("console.log") && (lc.includes("token") || lc.includes("secret") || lc.includes("key") || lc.includes("password"))) {
            findings.push({ line: i + 1, pattern: "console-log-secret", severity: "high", message: "Potential secret logged to console" });
          }
          if (lc.includes("process.env") && (lc.includes("api_key") || lc.includes("secret") || lc.includes("token"))) {
            findings.push({ line: i + 1, pattern: "env-in-code", severity: "medium", message: "process.env.KEY referenced in code — ensure not in client bundle" });
          }
        }
        for (const f of findings) {
          await addSecurityFinding({ filePath: params.filePath, lineNumber: f.line, pattern: f.pattern, severity: f.severity, message: f.message });
        }
        if (findings.length === 0) return `🔒 No security issues found in "${params.filePath}".`;
        return `🔒 **Security Scan** — ${findings.length} finding(s) in "${params.filePath}":\n${findings.map(f => `  ${f.severity === "high" ? "🔴" : "🟡"} L${f.line}: ${f.message}`).join("\n")}`;
      }
    } catch {}
  }
  return await getSecurityFindings();
}

// ============================================================
// GC — Kuma Hygiene / Garbage Collection
// ============================================================

async function handleGc(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_gc", {});
  return await runGarbageCollection();
}

// ============================================================
// AST VALIDATION — AST-Based Code Validation
// ============================================================

async function handleAstValidation(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_ast", { scope: params.scope });
  const { validateCodeContent, validateFile, formatValidationFindings } = await import("../engine/kumaAstValidator.js");
  if (params.command) {
    const findings = validateCodeContent(params.command, params.scope);
    return formatValidationFindings(findings, params.scope);
  }
  if (params.scope) {
    const findings = validateFile(params.scope);
    return formatValidationFindings(findings, params.scope);
  }
  return "⚠️ Provide a scope (file path) or command (code content) to validate.";
}

// ============================================================
// CHECKPOINT — Atomic Sandbox Checkpoint & Rollback
// ============================================================

async function handleCheckpoint(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_checkpoint", { label: params.label });
  if (!params.label) return "⚠️ label parameter required. Example: kuma_safety({ action: 'checkpoint', label: 'pre-feature-x' })";
  const { createCheckpoint } = await import("../engine/kumaCheckpoint.js");
  return await createCheckpoint(params.label, params.description);
}

async function handleRollbackLabel(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_rollback_label", { label: params.label });
  if (!params.label) return "⚠️ label parameter required. Example: kuma_safety({ action: 'rollback_label', label: 'pre-feature-x' })";
  const { rollbackToCheckpoint } = await import("../engine/kumaCheckpoint.js");
  return await rollbackToCheckpoint(params.label);
}

async function handleCheckpointList(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_checkpoint_list", {});
  const { listCheckpoints } = await import("../engine/kumaCheckpoint.js");
  return listCheckpoints();
}

// ============================================================
// VERIFY — On-Demand Test Verification
// ============================================================

let _lastVerifyCall = 0;
const VERIFY_COOLDOWN_MS = 30_000;

async function handleVerify(params: SafetyParams): Promise<string> {
  const now = Date.now();
  if (_lastVerifyCall > 0 && (now - _lastVerifyCall) < VERIFY_COOLDOWN_MS) {
    const remaining = Math.ceil((VERIFY_COOLDOWN_MS - (now - _lastVerifyCall)) / 1000);
    return `⏳ **Handler rate limit** — verify was just called ${Math.floor((now - _lastVerifyCall) / 1000)}s ago. Please wait ${remaining}s before calling verify again.`;
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

  sessionMemory.recordToolCall("kuma_safety_verify", { scope: params.scope || params.filePath });
  const { runAutoVerification } = await import("../engine/kumaVerifier.js");
  const verifyResult = await runAutoVerification({
    scope: params.scope || params.filePath,
    force: params.force,
    timeoutMs: 30000,
  });
  return verifyResult + recordingWarning;
}

// ============================================================
// GOTCHA STALENESS — Verify gotcha file/symbol references
// ============================================================

async function handleGotchaStaleness(_params: SafetyParams): Promise<string> {
  const { verifyGotchaStaleness, formatGotchaStalenessReport } = await import("../engine/kumaSelfHeal.js");
  const stale = await verifyGotchaStaleness();
  return formatGotchaStalenessReport(stale);
}

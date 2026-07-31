import { sessionMemory } from "../engine/sessionMemory.js";
import { safetyCheck, safetyOverride } from "../engine/kumaSafetyLayer.js";
import { queryAudit, auditStats } from "../engine/safetyAudit.js";
import { acquireLock, releaseLock, listLocks, cleanStaleLocks } from "../engine/kumaLock.js";
import { saveHealthSnapshot, getSecurityFindings, addSecurityFinding, runGarbageCollection, runDoctor, checkPortability, ensureGitignore } from "../engine/kumaDb.js";
import { handleKumaGuard } from "../tools/kumaGuard.js";

type SafetyAction = "guard" | "check" | "audit" | "lock" | "health" | "override" | "security" | "gc" | "doctor" | "portability" | "gitignore" | "verify" | "clean" | "policy" | "ast" | "validate" | "checkpoint" | "rollback_label" | "checkpoint_list" | "contract" | "gotcha_staleness";

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

  lockAction?: "acquire" | "release" | "list" | "clean";
  lockFilePath?: string;
  agentId?: string;

  reason?: string;
  label?: string;
  description?: string;
  phase?: "pre" | "post";
}

export async function handleSafety(params: SafetyParams): Promise<string> {
  const { action } = params;
  sessionMemory.recordToolCall("kuma_safety", { action });

  switch (action) {
    case "guard": return handleGuard(params);
    case "verify": return handleVerify(params);
    case "check": return handleCheck(params);
    case "audit": return handleAudit(params);
    case "lock": return handleLock(params);
    case "health": return handleHealth(params);
    case "override": return handleOverride(params);
    case "security": return handleSecurity(params);
    case "gc": return handleGc(params);
    case "doctor": return handleDoctor(params);
    case "portability": return handlePortability(params);
    case "gitignore": return handleGitignore(params);
    case "clean": return handleClean(params);
    case "policy": return handlePolicy(params);
    case "ast":
    case "validate": return handleAstValidation(params);
    case "checkpoint": return handleCheckpoint(params);
    case "rollback_label": return handleRollbackLabel(params);
    case "checkpoint_list": return handleCheckpointList(params);
    case "contract": return handleContract(params);
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
    case "list": return listLocks();
    case "clean": return cleanStaleLocks();
    default: return listLocks();
  }
}

// ============================================================
// HEALTH — Project health dashboard (0-100 score)
// ============================================================

async function handleHealth(_params: SafetyParams): Promise<string> {
  try {
    const { computeSafetyScore, formatSafetyScore } = await import("../engine/safetyScore.js");
    const score = await computeSafetyScore();
    await saveHealthSnapshot(score.score, score.risk, JSON.stringify(score.checks), score.summary);
    return formatSafetyScore(score);
  } catch (err) {
    return `Error computing health: ${err}`;
  }
}

// ============================================================
// OVERRIDE — Bypass safety (logged)
// ============================================================

function handleOverride(params: SafetyParams): string {
  return safetyOverride(params.toolName || "unknown", params.reason);
}

// ============================================================
// SECURITY — Security Leak Scanner (Part 2 #8)
// ============================================================

async function handleSecurity(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_security", {});

  // If filePath is provided, try running a quick regex scan
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

        // Check for credentials in selects (Prisma `credentials: true`)
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
          await addSecurityFinding({
            filePath: params.filePath,
            lineNumber: f.line,
            pattern: f.pattern,
            severity: f.severity,
            message: f.message,
          });
        }

        if (findings.length === 0) {
          return `🔒 No security issues found in "${params.filePath}".`;
        }
        return `🔒 **Security Scan** — ${findings.length} finding(s) in "${params.filePath}":\n${findings.map(f => `  ${f.severity === "high" ? "🔴" : "🟡"} L${f.line}: ${f.message}`).join("\n")}`;
      }
    } catch {}
  }

  // Otherwise list all findings
  return await getSecurityFindings();
}

// ============================================================
// GC — Kuma Hygiene / Garbage Collection (Part 5 #6)
// ============================================================

async function handleGc(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_gc", {});
  return await runGarbageCollection();
}

// ============================================================
// DOCTOR — Kuma Health Check (Part 5 #6)
// ============================================================

async function handleDoctor(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_doctor", {});
  return await runDoctor();
}

// ============================================================
// PORTABILITY — Check path portability (Part 5 #7)
// ============================================================

async function handlePortability(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_portability", {});
  return await checkPortability();
}

// ============================================================
// GITIGNORE — Auto-configure .gitignore (Part 5 #1)
// ============================================================

async function handleGitignore(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_gitignore", {});
  return await ensureGitignore();
}

// ============================================================
// CLEAN — Purge scratch directory & reset drift (Issue #10)
// ============================================================

async function handleClean(_params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_clean", {});
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = process.cwd();
  const scratchDir = path.resolve(root, ".kuma", "scratch");
  let removed = 0;
  if (fs.existsSync(scratchDir)) {
    try {
      const entries = fs.readdirSync(scratchDir);
      for (const entry of entries) {
        const fullPath = path.join(scratchDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            fs.unlinkSync(fullPath);
            removed++;
          } else if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            removed++;
          }
        } catch {}
      }
    } catch {}
  }
  // Also reset drift warnings in session
  sessionMemory.setGoal(sessionMemory.getSummary().currentGoal as string || "cleaned");
  const result = removed > 0
    ? `🧹 **Scratch Clean** — Removed ${removed} item(s) from .kuma/scratch/`
    : `🧹 **Scratch Clean** — No scratch files to clean.`;
  return `${result}\n💡 Drift warnings have been reset. Any temporary debug artifacts are now cleared.`;
}

// ============================================================
// POLICY — Policy-as-Code Engine (Issue #24)
// ============================================================

async function handlePolicy(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_policy", {});

  // Evaluate a command against policy
  if (params.command) {
    const { evaluateCommand, evaluateFilePath } = await import("../engine/kumaPolicyEngine.js");
    const commandVerdict = evaluateCommand(params.command);
    const lines: string[] = [];

    lines.push(`📜 **Policy Check**: ${commandVerdict.allowed ? "✅ Allowed" : "⛔ Blocked"}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");
    lines.push(`💻 Command: \`${params.command}\``);
    lines.push(`📋 Result: ${commandVerdict.message}`);

    if (commandVerdict.blockedBy) {
      lines.push("");
      lines.push(`🔴 **Blocked by rule**: ${commandVerdict.blockedBy.description}`);
      if (commandVerdict.requiresOverride) {
        lines.push(`🔑 Use kuma_safety({ action: 'override', toolName: 'policy', reason: '...' }) to bypass.`);
      }
    }

    for (const w of commandVerdict.warnings) {
      lines.push(`🟡 **Warning**: ${w.description}`);
    }

    // Also check file path
    if (params.filePath) {
      const fileVerdict = evaluateFilePath(params.filePath);
      if (!fileVerdict.allowed) {
        lines.push("");
        lines.push(fileVerdict.message);
      }
    }

    return lines.join("\n");
  }

  // Show current policy status
  const { formatPolicyStatus } = await import("../engine/kumaPolicyEngine.js");
  return formatPolicyStatus();
}

// ============================================================
// AST VALIDATION — AST-Based Code Validation (Issue #22)
// ============================================================

async function handleAstValidation(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_ast", { scope: params.scope });

  const { validateCodeContent, validateFile, formatValidationFindings } = await import("../engine/kumaAstValidator.js");

  // If content is provided, validate it directly
  if (params.command) {
    const findings = validateCodeContent(params.command, params.scope);
    return formatValidationFindings(findings, params.scope);
  }

  // If scope is a file path, validate the file
  if (params.scope) {
    const findings = validateFile(params.scope);
    return formatValidationFindings(findings, params.scope);
  }

  return "⚠️ Provide a scope (file path) or command (code content) to validate.";
}



// ============================================================
// CHECKPOINT — Atomic Sandbox Checkpoint & Rollback (Issue #29)
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
// CONTRACT — Agent Contract Testing (Issue #26)
// ============================================================

async function handleContract(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_contract", {
    toolName: params.toolName || "edit",
    filePath: params.filePath,
    phase: params.phase || "pre",
  });
  const { runContractChecks, listContracts } = await import("../engine/kumaContractEngine.js");

  // If no file path, list contracts
  if (!params.filePath && !params.toolName) {
    return listContracts();
  }

  return await runContractChecks(
    params.toolName || "edit",
    params.filePath,
    params.phase || "pre",
  );
}

// ============================================================
// VERIFY — On-Demand Test Verification (SAFETY-GUARDED)
// ============================================================
// 🔴 This handler is the **ONLY** entry point for runAutoVerification().
// Do NOT add any internal hooks, health-check triggers, or auto-calls
// that invoke runAutoVerification() — it has its own built-in rate
// limiter + runaway detection as a second line of defense.
//
// Secondary safety guards at handler level (in addition to verifier):
//   • Rate limit: blocks if verify was called < 30s ago
//   • Concurrency: blocks if verify is already running
// ============================================================

let _lastVerifyCall = 0;
const VERIFY_COOLDOWN_MS = 30_000; // 30s handler-level cooldown

async function handleVerify(params: SafetyParams): Promise<string> {
  // Handler-level rate limit (secondary defense)
  const now = Date.now();
  if (_lastVerifyCall > 0 && (now - _lastVerifyCall) < VERIFY_COOLDOWN_MS) {
    const remaining = Math.ceil((VERIFY_COOLDOWN_MS - (now - _lastVerifyCall)) / 1000);
    return `⏳ **Handler rate limit** — verify was just called ${Math.floor((now - _lastVerifyCall) / 1000)}s ago. Please wait ${remaining}s before calling verify again.`;
  }
  _lastVerifyCall = now;

  // Recording enforcement — check if agent recorded before verify
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

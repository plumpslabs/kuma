import { sessionMemory } from "../engine/sessionMemory.js";
import { safetyCheck, safetyOverride } from "../engine/kumaSafetyLayer.js";
import { queryAudit, auditStats } from "../engine/safetyAudit.js";
import { acquireLock, releaseLock, listLocks, cleanStaleLocks } from "../engine/kumaLock.js";
import { saveHealthSnapshot, getSecurityFindings, addSecurityFinding, runGarbageCollection, runDoctor, checkPortability, ensureGitignore } from "../engine/kumaDb.js";
import { handleKumaGuard } from "../tools/kumaGuard.js";

type SafetyAction = "guard" | "check" | "audit" | "lock" | "health" | "override" | "security" | "gc" | "doctor" | "portability" | "gitignore";

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
    case "security": return handleSecurity(params);
    case "gc": return handleGc(params);
    case "doctor": return handleDoctor(params);
    case "portability": return handlePortability(params);
    case "gitignore": return handleGitignore(params);
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

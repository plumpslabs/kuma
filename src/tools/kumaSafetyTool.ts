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
// VERIFY — Blast radius & scope notice (test execution removed)
// ============================================================

async function handleVerify(params: SafetyParams): Promise<string> {
  sessionMemory.recordToolCall("kuma_safety_verify", { scope: params.scope, target: params.target });
  const target = params.target || params.scope;

  if (target) {
    const { analyzeImpact, formatImpact } = await import("../engine/kumaGraph.js");
    const impact = await analyzeImpact(target);
    const formattedImpact = formatImpact(impact);

    let recommendedCmd = "";
    try {
      const { getWorkspaceInfo, findPackageForFile } = await import("../engine/workspaceIntelligence.js");
      const wsInfo = await getWorkspaceInfo();
      const testFile = impact.affectedTests && impact.affectedTests.length > 0 ? impact.affectedTests[0] : "";
      const targetPkg = findPackageForFile(testFile || target, wsInfo);
      const pkgName = targetPkg?.name;
      const pkgPath = targetPkg?.path;
      const isMonorepo = wsInfo.isWorkspace && pkgName && !targetPkg?.isRoot;

      if (isMonorepo) {
        const relTest = testFile && pkgPath && testFile.startsWith(pkgPath + "/")
          ? testFile.slice(pkgPath.length + 1)
          : testFile || target;

        if (wsInfo.type === "pnpm") {
          recommendedCmd = `pnpm --filter ${pkgName} test${relTest ? ` -- "${relTest}"` : ""}\n   (or \`pnpm --prefix ${pkgPath} test\`)`;
        } else if (wsInfo.type === "npm") {
          recommendedCmd = `npm test --workspace=${pkgName}${relTest ? ` -- "${relTest}"` : ""}`;
        } else if (wsInfo.type === "yarn") {
          recommendedCmd = `yarn workspace ${pkgName} test${relTest ? ` "${relTest}"` : ""}`;
        } else {
          recommendedCmd = `cd ${pkgPath} && npm test${relTest ? ` -- "${relTest}"` : ""}`;
        }
      } else {
        const testPattern = testFile ? `"${testFile}"` : `"${target}"`;
        recommendedCmd = wsInfo.type === "pnpm" ? `pnpm test -- ${testPattern}` : `npm test -- ${testPattern}`;
      }
    } catch {
      recommendedCmd = `npm test -- "${target}"`;
    }

    return [
      `ℹ️ **Kuma Scope Notice**: Test execution is outside Kuma's scope. Please execute your native test runner directly.`,
      "",
      `🎯 **Post-Edit Blast Radius & Dependency Impact for \`${target}\`:**`,
      formattedImpact,
      "",
      `📋 **Recommended Scoped Test Command:**`,
      `   \`${recommendedCmd}\``,
    ].join("\n");
  }

  return [
    `ℹ️ **Kuma Scope Notice**: Test execution is outside Kuma's scope.`,
    `Please run your project's native test runner directly in your shell (e.g. \`npm test\`, \`pnpm test\`, \`pytest\`, \`cargo test\`).`,
    "",
    `💡 Use Kuma for:`,
    `- Codebase Topology & AST Search: kuma_context({ action: "research", scope: "..." })`,
    `- Blast Radius & Impact Analysis: kuma_context({ action: "impact", target: "..." })`,
    `- Monorepo Map & Package Boundaries: kuma_context({ action: "map" })`,
    `- Living Memory & Decision History: kuma_context({ action: "history", target: "..." })`,
    `- Safety Guard & Rollback Checkpoints: kuma_safety({ action: "guard" })`,
  ].join("\n");
}


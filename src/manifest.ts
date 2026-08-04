import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { handleContext, handleMemory, handleSafety } from "./engine/kumaRouter.js";
import { ensureInitialized } from "./engine/kumaAutoInit.js";

// ============================================================
// NAMESPACE NORMALIZER — Pilar 2
// ============================================================
// Resolves tool name aliases so MCP clients that add prefixes
// (e.g., kuma_kuma_context) still work seamlessly.
// ============================================================

const TOOL_ALIASES: Record<string, string> = {
  // Double-prefix aliases (client adds server name prefix)
  "kuma_kuma_context": "kuma_context",
  "kuma_kuma_memory": "kuma_memory",
  "kuma_kuma_safety": "kuma_safety",
  // Single-prefix variants
  "kuma_context": "kuma_context",
  "kuma_memory": "kuma_memory",
  "kuma_safety": "kuma_safety",
  // Short aliases (no prefix)
  "context": "kuma_context",
  "memory": "kuma_memory",
  "safety": "kuma_safety",
};

/**
 * Resolve a tool name through the alias map.
 * Returns the canonical tool name, or the original if no alias found.
 */
export function resolveToolName(name: string): string {
  return TOOL_ALIASES[name] || name;
}

export function registerAllTools(server: McpServer): void {
  // ============================================================
  // kuma_context — Context & Understanding
  // ============================================================
  server.tool(
    "kuma_context",
    "**Call FIRST every session.** Understand your project before making changes.\n\nWORKFLOW:\n• STEP 1 (ALWAYS): `init` — lean project brief + session restore (<500 tokens)\n• During edits: hooks (`kuma hook pre-edit` / `pre-bash`) auto-inject gotchas, decisions & history — zero extra steps\n• Editing an unfamiliar file: `history` — why is this file written this way (cross-session trace)\n• STEP 8 (END of session): `changes` — review what you modified\n\nOther actions: flow (hash-verified derived flow cache), impact (analyze changes), digest (compact briefing), drift (detect staleness), rollback (undo a change).",
    {
      action: z.enum(["init", "research", "impact", "navigate", "flow", "history", "changes", "rollback", "digest", "drift", "resume"]).describe("Action: init=lean project brief, research=research pipeline, impact=analyze change effects, navigate=trace code flow, flow=hash-verified derived flow cache (F13), history=why is this file written this way (cross-session trace + fresh gotchas), changes=view change log, rollback=undo a change by ID, digest=ultra-compact project briefing, drift=detect memory staleness, resume=load previous session context"),
      scope: z.string().optional().describe("Research scope for research action"),
      target: z.string().optional().describe("Target symbol/file for impact/navigate/changes"),
      goal: z.string().optional().describe("Current goal (for init)"),
      since: z.number().optional().describe("Unix timestamp filter for changes"),
    },
    async (params) => {
      try {
        // Pilar 1: Auto-init on first call
        await ensureInitialized();

        const text = await handleContext({
          action: params.action,
          scope: params.scope,
          target: params.target,
          goal: params.goal,
          since: params.since,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_context: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_memory — Decision & Knowledge
  // ============================================================
  server.tool(
    "kuma_memory",
    "**Call after research/editing** (including research-only). Record what matters, skip what doesn't.\n\n🔴 MUST RECORD — High Impact (saves agent time next session):\n• STEP 5: `research_save` — after exploring area (creates search cache).\n• STEP 6: `gotcha` — IMMEDIATELY when you discover bugs/quirks. No re-research.\n• STEP 7: `arch_flow` — AFTER tracing COMPLETE flow (max 5 core files).\n• STEP 8: `decision` — IMMEDIATELY when choosing between options. Preserves rationale.\n\n🟢 SKIP using MCP (agent native tools are faster):\n• Function/class nodes → grep\n• Component/route nodes → glob or check directly\n• Import edges → read imports directly\n• Visual graph → for humans, not AI agents\n\nOther actions: session, search, changes.",
    {
      action: z.enum(["decision", "mine", "research_save", "session", "search", "changes", "arch_flow", "gotcha", "delete_node", "clear", "goal_progress"]).describe("Memory action: decision=ADR, mine=mine git log, research_save=save findings, session=summary, search=search memory + graph, changes=change log, arch_flow=record architecture flow, gotcha=record bug/quirk, delete_node=delete node/gotcha, clear=wipe all nodes, goal_progress=update goal progress"),
      scope: z.string().optional().describe("Scope for research_save/search/mine — or file path for gotcha/delete_node"),
      trigger_command: z.string().optional().describe("Gotcha trigger: shell command that hits this gotcha (e.g. 'npm run seed'). Injected by the Bash PreToolUse hook"),
      query: z.string().optional().describe("Search query for search action"),
      content: z.string().optional().describe("Content/notes for research_save / gotcha description / arch_flow record"),
      record: z.string().optional().describe("JSON record string for research_save"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
      confirm: z.boolean().optional().describe("Confirm and record candidates automatically for mine action"),
      title: z.string().optional().describe("Decision title (required for decision)"),
      context: z.string().optional().describe("Decision context"),
      rationale: z.string().optional().describe("Decision rationale (required for decision)"),
      outcome: z.string().optional().describe("Decision outcome (default: implemented)"),
      status: z.string().optional().describe("Gotcha severity for gotcha action (low|medium|high|critical)"),
      description: z.string().optional().describe("Gotcha workaround for gotcha action"),
      topic: z.string().optional().describe("Memory topic for session action"),
      limit: z.number().min(1).max(100).optional().describe("Result limit for search/mine"),
      target: z.string().optional().describe("File path for changes / node ID for delete_node"),
      since: z.number().optional().describe("Timestamp filter for changes/mine"),
    },
    async (params) => {
      try {
        // Pilar 1: Auto-init on first call
        await ensureInitialized();

        const text = await handleMemory({
          action: params.action,
          scope: params.scope,
          query: params.query,
          content: params.content,
          record: params.record,
          confidence: params.confidence,
          confirm: params.confirm,
          title: params.title,
          context: params.context,
          rationale: params.rationale,
          outcome: params.outcome,
          topic: params.topic,
          limit: params.limit,
          target: params.target,
          since: params.since,
          status: params.status,
          description: params.description,
          trigger_command: params.trigger_command,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_memory: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_safety — Safety & Policy
  // ============================================================
  server.tool(
    "kuma_safety",
    "Safety checks, policy enforcement, and auto-verification.\n\nWORKFLOW:\n• STEP 2 (BEFORE work): `guard` — detect anti-patterns, drift, runaway loops\n• STEP 9 (AFTER research/edits): `verify` — auto-run scoped tests + AST validation\n\nOther actions: check (pre-exec safety), audit (query trail), health (score 0-100), ast (code validation), checkpoint (snapshot before refactors), gotcha_staleness (verify recorded gotchas are still valid).",
    {
      action: z.enum(["guard", "verify", "check", "audit", "health", "security", "gc", "ast", "validate", "checkpoint", "rollback_label", "checkpoint_list", "gotcha_staleness"]).describe("Safety action: guard=anti-patterns, verify=auto-run tests, check=pre-exec safety, audit=query trail, health=project score, security=scan leaks, gc=garbage collect, ast/validate=AST validation, checkpoint=create snapshot, rollback_label=restore from checkpoint, checkpoint_list=list checkpoints, gotcha_staleness=verify gotcha file refs still valid"),
      // Verify params
      scope: z.string().optional().describe("Scope for verify/ast/validate (e.g. 'auth', file path)"),
      // Guard params
      guardGoal: z.string().optional().describe("Goal for guard check"),
      guardCheck: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().describe("Guard check type"),
      // Check params
      filePath: z.string().optional().describe("File path for check/security scan"),
      command: z.string().optional().describe("Command for check"),
      // Audit params
      toolName: z.string().optional().describe("Filter audit by tool name"),
      riskLevel: z.string().optional().describe("Filter audit by risk level"),
      allowed: z.boolean().optional().describe("Filter audit by allowed/blocked"),
      limit: z.number().min(1).max(100).optional().describe("Audit result limit"),
      since: z.number().optional().describe("Timestamp filter for audit"),
      force: z.boolean().optional().describe("Force re-run even if cache is fresh (verify)"),
      // Checkpoint params (#29)
      label: z.string().optional().describe("Checkpoint label for checkpoint/rollback_label actions"),
      description: z.string().optional().describe("Description for checkpoint"),
    },
    async (params) => {
      try {
        // Pilar 1: Auto-init on first call
        await ensureInitialized();

        const text = await handleSafety({
          action: params.action,
          guardGoal: params.guardGoal,
          guardCheck: params.guardCheck,
          filePath: params.filePath,
          scope: params.scope,
          command: params.command,
          toolName: params.toolName,
          riskLevel: params.riskLevel,
          allowed: params.allowed,
          limit: params.limit,
          since: params.since,
          force: params.force,
          label: params.label,
          description: params.description,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_safety: ${err}` }], isError: true };
      }
    }
  );

  console.error("[Manifest] Registered 3 V3 coarse-grained tools (kuma_context, kuma_memory, kuma_safety).");
  console.error("[Manifest] Pilar 1: Auto-init hooks installed on all tools.");
  console.error("[Manifest] Pilar 2: Namespace aliases active (kuma_kuma_* → kuma_*, context → kuma_context).");
}

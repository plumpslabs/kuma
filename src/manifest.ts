import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { handleContext, handleMemory, handleSafety } from "./engine/kumaRouter.js";
import { ensureInitialized } from "./engine/kumaAutoInit.js";

// ============================================================
// NAMESPACE NORMALIZER
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

/**
 * Agent surface = 13 core actions across 3 tools.
 * Everything else (impact, navigate, changes, digest, drift, resume, mine,
 * session, delete_node, clear, goal_progress, check, audit, security, gc,
 * ast, validate, gotcha_staleness) runs internally and is NOT exposed —
 * exposing it only adds decision cost + token weight for the agent.
 */
const CORE_NOTE = "\n\nCORE ACTIONS (use these): ";

export function registerAllTools(server: McpServer): void {
  // ============================================================
  // kuma_context — Context & Understanding
  // ============================================================
  server.tool(
    "kuma_context",
    "Context & memory recall. Call FIRST each session. Lean — each call returns only what you need." +
      CORE_NOTE +
      "`init` (start of session: project brief + session state), `research` (before editing unfamiliar code), `history` (why is this file written this way), `flow` (read a recorded architecture flow).",
    {
      action: z.enum(["init", "research", "history", "flow"]).describe(
        "init=project brief + session restore, research=research pipeline, history=file rationale + fresh gotchas, flow=read recorded domain flow"
      ),
      scope: z.string().optional().describe("Research scope for research action"),
      target: z.string().optional().describe("Target symbol/file for history/flow"),
      goal: z.string().optional().describe("Current goal (for init)"),
    },
    async (params) => {
      try {
        // Auto-init on first call
        await ensureInitialized();

        const text = await handleContext({
          action: params.action,
          scope: params.scope,
          target: params.target,
          goal: params.goal,
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
    "Persistent knowledge. Record what matters, skip what doesn't. This is what saves time in future sessions. Don't record what grep/glob answers faster (functions, imports, types, components)." +
      CORE_NOTE +
      "`gotcha` (IMMEDIATELY when you find a bug/quirk), `decision` (when choosing between options), `arch_flow` (after tracing a complete flow, max 5 core files), `research_save` (after exploring an area), `search` (quick lookup of memory + knowledge graph).",
    {
      action: z.enum(["gotcha", "decision", "arch_flow", "research_save", "search"]).describe(
        "gotcha=record bug/quirk, decision=ADR, arch_flow=record architecture flow, research_save=save findings, search=quick memory+graph lookup"
      ),
      scope: z.string().optional().describe("File path for gotcha — or scope for research_save/search"),
      trigger_command: z.string().optional().describe("Gotcha trigger: shell command that hits this gotcha"),
      query: z.string().optional().describe("Search query for search action"),
      content: z.string().optional().describe("Content/notes for research_save / gotcha description / arch_flow record"),
      record: z.string().optional().describe("JSON record string for research_save"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
      title: z.string().optional().describe("Decision title (required for decision)"),
      context: z.string().optional().describe("Decision context"),
      rationale: z.string().optional().describe("Decision rationale (required for decision)"),
      outcome: z.string().optional().describe("Decision outcome (default: implemented)"),
      status: z.string().optional().describe("Gotcha severity (low|medium|high|critical)"),
      description: z.string().optional().describe("Gotcha workaround"),
      limit: z.number().min(1).max(100).optional().describe("Result limit for search"),
    },
    async (params) => {
      try {
        // Auto-init on first call
        await ensureInitialized();

        const text = await handleMemory({
          action: params.action,
          scope: params.scope,
          query: params.query,
          content: params.content,
          record: params.record,
          confidence: params.confidence,
          title: params.title,
          context: params.context,
          rationale: params.rationale,
          outcome: params.outcome,
          limit: params.limit,
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
    "Safety & verification. Use at task boundaries, not on every edit." +
      CORE_NOTE +
      "`guard` (before risky work: anti-patterns, drift, loops), `verify` (after edits: scoped tests + validation), `checkpoint` + `rollback_label` (the one rollback mechanism: snapshot before risky work, restore after).",
    {
      action: z.enum(["guard", "verify", "checkpoint", "rollback_label"]).describe(
        "guard=anti-patterns/drift/loops before risky work, verify=scoped tests after edits, checkpoint=labeled snapshot before risky work, rollback_label=restore a labeled snapshot"
      ),
      scope: z.string().optional().describe("Scope for verify (e.g. 'auth', file path)"),
      force: z.boolean().optional().describe("Force re-run even if cache is fresh (verify)"),
      guardGoal: z.string().optional().describe("Goal for guard check"),
      guardCheck: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().describe("Guard check type"),
      label: z.string().optional().describe("Checkpoint label for checkpoint/rollback_label"),
      description: z.string().optional().describe("Description for checkpoint"),
    },
    async (params) => {
      try {
        // Auto-init on first call
        await ensureInitialized();

        const text = await handleSafety({
          action: params.action,
          guardGoal: params.guardGoal,
          guardCheck: params.guardCheck,
          scope: params.scope,
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

  console.error("[Manifest] Registered 3 coarse-grained tools with 13 core actions (init/research/history/flow · gotcha/decision/arch_flow/research_save/search · guard/verify/checkpoint/rollback_label).");
  console.error("[Manifest] Auto-init hooks installed on all tools.");
  console.error("[Manifest] Namespace aliases active (kuma_kuma_* → kuma_*, context → kuma_context).");
}

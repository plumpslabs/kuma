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
  const contextDesc =
    "Context & memory recall. Call FIRST each session. Lean — each call returns only what you need." +
    CORE_NOTE +
    "`init` (start of session: project brief + session state), `research` (before editing unfamiliar code), `history` (why is this file written this way), `flow` (read a recorded architecture flow), `map` (repository topology), `impact` (blast radius analysis).";

  const contextSchema = {
    action: z.enum(["init", "research", "history", "flow", "map", "impact"]).describe(
      "init=project brief + session restore, research=research pipeline, history=file rationale + fresh gotchas, flow=read recorded domain flow, map=repo topology, impact=blast radius"
    ),
    scope: z.string().optional().describe("Research scope or target for impact"),
    target: z.string().optional().describe("Target symbol/file for history/flow/impact"),
    goal: z.string().optional().describe("Current goal (for init)"),
  };

  const contextHandler = async (params: any) => {
    try {
      await ensureInitialized();
      const text = await handleContext({
        action: params.action,
        scope: params.scope,
        target: params.target,
        goal: params.goal,
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error in kuma_context: ${err}` }], isError: true };
    }
  };

  server.tool("kuma_context", contextDesc, contextSchema, contextHandler);
  server.tool("kuma_kuma_context", contextDesc, contextSchema, contextHandler);

  // ============================================================
  // kuma_memory — Decision & Knowledge
  // ============================================================
  const memoryDesc =
    "Persistent knowledge. Record what matters, skip what doesn't. This is what saves time in future sessions. Don't record what grep/glob answers faster (functions, imports, types, components)." +
    CORE_NOTE +
    "`gotcha` (IMMEDIATELY when you find a bug/quirk), `decision` (when choosing between options), `arch_flow` (after tracing a complete flow, max 5 core files), `research_save` (after exploring an area), `search` (quick lookup of memory + knowledge graph), `gotcha_resolve` (archive fixed bugs).";

  const memorySchema = {
    action: z.enum(["gotcha", "decision", "arch_flow", "research_save", "search", "gotcha_resolve"]).describe(
      "gotcha=record bug/quirk, decision=ADR, arch_flow=record architecture flow, research_save=save findings, search=quick memory+graph lookup, gotcha_resolve=archive fixed bug"
    ),
    scope: z.string().optional().describe("File path for gotcha — or scope for research_save/search"),
    target: z.string().optional().describe("Target file, gotcha ID, or component"),
    trigger_command: z.string().optional().describe("Gotcha trigger: shell command that hits this gotcha"),
    query: z.string().optional().describe("Search query for search action"),
    content: z.string().optional().describe("Content/notes for research_save / gotcha description / arch_flow record"),
    record: z.string().optional().describe("JSON record string for research_save"),
    confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
    title: z.string().optional().describe("Decision title (optional if content/target provided)"),
    context: z.string().optional().describe("Decision context"),
    rationale: z.string().optional().describe("Decision rationale (optional if content provided)"),
    outcome: z.string().optional().describe("Decision outcome (default: implemented)"),
    status: z.string().optional().describe("Gotcha severity (low|medium|high|critical) or status (resolved|deprecated)"),
    severity: z.string().optional().describe("Gotcha severity (low|medium|high|critical)"),
    description: z.string().optional().describe("Gotcha workaround / rationale"),
    id: z.union([z.number(), z.string()]).optional().describe("Gotcha ID for resolution or deprecation"),
    limit: z.number().min(1).max(100).optional().describe("Result limit for search"),
  };

  const memoryHandler = async (params: any) => {
    try {
      await ensureInitialized();
      const text = await handleMemory({
        action: params.action,
        scope: params.scope,
        target: params.target,
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
        severity: params.severity,
        description: params.description,
        trigger_command: params.trigger_command,
        id: params.id,
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error in kuma_memory: ${err}` }], isError: true };
    }
  };

  server.tool("kuma_memory", memoryDesc, memorySchema, memoryHandler);
  server.tool("kuma_kuma_memory", memoryDesc, memorySchema, memoryHandler);

  // ============================================================
  // kuma_safety — Safety & Policy
  // ============================================================
  const safetyDesc =
    "Safety & verification. Use at task boundaries, not on every edit." +
    CORE_NOTE +
    "`guard` (before risky work: anti-patterns, drift, loops), `verify` (after edits: scoped tests + validation), `checkpoint` + `rollback_label` (the one rollback mechanism: snapshot before risky work, restore after).";

  const safetySchema = {
    action: z.enum(["guard", "verify", "checkpoint", "rollback_label"]).describe(
      "guard=anti-patterns/drift/loops before risky work, verify=scoped tests after edits, checkpoint=labeled snapshot before risky work, rollback_label=restore a labeled snapshot"
    ),
    scope: z.string().optional().describe("Scope for verify (e.g. 'auth', file path)"),
    target: z.string().optional().describe("Target test file or scope for verify"),
    command: z.string().optional().describe("Custom test command to run during verify"),
    timeoutMs: z.number().optional().describe("Custom timeout in milliseconds for verify (default: 60000)"),
    timeout: z.number().optional().describe("Custom timeout in seconds for verify"),
    force: z.boolean().optional().describe("Force re-run even if cache is fresh or rate limited (verify)"),
    guardGoal: z.string().optional().describe("Goal for guard check"),
    guardCheck: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().describe("Guard check type"),
    label: z.string().optional().describe("Checkpoint label for checkpoint/rollback_label"),
    description: z.string().optional().describe("Description for checkpoint"),
  };

  const safetyHandler = async (params: any) => {
    try {
      await ensureInitialized();
      const text = await handleSafety({
        action: params.action,
        guardGoal: params.guardGoal,
        guardCheck: params.guardCheck,
        scope: params.scope,
        target: params.target,
        command: params.command,
        timeoutMs: params.timeoutMs,
        timeout: params.timeout,
        force: params.force,
        label: params.label,
        description: params.description,
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error in kuma_safety: ${err}` }], isError: true };
    }
  };

  server.tool("kuma_safety", safetyDesc, safetySchema, safetyHandler);
  server.tool("kuma_kuma_safety", safetyDesc, safetySchema, safetyHandler);

  console.error("[Manifest] Registered 3 core tools with universal dual-prefix aliases (kuma_* and kuma_kuma_*).");
  console.error("[Manifest] Auto-init hooks installed on all tools.");
}

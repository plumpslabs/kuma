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
 * Core actions are the 6 high-value entry points agents should use.
 * Everything else exists for power users / maintenance and is marked internal.
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
      "`init` (start of session: project brief + session state), `research` (before editing unfamiliar code), `history` (why is this file written this way). Other actions are internal: flow, impact, navigate, digest, drift, rollback, changes, resume.",
    {
      action: z.enum(["init", "research", "impact", "navigate", "flow", "history", "changes", "rollback", "digest", "drift", "resume"]).describe(
        "init=project brief + session restore (CORE), research=research pipeline (CORE), history=file rationale + fresh gotchas (CORE); internal (avoid unless needed): impact, navigate, flow, changes, rollback, digest, drift, resume"
      ),
      scope: z.string().optional().describe("Research scope for research action"),
      target: z.string().optional().describe("Target symbol/file for impact/navigate/changes/history"),
      goal: z.string().optional().describe("Current goal (for init)"),
      since: z.number().optional().describe("Unix timestamp filter for changes"),
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
    "Persistent knowledge. Record what matters, skip what doesn't. This is what saves time in future sessions. Don't record what grep/glob answers faster (functions, imports, types, components)." +
      CORE_NOTE +
      "`gotcha` (IMMEDIATELY when you find a bug/quirk), `decision` (when choosing between options), `arch_flow` (after tracing a complete flow, max 5 core files), `research_save` (after exploring an area). Other actions are internal: session, search, changes, mine, delete_node, clear, goal_progress.",
    {
      action: z.enum(["decision", "mine", "research_save", "session", "search", "changes", "arch_flow", "gotcha", "delete_node", "clear", "goal_progress"]).describe(
        "gotcha=record bug/quirk (CORE), decision=ADR (CORE), arch_flow=record architecture flow (CORE), research_save=save findings (CORE); internal (avoid unless needed): mine, session, search, changes, delete_node, clear, goal_progress"
      ),
      scope: z.string().optional().describe("Scope for research_save/search/mine — or file path for gotcha/delete_node"),
      trigger_command: z.string().optional().describe("Gotcha trigger: shell command that hits this gotcha. Injected by the Bash PreToolUse hook"),
      query: z.string().optional().describe("Search query for search action"),
      content: z.string().optional().describe("Content/notes for research_save / gotcha description / arch_flow record"),
      record: z.string().optional().describe("JSON record string for research_save"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
      confirm: z.boolean().optional().describe("Confirm and record candidates automatically for mine action"),
      title: z.string().optional().describe("Decision title (required for decision)"),
      context: z.string().optional().describe("Decision context"),
      rationale: z.string().optional().describe("Decision rationale (required for decision)"),
      outcome: z.string().optional().describe("Decision outcome (default: implemented)"),
      status: z.string().optional().describe("Gotcha severity (low|medium|high|critical)"),
      description: z.string().optional().describe("Gotcha workaround"),
      topic: z.string().optional().describe("Memory topic for session action"),
      limit: z.number().min(1).max(100).optional().describe("Result limit for search/mine"),
      target: z.string().optional().describe("File path for changes / node ID for delete_node"),
      since: z.number().optional().describe("Timestamp filter for changes/mine"),
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
    "Safety & verification. Use at task boundaries, not on every edit." +
      CORE_NOTE +
      "`guard` (before risky work: anti-patterns, drift, loops), `verify` (after edits: scoped tests + validation). Other actions are internal/deprecated: check, audit, health, security, gc, ast, validate, checkpoint, rollback_label, checkpoint_list, gotcha_staleness.",
    {
      action: z.enum(["guard", "verify", "check", "audit", "health", "security", "gc", "ast", "validate", "checkpoint", "rollback_label", "checkpoint_list", "gotcha_staleness"]).describe(
        "guard=anti-patterns/drift/loops before risky work (CORE), verify=scoped tests after edits (CORE); internal/deprecated (avoid unless needed): check, audit, health, security, gc, ast, validate, checkpoint, rollback_label, checkpoint_list, gotcha_staleness"
      ),
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
      // Checkpoint params
      label: z.string().optional().describe("Checkpoint label for checkpoint/rollback_label actions"),
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

  console.error("[Manifest] Registered 3 coarse-grained tools (kuma_context, kuma_memory, kuma_safety).");
  console.error("[Manifest] Auto-init hooks installed on all tools.");
  console.error("[Manifest] Namespace aliases active (kuma_kuma_* → kuma_*, context → kuma_context).");
}

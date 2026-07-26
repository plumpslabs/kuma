import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { handleContext, handleMemory, handleSafety } from "./engine/kumaRouter.js";

export function registerAllTools(server: McpServer): void {
  // ============================================================
  // kuma_context — Context & Understanding (V3 Coarse-Grained)
  // ============================================================
  server.tool(
    "kuma_context",
    "**Call FIRST every session.** Understand your project before making changes. Actions: init (load project brief), research (5-step pipeline: cache→staleness→graph→impact→decision), impact (analyze change effects), navigate (trace code flow), changes (view change log), health (project health score 0-100). RESEARCH IS REQUIRED before editing unfamiliar code.",
    {
      action: z.enum(["init", "research", "impact", "navigate", "changes", "health"]).describe("Action: init=project brief, research=5-step research pipeline (REQUIRED before edits), impact=analyze change effects, navigate=trace code flow, changes=view change log, health=project health score"),
      scope: z.string().optional().describe("Research scope for research action (e.g. 'auth', 'database', 'api')"),
      target: z.string().optional().describe("Target symbol/file for impact/navigate/changes"),
      goal: z.string().optional().describe("Current goal (for init/health)"),
      since: z.number().optional().describe("Unix timestamp filter for changes"),
      compact: z.boolean().optional().default(false).describe("Compact output mode"),
    },
    async (params) => {
      try {
        const text = await handleContext({
          action: params.action,
          scope: params.scope,
          target: params.target,
          goal: params.goal,
          since: params.since,
          compact: params.compact,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_context: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_memory — Decision & Knowledge (V3 Coarse-Grained)
  // ============================================================
  server.tool(
    "kuma_memory",
    "Record and retrieve project knowledge. Actions: decision (ADR-style record/template/suggest), research_save (save research results), session (current session summary), heal (self-heal knowledge graph), search (search memory + graph), changes (view change log for selective undo).",
    {
      action: z.enum(["decision", "research_save", "session", "heal", "search", "changes"]).describe("Memory action: decision=record ADR, research_save=save research, session=session summary, heal=graph repair, search=search all, changes=change log"),
      scope: z.string().optional().describe("Scope for research_save/search"),
      query: z.string().optional().describe("Search query for search action"),
      content: z.string().optional().describe("Content/notes for research_save"),
      record: z.string().optional().describe("JSON record string for research_save"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
      // Decision params
      decisionAction: z.enum(["template", "suggest", "record"]).optional().describe("Decision sub-action"),
      title: z.string().optional().describe("Decision title"),
      context: z.string().optional().describe("Decision context"),
      rationale: z.string().optional().describe("Decision rationale"),
      outcome: z.string().optional().describe("Decision outcome"),
      // Heal params
      healAction: z.enum(["check", "heal"]).optional().describe("Heal sub-action"),
      topic: z.string().optional().describe("Memory topic for session"),
      limit: z.number().min(1).max(100).optional().describe("Result limit"),
      target: z.string().optional().describe("File path for changes"),
      since: z.number().optional().describe("Timestamp filter for changes"),
      compact: z.boolean().optional().default(false).describe("Compact output mode"),
    },
    async (params) => {
      try {
        const text = await handleMemory({
          action: params.action,
          scope: params.scope,
          query: params.query,
          content: params.content,
          record: params.record,
          confidence: params.confidence,
          decisionAction: params.decisionAction,
          title: params.title,
          context: params.context,
          rationale: params.rationale,
          outcome: params.outcome,
          healAction: params.healAction,
          topic: params.topic,
          limit: params.limit,
          target: params.target,
          since: params.since,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_memory: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_safety — Safety & Policy (V3 Coarse-Grained)
  // ============================================================
  server.tool(
    "kuma_safety",
    "Safety checks, policy enforcement, and multi-agent coordination. Actions: guard (anti-pattern detection), check (pre-exec safety check), audit (query audit trail), lock (multi-agent file lock), health (project health score), override (logged bypass).",
    {
      action: z.enum(["guard", "check", "audit", "lock", "health", "override"]).describe("Safety action: guard=anti-patterns, check=pre-exec safety, audit=query trail, lock=multi-agent, health=score, override=logged bypass"),
      // Guard params
      guardGoal: z.string().optional().describe("Goal for guard check"),
      guardCheck: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().describe("Guard check type"),
      // Check params
      filePath: z.string().optional().describe("File path for check/lock"),
      command: z.string().optional().describe("Command for check"),
      // Audit params
      toolName: z.string().optional().describe("Filter audit by tool name"),
      riskLevel: z.string().optional().describe("Filter audit by risk level"),
      allowed: z.boolean().optional().describe("Filter audit by allowed/blocked"),
      limit: z.number().min(1).max(100).optional().describe("Audit result limit"),
      since: z.number().optional().describe("Timestamp filter for audit"),
      // Lock params
      lockAction: z.enum(["acquire", "release", "list", "clean"]).optional().describe("Lock sub-action"),
      lockFilePath: z.string().optional().describe("File path for lock acquire/release"),
      agentId: z.string().optional().describe("Agent ID for lock"),
      // Override params
      reason: z.string().optional().describe("Reason for safety override"),
      compact: z.boolean().optional().default(false).describe("Compact output mode"),
    },
    async (params) => {
      try {
        const text = await handleSafety({
          action: params.action,
          guardGoal: params.guardGoal,
          guardCheck: params.guardCheck,
          filePath: params.filePath,
          command: params.command,
          toolName: params.toolName,
          riskLevel: params.riskLevel,
          allowed: params.allowed,
          limit: params.limit,
          since: params.since,
          lockAction: params.lockAction,
          lockFilePath: params.lockFilePath,
          agentId: params.agentId,
          reason: params.reason,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_safety: ${err}` }], isError: true };
      }
    }
  );

  console.error("[Manifest] Registered 3 V3 coarse-grained tools (kuma_context, kuma_memory, kuma_safety).");
}

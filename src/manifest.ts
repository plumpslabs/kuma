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
      action: z.enum(["init", "research", "impact", "navigate", "changes", "health", "rollback", "researches"]).describe("Action: init=project brief, research=5-step research pipeline (REQUIRED before edits), impact=analyze change effects, navigate=trace code flow, changes=view change log, rollback=undo a change by ID, researches=list all cached research, health=project health score"),
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
    "Record and retrieve project knowledge. Actions: decision (ADR-style record/template/suggest), research_save (save research), session (session summary), heal (graph repair), search (search all), changes (change log), todo (persistent todo CRUD), context (inject context notes), benchmark (capture/diff metrics), decision_log (living document with status tracking).",
    {
      action: z.enum(["decision", "research_save", "session", "heal", "search", "changes", "todo", "context", "benchmark", "decision_log"]).describe("Memory action: decision=ADR, research_save=save, session=summary, heal=repair, search=search, changes=log, todo=manage todos, context=inject notes, benchmark=capture/diff, decision_log=manage decisions"),
      scope: z.string().optional().describe("Scope for research_save/search/todo/context"),
      query: z.string().optional().describe("Search query for search action"),
      content: z.string().optional().describe("Content/notes for research_save / context"),
      record: z.string().optional().describe("JSON record string for research_save"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
      // Decision params
      decisionAction: z.enum(["template", "suggest", "record"]).optional().describe("Decision sub-action"),
      title: z.string().optional().describe("Decision/todo/benchmark title"),
      context: z.string().optional().describe("Decision context"),
      rationale: z.string().optional().describe("Decision rationale"),
      outcome: z.string().optional().describe("Decision outcome"),
      // Heal params
      healAction: z.enum(["check", "heal"]).optional().describe("Heal sub-action"),
      topic: z.string().optional().describe("Memory topic for session"),
      limit: z.number().min(1).max(100).optional().describe("Result limit"),
      target: z.string().optional().describe("File path for changes / decision_log ID"),
      since: z.number().optional().describe("Timestamp filter for changes"),
      compact: z.boolean().optional().default(false).describe("Compact output mode"),
      // Todo params
      description: z.string().optional().describe("Todo description"),
      deps: z.string().optional().describe("Todo dependencies (JSON array)"),
      success_criteria: z.string().optional().describe("Todo success criteria"),
      status: z.string().optional().describe("Status for todo/decision_log"),
      todoId: z.number().optional().describe("Todo ID for status update"),
      // Context params
      source: z.string().optional().describe("Context source (e.g. 'slack', 'jira', 'meeting')"),
      // Benchmark params
      label: z.string().optional().describe("Benchmark label"),
      metrics: z.string().optional().describe("Benchmark metrics JSON"),
      labelB: z.string().optional().describe("Second benchmark label for diff"),
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
    "Safety checks, policy enforcement, security scanning, and project hygiene. Actions: guard (anti-pattern detection), check (pre-exec safety), audit (query trail), lock (multi-agent), health (score), security (scan for leaks), gc (garbage collection), doctor (health check), portability (path check), gitignore (auto-config), override (bypass).",
    {
      action: z.enum(["guard", "check", "audit", "lock", "health", "override", "security", "gc", "doctor", "portability", "gitignore"]).describe("Safety action: guard=anti-patterns, check=pre-exec safety, audit=query trail, lock=multi-agent, health=score, security=scan leaks, gc=garbage collect, doctor=health check, portability=paths, gitignore=config, override=bypass"),
      // Guard params
      guardGoal: z.string().optional().describe("Goal for guard check"),
      guardCheck: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().describe("Guard check type"),
      // Check params
      filePath: z.string().optional().describe("File path for check/lock/security scan"),
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

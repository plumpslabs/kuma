import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  handleInit,
  handleCore,
  handleVerify,
  handleSafety,
  handleGraph,
  handleMemory,
  handleAnalytics,
  handleHistory,
  handleLock,
  handleAdvanced,
} from "./engine/kumaRouter.js";
import { handlePreciseDiffEditor } from "./tools/preciseDiffEditor.js";
import { wrapWithSafety } from "./engine/kumaSafetyProxy.js";
import { formatOutput, buildCacheKey } from "./utils/kumaOutput.js";

/**
 * Wrapper: applies compact mode, adaptive compression, and dedup to all tool outputs.
 */
function wrapOutput(text: string, toolName: string, params: Record<string, unknown>): string {
  const compact = (params as any).compact === true;
  const responseBudget = (params as any).responseBudget as number | undefined;
  const cacheKey = buildCacheKey(toolName, params);
  return formatOutput(text, { compact, responseBudget, cacheKey });
}

/** Shared compact + responseBudget schema for all tools */
const compactSchema = {
  compact: z.boolean().optional().default(false).describe("Compact output mode (strips emojis/formatting, saves ~50% tokens)"),
  responseBudget: z.number().min(100).max(10000).optional().describe("Max tokens for response (auto-compresses if exceeded)"),
};

export function registerAllTools(server: McpServer): void {
  // ============================================================
  // kuma_init — Session initialization (Call FIRST)
  // ============================================================
  server.tool(
    "kuma_init",
    "**Call FIRST** every session. Loads project context: rules from .kuma/init.md, memories, conventions, structure. Actions: init, conventions, structure.",
    {
      action: z.enum(["init", "conventions", "structure"]).default("init").describe("Action: init=load all context, conventions=detect stack, structure=show tree"),
      projectRoot: z.string().optional().describe("Project root path (auto-detected)"),
      forceRescan: z.boolean().optional().default(false).describe("Force rescan for conventions"),
      depth: z.number().min(1).max(6).optional().default(3).describe("Tree depth for structure"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleInit(params.action || "init", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_init", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_init: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_core — Core editing tools
  // ============================================================
  const safeEditHandler = wrapWithSafety("precise_diff_editor", handlePreciseDiffEditor, {
    extractFilePath: (p) => (p as any).filePath,
  });

  server.tool(
    "kuma_core",
    "Core coding tools: grep (search), read (file), edit (search-and-replace), batch (create files), lsp (rename/reference).",
    {
      action: z.enum(["grep", "read", "edit", "batch", "lsp"]).describe("Action: grep=search code, read=open file, edit=edit with safety, batch=create files, lsp=semantic analysis"),
      // grep params
      query: z.string().optional().describe("Regex pattern for grep action"),
      targetFolder: z.string().optional().describe("Target folder for grep"),
      maxResults: z.number().min(1).max(100).optional().default(30).describe("Max results"),
      extensions: z.array(z.string()).optional().describe("File extensions filter"),
      // read params
      filePath: z.string().optional().describe("File path for read/edit/batch actions"),
      startLine: z.number().min(1).optional().describe("Start line (1-indexed) for read"),
      endLine: z.number().min(1).optional().describe("End line (1-indexed) for read"),
      chunkStrategy: z.enum(["full", "smart", "outline"]).optional().default("smart").describe("Read strategy"),
      // edit params
      edits: z.array(z.object({
        searchBlock: z.string().min(1).describe("Code to replace"),
        replaceBlock: z.string().describe("Replacement code"),
        allowMultiple: z.boolean().optional().default(false).describe("Allow multiple replacements"),
        fuzzyThreshold: z.number().min(0).max(1).optional().default(0.85).describe("Fuzzy threshold"),
      })).min(1).max(10).optional().describe("Array of edits (for edit action)"),
      dryRun: z.boolean().optional().default(false).describe("Preview without writing"),
      version: z.union([z.number().min(1), z.literal('list')]).optional().describe("Backup version for rollback"),
      scope: z.enum(['file', 'dir', 'edit-id', 'commit']).optional().describe("Rollback scope"),
      editId: z.string().optional().describe("Edit ID for rollback"),
      // batch params
      files: z.array(z.object({
        filePath: z.string().min(1).describe("File path"),
        content: z.string().describe("File content"),
        instructions: z.string().min(1).describe("Reason for creating"),
      })).min(1).max(15).optional().describe("Array of files (for batch action)"),
      // lsp params
      line: z.number().min(0).optional().describe("Line number (0-indexed) for LSP"),
      character: z.number().min(0).optional().describe("Character position (0-indexed) for LSP"),
      lspAction: z.enum(["def", "refs", "type", "rename"]).optional().describe("LSP sub-action"),
      newName: z.string().optional().describe("New name for rename action"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const action = params.action || "grep";
        if (action === "edit") {
          const text = await safeEditHandler(params as any);
          return { content: [{ type: "text", text: wrapOutput(text, "kuma_core", params) }] };
        }
        const text = await handleCore(action, params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_core", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_core: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_verify — Testing, review, linting
  // ============================================================
  server.tool(
    "kuma_verify",
    "Verify code quality after edits. Actions: test (run tests), review (code review), lint (static analysis).",
    {
      action: z.enum(["test", "review", "lint"]).describe("Action: test=run tests, review=code review, lint=static analysis"),
      // test params
      task: z.enum(["test", "build", "lint", "typecheck", "custom"]).optional().describe("Task for test action"),
      customCommand: z.string().optional().describe("Custom command for task='custom'"),
      timeout: z.number().min(5).max(180).optional().default(60).describe("Timeout in seconds"),
      cwd: z.string().optional().describe("Relative working directory"),
      workspace: z.string().optional().describe("Workspace name"),
      // review params
      files: z.array(z.string()).max(10).optional().describe("Files to review"),
      focus: z.enum(["correctness", "conventions", "security", "performance", "over-engineering"]).optional().default("correctness").describe("Review focus"),
      customCriteria: z.string().optional().describe("Custom review criteria"),
      format: z.enum(["text", "json"]).optional().default("text").describe("Output format"),
      // lint params
      tool: z.enum(["eslint", "tsc", "prettier", "ruff", "all"]).optional().default("all").describe("Lint tool"),
      autoFix: z.boolean().optional().default(false).describe("Auto-fix issues"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleVerify(params.action || "test", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_verify", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_verify: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_safety — Safety checks & risk prediction
  // ============================================================
  server.tool(
    "kuma_safety",
    "Safety & risk tools. Actions: guard (anti-patterns), score (0-100 health), check (pre-exec), policy (enforce rules), risk (impact analysis), dependency (guard), context (snapshots), audit (trail), stats, override.",
    {
      action: z.enum(["guard", "score", "check", "policy", "risk", "dependency", "context", "audit", "stats", "override"]).describe("Safety action to execute"),
      goal: z.string().optional().describe("Goal/context for guard/score"),
      filePath: z.string().optional().describe("File path for check/risk/policy"),
      symbol: z.string().optional().describe("Symbol name for risk analysis"),
      depth: z.number().min(1).max(5).optional().default(2).describe("Search depth for risk"),
      command: z.string().optional().describe("Command for check"),
      reason: z.string().optional().describe("Reason for override"),
      limit: z.number().min(1).max(100).optional().default(20).describe("Limit for audit/stats"),
      check: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().default("all").describe("Guard check type"),
      packageName: z.string().optional().describe("Package name for dependency guard"),
      packageVersion: z.string().optional().describe("Package version for dependency guard"),
      actionCheck: z.string().optional().describe("Check sub-action (e.g. 'edit')"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const action = params.action || "guard";
        const text = await handleSafety(action, {
          ...params,
          actionCheck: params.actionCheck || params.action,
          contextAction: (params as any).contextAction || (action === "context" ? "save" : undefined),
        });
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_safety", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_safety: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_graph — Knowledge graph navigation & queries
  // ============================================================
  server.tool(
    "kuma_graph",
    "Knowledge graph tools. Actions: query (nodes/edges/stats/search), navigate (flow), diagram (mermaid), investigate (auto-discover), arch (architecture), experience (patterns), intent (path suggestion).",
    {
      action: z.enum(["query", "navigate", "diagram", "investigate", "arch", "experience", "intent"]).describe("Graph action"),
      query: z.string().optional().describe("Search query for query/navigate"),
      type: z.string().optional().describe("Query type: nodes, edges, stats, search"),
      limit: z.number().min(1).max(100).optional().default(20).describe("Result limit"),
      problem: z.string().optional().describe("Problem description for investigate"),
      diagramType: z.enum(["architecture", "sequence", "impact", "ownership", "heatmap"]).optional().default("architecture").describe("Diagram type"),
      focus: z.string().optional().describe("Focus area for diagram"),
      archAction: z.enum(["capture", "diff", "diagram", "fs", "graph", "profiles"]).optional().describe("Architecture sub-action"),
      profile: z.string().optional().describe("Architecture profile name"),
      experienceAction: z.enum(["suggest", "errors", "prune"]).optional().describe("Experience sub-action"),
      toolName: z.string().optional().describe("Tool name for experience errors"),
      intentAction: z.enum(["suggest"]).optional().describe("Intent sub-action"),
      intent: z.string().optional().describe("Intent description"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleGraph(params.action || "query", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_graph", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_graph: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_memory — Session & persistent memory
  // ============================================================
  server.tool(
    "kuma_memory",
    "Memory & context tools. Actions: get (session summary), search (keywords), write (persist), decision (ADR), context (auto-context), heal (self-heal graph).",
    {
      action: z.enum(["get", "search", "write", "decision", "context", "heal"]).describe("Memory action"),
      topic: z.enum(["decisions", "glossary", "architecture", "conventions", "known-issues"]).optional().describe("Memory topic for get/write"),
      query: z.string().optional().describe("Search query for search action"),
      limit: z.number().min(1).max(100).optional().default(20).describe("Result limit for search/context"),
      content: z.string().optional().describe("Content for write action"),
      mode: z.enum(["append", "prepend", "overwrite"]).optional().default("append").describe("Write mode"),
      goal: z.string().optional().describe("Goal for context action"),
      decisionAction: z.enum(["template", "suggest", "record"]).optional().describe("Decision sub-action"),
      title: z.string().optional().describe("Decision title for record"),
      rationale: z.string().optional().describe("Decision rationale for record"),
      outcome: z.string().optional().describe("Decision outcome for record"),
      healAction: z.enum(["check", "heal"]).optional().default("heal").describe("Heal sub-action"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleMemory(params.action || "get", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_memory", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_memory: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_analytics — Session analytics & reflection
  // ============================================================
  server.tool(
    "kuma_analytics",
    "Session analytics & insights. Actions: reflect (on-track/off-track), analytics (stats), health (dashboard), replay (session), heatmap (activity), learn (patterns), predict (next), confidence (score), dna (project fingerprint).",
    {
      action: z.enum(["reflect", "analytics", "health", "replay", "heatmap", "learn", "predict", "confidence", "dna"]).describe("Analytics action"),
      goal: z.string().optional().describe("Goal for reflect"),
      context: z.string().optional().describe("Context for predict"),
      target: z.string().optional().describe("Target for confidence"),
      sessionStats: z.boolean().optional().default(false).describe("Include session stats in heatmap"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleAnalytics(params.action || "reflect", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_analytics", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_analytics: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_history — Git & code time machine
  // ============================================================
  server.tool(
    "kuma_history",
    "Code history & time machine. Actions: timeline (symbol evolution), log (commit history), diff (file changes).",
    {
      action: z.enum(["timeline", "log", "diff"]).describe("History action"),
      filePath: z.string().optional().describe("File path for timeline/log/diff"),
      symbol: z.string().optional().describe("Symbol name for timeline"),
      symbolType: z.enum(["function", "class", "interface", "type", "variable"]).optional().default("function").describe("Symbol type for timeline"),
      symbolAction: z.enum(["file", "symbol"]).optional().default("symbol").describe("Timeline scope"),
      maxCount: z.number().min(1).max(100).optional().default(10).describe("Max results"),
      staged: z.boolean().optional().default(false).describe("Show staged changes for diff"),
      contextLines: z.number().min(1).max(20).optional().default(3).describe("Context lines for diff"),
      baseRef: z.string().optional().describe("Base git ref for diff"),
      targetRef: z.string().optional().describe("Target git ref for diff"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleHistory(params.action || "log", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_history", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_history: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_lock — Multi-agent file locking
  // ============================================================
  server.tool(
    "kuma_lock",
    "Multi-agent coordination. Actions: acquire (lock file), release (unlock), list (show locks), clean (stale locks).",
    {
      action: z.enum(["acquire", "release", "list", "clean"]).describe("Lock action"),
      filePath: z.string().optional().describe("File path for acquire/release"),
      agentId: z.string().optional().describe("Agent identifier for lock"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleLock(params.action || "list", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_lock", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_lock: ${err}` }], isError: true };
      }
    }
  );

  // ============================================================
  // kuma_advanced — Maintenance & advanced features
  // ============================================================
  server.tool(
    "kuma_advanced",
    "Advanced & maintenance tools. Actions: failure (KB), compress (semantic), shadow (simulate), collective (VPS sync), marketplace (templates).",
    {
      action: z.enum(["failure", "compress", "shadow", "collective", "marketplace"]).describe("Advanced action"),
      // failure params
      failureAction: z.string().optional().describe("Failure sub-action: stats, query, record"),
      type: z.string().optional().describe("Error type for failure record"),
      errorMessage: z.string().optional().describe("Error message for failure record"),
      symbol: z.string().optional().describe("Symbol for failure record"),
      solution: z.string().optional().describe("Solution for failure record"),
      // shadow params
      shadowType: z.enum(["modify", "rename", "move", "add", "delete"]).optional().default("modify").describe("Shadow simulation type"),
      target: z.string().optional().describe("Target for shadow simulation"),
      newName: z.string().optional().describe("New name for shadow rename"),
      // collective params
      collectiveAction: z.enum(["sync", "discover", "export"]).optional().describe("Collective sub-action"),
      // marketplace params
      marketplaceAction: z.enum(["list", "install"]).optional().describe("Marketplace sub-action"),
      template: z.string().optional().describe("Template ID for marketplace install"),
      // query params
      query: z.string().optional().describe("Query for failure query"),
      ...compactSchema,
    },
    async (params) => {
      try {
        const text = await handleAdvanced(params.action || "marketplace", params);
        return { content: [{ type: "text", text: wrapOutput(text, "kuma_advanced", params) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_advanced: ${err}` }], isError: true };
      }
    }
  );

  console.error("[Manifest] Registered 10 grouped tools (consolidating 46+ operations).");
}

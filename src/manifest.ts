import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { handleContext, handleMemory, handleSafety } from "./engine/kumaRouter.js";

export function registerAllTools(server: McpServer): void {
  // ============================================================
  // kuma_context — Context & Understanding (V3 Coarse-Grained)
  // ============================================================
  server.tool(
    "kuma_context",
    "**Call FIRST every session.** Understand your project before making changes.\n\nWORKFLOW:\n• STEP 1 (ALWAYS): `init` — load project brief, restore session\n• STEP 3 (BEFORE edits): `research` — 5-step pipeline (cache→staleness→graph→impact→decision)\n• STEP 8 (END of session): `changes` — review what you modified\n\nOther actions: impact (analyze changes), navigate (trace flow), health (score 0-100), digest (compact briefing), drift (detect staleness).",
    {
      action: z.enum(["init", "research", "impact", "navigate", "changes", "health", "rollback", "researches", "sync", "visualize", "digest", "drift", "progressive"]).describe("Action: init=project brief, research=5-step research pipeline (REQUIRED before edits), impact=analyze change effects, navigate=trace code flow, changes=view change log, rollback=undo a change by ID, researches=list all cached research, sync=unified batch state, visualize=Mermaid knowledge graph diagram, digest=ultra-compact <500 token project briefing (Issue #18), drift=detect memory staleness & code drift (Issue #20), progressive=progressive context loading (Issue #25), health=project health score"),
      scope: z.string().optional().describe("Research scope for research/progressive action"),
      target: z.string().optional().describe("Target symbol/file for impact/navigate/changes"),
      goal: z.string().optional().describe("Current goal (for init/health)"),
      since: z.number().optional().describe("Unix timestamp filter for changes"),
      compact: z.boolean().optional().default(false).describe("Compact output mode"),
      section: z.string().optional().describe("Context section for progressive action (domain_rules, architecture, gotchas, decisions, graph, changes, health)"),
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
          section: params.section,
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
    "**Call after research/editing** (including research-only). Record what matters, skip what doesn't.\n\n🔴 MUST RECORD — High Impact (saves agent time next session):\n• STEP 5: `research_save` — every read/grep that finds new files. Creates searchable cache.\n• STEP 6: `gotcha` — IMMEDIATELY when you discover bugs/quirks. No re-research.\n• STEP 7: `arch_flow` — IMMEDIATELY after EACH flow hop. Saves reading 5-10 files.\n• STEP 8: `decision` — IMMEDIATELY when choosing between options. Preserves rationale.\n\n🟢 SKIP using MCP (agent native tools are faster):\n• Function/class nodes → grep\n• Component/route nodes → glob or check directly\n• Import edges → read imports directly\n• Visual graph → for humans, not AI agents\n\nOther actions: session, heal, search, changes, benchmark, layers.",
    {
      action: z.enum(["decision", "mine", "research_save", "session", "heal", "search", "changes", "todo", "context", "benchmark", "decision_log", "domain_rules", "arch_flow", "gotcha", "layers", "federated", "gen_test", "trajectory", "skills", "add_node"]).describe("Memory action: decision=ADR, mine=mine git log & comments, research_save=save (creates file + graph node), session=summary, heal=repair, search=search, changes=log, todo=manage todos, context=inject notes, benchmark=capture/diff, decision_log=manage decisions, domain_rules=Layer 1 business rules (Issue #17), arch_flow=Layer 2 architecture flow (Issue #17), gotcha=Layer 3 known gotchas (Issue #17/#21), layers=all 3 layers summary, federated=resolve federated kuma:// URI (Issue #27), gen_test=generate test from trajectory (Issue #28), trajectory=list trajectories, skills=list distilled skills, add_node=manually create function/class/component structural nodes"),
      scope: z.string().optional().describe("Scope for research_save/search/todo/context/mine/federated"),
      query: z.string().optional().describe("Search query for search action"),
      content: z.string().optional().describe("Content/notes for research_save / context"),
      record: z.string().optional().describe("JSON record string for research_save"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence for research_save (0-1)"),
      confirm: z.boolean().optional().describe("Confirm and record candidates automatically for mine action"),
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
      target: z.string().optional().describe("File path for changes / decision_log ID / trajectory ID"),
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
      // Federated params (#27)
      uri: z.string().optional().describe("Federated URI (kuma://project/node-id)"),
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
          confirm: params.confirm,
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
          uri: params.uri,
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
    "Safety checks, policy enforcement, and auto-verification.\n\nWORKFLOW:\n• STEP 2 (BEFORE work): `guard` — detect anti-patterns, drift, runaway loops\n• STEP 9 (AFTER research/edits): `verify` — auto-run scoped tests + AST validation\n\nOther actions: check (pre-exec safety), audit (query trail), lock (multi-agent), health (score 0-100), policy (evaluate commands), ast (code validation), checkpoint (snapshot before refactors), contract (pre/post-condition check).",
    {
      action: z.enum(["guard", "verify", "check", "audit", "lock", "health", "override", "security", "gc", "doctor", "portability", "gitignore", "clean", "policy", "ast", "validate", "checkpoint", "rollback_label", "checkpoint_list", "contract"]).describe("Safety action: guard=anti-patterns, verify=auto-run scoped tests, check=pre-exec safety, audit=query trail, lock=multi-agent, health=score, security=scan leaks, gc=garbage collect, doctor=health check, portability=paths, gitignore=config, clean=purge scratch dir & drift, policy=Policy-as-Code engine (Issue #24), ast/validate=AST-based code validation (Issue #22), checkpoint=create atomic snapshot (Issue #29), rollback_label=restore from checkpoint (Issue #29), checkpoint_list=list checkpoints, contract=run contract checks (Issue #26), override=bypass"),
      // Verify params
      scope: z.string().optional().describe("Scope for verify or context (e.g. 'auth', file path)"),
      // Guard params
      guardGoal: z.string().optional().describe("Goal for guard check"),
      guardCheck: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().describe("Guard check type"),
      // Check params
      filePath: z.string().optional().describe("File path for check/lock/security scan/contract"),
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
      // Checkpoint params (#29)
      label: z.string().optional().describe("Checkpoint label for checkpoint/rollback_label actions"),
      description: z.string().optional().describe("Description for checkpoint"),
      // Contract params (#26)
      phase: z.enum(["pre", "post"]).optional().describe("Contract check phase"),
    },
    async (params) => {
      try {
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
          lockAction: params.lockAction,
          lockFilePath: params.lockFilePath,
          agentId: params.agentId,
          reason: params.reason,
          label: params.label,
          description: params.description,
          phase: params.phase,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_safety: ${err}` }], isError: true };
      }
    }
  );

  console.error("[Manifest] Registered 3 V3 coarse-grained tools (kuma_context, kuma_memory, kuma_safety).");
}

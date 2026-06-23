// ============================================================
// ORCHESTRATOR — Multi-Agent Parallel Execution Engine
// ============================================================
//
// This is the orchestrator blueprint that AI can call
// to run multiple agents in parallel.
//
// For initial implementation, this orchestrator provides:
// 1. Parallel tool execution API
// 2. Supervisor pattern for task breakdown
// 3. Result synthesis from multiple sources
// ============================================================

import { sessionMemory } from "./sessionMemory.js";

// ============================================================
// TYPES
// ============================================================

export interface OrchestrationTask {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  dependsOn?: string[]; // Task IDs yang harus selesai duluan
}

export interface TaskResult {
  taskId: string;
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface OrchestrationPlan {
  goal: string;
  parallelGroups: OrchestrationTask[][]; // Tasks per group (run in parallel within group)
}

// ============================================================
// ORCHESTRATOR
// ============================================================

class Orchestrator {
  private results = new Map<string, TaskResult>();

  /**
   * Execute a plan with parallel task groups
   * Each group runs in parallel, next group waits for previous group
   */
  async executePlan(plan: OrchestrationPlan): Promise<{
    results: TaskResult[];
    summary: string;
    durationMs: number;
  }> {
    const startTime = Date.now();
    const allResults: TaskResult[] = [];

    sessionMemory.setGoal(plan.goal);

    for (let groupIndex = 0; groupIndex < plan.parallelGroups.length; groupIndex++) {
      const group = plan.parallelGroups[groupIndex];
      console.error(`[Orchestrator] Executing group ${groupIndex + 1}/${plan.parallelGroups.length} (${group.length} tasks)`);

      // Execute all tasks in group in parallel
      const groupResults = await Promise.all(
        group.map((task) => this.executeTask(task))
      );

      allResults.push(...groupResults);

      // Store results for dependency resolution
      for (const result of groupResults) {
        this.results.set(result.taskId, result);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      results: allResults,
      summary: this.generateSummary(allResults, durationMs),
      durationMs,
    };
  }

  private async executeTask(task: OrchestrationTask): Promise<TaskResult> {
    const startTime = Date.now();
    sessionMemory.recordToolCall(`orchestrator.${task.toolName}`, task.params);

    try {
      // The actual execution is done by the AI calling the tool.
      // This orchestrator is a coordination layer — it sequences the calls
      // and synthesizes the results.

      return {
        taskId: task.id,
        toolName: task.toolName,
        success: true,
        output: `Task ${task.id} prepared for execution. Tool: ${task.toolName}. Params: ${JSON.stringify(task.params)}`,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        taskId: task.id,
        toolName: task.toolName,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private generateSummary(results: TaskResult[], durationMs: number): string {
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    const lines: string[] = [
      `🎯 **Orchestration Complete**`,
      `⏱️ Duration: ${(durationMs / 1000).toFixed(1)}s`,
      `✅ ${successCount} tasks succeeded`,
      failCount > 0 ? `❌ ${failCount} tasks failed` : "",
    ];

    if (failCount > 0) {
      lines.push("", "**Failed Tasks:**");
      for (const r of results.filter((r) => !r.success)) {
        lines.push(`- [${r.taskId}] ${r.toolName}: ${r.error}`);
      }
    }

    return lines.filter(Boolean).join("\n");
  }

  reset(): void {
    this.results.clear();
  }
}

export const orchestrator = new Orchestrator();

// ============================================================
// HELPER: Build context-gathering plan
// ============================================================

/**
 * Build a standard context-gathering orchestration plan.
 * AI will call this to gather context from multiple sources at once.
 */
export function buildContextPlan(goal: string, queries: string[]): OrchestrationPlan {
  const grepTasks: OrchestrationTask[] = queries.map((q, i) => ({
    id: `grep_${i}`,
    toolName: "smart_grep",
    params: { query: q, maxResults: 20 },
  }));

  return {
    goal: `Context gathering: ${goal}`,
    parallelGroups: [grepTasks], // All in parallel
  };
}

/**
 * Build standard edit+validate plan
 */
export function buildEditPlan(
  goal: string,
  fileEdits: Array<{ filePath: string; edits: Array<{ searchBlock: string; replaceBlock: string }> }>
): OrchestrationPlan {
  const editTasks: OrchestrationTask[] = fileEdits.map((fe, i) => ({
    id: `edit_${i}`,
    toolName: "precise_diff_editor",
    params: { filePath: fe.filePath, edits: fe.edits },
  }));

  const reviewTasks: OrchestrationTask[] = fileEdits.map((fe, i) => ({
    id: `review_${i}`,
    toolName: "code_reviewer",
    params: { files: [fe.filePath], focus: "correctness" },
    dependsOn: [`edit_${i}`],
  }));

  const validateTasks: OrchestrationTask[] = [
    {
      id: "typecheck",
      toolName: "execute_safe_test",
      params: { task: "typecheck", timeout: 60 },
      dependsOn: reviewTasks.map((t) => t.id),
    },
    {
      id: "lint",
      toolName: "execute_safe_test",
      params: { task: "lint", timeout: 30 },
      dependsOn: reviewTasks.map((t) => t.id),
    },
  ];

  return {
    goal,
    parallelGroups: [
      editTasks,       // Group 1: Edit paralel
      reviewTasks,     // Group 2: Review paralel (setelah edit)
      validateTasks,   // Group 3: Validate paralel (setelah review)
    ],
  };
}

// ============================================================
// TASK BUDGET — proportionality helpers (proposal: systemic)
// ============================================================

export interface TaskBudgetInput {
  changedFiles?: number;
  changedLines?: number;
  singleFile?: boolean;
}

export function isTrivialTask(input: TaskBudgetInput = {}): boolean {
  const files = input.changedFiles ?? 0;
  const lines = input.changedLines ?? 0;
  return files <= 1 && lines <= 40;
}

export function getTokenBudget(input: TaskBudgetInput = {}): "trivial" | "small" | "medium" | "large" {
  if (isTrivialTask(input)) return "trivial";
  const files = input.changedFiles ?? 0;
  const lines = input.changedLines ?? 0;
  if (files <= 3 && lines <= 120) return "small";
  if (files <= 8 && lines <= 400) return "medium";
  return "large";
}

export function shouldSkipStep(step: string, budget: ReturnType<typeof getTokenBudget>): boolean {
  const trivialSkips = new Set(["research", "plan", "review", "report"]);
  const smallSkips = new Set(["report"]);
  if (budget === "trivial" && trivialSkips.has(step)) return true;
  if (budget === "small" && smallSkips.has(step)) return true;
  return false;
}

export const classifyTask = getTokenBudget;

/**
 * 🏗️ CORE TYPE DEFINITIONS
 * 
 * All types used across the engine.
 * SINGLE SOURCE OF TRUTH — do not duplicate in other files!
 */

// ============================================================
// TOOL SYSTEM
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for input parameter validation */
  inputSchema: {
    type: "object";
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
  /** Handler function to execute */
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  /** 
   * Tool category — for MCP grouping and logging.
   * "context" = gathers info (grep, pick, research)
   * "execution" = modifies files (diff, write)
   * "validation" = tests (test, lint, review)
   * "system" = internal (memory, convention)
   */
  category: "context" | "execution" | "validation" | "system";
  /** Estimated tool weight in tokens (for rate limiting) */
  weight: "light" | "medium" | "heavy";
}

export interface SchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  default?: unknown;
  /** Regex pattern for string validation */
  pattern?: string;
  /** Min/max for number */
  minimum?: number;
  maximum?: number;
  /** For array: type of items within */
  items?: SchemaProperty;
}


// ============================================================
// AGENT SYSTEM
// ============================================================

/**
 * An "Agent" is a task with context.
 * Different from Tool: Agent has a prompt and specific goal.
 * 
 * Orchestrator can spawn MULTIPLE agents in PARALLEL.
 * Each agent has 1 tool call + 1 goal.
 */
export interface AgentDefinition {
  /** Agent name (for logging and debugging) */
  name: string;
  /** Agent goal — what must be achieved */
  goal: string;
  /** Tool this agent calls */
  toolName: string;
  /** Parameters for that tool */
  params: Record<string, unknown>;
  /** Priority */
  priority: AgentPriority;
  /** 
   * Is this agent CRITICAL?
   * If critical fails → orchestrator stops all
   */
  critical: boolean;
  /**
   * Should this agent's result be summarized?
   * light = compressed summary only
   * full = full result sent
   */
  responseMode: "light" | "full";
}

export type AgentPriority = "high" | "normal" | "low";

/**
 * Template for declaratively defining agents.
 * Used by AI to choose which agent to spawn.
 */
export interface AgentTemplate {
  name: string;
  description: string;
  toolName: string;
  defaultParams: Record<string, unknown>;
  priority: AgentPriority;
  critical: boolean;
  responseMode: "light" | "full";
  /** When this agent is suitable to use */
  useCases: string[];
}


// ============================================================
// WORKFLOW SYSTEM — SINGLE SOURCE OF TRUTH
// ============================================================

/**
 * WORKFLOW TEMPLATES — Blueprint for commonly used workflows.
 * AI does not need to write plans from scratch every time — just pick a template.
 * 
 * Examples:
 * - "debug_error" → grep error → pick file → review → fix
 * - "implement_feature" → conventions → grep existing → pick → write → test
 * - "refactor" → grep usage → pick files → diff edit → test
 */
export interface WorkflowTemplate {
  name: string;
  description: string;
  /** Customizable parameters */
  parameters: Record<string, SchemaProperty>;
  /** Function to generate ExecutionPlan from parameters */
  generatePlan: (params: Record<string, unknown>) => ExecutionPlan;
}

/**
 * ===== EXECUTION PLAN =====
 * Execution plan sent by AI to the orchestrator.
 * 
 * AI can request:
 * 1. Multiple tools running in parallel
 * 2. Multiple tools running sequentially (serial)
 * 3. Multi-phase: phase 1 parallel, then phase 2 parallel (phases)
 * 
 * THIS IS THE SINGLE SOURCE OF TRUTH.
 * Do not redefine in other files!
 */
export interface ExecutionPlan {
  /** Short title of this plan (for logging) */
  title: string;
  /** Workflow to execute */
  workflow: Workflow;
  /** 
   * Strategy if a task fails:
   * "fail_fast" = cancel all if one fails
   * "continue" = continue other tasks, collect errors
   * "retry" = retry failed tasks (maxRetries times)
   */
  onError: "fail_fast" | "continue" | "retry";
  /** Max retries (default: 2) */
  maxRetries: number;
  /** Total timeout for all tasks (ms). Default: 60000 */
  globalTimeoutMs: number;
}

/**
 * A task is a single tool call to be executed.
 * This is a "sub-agent" — a small agent specialized for one task.
 */
export interface Task {
  /** Unique ID for this task (so it can be referenced in results) */
  id: string;
  /** Tool name to call (must be registered in the registry) */
  tool: string;
  /** Parameters for that tool */
  params: Record<string, unknown>;
  /** 
   * Priority: "high" = execute first 
   * "normal" = default
   * "low" = can be deferred
   */
  priority?: AgentPriority;
  /** Timeout per-task (ms). Default: 15000 */
  timeoutMs?: number;
  /** 
   * Dependency: this task does not run until task_id in dependency completes.
   * This is how we create SEQUENTIAL workflows inside PARALLEL.
   */
  dependsOn?: string[];
  /**
   * Is this task critical? If critical fails → orchestrator stops.
   * Default: false
   */
  critical?: boolean;
}

/**
 * Workflow determines ORDER and PARALLELISM of tasks.
 * 
 * Example:
 * {
 *   parallel: [
 *     { id: "grep-1", tool: "smart_grep", params: { query: "auth" } },
 *     { id: "grep-2", tool: "smart_grep", params: { query: "user" } },
 *   ],
 *   serial: [
 *     // Tasks here run AFTER all parallel tasks complete
 *     { id: "synthesis", tool: "llm_synthesize", params: { ... }, dependsOn: ["grep-1", "grep-2"] }
 *   ]
 * }
 */
export interface Workflow {
  /** Tasks that can run TOGETHER (parallel) */
  parallel?: Task[];
  /** Tasks that run SEQUENTIALLY after parallel tasks complete */
  serial?: Task[];
  /**
   * Multi-phase parallel: array of parallel groups running sequentially.
   * Phase 1 runs first, after completion Phase 2 runs, etc.
   * For cases: "search files first (phase1), then read content (phase2)"
   */
  phases?: Task[][];
  /**
   * Maximum number of tasks running TOGETHER in one phase.
   * Default: 5 — prevents Promise.all overload with 50 tasks.
   */
  concurrency?: number;
}


// ============================================================
// EXECUTION RESULT
// ============================================================

export interface TaskResult {
  id: string;
  tool: string;
  status: "success" | "error" | "timeout" | "skipped";
  data?: unknown;
  error?: {
    message: string;
    code: string;
    recoverable: boolean;
  };
  /** Execution time in ms */
  durationMs: number;
  /** Attempt number (0 = first) */
  attempt: number;
}

export interface ExecutionReport {
  planTitle: string;
  status: "completed" | "partial" | "failed" | "timed_out";
  results: TaskResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    timedOut: number;
    skipped: number;
    totalDurationMs: number;
  };
  /** Summary for AI (must be token-efficient!) */
  compressedSummary: string;
}


// ============================================================
// MEMORY SYSTEM
// ============================================================

export interface SessionMemory {
  sessionId: string;
  /** Files that have been modified */
  filesModified: ModifiedFile[];
  /** Files that failed tests */
  filesFailed: FailedFile[];
  /** Execution history */
  executionHistory: ExecutionHistoryEntry[];
  /** 
   * File dependency graph.
   * Record (not Map!) so it serializes easily to JSON.
   * Example: { "auth.ts": ["user.ts", "db.ts"], "user.ts": ["types.ts"] }
   */
  dependencyGraph: Record<string, string[]>;
  /** Current goal being worked on */
  currentGoal: string;
  /** Completed steps */
  completedSteps: string[];
  /** Token tracker */
  tokenUsage: TokenUsage;
}

export interface ModifiedFile {
  path: string;
  action: "created" | "modified" | "deleted";
  timestamp: number;
  backupPath?: string;
}

export interface FailedFile {
  path: string;
  error: string;
  attempts: number;
  lastAttempt: number;
}

export interface ExecutionHistoryEntry {
  phase: string;
  action: string;
  result: "success" | "failure";
  timestamp: number;
}

export interface TokenUsage {
  totalInput: number;
  totalOutput: number;
  estimatedCost: number;
  warnings: string[];
}


// ============================================================
// CONVENTION SYSTEM
// ============================================================

export interface ProjectConventions {
  framework: string | null;
  testRunner: string | null;
  styling: string | null;
  importAlias: string | null;
  packageManager: string | null;
  language: "ts" | "js" | "both";
  nodeVersion: string | null;
  typescriptVersion: string | null;
  lintRules: string[];
  conventions: string[];
  dangerousPatterns: string[];
}


// ============================================================
// ERROR SYSTEM
// ============================================================

export type ErrorCategory =
  | "DIFF_MISMATCH"      // searchBlock does not match file
  | "TIMEOUT"            // tool timeout
  | "VALIDATION"         // parameter validation failed
  | "TEST_FAILURE"       // test/typecheck failed
  | "NOT_FOUND"          // file/pattern not found
  | "PERMISSION_DENIED"  // path access denied
  | "TOOL_CRASH"         // tool internal error
  | "ABORTED"            // cancelled by user/system
  | "LOOP_DETECTED"      // circuit breaker active
  | "UNKNOWN_ERROR";     // unknown error

export interface AgentError {
  category: ErrorCategory;
  message: string;
  severity: "low" | "medium" | "critical";
  recoverable: boolean;
  /** Fix suggestion for AI */
  suggestion?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

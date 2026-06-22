/**
 * 🏗️ CORE TYPE DEFINITIONS
 * 
 * Semua tipe yang dipake di seluruh engine.
 * SINGLE SOURCE OF TRUTH — jangan duplikasi di file lain!
 */

// ============================================================
// TOOL SYSTEM
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema untuk validasi parameter input */
  inputSchema: {
    type: "object";
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
  /** Fungsi handler yang dieksekusi */
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  /** 
   * Kategori tool — untuk grouping di MCP dan logging.
   * "context" = ngumpulin info (grep, pick, research)
   * "execution" = ngeubah file (diff, write)
   * "validation" = ngetes (test, lint, review)
   * "system" = internal (memory, convention)
   */
  category: "context" | "execution" | "validation" | "system";
  /** Estimasi berat tool dalam token (untuk rate limiting) */
  weight: "light" | "medium" | "heavy";
}

export interface SchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  default?: unknown;
  /** Regex pattern untuk validasi string */
  pattern?: string;
  /** Min/max untuk number */
  minimum?: number;
  maximum?: number;
  /** Untuk array: tipe item di dalamnya */
  items?: SchemaProperty;
}


// ============================================================
// AGENT SYSTEM
// ============================================================

/**
 * Sebuah "Agent" adalah task dengan konteks.
 * Beda dari Tool: Agent punya prompt dan tujuan spesifik.
 * 
 * Orchestrator bisa spawn MULTIPLE agents secara PARALLEL.
 * Setiap agent punya 1 tool call + 1 tujuan.
 */
export interface AgentDefinition {
  /** Nama agent (untuk logging dan debugging) */
  name: string;
  /** Tujuan agent — apa yang harus dicapai */
  goal: string;
  /** Tool yang dipanggil agent ini */
  toolName: string;
  /** Parameter untuk tool tersebut */
  params: Record<string, unknown>;
  /** Prioritas */
  priority: AgentPriority;
  /** 
   * Apakah agent ini WAJIB berhasil?
   * Kalau critical gagal → orchestrator stop semua
   */
  critical: boolean;
  /**
   * Apakah hasil agent ini perlu di-summarize?
   * light = compressed summary only
   * full = full result dikirim
   */
  responseMode: "light" | "full";
}

export type AgentPriority = "high" | "normal" | "low";

/**
 * Template untuk mendefinisikan agent secara deklaratif.
 * Ini yang dipake AI untuk milih agent apa yang mau di-spawn.
 */
export interface AgentTemplate {
  name: string;
  description: string;
  toolName: string;
  defaultParams: Record<string, unknown>;
  priority: AgentPriority;
  critical: boolean;
  responseMode: "light" | "full";
  /** Kapan agent ini cocok dipake */
  useCases: string[];
}


// ============================================================
// WORKFLOW SYSTEM — SINGLE SOURCE OF TRUTH
// ============================================================

/**
 * WORKFLOW TEMPLATES — Blueprint untuk workflow yang sering dipake.
 * AI gak perlu nulis plan dari nol setiap kali — tinggal pilih template.
 * 
 * Contoh:
 * - "debug_error" → grep error → pick file → review → fix
 * - "implement_feature" → conventions → grep existing → pick → write → test
 * - "refactor" → grep usage → pick files → diff edit → test
 */
export interface WorkflowTemplate {
  name: string;
  description: string;
  /** Parameter yang bisa dikustomisasi */
  parameters: Record<string, SchemaProperty>;
  /** Fungsi untuk generate ExecutionPlan dari parameter */
  generatePlan: (params: Record<string, unknown>) => ExecutionPlan;
}

/**
 * ===== EXECUTION PLAN =====
 * Rencana eksekusi yang dikirim oleh AI ke orchestrator.
 * 
 * AI bisa request:
 * 1. Beberapa tools jalan parallel (parallel)
 * 2. Beberapa tools jalan berurutan (serial)
 * 3. Multi-phase: phase 1 parallel, lalu phase 2 parallel (phases)
 * 
 * INI ADALAH SINGLE SOURCE OF TRUTH.
 * Jangan definisikan ulang di file lain!
 */
export interface ExecutionPlan {
  /** Judul singkat dari rencana ini (untuk logging) */
  title: string;
  /** Workflow yang akan dieksekusi */
  workflow: Workflow;
  /** 
   * Strategi jika ada task yang gagal:
   * "fail_fast" = batalkan semua kalau ada satu gagal
   * "continue" = lanjutkan task lain, kumpulin error
   * "retry" = coba ulang task yang gagal (maxRetries kali)
   */
  onError: "fail_fast" | "continue" | "retry";
  /** Maks percobaan ulang (default: 2) */
  maxRetries: number;
  /** Timeout total untuk semua task (ms). Default: 60000 */
  globalTimeoutMs: number;
}

/**
 * Sebuah task adalah satu panggilan tool yang akan dieksekusi.
 * Ini adalah "sub-agent" — agent kecil yang specialized untuk satu tugas.
 */
export interface Task {
  /** ID unik untuk task ini (biar bisa di-refer di result) */
  id: string;
  /** Nama tool yang mau dipanggil (harus terdaftar di registry) */
  tool: string;
  /** Parameter untuk tool tersebut */
  params: Record<string, unknown>;
  /** 
   * Priority: "high" = eksekusi duluan 
   * "normal" = default
   * "low" = boleh ditunda
   */
  priority?: AgentPriority;
  /** Timeout per-task (ms). Default: 15000 */
  timeoutMs?: number;
  /** 
   * Dependency: task ini gak jalan sampe task_id di dependency selesai.
   * Ini yang bikin kita bisa bikin workflow SEQUENTIAL di dalam PARALLEL.
   */
  dependsOn?: string[];
  /**
   * Apakah task ini critical? Kalau critical gagal → orchestrator stop.
   * Default: false
   */
  critical?: boolean;
}

/**
 * Workflow menentukan URUTAN dan PARALELITAS dari tasks.
 * 
 * Contoh:
 * {
 *   parallel: [
 *     { id: "grep-1", tool: "smart_grep", params: { query: "auth" } },
 *     { id: "grep-2", tool: "smart_grep", params: { query: "user" } },
 *   ],
 *   serial: [
 *     // Task di sini jalan SETELAH semua parallel selesai
 *     { id: "synthesis", tool: "llm_synthesize", params: { ... }, dependsOn: ["grep-1", "grep-2"] }
 *   ]
 * }
 */
export interface Workflow {
  /** Task-task yang bisa jalan BERSAMAAN (parallel) */
  parallel?: Task[];
  /** Task-task yang jalan BERURUTAN setelah parallel selesai */
  serial?: Task[];
  /**
   * Multi-phase parallel: array of parallel groups yang jalan berurutan.
   * Phase 1 jalan duluan, setelah selesai Phase 2 jalan, dst.
   * Ini untuk kasus: "cari file dulu (phase1), baru baca isinya (phase2)"
   */
  phases?: Task[][];
  /**
   * Maksimal jumlah task yang jalan BERSAMAAN dalam satu phase.
   * Default: 5 — mencegah overload Promise.all dengan 50 task.
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
  /** Waktu eksekusi dalam ms */
  durationMs: number;
  /** Percobaan ke berapa (0 = pertama) */
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
  /** Ringkasan untuk AI (harus hemat token!) */
  compressedSummary: string;
}


// ============================================================
// MEMORY SYSTEM
// ============================================================

export interface SessionMemory {
  sessionId: string;
  /** File yang udah diubah */
  filesModified: ModifiedFile[];
  /** File yang gagal test */
  filesFailed: FailedFile[];
  /** History eksekusi */
  executionHistory: ExecutionHistoryEntry[];
  /** 
   * Graph dependency antar file.
   * Record (bukan Map!) biar gampang di-serialize ke JSON.
   * Contoh: { "auth.ts": ["user.ts", "db.ts"], "user.ts": ["types.ts"] }
   */
  dependencyGraph: Record<string, string[]>;
  /** Goal yang sedang dikerjakan */
  currentGoal: string;
  /** Langkah-langkah yang udah selesai */
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
  | "DIFF_MISMATCH"      // searchBlock gak cocok di file
  | "TIMEOUT"            // tool timeout
  | "VALIDATION"         // parameter validation gagal
  | "TEST_FAILURE"       // test/typecheck gagal
  | "NOT_FOUND"          // file/pattern gak ditemukan
  | "PERMISSION_DENIED"  // akses path dilarang
  | "TOOL_CRASH"         // tool internal error
  | "ABORTED"            // dibatalkan user/system
  | "LOOP_DETECTED"      // circuit breaker aktif
  | "UNKNOWN_ERROR";     // error gak dikenal

export interface AgentError {
  category: ErrorCategory;
  message: string;
  severity: "low" | "medium" | "critical";
  recoverable: boolean;
  /** Saran perbaikan untuk AI */
  suggestion?: string;
  /** Konteks tambahan */
  context?: Record<string, unknown>;
}

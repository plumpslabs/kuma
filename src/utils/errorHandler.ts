// ============================================================
// ERROR CLASSIFICATION SYSTEM
// ============================================================

export type ErrorType =
  | "DIFF_MISMATCH"      // searchBlock gak cocok di file
  | "TIMEOUT"            // tool/command timeout
  | "VALIDATION"         // path/param validation gagal
  | "TEST_FAILURE"       // test/typecheck/lint gagal
  | "HALLUCINATION"      // AI ngaco (detected by reviewer)
  | "LOOP_DETECTED"      // Same action repeated >3x
  | "FILE_NOT_FOUND"     // File tidak ditemukan
  | "PATH_TRAVERSAL"     // Mencoba akses file di luar proyek
  | "COMMAND_FAILED"     // Terminal command gagal
  | "UNKNOWN"            // Error tidak dikenal
  | "TOOL_MISUSE";       // Tool dipanggil dengan argumen salah

export type SeverityLevel = "low" | "medium" | "critical";

export interface ToolError {
  type: ErrorType;
  severity: SeverityLevel;
  message: string;
  details?: string;
  filePath?: string;
  timestamp: Date;
  attemptCount?: number;
}

export interface RecoveryStep {
  action: string;
  description: string;
}

export interface RecoveryStrategy {
  type: ErrorType;
  severity: SeverityLevel;
  steps: RecoveryStep[];
  maxAttempts: number;
  notifyUser: boolean;
}

// ============================================================
// RECOVERY STRATEGIES
// ============================================================

export const RECOVERY_STRATEGIES: Record<ErrorType, RecoveryStrategy> = {
  DIFF_MISMATCH: {
    type: "DIFF_MISMATCH",
    severity: "low",
    steps: [
      { action: "read_file", description: "Baca ulang file untuk dapet konten real" },
      { action: "normalize_whitespace", description: "Coba compare tanpa whitespace" },
      { action: "fuzzy_match", description: "Levenshtein distance matching" },
      { action: "report_specific_diff", description: "Kirim error detail ke AI: baris terdekat, perbedaan" },
    ],
    maxAttempts: 3,
    notifyUser: false,
  },

  TIMEOUT: {
    type: "TIMEOUT",
    severity: "medium",
    steps: [
      { action: "kill_process_tree", description: "Matiin semua child process" },
      { action: "increase_timeout", description: "Coba lagi dengan timeout 2x lipat" },
      { action: "simplify_command", description: "Coba dengan versi lebih sederhana" },
    ],
    maxAttempts: 2,
    notifyUser: true,
  },

  VALIDATION: {
    type: "VALIDATION",
    severity: "low",
    steps: [
      { action: "check_param_types", description: "Cek tiap parameter sesuai schema" },
      { action: "fix_param_format", description: "Perbaiki format parameter" },
      { action: "retry_with_fixed_params", description: "Coba panggil ulang dengan parameter bener" },
    ],
    maxAttempts: 3,
    notifyUser: false,
  },

  TEST_FAILURE: {
    type: "TEST_FAILURE",
    severity: "medium",
    steps: [
      { action: "read_error_log", description: "Baca stdout/stderr dari test" },
      { action: "identify_failing_file", description: "Cari file spesifik yang error" },
      { action: "fix_code", description: "Perbaiki kode berdasarkan error" },
      { action: "retry_test", description: "Jalankan test ulang" },
    ],
    maxAttempts: 3,
    notifyUser: false,
  },

  HALLUCINATION: {
    type: "HALLUCINATION",
    severity: "critical",
    steps: [
      { action: "read_actual_file", description: "Baca file beneran, bukan dari ingatan" },
      { action: "verify_imports_exist", description: "Cek library yang dipake beneran ada" },
      { action: "rewrite_with_correct_info", description: "Tulis ulang dengan informasi real" },
    ],
    maxAttempts: 2,
    notifyUser: true,
  },

  LOOP_DETECTED: {
    type: "LOOP_DETECTED",
    severity: "critical",
    steps: [
      { action: "circuit_breaker", description: "Hentikan eksekusi" },
      { action: "inject_warning", description: "Inject warning ke AI: 'Kamu looping. Coba pendekatan beda'" },
      { action: "suggest_alternative", description: "Saran: baca doc, cari pattern beda, atau lapor user" },
    ],
    maxAttempts: 1,
    notifyUser: true,
  },

  FILE_NOT_FOUND: {
    type: "FILE_NOT_FOUND",
    severity: "low",
    steps: [
      { action: "suggest_similar_files", description: "Cari file dengan nama mirip" },
      { action: "list_directory", description: "List isi direktori untuk bantu AI" },
      { action: "retry_with_correct_path", description: "Coba dengan path yang bener" },
    ],
    maxAttempts: 2,
    notifyUser: false,
  },

  PATH_TRAVERSAL: {
    type: "PATH_TRAVERSAL",
    severity: "critical",
    steps: [
      { action: "block_immediately", description: "Blokir akses dan log attempt" },
      { action: "warn_ai", description: "Peringatkan AI: akses dilarang" },
      { action: "suggest_allowed_path", description: "Saran path yang diizinkan" },
    ],
    maxAttempts: 1,
    notifyUser: true,
  },

  COMMAND_FAILED: {
    type: "COMMAND_FAILED",
    severity: "medium",
    steps: [
      { action: "read_stderr", description: "Baca error output dari command" },
      { action: "check_command_exists", description: "Cek apakah command terinstall" },
      { action: "retry_with_fallback", description: "Coba dengan alternatif command" },
    ],
    maxAttempts: 2,
    notifyUser: false,
  },

  TOOL_MISUSE: {
    type: "TOOL_MISUSE",
    severity: "low",
    steps: [
      { action: "validate_parameters", description: "Cek parameter sesuai skema" },
      { action: "show_correct_usage", description: "Tampilkan contoh penggunaan yang benar" },
      { action: "retry_with_correct_params", description: "Coba ulang dengan parameter benar" },
    ],
    maxAttempts: 3,
    notifyUser: false,
  },

  UNKNOWN: {
    type: "UNKNOWN",
    severity: "medium",
    steps: [
      { action: "log_error", description: "Log error detail ke file" },
      { action: "report_to_ai", description: "Kirim error ke AI untuk analisis" },
      { action: "suggest_workaround", description: "Saran pendekatan alternatif" },
    ],
    maxAttempts: 2,
    notifyUser: true,
  },
};

// ============================================================
// ERROR CLASSIFIER
// ============================================================

export function classifyError(
  message: string,
  context?: {
    toolName?: string;
    params?: Record<string, unknown>;
    errorCode?: number;
    filePath?: string;
  }
): ToolError {
  const lowerMsg = message.toLowerCase();

  // Path traversal
  if (
    lowerMsg.includes("..") ||
    lowerMsg.includes("outside project") ||
    lowerMsg.includes("path traversal") ||
    lowerMsg.includes("unauthorized path")
  ) {
    return createError("PATH_TRAVERSAL", "Mencoba akses direktori di luar proyek", message, context);
  }

  // Diff mismatch
  if (
    lowerMsg.includes("searchblock") ||
    lowerMsg.includes("not found") ||
    lowerMsg.includes("no match") ||
    lowerMsg.includes("diff mismatch")
  ) {
    return createError("DIFF_MISMATCH", "searchBlock tidak cocok dengan isi file", message, context);
  }

  // Timeout
  if (
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("timed out") ||
    lowerMsg.includes("etimedout")
  ) {
    return createError("TIMEOUT", "Tool/command timeout", message, context);
  }

  // Validation
  if (
    lowerMsg.includes("validation") ||
    lowerMsg.includes("invalid") ||
    lowerMsg.includes("schema") ||
    lowerMsg.includes("zod")
  ) {
    return createError("VALIDATION", "Validasi parameter gagal", message, context);
  }

  // File not found
  if (
    lowerMsg.includes("enoent") ||
    lowerMsg.includes("not found") ||
    lowerMsg.includes("no such file") ||
    lowerMsg.includes("file doesn't exist")
  ) {
    return createError("FILE_NOT_FOUND", "File tidak ditemukan", message, context);
  }

  // Loop detection
  if (context?.toolName && context?.params) {
    // Ini akan di-handle oleh circuit breaker logic
    // Tapi kita klasifikasiin aja
    return createError("LOOP_DETECTED", "Detected repeated tool call", message, context);
  }

  // Default: unknown
  return createError("UNKNOWN", message, message, context);
}

function createError(
  type: ErrorType,
  message: string,
  details?: string,
  context?: { filePath?: string }
): ToolError {
  return {
    type,
    severity: RECOVERY_STRATEGIES[type].severity,
    message,
    details,
    filePath: context?.filePath,
    timestamp: new Date(),
    attemptCount: 0,
  };
}

// ============================================================
// CIRCUIT BREAKER
// ============================================================

interface CircuitBreakerState {
  toolName: string;
  attemptCount: number;
  lastAttempt: Date | null;
  lastParams: string; // JSON stringified params for comparison
  isOpen: boolean;    // Circuit open = stop all attempts
}

class CircuitBreakerStore {
  private store = new Map<string, CircuitBreakerState>();
  private readonly MAX_ATTEMPTS = 3;
  private readonly RESET_TIMEOUT_MS = 60000; // Reset after 1 min

  check(toolName: string, params: Record<string, unknown>): { allowed: boolean; reason?: string } {
    const key = this.makeKey(toolName, params);
    const state = this.store.get(key);

    if (!state) {
      // First attempt
      this.store.set(key, {
        toolName,
        attemptCount: 1,
        lastAttempt: new Date(),
        lastParams: JSON.stringify(params),
        isOpen: false,
      });
      return { allowed: true };
    }

    // Check if circuit is open
    if (state.isOpen) {
      // Check if enough time has passed to reset
      if (state.lastAttempt && (Date.now() - state.lastAttempt.getTime()) > this.RESET_TIMEOUT_MS) {
        this.store.delete(key);
        return { allowed: true };
      }
      return { allowed: false, reason: `Circuit breaker open for ${toolName} after ${state.attemptCount} attempts. Reset in ${Math.ceil((this.RESET_TIMEOUT_MS - (Date.now() - state.lastAttempt!.getTime())) / 1000)}s` };
    }

    // Increment attempt count
    state.attemptCount++;
    state.lastAttempt = new Date();

    if (state.attemptCount >= this.MAX_ATTEMPTS) {
      state.isOpen = true;
      return { allowed: false, reason: `Circuit breaker TRIPPED for ${toolName} after ${state.attemptCount} identical attempts. Trying same approach again won't work.` };
    }

    return { allowed: true };
  }

  reset(toolName: string): void {
    for (const [key, state] of this.store.entries()) {
      if (state.toolName === toolName) {
        this.store.delete(key);
      }
    }
  }

  private makeKey(toolName: string, params: Record<string, unknown>): string {
    // Simplify params to detect similar patterns
    const simplified = { ...params };
    // Hapus field yang gak relevan buat loop detection
    delete (simplified as Record<string, unknown>).timestamp;
    return `${toolName}:${JSON.stringify(simplified)}`;
  }

  getAttemptCount(toolName: string, params: Record<string, unknown>): number {
    const key = this.makeKey(toolName, params);
    return this.store.get(key)?.attemptCount ?? 0;
  }
}

export const circuitBreaker = new CircuitBreakerStore();

// ============================================================
// ERROR FORMATTER — Untuk dikirim ke AI
// ============================================================

export function formatErrorForAI(error: ToolError, recoverySteps?: RecoveryStep[]): string {
  const steps = recoverySteps ?? RECOVERY_STRATEGIES[error.type].steps;

  return [
    `**Error [${error.type}]** (${error.severity.toUpperCase()})`,
    `📝 ${error.message}`,
    error.details ? `\`\`\`\n${error.details}\n\`\`\`` : "",
    error.filePath ? `📍 File: \`${error.filePath}\`` : "",
    "",
    "**🔄 Recovery Steps:**",
    ...steps.map((s, i) => `${i + 1}. **${s.action}**: ${s.description}`),
    "",
    error.severity === "critical"
      ? "⚠️ **This error needs attention. Consider asking the user for guidance.**"
      : "💡 **Try the recovery steps above.**",
  ]
    .filter(Boolean)
    .join("\n");
}

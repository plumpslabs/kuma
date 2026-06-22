import { spawn } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { circuitBreaker } from "../utils/errorHandler.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// SAFE TERMINAL EXEC — Eksekutor terminal aman
// ============================================================

interface TerminalExecParams {
  task: "test" | "build" | "lint" | "typecheck" | "custom";
  customCommand?: string;
  timeout?: number;
}

// Map tugas ke command
const TASK_COMMANDS: Record<string, string> = {
  test: "npm test",
  build: "npm run build",
  lint: "npm run lint",
  typecheck: "npx tsc --noEmit",
};

const DANGEROUS_PATTERNS = [
  "rm -rf",
  "rm -fr",
  "del /f",
  "rd /s",
  "rmdir /s",
  "git push",
  "git commit",
  "npm publish",
  "npx publish",
  "yarn publish",
  "pnpm publish",
  "> /dev/sda",
  "format",
  "mkfs",
  "dd if=",
  ":(){ :|:& };:", // fork bomb
  "curl ",
  "wget ",
];

export async function handleSafeTerminalExec(params: TerminalExecParams): Promise<string> {
  const { task, customCommand, timeout = 30 } = params;

  // Validate task
  if (task === "custom" && !customCommand) {
    return "Error: Task 'custom' membutuhkan parameter 'customCommand'.";
  }

  // Build command
  let command: string;
  if (task === "custom") {
    command = customCommand!;
  } else {
    command = TASK_COMMANDS[task];
  }

  // Check circuit breaker
  const cbResult = circuitBreaker.check("safe_terminal_exec", { task, command });
  if (!cbResult.allowed) {
    return `⚠️ Circuit breaker: ${cbResult.reason}\n\nCoba perbaiki kode dulu sebelum menjalankan task lagi.`;
  }

  // Check dangerous patterns
  const dangerousPattern = DANGEROUS_PATTERNS.find((p) => command.toLowerCase().includes(p.toLowerCase()));
  if (dangerousPattern) {
    return `🚫 BLOCKED: Command mengandung pola berbahaya "${dangerousPattern}".\nPerintah ini tidak diizinkan demi keamanan.`;
  }

  const projectRoot = getProjectRoot();

  try {
    sessionMemory.recordToolCall("execute_safe_test", { task, command });

    // Execute with timeout
    const result = await executeWithTimeout(command, projectRoot, timeout);

    // Format output
    const output = formatExecResult(result, command, task);

    // Record success/failure
    if (result.exitCode !== 0) {
      sessionMemory.addFailedFile(task, result.stderr || result.stdout);
    }

    return output;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMsg.toLowerCase().includes("timeout");

    if (isTimeout) {
      return formatTimeoutResult(command, timeout);
    }

    return `Error saat menjalankan "${command}": ${errorMsg}`;
  }
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

async function executeWithTimeout(
  command: string,
  cwd: string,
  timeoutSeconds: number
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const parts = command.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      cwd,
      shell: process.platform === "win32", // Use shell on Windows
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutSeconds * 1000,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Timeout handler
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");

      // Also kill process tree on Windows
      if (process.platform === "win32") {
        try {
          spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" });
        } catch {
          // Ignore kill errors
        }
      }
    }, timeoutSeconds * 1000);

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: truncateOutput(stdout, 5000),
        stderr: truncateOutput(stderr, 2000),
        exitCode: code ?? -1,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  return output.slice(0, maxChars) + `\n\n[...truncated, ${output.length - maxChars} more characters]`;
}

function formatExecResult(result: ExecResult, command: string, task: string): string {
  const status = result.exitCode === 0 ? "✅ PASS" : "❌ FAIL";
  const lines: string[] = [
    `💻 ${status} — Task: ${task}`,
    `$ ${command}`,
    `Exit code: ${result.exitCode}`,
    `Duration: ${result.timedOut ? "TIMEOUT" : "completed"}`,
    "",
  ];

  if (result.stdout.trim()) {
    lines.push("📤 STDOUT:", "```", result.stdout, "```", "");
  }

  if (result.stderr.trim()) {
    lines.push("📤 STDERR:", "```", result.stderr, "```", "");
  }

  if (result.exitCode !== 0) {
    lines.push(
      "💡 Recovery saran:",
      "  1. Baca error di atas — file mana yang error?",
      "  2. Gunakan smart_file_picker untuk baca file yang error",
      "  3. Perbaiki dengan precise_diff_editor",
      "  4. Jalankan task lagi untuk verifikasi",
    );
  } else {
    lines.push("✅ Semua test lulus.");
  }

  return lines.join("\n");
}

function formatTimeoutResult(command: string, timeout: number): string {
  return [
    `⏰ TIMEOUT — "${command}" melebihi batas ${timeout} detik.`,
    "",
    "Kemungkinan penyebab:",
    "  1. Infinite loop di kode",
    "  2. Test terlalu lambat (butuh optimasi)",
    "  3. Background process blocking",
    "",
    "Saran:",
    "  - Cek kode untuk infinite loop",
    "  - Tambah timeout lebih besar (max 120s)",
    "  - Jalankan di terminal manual untuk test",
  ].join("\n");
}

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { circuitBreaker } from "../utils/errorHandler.js";
import { sessionMemory } from "../engine/sessionMemory.js";
import { detectPackageManagerForDir } from "../utils/conventionsDetector.js";
import { spawnShell, type ProcessResult } from "../utils/processRunner.js";

// ============================================================
// SAFE TERMINAL EXEC — Sandboxed terminal runner
// ============================================================

interface TerminalExecParams {
  task: "test" | "build" | "lint" | "typecheck" | "custom";
  customCommand?: string;
  timeout?: number;
  cwd?: string;
  workspace?: string;
}

/**
 * Strips common shell obfuscation techniques from a command string
 * so dangerous pattern detection can match the REAL command.
 *
 * Handles:
 *   - `$()` command substitution (including nested)
 *   - `${}` variable expansion → replaced with space (preserves word boundaries)
 *   - `$(( ))` arithmetic expansion
 *   - `$'...'` ANSI-C quoting
 *   - `$"..."` locale-aware quoting
 *   - `$var` standalone variable
 */
export function stripShellObfuscation(cmd: string): string {
  let result = cmd;

  // 1. Strip $() command substitution (handles nesting via loop)
  let prev: string;
  do {
    prev = result;
    result = result.replace(/\$\([^()]*\)/g, '');
  } while (result !== prev);

  // 2. Strip $(( )) arithmetic expansion (handles nesting)
  do {
    prev = result;
    result = result.replace(/\$\(\([^()]*\)\)/g, '');
  } while (result !== prev);

  // 3. Replace ${} variable expansion with space (preserves word boundaries)
  result = result.replace(/\$\{[^}]*\}/g, ' ');

  // 4. Strip $'...' ANSI-C quoting
  result = result.replace(/\$'[^']*'/g, '');

  // 5. Strip $"..." locale-aware quoting
  result = result.replace(/\$"[^"]*"/g, '');

  // 6. Strip standalone $var references (replace with space)
  result = result.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, ' ');

  // 7. Normalize whitespace (collapse multiple spaces)
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/** Build a task command with the correct package manager prefix for the working directory */
function buildTaskCommand(task: string, cwd: string): string {
  const pm = detectPackageManagerForDir(cwd);
  const prefix = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : pm === "bun" ? "bun" : "npm";
  const npx = pm === "pnpm" ? "pnpm" : pm === "bun" ? "bunx" : "npx";

  switch (task) {
    case "test": return `${prefix} test`;
    case "build": return `${prefix} run build`;
    case "lint": return `${prefix} run lint`;
    case "typecheck": return `${npx} tsc --noEmit`;
    default: return `${prefix} test`;
  }
}

const DANGEROUS_PATTERNS = [
  // RM variants
  "rm -rf",
  "rm -fr",
  "rm --recursive",
  "rm --force",
  "del /f",
  "rd /s",
  "rmdir /s",

  // Git dangerous
  "git push",
  "git commit",
  "git reset --hard",
  "git clean -fd",
  "git checkout -- .",

  // Publish to registries
  "npm publish",
  "npx publish",
  "yarn publish",
  "pnpm publish",

  // System destruction
  "> /dev/sda",
  "mkfs",
  "dd if=",
  "dd of=",
  "fdisk",
  "parted",
  "mkswap",

  // Fork bomb
  ":(){ :|:& };:",
  ":(){",

  // Pipe to shell (remote code execution vector)
  "| bash",
  "| sh",

  // Dangerous eval/exec
  "eval ",
  "exec ",
  "source /dev/stdin",
  ". /dev/stdin",

  // Find destruction
  "find . -delete",
  "find / -delete",
  "find . -exec rm",
  "find / -exec rm",

  // Chmod abuse
  "chmod -R 777",
  "chmod 777 /",
  "chmod 000",

  // Alias hijacking
  "alias rm=",
  "alias cd=",
  "alias sudo=",

  // Overwrite protection
  "shred",
];

export async function handleSafeTerminalExec(params: TerminalExecParams): Promise<string> {
  const { task, customCommand, timeout = 60, cwd: inputCwd, workspace } = params;

  if (task === "custom" && !customCommand) {
    return "Error: Task 'custom' requires the 'customCommand' parameter.";
  }

  const projectRoot = getProjectRoot();

  // Resolve working directory first (needed for per-workspace package manager detection)
  let workingDir = projectRoot;
  let resolvedFrom = "root";

  if (workspace) {
    // Resolve workspace name → path from project_conventions
    const conventions = sessionMemory.getConventions();
    const workspaces = conventions?.workspaces as Array<{ path: string; name: string }> | undefined;
    const matched = workspaces?.find(w => w.name === workspace || w.path === workspace);
    if (matched) {
      workingDir = path.resolve(projectRoot, matched.path);
      resolvedFrom = `workspace "${matched.name}" → ${matched.path}`;
    } else {
      return `⚠️ Workspace "${workspace}" not found. Run project_conventions first to detect workspaces, or use 'cwd' parameter with a direct path.

Available workspaces: ${workspaces?.map(w => `"${w.name}" (${w.path})`).join(", ") || "none detected"}`;
    }
  } else if (inputCwd) {
    // Resolve relative path from project root
    const resolved = path.resolve(projectRoot, inputCwd);
    const normalizedResolved = path.normalize(resolved).toLowerCase();
    const normalizedRoot = path.normalize(projectRoot).toLowerCase();

    if (!normalizedResolved.startsWith(normalizedRoot)) {
      return `🚫 BLOCKED: Path "${inputCwd}" resolves outside project root "${projectRoot}".`;
    }

    if (!fs.existsSync(resolved)) {
      return `⚠️ Directory "${inputCwd}" does not exist at "${resolved}".`;
    }

    workingDir = resolved;
    resolvedFrom = `cwd: ${inputCwd}`;
  }

  // Build command with per-directory package manager detection
  const command = task === "custom" ? customCommand! : buildTaskCommand(task, workingDir);

  const cbResult = circuitBreaker.check("safe_terminal_exec", { task, command });
  if (!cbResult.allowed) {
    return `⚠️ Circuit breaker: ${cbResult.reason}\n\nFix the code first before running the task again.`;
  }

  // Deobfuscate before pattern matching to catch shell obfuscation techniques
  const deobfuscated = stripShellObfuscation(command);
  const dangerousPattern = DANGEROUS_PATTERNS.find(
    (p) => deobfuscated.toLowerCase().includes(p.toLowerCase())
  );
  if (dangerousPattern) {
    return `🚫 BLOCKED: Command contains a dangerous pattern: "${dangerousPattern}".\nThis command is not permitted.`;
  }

  try {
    sessionMemory.recordToolCall("execute_safe_test", { task, command, cwd: workingDir });

    const result = await spawnShell(command, {
      cwd: workingDir,
      timeoutSeconds: timeout,
    });

    const output = formatExecResult(result, command, task, resolvedFrom);

    if (result.exitCode !== 0) {
      sessionMemory.addFailedFile(task, result.stderr || result.stdout);
    }

    return output;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.toLowerCase().includes("timeout")) {
      return formatTimeoutResult(command, timeout);
    }
    return `Error running "${command}": ${errorMsg}`;
  }
}

function formatExecResult(result: ProcessResult, command: string, task: string, resolvedFrom?: string): string {
  const status = result.exitCode === 0 ? "✅ PASS" : "❌ FAIL";
  const lines: string[] = [
    `💻 ${status} — Task: ${task}`,
    `$ ${command}`,
    ...(resolvedFrom ? [`📍 ${resolvedFrom}`] : []),
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
      "💡 Recovery steps:",
      "  1. Read the error above — which file is failing?",
      "  2. Use smart_file_picker to open the failing file",
      "  3. Fix it with precise_diff_editor",
      "  4. Re-run the task to verify",
    );
  } else {
    lines.push("✅ All checks passed.");
  }

  return lines.join("\n");
}

function formatTimeoutResult(command: string, timeout: number): string {
  return [
    `⏰ TIMEOUT — "${command}" exceeded the ${timeout}s limit.`,
    "",
    "Possible causes:",
    "  1. Infinite loop in code",
    "  2. Test suite too slow (needs optimization)",
    "  3. Background process blocking",
    "",
    "Suggestions:",
    "  - Inspect the code for infinite loops",
    "  - Increase the timeout (max 180s)",
    "  - Run the command manually for diagnostics",
  ].join("\n");
}



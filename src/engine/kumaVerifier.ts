import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { saveVerification } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";

export interface VerificationOptions {
  scope?: string;
  force?: boolean;
  timeoutMs?: number;
}

export interface VerificationResult {
  runner: string;
  command: string;
  scope: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

/**
 * Detect project test runner from manifest files.
 */
export function detectTestRunner(root = process.cwd()): { runner: string; baseCommand: string } {
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts && pkg.scripts.test) {
        if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
          return { runner: "pnpm", baseCommand: "pnpm test" };
        }
        if (fs.existsSync(path.join(root, "yarn.lock"))) {
          return { runner: "yarn", baseCommand: "yarn test" };
        }
        return { runner: "npm", baseCommand: "npm test" };
      }
    } catch {}
  }

  if (fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"))) {
    return { runner: "pytest", baseCommand: "pytest" };
  }

  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    return { runner: "cargo", baseCommand: "cargo test" };
  }

  if (fs.existsSync(path.join(root, "go.mod"))) {
    return { runner: "go", baseCommand: "go test ./..." };
  }

  if (fs.existsSync(path.join(root, "Makefile"))) {
    return { runner: "make", baseCommand: "make test" };
  }

  return { runner: "unknown", baseCommand: "npm test" };
}

/**
 * Auto-verify project tests scoped by impact or session edits.
 */
export async function runAutoVerification(options: VerificationOptions = {}): Promise<string> {
  const startTime = Date.now();
  const root = process.cwd();
  const scope = options.scope || "session-impact";
  const timeoutMs = options.timeoutMs || 30000;

  const { runner, baseCommand } = detectTestRunner(root);

  // Scoping test files based on scope or session modifications
  let testFiles: string[] = [];
  const modified = sessionMemory.getModifiedFiles().map(f => f.filePath);

  if (options.scope) {
    const term = options.scope.toLowerCase();
    testFiles = modified.filter(f => f.toLowerCase().includes(term));
    if (testFiles.length === 0) {
      // Find files matching scope in tests/ or src/
      try {
        const { default: glob } = await import("fast-glob");
        const found = await glob([`**/*${term}*test*.*`, `**/*test*/*${term}*.*`], { cwd: root, ignore: ["node_modules/**", "dist/**"] });
        testFiles = found;
      } catch {}
    }
  } else {
    // Collect modified test files or related test files
    testFiles = modified.filter(f => f.includes(".test.") || f.includes(".spec.") || f.includes("_test."));
  }

  let fullCommand = baseCommand;
  if (testFiles.length > 0 && runner === "npm") {
    // Pass scoped test files to jest/vitest runner
    fullCommand = `${baseCommand} -- ${testFiles.map(f => `"${f}"`).join(" ")}`;
  }

  return new Promise<string>((resolve) => {
    exec(fullCommand, { cwd: root, timeout: timeoutMs }, async (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const rawOutput = (stdout + "\n" + stderr).trim();
      const passed = !error;

      // Truncate long output for memory persistence
      const truncatedOutput = rawOutput.length > 2000 ? rawOutput.substring(rawOutput.length - 2000) : rawOutput;

      await saveVerification(scope, runner, fullCommand, passed, truncatedOutput, durationMs);

      const statusSymbol = passed ? "✅" : "🔴";
      const summaryHeader = `${statusSymbol} **Auto-Verification ${passed ? "PASSED" : "FAILED"}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      
      const details = [
        summaryHeader,
        `🛠️ **Runner**: \`${runner}\``,
        `💻 **Command**: \`${fullCommand}\``,
        `🎯 **Scope**: \`${scope}\`${testFiles.length > 0 ? ` (${testFiles.length} file(s) matched)` : ""}`,
        `⏱️ **Duration**: ${durationMs}ms`,
        "",
      ];

      if (!passed) {
        details.push("⚠️ **BLOCKER**: Verification failed! Please fix test failures before shipping or continuing edits.");
        details.push("```text");
        details.push(rawOutput.substring(0, 1500));
        details.push("```");
      } else {
        details.push("🎉 All scoped tests passed cleanly!");
        if (rawOutput) {
          details.push("```text");
          details.push(rawOutput.substring(0, 800));
          details.push("```");
        }
      }

      resolve(details.join("\n"));
    });
  });
}

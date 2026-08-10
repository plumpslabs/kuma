#!/usr/bin/env node

import { readFileSync } from "node:fs";
import * as readline from "node:readline";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./manifest.js";
import { sessionMemory } from "./engine/sessionMemory.js";
import {
  runInit,
  formatInitResults,
  ALL_CONFIG_TYPES,
  type ConfigType,
} from "./cli/init.js";

// ============================================================
// KUMA — CLI Entry Point
// ============================================================

const SERVER_NAME = "kuma";
const SERVER_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version;

function printHelp(): void {
  console.error(`
🐻 Kuma v${SERVER_VERSION} — Zero-setup safety toolkit for AI coding agents

Usage:
  npx @plumpslabs/kuma              Start MCP server (default)
  npx @plumpslabs/kuma init         Generate AI agent config files
  npx @plumpslabs/kuma init --all   Generate ALL config files
  npx @plumpslabs/kuma init --merge Append to existing files (default)
  npx @plumpslabs/kuma init --skip-existing Skip generation if file exists
  npx @plumpslabs/kuma init --claude --cursor  Generate specific files
  npx @plumpslabs/kuma studio        Start Kuma Studio web dashboard (knowledge graph visualizer)
  npx @plumpslabs/kuma init --legacy  Bulk-onboard an existing (legacy) codebase
  npx @plumpslabs/kuma init --help  Show this help
  npx @plumpslabs/kuma hook pre-edit  Claude Code PreToolUse hook — inject gotcha/decision/history before edits
  npx @plumpslabs/kuma hook pre-bash   Claude Code PreToolUse hook — inject command-triggered gotchas before Bash

Available config files:
  --claude     CLAUDE.md                    (Claude Code)
  --cursor     .cursor/rules/kuma.mdc       (Cursor)
  --windsurf   .windsurf/rules/kuma.md       (Windsurf)
  --copilot    AGENTS.md + .github/skills/  (GitHub Copilot Editor)
  --cline      .clinerules/kuma.md          (Cline)
  --aider      CONVENTIONS.md + .aider.conf.yml  (Aider)
  --antigravity .agents/skills/kuma/SKILL.md    (Antigravity CLI)
  --opencode    AGENTS.md + .agents/skills/      (OpenCode)
  --codex       AGENTS.md + .codex/          (Codex CLI - OpenAI)
  --qwen        AGENTS.md + settings.json    (Qwen Code)
  --kiro        .kiro/steering/kuma.md       (Kiro)
  --openclaw    skills/kuma/SKILL.md         (OpenClaw)
  --codewhale   skills/kuma/SKILL.md + .codewhale/  (CodeWhale)

If no flags specified, you'll be prompted to select files interactively.
  `);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ============================================================
  // CLI MODE: kuma --version / -v
  // ============================================================
  if (args[0] === "--version" || args[0] === "-v" || args[0] === "version") {
    console.log(`🐻 Kuma v${SERVER_VERSION}`);
    process.exit(0);
  }

  // ============================================================
  // CLI MODE: kuma --help / -h
  // ============================================================
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    printHelp();
    process.exit(0);
  }

  // ============================================================
  // CLI MODE: kuma stop --force (kill switch)
  // ============================================================
  if (args[0] === "stop" && (args[1] === "--force" || args[1] === "-f")) {
    console.error(`🐻 Kuma v${SERVER_VERSION} — Kill Switch`);
    console.error("");

    // 1. Kill verification child processes (local + cross-instance from DB)
    let killedCount = 0;
    // Kill local process
    try {
      const { getRunningVerificationPid } = await import("./engine/kumaVerifier.js");
      const pid = getRunningVerificationPid();
      if (pid) {
        try { process.kill(-pid, "SIGKILL"); } catch {}
        try { process.kill(pid, "SIGKILL"); } catch {}
        console.error(`✅ Killed local verification process (PID: ${pid})`);
        killedCount++;
      }
    } catch {}
    // Clean up any lock files
    try {
      const path = await import("node:path");
      const fs = await import("node:fs");
      const lockDir = path.resolve(process.cwd(), ".kuma/verifier.lock");
      if (fs.existsSync(lockDir)) {
        // Try to read PID from lock file
        const pidFile = path.join(lockDir, "pid");
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
            if (pid && pid !== process.pid) {
              try { process.kill(-pid, "SIGKILL"); } catch {}
              try { process.kill(pid, "SIGKILL"); } catch {}
              console.error(`✅ Killed other instance verification (PID: ${pid})`);
              killedCount++;
            }
          } catch {}
        }
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
      if (killedCount === 0) {
        console.error("✅ No running verifications found to kill.");
      }
    } catch {}

    // 2. Kill orphaned test processes (Jest, pnpm test, npm test, etc.)
    try {
      const { execSync } = await import("node:child_process");
      // Kill jest worker processes
      try { execSync("pkill -f 'jest' 2>/dev/null || true"); } catch {}
      try { execSync("pkill -f 'jest-worker' 2>/dev/null || true"); } catch {}
      // Kill test runner processes
      try { execSync("pkill -f 'pnpm test' 2>/dev/null || true"); } catch {}
      try { execSync("pkill -f 'npm test' 2>/dev/null || true"); } catch {}
      try { execSync("pkill -f 'yarn test' 2>/dev/null || true"); } catch {}
      console.error("✅ Killed orphaned test processes");
    } catch {
      console.error("⚠️ Could not clean up orphaned processes — try `pkill -f jest` manually");
    }

    console.error("");
    console.error(`🛡️ Kill switch complete. You can safely restart Kuma.`);
    process.exit(0);
  }

  if (args[0] === "stop") {
    console.error(`🐻 Kuma v${SERVER_VERSION} — Kill Switch`);
    console.error("");
    console.error("⚠️  Use `kuma stop --force` to kill all child processes (verifier, tests).");
    console.error("💡 This kills orphaned Jest/worker/test processes spawned by Kuma.");
    console.error("");
    process.exit(0);
  }

  if (args[0] === "kill") {
    console.error(`🐻 Kuma v${SERVER_VERSION}`);
    console.error("");
    console.error("💡 Use `kuma stop --force` instead.");
    console.error("");
    process.exit(0);
  }

  // ============================================================
  // GIT HOOK MODE (Issue #16): Silent no-op for git hooks
  // Prevents git hook from hanging on `npx kuma --hook post-commit`
  // ============================================================
  // ============================================================
  // CLI MODE: kuma studio — Start Kuma Studio dashboard
  // ============================================================
  if (args[0] === "studio") {
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { spawn } = await import("node:child_process");
    const { existsSync } = await import("node:fs");

    // Resolve studio dist path relative to this script's location
    const distDir = dirname(fileURLToPath(import.meta.url));
    const studioPath = join(distDir, "..", "packages", "ide", "studio", "dist", "index.js");

    if (!existsSync(studioPath)) {
      console.error(`[${SERVER_NAME}] Kuma Studio not found at ${studioPath}`);
      console.error(`[${SERVER_NAME}] Make sure @plumpslabs/kuma is properly installed.`);
      console.error(`[${SERVER_NAME}] Or run manually: cd packages/ide/studio && pnpm start`);
      process.exit(1);
    }

    const studioArgs = args.slice(1); // --port, --dir, --help flags
    const child = spawn("node", [studioPath, ...studioArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    child.on("exit", (code) => process.exit(code ?? 1));
    child.on("error", (err) => {
      console.error(`[${SERVER_NAME}] Failed to start Kuma Studio: ${err.message}`);
      process.exit(1);
    });

    // Wait for the child to finish
    return;
  }

  // ============================================================
  // CLI MODE: kuma hook pre-edit — Claude Code PreToolUse hook (F2)
  // Runs automatically BEFORE every Edit/Write/MultiEdit via
  // .claude/settings.json. Reads the hook JSON from stdin → injects
  // fresh gotchas + decisions + trace (shadow memory).
  // Pipeline: I5 dedupe → I3 loop auto-capture → I4 metrics.
  // Output: {} when nothing is relevant (anti-noise), or additionalContext.
  // ============================================================
  if (args[0] === "hook" && args[1] === "pre-edit") {
    try {
      const stdin = await readStdin();
      const {
        parseHookInput,
        getRelevantContext,
        buildHookResponse,
        checkInjectDedupe,
        trackFileEditLoop,
      } = await import("./engine/kumaInject.js");
      const hook = parseHookInput(stdin);

      if (hook.filePaths.length === 0) {
        process.stdout.write("{}");
        process.exit(0);
      }

      // Context for the touched file (first file; MultiEdit stays a single
      // injection so the payload stays under the token budget)
      const target = hook.filePaths[0];

      // I3: repeated edits to the same file → auto-capture a low-severity gotcha.
      // Runs BEFORE dedupe so every edit counts toward the loop signal.
      await trackFileEditLoop(target);

      // I5: don't re-inject the same file within the dedupe window
      if (!checkInjectDedupe(target)) {
        process.stdout.write("{}");
        process.exit(0);
      }

      const context = await getRelevantContext(target, hook.goal);
      if (context.trim()) {
        // I4: record the injection for north-star metrics
        try {
          const { recordInjection } = await import("./engine/kumaGotchas.js");
          await recordInjection({ filePath: target, kind: "edit" });
        } catch { /* non-critical */ }
      }
      process.stdout.write(buildHookResponse(context));
    } catch {
      process.stdout.write("{}");
    }
    process.exit(0);
  }

  // ============================================================
  // CLI MODE: kuma hook pre-bash — Claude Code PreToolUse hook (I2)
  // Runs BEFORE every Bash tool call. Injects gotchas whose
  // trigger_command matches the command about to run (seed/migrate/build).
  // ============================================================
  if (args[0] === "hook" && args[1] === "pre-bash") {
    try {
      const stdin = await readStdin();
      const { getCommandContext, buildHookResponse } = await import("./engine/kumaInject.js");
      const data = JSON.parse(stdin || "{}");
      const command =
        (data && typeof data === "object" && data.tool_input && typeof data.tool_input.command === "string")
          ? data.tool_input.command
          : "";
      if (!command.trim()) {
        process.stdout.write("{}");
        process.exit(0);
      }
      const context = await getCommandContext(command);
      if (context.trim()) {
        try {
          const { recordInjection } = await import("./engine/kumaGotchas.js");
          await recordInjection({ command, kind: "command" });
        } catch { /* non-critical */ }
      }
      process.stdout.write(buildHookResponse(context));
    } catch {
      process.stdout.write("{}");
    }
    process.exit(0);
  }

  if (args[0] === "--hook") {
    // Git hook mode — no longer auto-harvests (removed: gimmic)
    process.exit(0);
  }

  // ============================================================
  // CLI MODE: kuma init
  // ============================================================
  if (args[0] === "init") {
    const flags = args.slice(1);

    if (flags.includes("--help") || flags.includes("-h")) {
      printHelp();
      process.exit(0);
    }

    // ============================================================
    // LEGACY ONBOARDING MODE: kuma init --legacy
    // Bulk-bootstraps an existing (legacy) codebase: git harvest →
    // decisions/gotchas, inline markers → gotchas, feature graph,
    // architecture digest. All in one command.
    // ============================================================
    const requestedFlags = flags.filter((f) => f.startsWith("--"));
    let selectedTypes: ConfigType[];

    // Interactive mode (no specific flags)
    if (requestedFlags.length === 0) {
      console.error("🐻 Kuma Init — AI Agent Config Generator");
      console.error("");
      console.error("Select config files to generate. Press Ctrl+C to skip.");
      console.error("");

      selectedTypes = await interactiveSelect();

      if (selectedTypes.length === 0) {
        console.error("\n⚠️ No files selected. Exiting.");
        process.exit(0);
      }
    } else {
      // From CLI flags
      if (requestedFlags.includes("--all")) {
        selectedTypes = ALL_CONFIG_TYPES;
      } else {
        const flagToType: Record<string, ConfigType> = {
          "--claude": "claude",
          "--cursor": "cursor",
          "--windsurf": "windsurf",
          "--copilot": "copilot",
          "--cline": "cline",
          "--aider": "aider",
          "--antigravity": "antigravity",
          "--opencode": "opencode",
          "--codex": "codex",
          "--qwen": "qwen",
          "--kiro": "kiro",
          "--openclaw": "openclaw",
          "--codewhale": "codewhale",
        };

        selectedTypes = [];
        for (const flag of requestedFlags) {
          const type = flagToType[flag];
          if (type) {
            selectedTypes.push(type);
          }
        }
        if (selectedTypes.length === 0) {
          console.error(
            "⚠️ No valid flags provided. Use --help to see options.",
          );
          process.exit(1);
        }
      }
    }

    const skipExisting = requestedFlags.includes("--skip-existing");

    const results = runInit({
      types: selectedTypes,
      projectRoot: process.cwd(),
      skipExisting,
    });
    const output = formatInitResults(results);

    // Print to stdout (for piping) and stderr (for human reading)
    console.log(output);

    // Reciprocal recommendation for matcha
    const fs = await import("node:fs");
    const path = await import("node:path");
    const matchaSkills = path.resolve(process.cwd(), "skills/matcha/SKILL.md");
    const matchaAgents = path.resolve(
      process.cwd(),
      ".agents/skills/matcha/SKILL.md",
    );
    const matchaRootSkills = path.resolve(
      process.cwd(),
      "skills/matcha/SKILL.md",
    );
    const matchaAgentsMd = path.resolve(process.cwd(), "AGENTS.md");
    const matchaWindsurfRules = path.resolve(
      process.cwd(),
      ".windsurf",
    );

    if (
      fs.existsSync(matchaSkills) ||
      fs.existsSync(matchaAgents) ||
      fs.existsSync(matchaRootSkills) ||
      fs.existsSync(matchaAgentsMd) ||
      fs.existsSync(matchaWindsurfRules)
    ) {
      console.error(
        "\n\u{1F375} Hey, I see matcha is installed \u2014 they pair well together!",
      );
    }

    process.exit(0);
  }

  // ============================================================
  // MCP SERVER MODE (default)
  // ============================================================

  sessionMemory.init({
    projectRoot: process.cwd(),
    startTime: Date.now(),
  });

  // Auto-generate .kuma/init.md (behavioral rules) if missing
  (async () => {
    try {
      const { generateInitMdContent } = await import("./cli/init.js");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const initMdPath = path.resolve(process.cwd(), ".kuma/init.md");
      if (!fs.existsSync(initMdPath)) {
        const kumaDir = path.dirname(initMdPath);
        if (!fs.existsSync(kumaDir)) fs.mkdirSync(kumaDir, { recursive: true });
        fs.writeFileSync(initMdPath, generateInitMdContent(), "utf-8");
        console.error(`[${SERVER_NAME}] Auto-generated .kuma/init.md`);
      }
    } catch (err) {
      console.error(`[${SERVER_NAME}] Failed to auto-generate .kuma/init.md: ${err}`);
    }
  })();

  // Auto-detect AI agent and create its native skill file if missing
  (async () => {
    try {
      const { detectAgent, getSkillPath, getAgentLabel } = await import("./utils/agentDetector.js");
      const { generateSkill, getSecondaryFiles } = await import("./utils/skillGenerator.js");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const detection = detectAgent();
      if (!detection.primary) {
        console.error(`[${SERVER_NAME}] No AI agent detected — skipping auto-skill creation`);
        return;
      }

      const agentType = detection.primary;
      const skillPath = getSkillPath(agentType);
      const fullPath = path.resolve(process.cwd(), skillPath);

      // Skip if skill file already exists
      if (fs.existsSync(fullPath)) {
        console.error(`[${SERVER_NAME}] Skill exists for ${getAgentLabel(agentType)} — skipping`);
        return;
      }

      // Create directory and write skill file
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, generateSkill(agentType), "utf-8");
      console.error(`[${SERVER_NAME}] Auto-created ${skillPath} for ${getAgentLabel(agentType)}`);

      // Create secondary files (e.g., mcp_config.json, settings.json)
      const secondaryFiles = getSecondaryFiles(agentType);
      for (const sf of secondaryFiles) {
        const sfPath = path.resolve(process.cwd(), sf.path);
        const sfDir = path.dirname(sfPath);
        if (!fs.existsSync(sfPath)) {
          if (!fs.existsSync(sfDir)) fs.mkdirSync(sfDir, { recursive: true });
          fs.writeFileSync(sfPath, sf.content, "utf-8");
          console.error(`[${SERVER_NAME}] Auto-created ${sf.path}`);
        }
      }
    } catch (err) {
      console.error(`[${SERVER_NAME}] Failed to auto-create skill file: ${err}`);
    }
  })();

  // COLD START BOOTSTRAP: Auto-run init sequence + restore session + populate graph
  (async () => {
    try {
      console.error(`[${SERVER_NAME}] 🔄 Running cold start bootstrap...`);

      // 1. Restore previous session state (load memory.json)
      const sessionInfo = sessionMemory.loadSession();
      if (sessionInfo.hasPrevSession) {
        console.error(`[${SERVER_NAME}] ✅ Restored session (${sessionInfo.toolCallCount} previous tool calls)`);
      }

      // 2. Populate knowledge graph from session memory
      try {
        const { buildFromSessionMemory } = await import("./engine/kumaGraph.js");
        const edgeCount = await buildFromSessionMemory();
        if (edgeCount > 0) {
          console.error(`[${SERVER_NAME}] ✅ Graph auto-populated with ${edgeCount} entries from session memory`);
        }
      } catch (err) {
        console.error(`[${SERVER_NAME}] ⚠️ Graph auto-population: ${err}`);
      }

      // 3. Create/update session record in DB
      try {
        const { getDb, saveDb } = await import("./engine/kumaDb.js");
        const db = await getDb();
        db.run(
          `INSERT INTO sessions (started_at, goal, tool_calls) VALUES (?, ?, ?)`,
          [Math.floor(Date.now() / 1000), sessionMemory.getSummary().currentGoal || "Session start", sessionInfo.toolCallCount],
        );
        saveDb(db);
      } catch (err) {
        console.error(`[${SERVER_NAME}] ⚠️ Session DB record: ${err}`);
      }

      // 5. Pre-warm search vector cache
      try {
        const { buildSearchVectors } = await import("./engine/kumaSearch.js");
        const vectors = await buildSearchVectors();
        if (vectors.length > 0) {
          console.error(`[${SERVER_NAME}] ✅ Search vector cache pre-warmed (${vectors.length} documents)`);
        }
      } catch (err) {
        console.error(`[${SERVER_NAME}] ⚠️ Search vector cache: ${err}`);
      }

      // 7. Pre-warm graph connectivity
      try {
        const { buildGraphConnectivity } = await import("./engine/kumaSearch.js");
        await buildGraphConnectivity();
        console.error(`[${SERVER_NAME}] ✅ Graph connectivity index built`);
      } catch (err) {
        console.error(`[${SERVER_NAME}] ⚠️ Graph connectivity: ${err}`);
      }

      console.error(`[${SERVER_NAME}] ✅ Cold start bootstrap complete`);
    } catch (err) {
      console.error(`[${SERVER_NAME}] ⚠️ Cold start bootstrap error: ${err}`);
    }
  })();

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  console.error(`[${SERVER_NAME} v${SERVER_VERSION}] Starting MCP server...`);
  console.error(`[${SERVER_NAME}] Project root: ${process.cwd()}`);
  console.error(
    `[${SERVER_NAME}] Session started: ${new Date().toISOString()}`,
  );
  console.error(
    `[${SERVER_NAME}] 🛡️ 3 coarse-grained tools: kuma_context, kuma_memory, kuma_safety — 13 core actions`,
  );

  await server.connect(transport);

  console.error(
    `[${SERVER_NAME}] Server connected via stdio. Waiting for requests...`,
  );
}

/**
 * Interactive prompt: ask user which config files to generate.
 * Uses Node.js readline for robust input handling.
 */
/**
 * Reads the entire stdin (Claude Code hook JSON).
 * Includes a safety timeout so the hook can never hang.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    const done = (): void => resolve(data);
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    // Safety: never hang for more than 2 seconds
    const timer = setTimeout(done, 2000);
    timer.unref?.();
  });
}

function interactiveSelect(): Promise<ConfigType[]> {
  const labels = [
    { type: "claude" as ConfigType, label: "1) Claude Code (CLAUDE.md)" },
    {
      type: "cursor" as ConfigType,
      label: "2) Cursor (.cursor/rules/kuma.mdc)",
    },
    { type: "windsurf" as ConfigType, label: "3) Windsurf (.windsurf/rules/kuma.md)" },
    {
      type: "copilot" as ConfigType,
      label: "4) GitHub Copilot Editor (AGENTS.md + Skill)",
    },
    { type: "cline" as ConfigType, label: "5) Cline (.clinerules/kuma.md)" },
    {
      type: "aider" as ConfigType,
      label: "6) Aider (CONVENTIONS.md via .aider.conf.yml)",
    },
    {
      type: "antigravity" as ConfigType,
      label: "7) Antigravity CLI (.agents/skills/)",
    },
    { type: "opencode" as ConfigType, label: "8) OpenCode (AGENTS.md + skills)" },
    {
      type: "codex" as ConfigType,
      label: "9) Codex CLI - OpenAI (AGENTS.md + .codex/config.toml)",
    },
    {
      type: "qwen" as ConfigType,
      label: "10) Qwen Code (AGENTS.md + settings.json)",
    },
    { type: "kiro" as ConfigType, label: "11) Kiro (.kiro/steering/kuma.md)" },
    {
      type: "openclaw" as ConfigType,
      label: "12) OpenClaw (skills/kuma/SKILL.md)",
    },
    {
      type: "codewhale" as ConfigType,
      label: "13) CodeWhale (skills/kuma/SKILL.md + .codewhale/mcp.json)",
    },
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    console.error("");
    for (const l of labels) {
      console.error(l.label);
    }
    console.error("");

    rl.question(
      "Enter numbers separated by space (e.g. '1 3 5'), or 'all': ",
      (answer) => {
        rl.close();
        const input = answer.trim().toLowerCase();

        if (input === "all") {
          resolve(ALL_CONFIG_TYPES);
          return;
        }

        const nums = input
          .split(/\s+/)
          .map(Number)
          .filter((n) => n >= 1 && n <= 13);
        const typeMap: Record<number, ConfigType> = {
          1: "claude",
          2: "cursor",
          3: "windsurf",
          4: "copilot",
          5: "cline",
          6: "aider",
          7: "antigravity",
          8: "opencode",
          9: "codex",
          10: "qwen",
          11: "kiro",
          12: "openclaw",
          13: "codewhale",
        };

        const selected: ConfigType[] = [];
        for (const n of nums) {
          const t = typeMap[n];
          if (t && !selected.includes(t)) {
            selected.push(t);
          }
        }
        resolve(selected);
      },
    );
  });
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, err);
  process.exit(1);
});

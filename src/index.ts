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
  npx @plumpslabs/kuma init --help  Show this help

Available config files:
  --claude     CLAUDE.md                    (Claude Code)
  --cursor     .cursor/rules/kuma.mdc       (Cursor)
  --windsurf   .windsurfrules               (Windsurf)
  --copilot    AGENTS.md + .github/skills/  (GitHub Copilot Editor)
  --cline      .clinerules/kuma.md          (Cline)
  --aider      CONVENTIONS.md + .aider.conf.yml  (Aider)
  --antigravity .agents/skills/kuma/SKILL.md    (Antigravity CLI)
  --opencode    opencode.json                (OpenCode)
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
  // CLI MODE: kuma stop --force (kill switch)
  // ============================================================
  if (args[0] === "stop" && (args[1] === "--force" || args[1] === "-f")) {
    console.error(`🐻 Kuma v${SERVER_VERSION} — Kill Switch`);
    console.error("");

    // 1. Kill verification child processes
    try {
      const { getRunningVerificationPid } = await import("./engine/kumaVerifier.js");
      const pid = getRunningVerificationPid();
      if (pid) {
        try { process.kill(-pid, "SIGKILL"); } catch {}
        try { process.kill(pid, "SIGKILL"); } catch {}
        console.error(`✅ Killed verification process (PID: ${pid})`);
      }
    } catch (err) {
      console.error(`⚠️ Could not check verifier: ${err}`);
    }

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
  // CLI MODE: kuma init
  // ============================================================
  if (args[0] === "init") {
    const flags = args.slice(1);

    if (flags.includes("--help") || flags.includes("-h")) {
      printHelp();
      process.exit(0);
    }

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
      ".windsurfrules",
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

      // 3. Ensure .kuma/scratch/ directory exists (Issue #10)
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const scratchDir = path.resolve(process.cwd(), ".kuma", "scratch");
        if (!fs.existsSync(scratchDir)) {
          fs.mkdirSync(scratchDir, { recursive: true });
          console.error(`[${SERVER_NAME}] ✅ Created .kuma/scratch/ for temporary debug artifacts`);
        }
      } catch (err) {
        console.error(`[${SERVER_NAME}] ⚠️ Scratch directory setup: ${err}`);
      }

      // 4. Create/update session record in DB
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
    `[${SERVER_NAME}] Kuma V3 — Safety-first context & orchestration engine`,
  );
  console.error(
    `[${SERVER_NAME}] 🧠 Call kuma_context({ action: "init" }) at session start`,
  );
  console.error(
    `[${SERVER_NAME}] 🔬 Call kuma_context({ action: "research", scope: "..." }) before editing`,
  );
  console.error(
    `[${SERVER_NAME}] 🛡️ 3 coarse-grained tools: kuma_context, kuma_memory, kuma_safety`,
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
function interactiveSelect(): Promise<ConfigType[]> {
  const labels = [
    { type: "claude" as ConfigType, label: "1) Claude Code (CLAUDE.md)" },
    {
      type: "cursor" as ConfigType,
      label: "2) Cursor (.cursor/rules/kuma.mdc)",
    },
    { type: "windsurf" as ConfigType, label: "3) Windsurf (.windsurfrules)" },
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
    { type: "opencode" as ConfigType, label: "8) OpenCode (opencode.json)" },
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

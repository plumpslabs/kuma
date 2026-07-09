<div align="center">

<img src="https://raw.githubusercontent.com/plumpslabs/kuma/main/public/kuma.png" alt="Kuma Logo" width="200" />

# Kuma

**Zero-setup safety toolkit for AI coding agents.**

[![npm](https://img.shields.io/npm/v/@plumpslabs/kuma.svg?logo=npm&color=red)](https://www.npmjs.com/package/@plumpslabs/kuma)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-18+-339933?logo=nodedotjs)](https://nodejs.org/)

Works with **13 AI coding agents** — Claude Code, Cursor, Windsurf, GitHub Copilot Editor, Cline, Aider, Antigravity CLI, OpenCode, Codex CLI, Qwen Code, Kiro, OpenClaw, CodeWhale — and any MCP-compatible client.

**No manual config needed.** Just run `npx @plumpslabs/kuma init`.

</div>

---

## Quick Start

```bash
# Generate config files for ALL supported AI agents
npx @plumpslabs/kuma init --all

# Or generate for specific agents
npx @plumpslabs/kuma init --cursor --claude --aider

# See all options
npx @plumpslabs/kuma init --help
```

Or add Kuma MCP server manually to any MCP client:

```json
{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@plumpslabs/kuma"]
    }
  }
}
```

---

## Unified Tool Router (10 Groups)

> **Kuma consolidates 46+ individual operations into 10 grouped tools.** AI agents scan 10 groups instead of 46 tools — simpler, faster, less context.

| Group | Actions | When to call |
|-------|---------|-------------|
| 🔵 `kuma_init` | `init`, `conventions`, `structure` | **Call first** every session |
| 🟢 `kuma_core` | `grep`, `read`, `edit`, `batch`, `lsp` | During active coding |
| 🟡 `kuma_verify` | `test`, `review`, `lint` | After every edit |
| 🔴 `kuma_safety` | `guard` (anti-patterns, loops, drift), `score` (0-100 health), `check` (pre-exec safety), `policy` (`.kuma/policy.yml`), `risk` (impact prediction), `dependency` (native JS alternatives) | Before risky ops |
| 🟣 `kuma_graph` | `query` (nodes/edges/stats/search), `navigate`, `diagram`, `investigate`, `arch` (capture/diff/diagram/fs/graph/profiles), `experience` (suggest/errors/prune), `intent` (suggest/patterns) | Codebase understanding — powered by **SQLite knowledge graph** |
| 🧠 `kuma_memory` | `get`, `search`, `write`, `decision`, `context`, `heal` | Persist/retrieve context |
| 📊 `kuma_analytics` | `reflect`, `analytics`, `health`, `replay`, `heatmap`, `learn`, `predict`, `confidence`, `dna` | Session review |
| ⏳ `kuma_history` | `timeline`, `log`, `diff` | Git/time analysis |
| 🔒 `kuma_lock` | `acquire`, `release`, `list`, `clean` | Multi-agent coordination |
| ⚙️ `kuma_advanced` | `failure`, `compress`, `shadow`, `collective`, `marketplace` | Maintenance |

```bash
# Example workflow
kuma_init({ action: "init" })                            # Load project context
kuma_core({ action: "grep", query: "handleAuth" })      # Find code
kuma_core({ action: "edit", filePath: "auth.ts", ... }) # Edit safely
kuma_verify({ action: "test" })                         # Verify didn't break
kuma_safety({ action: "guard", goal: "refactor auth" })  # Safety check
kuma_analytics({ action: "reflect" })                   # Reflect on progress
```

---

## Supported Agents

`kuma init` generates native config files for **13 AI coding agents** — no manual hunting for file formats:

| # | Agent | Generated Files | Approach |
|---|-------|----------------|----------|
| 1 | **Claude Code** | `CLAUDE.md` | Fallback instructions (plugin via `/plugin install` is proper) |
| 2 | **Cursor** | `.cursor/rules/kuma.mdc` | Rule file with YAML frontmatter (`alwaysApply: true`) |
| 3 | **Windsurf** | `.windsurfrules` | Static rules file |
| 4 | **GitHub Copilot Editor** | `AGENTS.md` + `.github/skills/kuma/SKILL.md` | AGENTS.md + Skill file |
| 5 | **Cline** | `.clinerules/kuma.md` | Rule file with `paths` frontmatter |
| 6 | **Aider** | `CONVENTIONS.md` + `.aider.conf.yml` | Convention file referenced via `read: CONVENTIONS.md` |
| 7 | **Antigravity CLI** | `.agents/skills/kuma/SKILL.md` + `.agents/mcp_config.json` | Skill (loaded on demand) |
| 8 | **OpenCode** | `opencode.json` | Plugin config JSON |
| 9 | **Codex CLI (OpenAI)** | `AGENTS.md` + `.codex/config.toml` | AGENTS.md + MCP server in TOML |
| 10 | **Qwen Code** | `AGENTS.md` + `settings.json` | AGENTS.md + MCP server in JSON |
| 11 | **Kiro** | `.kiro/steering/kuma.md` | Steering file with YAML frontmatter (`inclusion: always`) |
| 12 | **OpenClaw** | `skills/kuma/SKILL.md` | Skill (loaded on demand) |
| 13 | **CodeWhale** | `skills/kuma/SKILL.md` + `.codewhale/mcp.json` | Skill + MCP server config |

> `AGENTS.md` includes sections for all selected agents that read it (Codex CLI, Qwen Code, GitHub Copilot Editor) — one file, no conflicts.
> `skills/kuma/SKILL.md` is shared by agents that load skills from workspace root.

---

## Kuma's Promise

**Kuma is built for one thing: making sure AI agents don't break your project.**

Every tool in Kuma has a safety net built-in — not as an afterthought, but as a core design principle. Here's what Kuma guarantees:

| # | When this happens... | Kuma does this... |
|---|---|---|
| 1 | LSP server is not installed | **Falls back to regex** — never hard fails |
| 2 | An edit breaks something | **Rollback to any version** — versioned backups, dry-run preview, version list |
| 3 | AI loops on a test failure | **Circuit breaker stops it** — prevents infinite retries after 3 identical failures |
| 4 | A file path doesn't resolve | **Shows where it looked** — CWD vs project root with resolved paths |
| 5 | A command is dangerous | **Blocks it** — `rm -rf`, `git push --force`, `curl \| bash`, plus shell obfuscation detection |
| 6 | AI keeps repeating the same tool | **Tool-loop detection** — flags if same tool called 4+ times in last 10 calls |
| 7 | You need to undo an edit | **Versioned rollback** — `action: "rollback"` with `version: N` or `version: "list"` |
| 8 | A diff doesn't match | **Fuzzy fallback** — exact → whitespace-normalized → fuzzy match with configurable threshold |

Most tools make AI smarter. **Kuma makes AI not break things.**

---

## Tools (19)

### 🔍 Context — Understand the codebase

| Tool | Description |
|------|-------------|
| `smart_grep` | Search code with regex. Returns filename, line, and context. Caches results. |
| `smart_file_picker` | Read files with smart chunking: `full` (entire file), `smart` (signatures + tail), `outline` (exports only). |
| `project_structure` | Tree view of project layout. Depth control, folder-only mode, include/exclude patterns. |
| `git_log` | Structured commit history with optional file filter. |
| `git_diff` | Structured diff output. Supports staged/unstaged, file filter, ref ranges, and context line control. |
| `lsp_query` | Go-to-definition, find references, get type info, **or rename symbols** via TypeScript Language Server. **Falls back to regex when LSP unavailable.** |
| `project_conventions` | Auto-detect framework, test runner, package manager, import aliases, **monorepo workspaces**. |
| `kuma_init` | **Call FIRST** every session. Loads `.kuma/init.md` rules, `.kuma/memories/`, previous session state, and **knowledge graph** from SQLite DB. After this, you can work without re-detecting conventions. |

### ✏️ Execution — Make changes safely

| Tool | Description |
|------|-------------|
| `precise_diff_editor` | Search-and-replace with exact → whitespace → fuzzy fallback. **Auto-backup before every edit.** Supports **dry-run preview**, **versioned rollback** (`version: N`, `version: "list"`), and **batch edits** (up to 10 at once). |
| `batch_file_writer` | Create up to 15 files in one call. Validates paths before writing. |
| `static_analysis` | Run ESLint / TypeScript / Prettier / Ruff and **parse output into structured results.** Auto-detects tools from project config. |

### 🧪 Validation — Verify before breaking

| Tool | Description |
|------|-------------|
| `execute_safe_test` | Run `test`/`build`/`lint`/`typecheck`/`custom` with **timeout, circuit breaker, and process tree kill.** Supports **monorepo workspaces** via `workspace` param or relative `cwd`. |
| `code_reviewer` | Senior-level static analysis. Focus modes: correctness, conventions, security, performance, and **over-engineering detection.** Supports JSON output. |

### 🧠 Memory — Know what happened

| Tool | Description |
|------|-------------|
| `get_session_memory` | Session state tracker. Shows modified files, unresolved failures, tool history. Load specific memory topics with `{ topic }`. |
| `search_session_memory` | **Keyword search** across tool calls, memory files, errors, modified files, and dependency graph. |
| `write_memory` | Persist project knowledge (decisions, glossary) to `.kuma/memories/`. Append, prepend, or overwrite. |
| `kuma_reflect` | **Reflection tool** — checks if you're on track, detects drift (edits without tests, loops, unresolved failures), and suggests the next action. |
| `kuma_context` | **Snapshot manager** — save/restore project state (modified files, errors, git diff) before risky operations. |

### 🛡️ Safety — Stay on track

| Tool | Description |
|------|-------------|
| `kuma_guard` | **Context safety net.** Detects anti-patterns (script patching, bash grep), tool loops, drift (edits without tests, unresolved failures). Run this after every few edits. Checks: `all`, `anti-pattern`, `loop`, `drift`, `context`. |

---

## Safety

| Feature | What it does |
|---------|-------------|
| **Sandboxed** | All file operations locked to project directory. Path traversal blocked. System dirs protected. |
| **Auto-backup** | `.kuma/backups/<timestamp>/` snapshot before every `precise_diff_editor` edit. Rollback to any version. |
| **Circuit breaker** | Stops after 3 identical failures. Prevents AI loops. |
| **Timeout** | All commands have configurable timeout (max 180s). Process tree kill on timeout. |
| **Command whitelist** | Only `test`, `build`, `lint`, `typecheck`, and explicit custom commands. |
| **Dangerous pattern blocking** | `rm -rf`, `git push --force`, `npm publish`, `curl \| bash` blocked by default. **Shell obfuscation detection** catches hidden dangerous commands. |
| **LSP graceful degradation** | When TypeScript Language Server is not installed, LSP tools **fall back to regex** instead of hard failing. |
| **Multi-agent lock** | File-level locks prevent multiple AI agents from editing the same file simultaneously. |
| **Safety score** | Aggregate 0-100 score across 9 dimensions: git status, backups, LSP, tests, modified files, loops, failures, conventions, goal. |

---

## What Makes Kuma Unique

- **Router groups** — 46+ operations consolidated into 10 grouped tools. AI scans 10 groups instead of 46 tools.
- **Workflow combo** — `kuma_init → kuma_core → kuma_verify → kuma_safety → kuma_analytics` as a seamless pipeline.
- **Knowledge Graph (SQLite)** — Built-in SQLite database via `sql.js` (pure WASM, zero native build). Tracks nodes (functions, files, API routes, tests) + edges (calls, imports, defines, tests) + experience patterns + sessions. FTS5 full-text search with graceful fallback.
- **Safety is default, not optional** — Rollback, circuit breaker, sandbox, timeout, dangerous pattern blocking are built into every tool.
- **Graceful degradation** — When dependencies are missing (LSP, linters, FTS5), Kuma falls back instead of crashing.
- **Over-engineering detection** — `code_reviewer` with `focus: "over-engineering"` catches unnecessary abstractions.
- **Drift detection** — `kuma_guard` catches edits without tests, tool-call loops, unresolved failures.
- **Impact prediction** — `kuma_risk` tells you how many files reference a symbol before you change it.
- **Dependency guard** — Before adding npm packages, checks for native JS alternatives and existing similar packages.
- **Persistent memory** — Knowledge survives across sessions via `.kuma/memories/` + `.kuma/kuma.db`. Auto-generates architecture & conventions docs.
- **Monorepo awareness** — Detects workspaces, scans `apps/*`, `packages/*`, `services/*`, and pnpm/yarn/npm workspaces.

### Storage Layout

```
.kuma/
├── kuma.db          # SQLite database (knowledge graph, sessions, experiences)
├── init.md           # Behavioral rules for AI agents (auto-generated)
├── memory.json       # Session state (modified files, failures, tool history)
└── memories/         # Persistent knowledge files
    ├── architecture.md
    ├── conventions.md
    ├── decisions.md
    ├── glossary.md
    └── known-issues.md

.kuma/backups/        # Versioned backups from precise_diff_editor
└── <timestamp>/      # One backup snapshot per edit
    └── <relative-file-path>
```

---

## Kuma's DNA

1. **Zero setup, zero friction** — Built-in tools that work without config. No DB, no API key.
2. **Safety first** — Every tool has a safety net: timeout, circuit breaker, rollback, sandbox.
3. **Graceful degradation, not crash** — Every tool has a fallback before it fails. LSP unavailable? Regex. File not found? Show resolved paths. Diff mismatch? Whitespace→fuzzy retry. Test fails? Circuit breaker stops the loop. FTS5 unavailable? Full-text search disabled gracefully.
4. **Opinionated workflow** — Tools designed to be used together: `kuma_init → kuma_core → kuma_verify → kuma_safety → kuma_analytics`.
5. **Minimal surface** — 19 focused tools. Each tool has one job and does it well. No overlap, no confusion.

---

## 🍵 Pair with Matcha

**Kuma keeps AI agents safe. Matcha keeps AI agents deliberate.**

[Matcha](https://github.com/plumpslabs/matcha) is an engineering philosophy
ruleset that enforces deliberate thinking before, during, and after coding:

- **5W1H Gate** — Why are we doing this? Is there a simpler path?
- **Reuse Before Write** — Never write what already exists
- **Clean Finish** — No temp, no debug, no unused code

Where Kuma provides **runtime safety** (rollback, circuit breaker, sandbox),
Matcha provides **session discipline** (planning gate, cleanup scan, intensity levels).

```bash
# Try them together
npx @plumpslabs/matcha init     # Install matcha philosophy
npx @plumpslabs/kuma init --all  # Install kuma safety tools
```

Both tools are designed to complement each other — Kuma handles the
"can't break things" layer while Matcha handles the "think before you act" layer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## License

[MIT](LICENSE)

<div align="center">

**Made with 🐻 for AI agents everywhere**

[Report Bug](https://github.com/plumpslabs/kuma/issues) · [Request Feature](https://github.com/plumpslabs/kuma/issues)

</div>

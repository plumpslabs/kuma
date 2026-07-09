<div align="center">

<img src="https://raw.githubusercontent.com/plumpslabs/kuma/main/public/kuma.png" alt="Kuma Logo" width="200" />

# Kuma

**Zero-setup safety & context runtime for AI coding agents — v2.2.2**

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

| Group | Actions | What it does |
|-------|---------|-------------|
| 🔵 `kuma_init` | `init`, `conventions`, `structure` | **Call first** every session — load context, detect stack, show tree |
| 🟢 `kuma_core` | `grep`, `read`, `edit`, `batch`, `lsp` | During active coding — search, read, safe edit, create files, LSP queries |
| 🟡 `kuma_verify` | `test`, `review`, `lint` | After every edit — run tests, code review, static analysis |
| 🔴 `kuma_safety` | `guard`, `score`, `check`, `policy`, `risk`, `dependency`, `context`, `audit`, `stats`, `override` | Safety & risk — anti-patterns, health score, pre-exec check, policy enforcement, impact analysis, dependency guard, snapshots, audit trail |
| 🟣 `kuma_graph` | `query`, `navigate`, `diagram`, `investigate`, `arch`, `experience`, `intent` | Codebase understanding — query knowledge graph, navigate flows, Mermaid diagrams, auto-investigate, architecture guard, experience patterns, intent paths |
| 🧠 `kuma_memory` | `get`, `search`, `write`, `decision`, `context`, `heal` | Persist/retrieve context — session memory, keyword search, persist knowledge, decisions (ADR), auto-context engine, self-heal graph |
| 📊 `kuma_analytics` | `reflect`, `analytics`, `health`, `replay`, `heatmap`, `learn`, `predict`, `confidence`, `dna` | Session review — on-track detection, stats dashboard, code health, session replay, activity heat map, AI learning, predictive next, confidence score, project DNA |
| ⏳ `kuma_history` | `timeline`, `log`, `diff` | Code history — symbol evolution timeline, commit log, structured diffs |
| 🔒 `kuma_lock` | `acquire`, `release`, `list`, `clean` | Multi-agent coordination — file-level locks, lock listing, stale cleanup |
| ⚙️ `kuma_advanced` | `failure`, `compress`, `shadow`, `collective`, `marketplace` | Maintenance — failure knowledge base, semantic compression, shadow execution simulation, collective VPS sync, marketplace templates |

```bash
# Full workflow example
kuma_init({ action: "init" })                                    # Load project context
kuma_core({ action: "grep", query: "handleAuth" })               # Find code
kuma_core({ action: "edit", filePath: "auth.ts", edits: [...] }) # Edit safely
kuma_safety({ action: "guard", goal: "refactor auth" })           # Safety check
kuma_verify({ action: "test" })                                  # Verify didn't break
kuma_analytics({ action: "reflect" })                             # Reflect on progress
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
| 7 | **Antigravity CLI** | `.agents/skills/kuma/SKILL.md` + `.agents/mcp_config.json` | Skill + MCP config |
| 8 | **OpenCode** | `opencode.json` | Plugin config JSON |
| 9 | **Codex CLI (OpenAI)** | `AGENTS.md` + `.codex/config.toml` | AGENTS.md + MCP server in TOML |
| 10 | **Qwen Code** | `AGENTS.md` + `settings.json` | AGENTS.md + MCP server in JSON |
| 11 | **Kiro** | `.kiro/steering/kuma.md` | Steering file with YAML frontmatter |
| 12 | **OpenClaw** | `skills/kuma/SKILL.md` | Skill (loaded on demand) |
| 13 | **CodeWhale** | `skills/kuma/SKILL.md` + `.codewhale/mcp.json` | Skill + MCP server config |

> `AGENTS.md` is a merged file shared by Codex CLI, Qwen Code, and GitHub Copilot Editor — one file, no conflicts.

---

## Features

### 🔍 Context & Understanding

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Smart Grep** | `kuma_core({ action: "grep" })` | Regex code search with context lines, caching, and `.gitignore` respect |
| **Smart File Picker** | `kuma_core({ action: "read" })` | Read files with chunking strategies: `full`, `smart` (signatures + tail), `outline` (exports only) |
| **Project Structure** | `kuma_init({ action: "structure" })` | Tree view of project layout with depth control, folder-only mode, patterns |
| **Project Conventions** | `kuma_init({ action: "conventions" })` | Auto-detect framework, test runner, package manager, monorepo workspaces |
| **LSP Query** | `kuma_core({ action: "lsp" })` | Go-to-definition, find references, type info, rename symbols via TypeScript Language Server. **Falls back to regex when LSP unavailable.** |
| **Code Time Machine** | `kuma_history({ action: "timeline" })` | Track how a function evolved over time — git blame + commit analysis + design decisions |
| **Git Log** | `kuma_history({ action: "log" })` | Structured commit history with file filtering |
| **Git Diff** | `kuma_history({ action: "diff" })` | Structured diff with staged/unstaged, ref ranges, context control |

### 🧠 Knowledge Graph (SQLite)

Everything in Kuma is backed by a **SQLite knowledge graph** — auto-built, auto-healed, queryable:

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Graph Query** | `kuma_graph({ action: "query" })` | Query nodes/edges/stats. FTS5 full-text search with graceful fallback |
| **AI Navigation** | `kuma_graph({ action: "navigate" })` | Answer "How does login work?" — returns the full call chain |
| **Autonomous Investigation** | `kuma_graph({ action: "investigate" })` | Given a problem, auto-discovers the relevant code path + bottleneck |
| **Mermaid Diagrams** | `kuma_graph({ action: "diagram" })` | Generate architecture, sequence, impact, ownership, heatmap diagrams |
| **Living Architecture** | `kuma_graph({ action: "arch" })` | Auto-detect architecture (clean/layered/hexagonal/MVC), detect violations |
| **Experience Graph** | `kuma_graph({ action: "experience" })` | Learn from past sessions — suggests next tools based on success patterns |
| **Intent Graph** | `kuma_graph({ action: "intent" })` | Organize by intent, not dependency — suggests optimal paths for a goal |
| **Self-Healing** | `kuma_memory({ action: "heal" })` | Auto-detect stale nodes, repair via git history or content hash. Cascading edge cleanup |

### ✏️ Execution — Make Changes Safely

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Precise Diff Editor** | `kuma_core({ action: "edit" })` | Search-and-replace with exact → whitespace → fuzzy fallback. **Auto-backup before every edit.** Dry-run preview, versioned rollback, batch edits (up to 10) |
| **Batch File Writer** | `kuma_core({ action: "batch" })` | Create up to 15 files in one call. Path validation before writing |
| **Static Analysis** | `kuma_verify({ action: "lint" })` | Run ESLint / TypeScript / Prettier / Ruff — structured output |
| **Code Reviewer** | `kuma_verify({ action: "review" })` | Senior-level static analysis. Focus modes: correctness, conventions, security, performance, **over-engineering detection** |

### 🧠 Memory

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Session Memory** | `kuma_memory({ action: "get" })` | Session state tracker — modified files, unresolved failures, tool history |
| **Memory Search** | `kuma_memory({ action: "search" })` | Keyword search across tool calls, memory files, errors, dependency graph |
| **Persist Knowledge** | `kuma_memory({ action: "write" })` | Save decisions, glossary, architecture notes to `.kuma/memories/` |
| **Decision Memory** | `kuma_memory({ action: "decision" })` | ADR-style decision recording: context → options → rationale → outcome |
| **Context Engine** | `kuma_memory({ action: "context" })` | Auto-inject relevant context — finds files related to a goal via graph distance + recency + failure history |

### 🛡️ Safety — Stay on Track

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Safety Guard** | `kuma_safety({ action: "guard" })` | Anti-pattern detection (script patching, bash grep), tool loops, drift (edits without tests) |
| **Safety Score** | `kuma_safety({ action: "score" })` | Aggregate 0-100 health score across 9 dimensions: git status, backups, LSP, tests, loops, etc. |
| **Safety Policy** | `kuma_safety({ action: "policy" })` | Policy file (`.kuma/policy.yml`) — `never_touch`, `require_review`, `require_tests`, `block_commands` |
| **Risk Prediction** | `kuma_safety({ action: "risk" })` | Before editing — shows references, test files, API routes affected |
| **Dependency Guard** | `kuma_safety({ action: "dependency" })` | Before adding packages — checks existing deps, suggests native JS alternatives |
| **Context Snapshots** | `kuma_safety({ action: "context" })` | Save/restore project state before risky operations |
| **Safety Audit** | `kuma_safety({ action: "audit" })` | Every tool call recorded in SQLite. Queryable trail with override logging |
| **Safety Check** | `kuma_safety({ action: "check" })` | Pre-execution safety check — validates path, policy, dangerous commands |

### 📊 Analytics & Reflection

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Reflection** | `kuma_analytics({ action: "reflect" })` | On-track/off-track detection, drift warnings, next action suggestion |
| **Behavior Analytics** | `kuma_analytics({ action: "analytics" })` | Session stats — tool calls, edits, test runs, rollbacks, loops prevented |
| **Code Health Dashboard** | `kuma_analytics({ action: "health" })` | Project-level health — bug density, test pass rate, rollback rate, fragility scoring |
| **Session Replay** | `kuma_analytics({ action: "replay" })` | Replay what AI did in a previous session as a human-readable narrative |
| **Activity Heat Map** | `kuma_analytics({ action: "heatmap" })` | Show which parts of the codebase AI works on most |
| **AI Learning** | `kuma_analytics({ action: "learn" })` | Auto-prioritize high-usage patterns in the knowledge graph |
| **Predictive AI** | `kuma_analytics({ action: "predict" })` | Predict what file/tool AI needs next based on current context |
| **Confidence Engine** | `kuma_analytics({ action: "confidence" })` | Estimate how confident AI should be — factors: files read, refs checked, graph completeness |
| **Project DNA** | `kuma_analytics({ action: "dna" })` | One-page project fingerprint — architecture, coding style, coupling, risk areas, trends |

### ⏳ History & Time Machine

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Symbol Timeline** | `kuma_history({ action: "timeline" })` | "Why does login work this way?" — traces a function's evolution across commits with design decisions |
| **Commit Log** | `kuma_history({ action: "log" })` | Structured commit history with file filter |
| **Git Diff** | `kuma_history({ action: "diff" })` | Staged/unstaged/ref-range diffs with configurable context |

### 🔒 Multi-Agent

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **File Locking** | `kuma_lock({ action: "acquire" })` | Prevent multiple AI agents from editing the same file simultaneously |
| **Lock Management** | `kuma_lock({ action: "list" })` | See active locks, clean stale ones |

### ⚙️ Advanced

| Feature | Tool / Action | Description |
|---------|--------------|-------------|
| **Failure Knowledge Base** | `kuma_advanced({ action: "failure" })` | Every failure saved — type, symbol, solution. Proactive warnings for repeat patterns |
| **Semantic Compression** | `kuma_advanced({ action: "compress" })` | Compress large codebases into a semantic graph (type signatures + deps — no boilerplate) |
| **Shadow Execution** | `kuma_advanced({ action: "shadow" })` | Simulate changes before applying — virtual typecheck, test prediction, risk assessment |
| **Collective Intelligence** | `kuma_advanced({ action: "collective" })` | Sync anonymized patterns to your own VPS — learn from multiple projects |
| **Knowledge Marketplace** | `kuma_advanced({ action: "marketplace" })` | Install pre-built graph templates for popular frameworks |

---

## Kuma's Promise

**Kuma is built for one thing: making sure AI agents don't break your project.**

Every tool in Kuma has a safety net built-in — not as an afterthought, but as a core design principle:

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
| 9 | AI needs to understand complex code | **Knowledge graph** — SQLite-backed, auto-built, queryable, self-healing |
| 10 | AI is about to break architecture | **Architecture guard** — detects layer violations, suggests correct dependency direction |
| 11 | AI has no context for a goal | **Auto-context engine** — finds relevant files via graph distance + recency + failure history |
| 12 | AI needs to know confidence | **Confidence engine** — 0-100 score based on context completeness |
| 13 | AI wants to know a file's history | **Code time machine** — shows why code is the way it is via git blame + commit analysis |
| 14 | Multiple agents edit the same file | **File lock** — prevents conflicts, clean stale locks |

Most tools make AI smarter. **Kuma makes AI not break things.**

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
| **Safety policy** | `.kuma/policy.yml` — declare `never_touch` files, `require_review` paths, `block_commands`. |
| **Risk prediction** | Before editing a symbol — shows 42 references in 15 files, 7 test files, 3 API routes. |
| **Dependency guard** | When AI installs a new package — checks existing deps, suggests native alternatives. |
| **Safety audit** | Every tool call recorded in SQLite. Queryable trail with override logging. |

---

## What Makes Kuma Unique

- **Router groups** — 46+ operations consolidated into 10 grouped tools. AI scans 10 groups instead of 46 tools.
- **Knowledge Graph (SQLite)** — Built-in SQLite database via `sql.js` (pure WASM, zero native build). Tracks nodes (functions, files, API routes, tests) + edges (calls, imports, defines, tests) + experience patterns + sessions. FTS5 full-text search with graceful fallback.
- **Self-healing graph** — Automatically detects stale nodes, repairs via git history or content hash fingerprinting.
- **Safety is default, not optional** — Rollback, circuit breaker, sandbox, timeout, dangerous pattern blocking are built into every tool.
- **Graceful degradation** — When dependencies are missing (LSP, linters, FTS5), Kuma falls back instead of crashing.
- **Over-engineering detection** — `code_reviewer` with `focus: "over-engineering"` catches unnecessary abstractions.
- **Drift detection** — `kuma_guard` catches edits without tests, tool-call loops, unresolved failures.
- **Impact prediction** — `kuma_risk` tells you how many files reference a symbol before you change it.
- **Auto-context engine** — Given a goal, finds relevant files via graph distance + recency + failure history.
- **Code time machine** — Shows why code is the way it is: "Because commit e4f5g6h migrated from sessions to JWT for mobile support."
- **Mermaid diagrams** — Auto-generated architecture, sequence, impact, ownership, and heatmap diagrams from the knowledge graph.
- **Architecture guard** — Detects layer violations (Handler → Database when it should be Handler → Service → Repository).
- **Confidence engine** — 0-100 score estimating how confident AI should be about a change.
- **Shadow execution** — Simulate changes before applying: virtual typecheck, test prediction, risk assessment.
- **Failure knowledge base** — Every failure saved and becomes a learning. Proactive warnings.
- **Dependency guard** — Before adding npm packages, checks for native JS alternatives and existing similar packages.
- **Persistent memory** — Knowledge survives across sessions via `.kuma/memories/` + `.kuma/kuma.db`.
- **Monorepo awareness** — Detects workspaces, scans `apps/*`, `packages/*`, `services/*`, and pnpm/yarn/npm workspaces.
- **Collective intelligence** — Anonymized pattern sharing across projects via your own VPS. Zero source code leakage.
- **Knowledge marketplace** — Pre-built graph templates for Laravel, Spring Boot, Django, Gin, Axum, Next.js, Express.js, and more.

### Storage Layout

```
.kuma/
├── kuma.db              # SQLite database (knowledge graph, sessions, experiences, safety audit)
├── init.md              # Behavioral rules for AI agents (auto-generated)
├── config.json          # Per-project config (collective endpoint, autoSync, etc.)
├── memory.json          # Session state (modified files, failures, tool history)
├── policy.yml           # Safety policy (never_touch, require_review, block_commands)
├── .instance-id         # Anonymous instance ID for collective sync
└── memories/            # Persistent knowledge files
    ├── architecture.md
    ├── conventions.md
    ├── decisions.md
    ├── glossary.md
    └── known-issues.md

.kuma/backups/            # Versioned backups from precise_diff_editor
└── <timestamp>/          # One backup snapshot per edit
    └── <relative-file-path>
```

---

## 🔄 Self-Healing

Kuma automatically detects and repairs issues in the knowledge graph:

```bash
# Check for stale entries
kuma_memory({ action: "heal", healAction: "check" })

# Auto-heal — remove stale nodes/edges
kuma_memory({ action: "heal" })
```

| Feature | Description |
|---------|-------------|
| **Content Hash** | Detects files that changed since last scan (MD5 of head + tail + size) |
| **All-Node Scan** | Scans all node types: `file`, `function`, `class`, `interface`, `module`, `test`, etc. |
| **Git-Aware Repair** | Uses `git log --follow --diff-filter=R` to trace file renames |
| **Cascading Edges** | Stale node edges get weight reduced to near-zero |
| **Incremental Heal** | Batch processing — repairs only the affected subgraph, not full scan |
| **Auto-Heal Hook** | Runs automatically during graph queries — no manual action needed |

---

## 🛡️ Safety AI Layer

The Safety layer sits between AI agents and the filesystem. Every tool call goes through: policy check, path validation, audit logging.

### Features

| Feature | Description |
|---------|-------------|
| **Safety Audit** | Every tool call recorded in SQLite (`safety_audit`). Queryable. |
| **Safety Proxy** | `precise_diff_editor` is auto-wrapped — runs preCheck before execution. |
| **Risk Assessment** | Path validation, policy checks, dangerous command detection. |
| **Override Logging** | Safety bypasses are logged with reasons — audit trail stays clean. |
| **Safety Score** | 0-100 aggregate health score across 9 dimensions. |

### Usage

```bash
# Query audit trail (20 most recent entries)
kuma_safety({ action: "audit", limit: 20 })

# Audit statistics
kuma_safety({ action: "stats" })

# Full safety check before execution
kuma_safety({ action: "check", actionCheck: "edit", filePath: "config.ts" })

# Safety Score
kuma_safety({ action: "score" })

# Bypass safety (logged with reason)
kuma_safety({ action: "override", tool: "precise_diff_editor", reason: "trusted edit" })
```

---

## 🐻 Kolektif — Collective Intelligence

Kolektif allows Kuma instances across different projects to share anonymized patterns. Data is sent to **your own VPS server** — not to a public server.

### Architecture

```
Project A (Laptop) ──────┐
                          ├──► Your VPS (Hono + better-sqlite3)
Project B (Laptop) ──────┘    Port 3001
```

**Data sent (safe):**
- `errorType`: "type_error" / "build_error" — generic category
- `tools`: ["smart_grep", "lsp_query"] — tool names only
- `language`: "typescript" — programming language
- `count`, `successRate` — anonymous numbers

**Data NEVER sent:**
- ❌ Source code
- ❌ File names / function names
- ❌ Raw error messages
- ❌ Git history / commit messages
- ❌ User identity

### Quick Deploy (VPS)

Requires a VPS (1GB RAM is enough) with Node.js 18+.

```bash
# 1. Clone repo
ssh user@vps-ip
git clone https://github.com/plumpslabs/kuma.git kolektif
cd kolektif/server

# 2. Install + build
npm install
npx tsc

# 3. Start via PM2
pm2 start dist/index.js --name kuma-server
pm2 save

# 4. Open firewall
sudo ufw allow 3001/tcp
```

Or use the one-command deploy script:
```bash
ssh user@vps-ip 'bash -s' < server/deploy.sh
```

### Client Setup

Set the environment variable on your laptop:
```bash
export KUMA_COLLECTIVE_URL=http://<vps-ip>:3001
```

Or via `.kuma/config.json`:
```json
{
  "collective": {
    "url": "http://<vps-ip>:3001",
    "autoSync": true,
    "syncIntervalMinutes": 60
  }
}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/patterns` | Submit anonymized patterns |
| `GET` | `/api/v1/patterns?lang=go` | Get global patterns by language |
| `GET` | `/api/v1/stats` | Dashboard statistics |

### Trigger — Manual via AI

Sync is **manually triggered** by the AI agent calling the Kuma tool. There is no background scheduler — the AI decides when to sync based on context.

```bash
# Sync patterns to your VPS (sends + receives)
kuma_advanced({ action: "collective", collectiveAction: "sync" })

# Preview what data would be sent (safe preview)
kuma_advanced({ action: "collective", collectiveAction: "export" })

# Discover local patterns without sending
kuma_advanced({ action: "collective" })
```

> 💡 The `autoSync` flag in config tells the AI to remember syncing periodically — but the actual call is always made by the AI agent, not by a timer.

---

## 📦 Knowledge Marketplace

Marketplace provides **pre-built knowledge graph templates** for popular frameworks. Installing a template means Kuma instantly understands the framework's structure without having to learn from scratch.

### Usage

```bash
# List all templates
kuma_advanced({ action: "marketplace" })

# Install Laravel template — Kuma instantly understands Laravel MVC
kuma_advanced({ action: "marketplace", marketplaceAction: "install", template: "graph:laravel" })
```

### Available Templates

#### 🔷 TypeScript / JavaScript

| Template | Framework | Knows | Nodes | Edges |
|----------|-----------|-------|-------|-------|
| `graph:hono` | Hono | Middleware chain, RPC mode, typed routes, HonoX, JSX middleware | 35 | 90 |
| `graph:fastify` | Fastify | Plugin system, hooks lifecycle, schema validation, encapsulation | 40 | 100 |
| `graph:elysia` | Elysia (Bun) | Plugin system, Eden Treaty, schema validation, state/derive pattern | 28 | 70 |
| `graph:nextjs` | Next.js App Router | App Router, Server Components, layout structure, route groups | 45 | 120 |
| `graph:nextjs-pages` | Next.js Pages Router | Pages Router, getServerSideProps, API routes, ISR pattern | 38 | 95 |
| `graph:remix` | Remix | Loaders, actions, forms pattern, nested routes, resource routes | 32 | 80 |
| `graph:express` | Express.js | Middleware chain, route handlers, error patterns, app structure | 30 | 85 |

#### ⚛️ React Ecosystem

| Template | Library | Knows | Nodes | Edges |
|----------|---------|-------|-------|-------|
| `graph:tanstack-query` | TanStack Query | Query/mutation pattern, cache invalidation, optimistic updates, infinite queries | 36 | 88 |
| `graph:tanstack-router` | TanStack Router | File-based routing, loaders, search params, route guards, devtools | 30 | 75 |
| `graph:tanstack-table` | TanStack Table | Column definitions, sorting, filtering, pagination, row selection | 22 | 55 |
| `graph:zustand` | Zustand | Store pattern, middleware (persist, devtools, immer), subscribe, slice pattern | 18 | 42 |
| `graph:shadcn` | shadcn/ui | Component structure, Radix primitives, tailwind classes, registry pattern | 50 | 130 |

#### 🗄️ Database (JS/TS)

| Template | ORM | Knows | Nodes | Edges |
|----------|-----|-------|-------|-------|
| `graph:prisma` | Prisma | Schema models, relations, migrations, client queries, middleware hooks | 35 | 85 |
| `graph:drizzle` | Drizzle | Schema definition, relations, SQL-like queries, migrations, Drizzle Kit | 30 | 72 |

#### Other Languages

| Template | Framework | Knows | Nodes | Edges |
|----------|-----------|-------|-------|-------|
| `graph:laravel` | Laravel (PHP) | Controllers, Services, Repositories, Middleware, Blade, Eloquent | 50 | 140 |
| `graph:spring` | Spring Boot (Java) | Controllers, Services, JPA Repositories, Entities, Config | 55 | 150 |
| `graph:django` | Django (Python) | Views, Models, Serializers, URLs, Admin | 40 | 110 |
| `graph:gin` | Gin (Go) | Handlers, Services, Repositories, Middleware, Models | 25 | 65 |
| `graph:axum` | Axum (Rust) | Handlers, Extractors, Services, Repositories, State | 20 | 55 |

> ⚠️ `@kuma-templates/*` packages do not exist on npmjs yet. All built-in templates are generated from Kuma's source code directly — no npm install needed. The npm path exists for future community-published templates.

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

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## License

[MIT](LICENSE)

<div align="center">

**Made with 🐻 for AI agents everywhere**

[Report Bug](https://github.com/plumpslabs/kuma/issues) · [Request Feature](https://github.com/plumpslabs/kuma/issues)

</div>

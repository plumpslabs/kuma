
<div align="center">

<img src="https://raw.githubusercontent.com/plumpslabs/kuma/main/public/kuma.png" alt="Kuma Logo" width="180" />
</div>
# Kuma

**Safety-first context & orchestration engine for AI coding agents.**

[![npm](https://img.shields.io/npm/v/@plumpslabs/kuma?color=amber)](https://npm.im/@plumpslabs/kuma)
[![license: MIT](https://img.shields.io/badge/license-MIT-amber.svg)](LICENSE)
[![node: >=18](https://img.shields.io/badge/node->=18-amber.svg)](https://nodejs.org)

> Works with any MCP-compatible agent: Claude Code, Cursor, Windsurf, Zed, and more.

---

## What is Kuma?

Kuma is an MCP (Model Context Protocol) server that acts as a **pre-modification safety layer** for AI coding agents. Before an agent touches your code, Kuma enforces a research and safety pipeline — like a pre-flight checklist for code changes.

**The Problem:** AI agents often modify code without understanding the full context — missing dependencies, breaking related features, or repeating past mistakes.

**The Solution:** Kuma is a **shadow memory** that injects *"where is this file fragile and why is it written this way"* right before the agent touches it:
- 🪄 **Auto-inject hooks** — gotchas/decisions/history injected before every edit, zero extra steps
- 🧠 **Knowledge graph** — SQLite-based derived cache (hash-verified, never stale)
- 📝 **Decision memory** — ADR-style decision tracking across sessions
- 📊 **Kuma Studio** — Visual dashboard for gotchas, decisions, and shadow-memory metrics

---

## Quick Start

```bash
# Run with npx (zero setup)
npx -y @plumpslabs/kuma

# Or install globally
npm install -g @plumpslabs/kuma
kuma
```

Kuma auto-generates:
- `.kuma/init.md` — Project-specific behavioral rules
- `.kuma/kuma.db` — SQLite knowledge graph (WASM, zero native build)
- `.skills/` — Skill files for common patterns

---

## Core Architecture: 3 Pipeline-Driven Tools

Kuma provides **3 coarse-grained tools** with impactful actions. Removed gimmick actions (add_node, feature, heal, harvest, session_mine, todo, context, benchmark, domain_rules, layers, noise_policy, lock, override, policy, contract, portability, doctor, gitignore, clean, progressive, sync, visualize, researches) are no longer documented.

### 🧠 `kuma_context` — Context & Research

| Action | Purpose | Impact |
|--------|---------|--------|
| `init` | Lean project brief + restore session | 🔴 Required first |
| `research` | 5-step pipeline: cache → graph → scan → impact → decision | 🔴 Required before edits |
| `history` | Why is this file written this way (cross-session trace) | 🔴 High |
| `flow` | Hash-verified derived flow cache (F13) | 🔴 High |
| `impact` | Analyze change effects on related code | 🟡 Linear |
| `navigate` | Trace code flow across files | 🟡 Linear |
| `changes` | View change log for current session | 🟡 Linear |
| `rollback` | Undo a specific change by ID | 🟡 Linear |
| `digest` | Ultra-compact <500 token project briefing | 🟡 Linear |
| `drift` | Detect memory staleness & code drift | 🟡 Linear |
| `resume` | Load previous session context | 🟡 Linear |

### 💾 `kuma_memory` — Decision & Knowledge

| Action | Purpose | Impact |
|--------|---------|--------|
| `gotcha` | Record bugs/quirks IMMEDIATELY | 🔴 Exponential |
| `arch_flow` | Record architecture flow (max 5 core files) | 🔴 Exponential |
| `decision` | Record ADR-style decision with rationale | 🔴 Exponential |
| `research_save` | Save research findings to cache | 🟡 Linear |
| `mine` | Mine git history for hidden decisions | 🟡 Linear |
| `session` | View session summary | 🟢 Skip |
| `search` | Search knowledge graph | 🟡 Linear |
| `delete_node` | Remove node/gotcha from graph + table | 🟡 Linear |
| `goal_progress` | Track goal completion | 🟢 Skip |

### 🛡️ `kuma_safety` — Safety & Verification

| Action | Purpose | Impact |
|--------|---------|--------|
| `guard` | Detect anti-patterns, drift, runaway loops | 🔴 Required |
| `verify` | Auto-run scoped tests after edits | 🔴 High |
| `check` | Pre-execution safety check | 🟡 Linear |
| `audit` | Query safety audit trail | 🟡 Linear |
| `health` | Project health score (optional/cosmetic) | 🟢 Skip |
| `security` | Scan for leaked secrets/tokens | 🟡 Linear |
| `gc` | Garbage collect stale data | 🟢 Skip |
| `ast` / `validate` | AST-based code validation | 🟡 Linear |
| `checkpoint` | Atomic snapshot before refactors | 🟡 Linear |
| `rollback_label` | Restore from checkpoint | 🟡 Linear |

---

## Architecture

Kuma exposes exactly **3 coarse-grained tools** — the agent picks an *action*, Kuma runs the internal workflow:

| Tool | Core Actions | Purpose |
|------|--------------|---------|
| `kuma_context` | `init`, `research`, `history` | Load project context, understand unfamiliar code |
| `kuma_memory` | `gotcha`, `decision`, `arch_flow`, `research_save` | Persistent knowledge that saves future sessions |
| `kuma_safety` | `guard`, `verify` | Pre-risk check, post-edit verification |

Everything else is an internal action for power users. The agent uses its **own native tools** for editing, searching, and execution — Kuma is memory & safety, not a code manager.

### What Kuma Provides

- **Knowledge Graph** — SQLite + FTS5 full-text search (derived cache)
- **Session Memory** — track tool calls, recordings, and efficiency per session
- **Guard System** — real-time monitoring with blocking warnings for anti-patterns
- **Shadow Injection** — gotchas injected before edits via hooks (zero token waste when clean)
- **Kuma Studio** — visual dashboard with graph, gotchas, and injection metrics
- **Checkpoint/Rollback** — atomic snapshots before major refactors

---

## Kuma Studio

Kuma Studio is a **web-based dashboard** for visualizing and managing your knowledge graph.

### Features

- **📊 Knowledge Graph** — Interactive node-edge visualization with physics simulation
- **⚠️ Gotchas** — Known bugs and quirks with severity levels
- **⚡ Efficiency** — Session metrics, time saved, verification pass rates
- **🪄 Injections** — Shadow-memory metrics: injection count + time saved (24h)
- **📈 Staleness** — Detection of stale nodes with missing file references

### Usage

```bash
# Start Kuma Studio
kuma studio

# Or via npx
npx -y @plumpslabs/kuma studio
```

Studio runs at `http://localhost:3322` and provides:
- Real-time graph visualization
- Copy report functionality for activity analysis
- Node detail modals with relations and gotchas
- Search and filter capabilities
- Physics-based graph layout with depth controls

---

## Knowledge Graph Schema

Kuma builds a comprehensive knowledge graph with these node types:

| Node Type | Description |
|-----------|-------------|
| `feature` | High-level module (e.g., Auth, Billing) |
| `arch_flow` | Architecture flow between files |
| `gotcha` | Known bug or quirk |
| `decision` | ADR-style decision with rationale |
| `function` | Function or method |
| `class` | Class definition |
| `component` | UI component |
| `file` | Source file |
| `api_route` | API endpoint |
| `test` | Test file |
| `research` | Research cache entry |

Edge types include: `contains`, `flows_through`, `owns`, `explains`.

---

## Safety Layer

### Audit Trail

Every safety check is logged to the audit trail:
- Tool name and parameters
- Risk level (low/medium/high/critical)
- Allowed/blocked decision
- Duration and metadata

---

## Workflow

A typical Kuma-powered session follows this flow:

```
1. INIT          → kuma_context({ action: 'init' })
                   Load project brief, restore session context

2. RESEARCH      → kuma_context({ action: 'research', scope: '<area>' })
                   5-step pipeline: cache → graph → impact → decision → safety

3. GUARD         → kuma_safety({ action: 'guard' })
                   Check for anti-patterns, drift, runaway loops

4. EDIT          → Agent modifies code (native tools)

5. RECORD        → kuma_memory({ action: 'gotcha' | 'arch_flow' | 'decision' })
                   Record what was learned for future sessions

6. VERIFY        → kuma_safety({ action: 'verify' })
                   Auto-run scoped tests + AST validation

7. REVIEW        → kuma_context({ action: 'changes' })
                   Review what was modified this session
```

---

## Per-Project Context Model

Kuma stores all context locally in `.kuma/`:

```
.kuma/
├── kuma.db          # SQLite knowledge graph (WASM) — nodes, edges, research cache, changes
├── init.md          # Project behavioral rules (generated by `kuma init`)
├── memory.json      # Session state + metrics (auto)
├── auto-gotcha.json # Self-learning loop state (auto)
├── policy.yml       # OPTIONAL safety policy — only read if you create it
├── memories/        # Memory layer markdown (decisions.md, arch_flow.md, ...)
├── checkpoints/     # Atomic snapshots (label/ with kuma.db + files/)
└── scratch/         # Temp debug artifacts (auto, ephemeral)
```

> Hooks are registered in `.claude/settings.json` (PreToolUse) — not stored under `.kuma/`.

> Research cache is **not** a folder — it lives in the `research_cache` table inside `kuma.db`.

**Key principle:** Context is per-project, per-agent. No shared state between projects.

---

## Why Kuma?

| Problem | Without Kuma | With Kuma |
|---------|--------------|-----------|
| **Context** | Agent forgets project-specific patterns | Knowledge graph persists across sessions |
| **Safety** | Agent may break critical code | Policy engine blocks risky operations |
| **Impact** | Agent doesn't know what's affected | Impact analysis traces dependencies |
| **Coordination** | Multiple agents conflict | Per-agent session state + audit trail avoid collisions |
| **Memory** | Agent repeats past mistakes | Decision memory + gotchas prevent loops |
| **Reversibility** | Hard to undo changes | Checkpoint snapshots + selective undo |
| **Staleness** | Knowledge becomes outdated | Drift detection + gotcha staleness checks flag stale data |

---

## Installation

```bash
# Global install
npm install -g @plumpslabs/kuma

# Or use npx (no install needed)
npx -y @plumpslabs/kuma

# With pnpm
pnpm add -g @plumpslabs/kuma
```

### Requirements

- Node.js >= 18.0.0
- No native dependencies (uses WASM for SQLite)

---

## CLI Commands

```bash
# Start MCP server (default)
kuma

# Start Kuma Studio dashboard
kuma studio

# Initialize a project
kuma init

# Show version
kuma --version

# Show help
kuma --help
```

---

## Configuration

### MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop):

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

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KUMA_DB_PATH` | Custom database path | `.kuma/kuma.db` |
| `KUMA_POLICY_PATH` | Custom policy file | `.kuma/policy.yml` |
| `KUMA_STUDIO_PORT` | Studio server port | `3322` |

---

## Development

```bash
# Clone the repo
git clone https://github.com/plumpslabs/kuma.git
cd kuma

# Install dependencies
pnpm install

# Build
pnpm run build:all

# Run tests
pnpm test

# Start studio in dev mode
pnpm run studio:dev
```

---

## Power Curve: What to Record

| What to Record | When | Why | Impact |
|----------------|------|-----|--------|
| `arch_flow` | After tracing a complete flow | Saves 5-10 files next session | 🔴 Exponential |
| `gotcha` | IMMEDIATELY when finding bugs | Prevents re-discovery | 🔴 Exponential |
| `decision` | When choosing between options | Preserves rationale | 🔴 Exponential |
| `feature` | When identifying a module | Creates owns edges to files | 🔴 Exponential |
| `research_save` | After exploring an area | Creates search cache | 🔴 Exponential |
| Function/class nodes | Skip | Agent can grep/glob | 🟢 Skip |
| Import edges | Skip | Agent can read imports | 🟢 Skip |
| Visual graph | Skip | For humans, not AI | 🟢 Skip |

---

## License

MIT — use freely in personal and commercial projects.

---

## Community

- **GitHub:** [github.com/plumpslabs/kuma](https://github.com/plumpslabs/kuma)
- **Issues:** [github.com/plumpslabs/kuma/issues](https://github.com/plumpslabs/kuma/issues)
- **npm:** [npm.im/@plumpslabs/kuma](https://npm.im/@plumpslabs/kuma)

---

<p align="center">
  <sub>Built with 🧠 by the Kuma community</sub>
</p>

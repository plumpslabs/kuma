
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

**The Solution:** Kuma ensures every modification is informed by:
- 🧠 **Project-specific knowledge graph** — SQLite-based graph of nodes, edges, gotchas, and decisions
- 🔍 **Mandatory research pipeline** — 5-step context gathering before any edit
- 🛡️ **Safety policies** — Configurable rules that block risky operations
- 📝 **Decision memory** — ADR-style decision tracking across sessions
- 🔄 **Self-healing** — Automatic detection and repair of stale knowledge
- ↩️ **Selective undo** — Symbol-level change tracking for precise reverts
- 📊 **Kuma Studio** — Visual dashboard for knowledge graph, efficiency metrics, and activity tracking

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
- `.kuma/policy.yml` — Customizable safety policies
- `.skills/` — Skill files for common patterns

---

## Core Architecture: 3 Pipeline-Driven Tools

Kuma V3 consolidates 46+ micro-tools into **3 coarse-grained tools**. Each action triggers an internal multi-step workflow — the agent doesn't chain individual calls.

### 🧠 `kuma_context` — Context & Research

| Action | Purpose | Impact |
|--------|---------|--------|
| `init` | Load project brief, restore session | 🔴 Required first |
| `research` | 5-step pipeline: cache → graph → impact → decision → safety | 🔴 Required before edits |
| `impact` | Analyze change effects on related code | 🔴 High |
| `navigate` | Trace code flow across files | 🟡 Linear |
| `changes` | View change log for current session | 🟡 Linear |
| `health` | Project health score (0-100) | 🟡 Linear |
| `rollback` | Undo a specific change by ID | 🟡 Linear |
| `sync` | Unified batch state query | 🟢 Skip (agent native) |
| `digest` | Ultra-compact <500 token project briefing | 🟡 Linear |
| `drift` | Detect memory staleness & code drift | 🟡 Linear |
| `progressive` | Progressive context loading | 🟡 Linear |

### 💾 `kuma_memory` — Decision & Knowledge

| Action | Purpose | Impact |
|--------|---------|--------|
| `research_save` | Save research findings to cache | 🔴 Exponential |
| `gotcha` | Record bugs/quirks IMMEDIATELY | 🔴 Exponential |
| `arch_flow` | Record architecture flow (max 5 core files) | 🔴 Exponential |
| `decision` | Record ADR-style decision with rationale | 🔴 Exponential |
| `feature` | Record high-level feature with owns edges | 🔴 Exponential |
| `mine` | Mine git history for hidden decisions | 🟡 Linear |
| `session` | View session summary | 🟢 Skip |
| `heal` | Repair stale graph entries | 🟡 Linear |
| `search` | Search knowledge graph | 🟡 Linear |
| `todo` | Manage persistent todos | 🟡 Linear |
| `context` | Inject notes into context | 🟡 Linear |
| `benchmark` | Capture/diff performance metrics | 🟡 Linear |
| `domain_rules` | Layer 1: Business rules | 🟡 Linear |
| `layers` | View all 3 memory layers | 🟢 Skip |

### 🛡️ `kuma_safety` — Safety & Policy

| Action | Purpose | Impact |
|--------|---------|--------|
| `guard` | Detect anti-patterns, drift, runaway loops | 🔴 Required |
| `verify` | Auto-run scoped tests + AST validation | 🔴 High |
| `check` | Pre-execution safety check | 🟡 Linear |
| `audit` | Query safety audit trail | 🟡 Linear |
| `lock` | Multi-agent coordination lock | 🟡 Linear |
| `health` | Safety health score | 🟡 Linear |
| `override` | Bypass safety (recorded in audit) | 🟡 Linear |
| `security` | Scan for leaked secrets | 🟡 Linear |
| `gc` | Garbage collect stale data | 🟢 Skip |
| `doctor` | Full health check | 🟡 Linear |
| `policy` | Policy-as-Code engine | 🟡 Linear |
| `ast` / `validate` | AST-based code validation | 🟡 Linear |
| `checkpoint` | Atomic snapshot before refactors | 🟡 Linear |
| `rollback_label` | Restore from checkpoint | 🟡 Linear |
| `contract` | Pre/post-condition checks | 🟡 Linear |

---

## V3 Changes: What's New

Kuma V3 is a major evolution focusing on **simplicity, safety, and agent-native workflows**.

### Dropped Tools (Now Handled by Agents)

| Dropped Tool | Why Dropped |
|--------------|-------------|
| `precise_diff_editor` | Agent has native edit tools |
| `safe_terminal_exec` | Agent executes commands natively |
| `smart_grep` | Agent searches natively (ripgrep, semantic) |
| `batch_file_writer` | Agent creates files natively |
| `ast_validator` (standalone) | Merged into `kuma_safety` as `ast`/`validate` action |
| `git_diff_analyzer` | Merged into `kuma_context` as `impact` action |

### New Features in V3

| Feature | Description |
|---------|-------------|
| **3 Coarse-Grained Tools** | Simplified API: `kuma_context`, `kuma_memory`, `kuma_safety` |
| **Pipeline-Driven Actions** | Each action triggers internal multi-step workflows |
| **Knowledge Graph** | SQLite + FTS5 full-text search with WASM engine |
| **Feature Recording** | Auto-detect and record high-level features with `owns` edges |
| **Session Memory** | Track tool calls, recordings, and efficiency per session |
| **Guard System** | Real-time monitoring with blocking warnings for anti-patterns |
| **Self-Healing** | Automatic detection and repair of stale nodes |
| **Kuma Studio** | Visual dashboard with graph, efficiency, and activity tracking |
| **Policy-as-Code** | Configurable safety rules in `.kuma/policy.yml` |
| **Checkpoint/Rollback** | Atomic snapshots before major refactors |

---

## Kuma Studio

Kuma Studio is a **web-based dashboard** for visualizing and managing your knowledge graph.

### Features

- **📊 Knowledge Graph** — Interactive node-edge visualization with physics simulation
- **⭐ Features** — High-level module tracking with owns edges to files
- **⚠️ Gotchas** — Known bugs and quirks with severity levels
- **💚 Health** — Project health scores over time
- **⚡ Efficiency** — Session metrics, time saved, verification pass rates
- **📈 Staleness** — Detection of stale nodes with missing file references
- **🤖 Activity** — Agent usage intensity, success rates, and session history

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

Edge types include: `calls`, `imports`, `defines`, `tests`, `routes`, `implements`, `extends`, `depends_on`, `owns`, `modified_by`, `contains`, `composes`, `flows_through`, `triggers`, `syncs_with`, `affects`.

---

## Safety Layer

### Policy Engine

Configure safety rules in `.kuma/policy.yml`:

```yaml
rules:
  - name: "No production databases"
    pattern: "DROP TABLE|DELETE FROM.*WHERE 1"
    action: block
    message: "Production database modifications blocked"
    
  - name: "Require tests before deploy"
    pattern: "git push"
    require: "kuma_safety({ action: 'verify' })"
    message: "Run tests before pushing"
```

### Audit Trail

Every safety check is logged to the audit trail:
- Tool name and parameters
- Risk level (low/medium/high/critical)
- Policy violations
- Allowed/blocked decision
- Duration and metadata

### Multi-Agent Lock

Prevent conflicts when multiple agents work on the same project:
```bash
kuma_safety({ action: 'lock', acquire: true })
# ... work ...
kuma_safety({ action: 'lock', release: true })
```

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
├── kuma.db          # SQLite knowledge graph (WASM)
├── init.md          # Project-specific behavioral rules
├── policy.yml       # Safety policies
├── memory.json      # Session metrics and recordings
├── research/        # Research cache files
├── memories/        # Memory layer files (domain_rules, arch_flow, gotcha)
└── checkpoints/     # Atomic snapshots for rollback
```

**Key principle:** Context is per-project, per-agent. No shared state between projects.

---

## Why Kuma?

| Problem | Without Kuma | With Kuma |
|---------|--------------|-----------|
| **Context** | Agent forgets project-specific patterns | Knowledge graph persists across sessions |
| **Safety** | Agent may break critical code | Policy engine blocks risky operations |
| **Impact** | Agent doesn't know what's affected | Impact analysis traces dependencies |
| **Coordination** | Multiple agents conflict | Multi-agent lock prevents collisions |
| **Memory** | Agent repeats past mistakes | Decision memory + gotchas prevent loops |
| **Reversibility** | Hard to undo changes | Selective undo at symbol level |
| **Staleness** | Knowledge becomes outdated | Self-healing detects and repairs stale data |

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

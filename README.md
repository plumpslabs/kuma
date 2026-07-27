<div align="center">

<img src="https://raw.githubusercontent.com/plumpslabs/kuma/main/public/kuma.png" alt="Kuma Logo" width="180" />

# Kuma

**Safety-first context & orchestration engine for AI coding agents**

[![npm](https://img.shields.io/npm/v/@plumpslabs/kuma.svg?logo=npm&color=red)](https://www.npmjs.com/package/@plumpslabs/kuma)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-18+-339933?logo=nodedotjs)](https://nodejs.org/)

Works with **any MCP-compatible agent** — Claude Code, Cursor, Windsurf, Cline, Aider, OpenCode, Codex CLI, Qwen Code, Kiro, and more.

</div>

---

## What is Kuma?

Kuma is an **MCP server** that sits alongside your AI coding agent and enforces a simple rule: *understand before you touch.*

When an agent wants to modify code, Kuma won't let it work blind. It runs a deterministic pipeline: load the research cache, query the knowledge graph, analyze impact across the entire codebase, look up past decisions, and check safety policies — all in one MCP call. Only then does the agent have the context it needs to edit safely.

Kuma is **not** an editor, search tool, linter, or terminal. Those are things your AI agent already does natively. Kuma is the **safety layer** that makes sure those actions are informed, tracked, and reversible.

**Think of it this way:** Your AI agent is the surgeon. Kuma is the pre-op checklist, the patient history, the X-ray, and the post-op report — all in one.

---

## Zero Setup?

**Yes — to run Kuma, you need exactly zero configuration:**

```bash
npx -y @plumpslabs/kuma
```

That's it. The MCP server starts. Your AI agent connects. Kuma auto-generates `.kuma/init.md` (behavioral rules), detects your AI agent, and creates its native skill file — automatically.

The "setup" part is optional: `npx @plumpslabs/kuma init` generates config files for 13 AI agents, but that's just convenience. Kuma works with any MCP client out of the box.

---

## Core Features

### 🧠 Knowledge Graph (SQLite)

Every project gets its own SQLite database (pure WASM, no native build). Kuma builds a graph of **nodes** (files, functions, classes, tests, API routes) and **edges** (calls, imports, defines, tests). This graph is what powers all research, impact analysis, and flow navigation.

- FTS5 full-text search with graceful fallback
- Auto-built, auto-healed, queryable
- Per-project — your context stays with your codebase

### 🔬 Mandatory Research Pipeline

Before an agent edits unfamiliar code, Kuma enforces a 5-step research pipeline:

| Step | What happens |
|------|-------------|
| **1. Load Cache** | Check `.kuma/research/<scope>.json` — fresh or stale? |
| **2. Graph Query** | Find all related nodes and edges in the knowledge graph |
| **3. Impact Analysis** | "If I change X, what breaks?" — references, files, tests, API routes |
| **4. Decision Lookup** | Check past ADR-style decisions and known issues |
| **5. Safety Check** | Policy compliance, active locks, risk level |

All in one MCP call: `kuma_context({ action: "research", scope: "auth" })`. No chaining. No guesswork.

### 🛡️ Safety Layer

| Feature | What it does |
|---------|-------------|
| **Safety Guard** | Anti-pattern detection, drift (edits without tests), tool-loop prevention, unresolved failure checks |
| **Safety Policy** | YAML policy file (`.kuma/policy.yml`) — `never_touch`, `require_review`, `block_commands` |
| **Safety Audit** | Every tool call recorded in SQLite. Queryable trail. Override logging with reasons. |
| **Multi-Agent Lock** | File-level locks prevent multiple AI agents from editing the same file simultaneously |

### 📝 Decision Memory

When Kuma detects a significant change, it can suggest recording an **ADR-style decision**:

```
Context:  "We need stateless tokens that expire in 15min"
Options:  "JWT vs opaque tokens vs session store"
Rationale: "JWT is mobile-compatible, no server-side store needed"
Outcome:  "Implemented JwtPasswordResetService"
```

Saved to the knowledge graph + `.kuma/memories/decisions.md`. Survives across sessions. Readable by both humans and future AI agents.

### 🔄 Self-Healing

The knowledge graph automatically detects stale nodes, repairs via git history (tracks renames), and reduces stale edge weights — all without manual intervention.

### ↩️ Selective Undo

Kuma tracks **symbol-level changes** per session. Instead of file-level rollback, you can see exactly what changed and revert specific modifications without affecting unrelated work:

```
kuma_context({ action: "changes" })  → "Session 3 modified routes.ts:42-67 and db.ts"
```

---

## 3 Tools

Kuma consolidates everything into **3 coarse-grained tools**. Each action triggers a complete workflow internally — one MCP call, not a chain of micro-tools.

### 🧠 `kuma_context` — Context & Research

| Action | Pipelina | Use case |
|--------|----------|----------|
| `init` | Project brief | **Call first every session.** Load graph, detect stack, show structure. |
| `research` | 5-step pipeline | **WAJIB before editing.** Cache → staleness → graph → impact → decisions. |
| `impact` | Graph traversal | "Change validateToken → 42 refs, 15 files, 3 tests, 2 API routes." |
| `navigate` | BFS traversal | "How does login work?" — full call chain from route to database. |
| `changes` | Change log query | "What changed this session?" — selective undo support. |
| `health` | Aggregate scoring | Project health dashboard 0-100 across 9 dimensions. |

### 📝 `kuma_memory` — Decision & Knowledge

| Action | Use case |
|--------|----------|
| `decision` | ADR-style recording: template, suggest, or record. |
| `mine` | Mine historical decisions from git log & inline code comments. |
| `research_save` | Persist research to graph + `.kuma/research/<scope>.json`. |
| `session` | "What happened this session?" — files, failures, progress. |
| `heal` | Self-heal knowledge graph — stale detection, git repair. |
| `search` | Search across memories + knowledge graph. |
| `changes` | Change log for selective undo. |

### 🛡️ `kuma_safety` — Safety & Policy

| Action | Use case |
|--------|----------|
| `guard` | Anti-pattern, drift, tool-loop, and failure checks. |
| `verify` | Integrated auto-verification — auto-detect runner & execute scoped tests. |
| `check` | Pre-execution safety: policy, path, lock, risk level. |
| `audit` | Query audit trail + stats + override log. |
| `lock` | Multi-agent file locking. |
| `health` | Safety score 0-100 with dimension breakdown. |
| `override` | Logged safety bypass with reason. |

---

## VPS / Collective — What Is It?

Kuma has an optional feature called **Kolektif** — collective intelligence. It lets multiple Kuma instances across different projects share anonymized patterns to your own VPS.

**This is entirely optional.** You never need to set it up. Kuma works perfectly fine with zero infrastructure — just local SQLite.

What it does:
- Syncs **anonymized** patterns (error types, tool names, language — no source code, no file names, no git history)
- Helps Kuma learn patterns across projects ("this error pattern is common in Go projects")
- Data goes to **your own VPS**, not a public server

When not configured, Kuma is 100% local. No data leaves your machine.

---

## Context Model: Per-Project

Kuma stores context **per project** in a `.kuma/` directory at your project root:

```
your-project/
├── src/
├── tests/
└── .kuma/              ← Auto-generated by Kuma
    ├── kuma.db         ← Knowledge graph, research cache, audit trail, change log
    ├── init.md         ← Behavioral rules for the AI agent
    ├── config.json     ← Per-project settings
    ├── policy.yml      ← Safety policy
    ├── research/       ← Research records (one JSON per scope)
    └── memories/       ← Persistent decisions, conventions, glossary
```

This means **every project has its own context**. The auth flow in Project A is different from Project B. The knowledge graph, decisions, and research are all project-specific — never mixed.

The VPS collective (optional) is the only cross-project feature, and it only shares anonymized patterns — never code or project-specific context.

---

## Workflow

A typical Kuma-powered session:

```
# 1. Understand the project
kuma_context({ action: "init", goal: "add password reset" })

# 2. Research before touching code (WAJIB)
kuma_context({ action: "research", scope: "auth" })
  → Returns: entry points, flow, 42 refs in 15 files, 3 tests, 2 decisions

# 3. Agent edits using native tools (Claude Code / Cursor / etc.)

# 4. Save what you learned
kuma_memory({ action: "research_save", scope: "auth", confidence: 0.85 })

# 5. Record significant decisions
kuma_memory({
  action: "decision",
  decisionAction: "record",
  title: "Use JWT for password reset tokens",
  context: "Need stateless tokens that expire in 15min",
  rationale: "No session store needed, mobile-compatible",
  outcome: "Implemented JwtPasswordResetService"
})

# 6. Verify nothing broke
kuma_safety({ action: "guard", guardGoal: "add password reset" })

# 7. Check changes for selective undo awareness
kuma_context({ action: "changes" })
```

---

## Why Kuma?

| Need | Problem | Kuma's Answer |
|------|---------|---------------|
| Context | AI agent forgets what happened last session | Knowledge graph + session memory survive across sessions |
| Safety | AI agent edits the wrong file | Policy enforcement + path validation + audit trail |
| Impact | "If I change this, what breaks?" | Graph-based impact analysis — references, tests, API routes |
| Coordination | Two agents editing the same file | Multi-agent file lock |
| Memory | "Why was this decision made?" | ADR-style decision recording, trigger-based |
| Reversibility | "Undo this change, but not that one" | Selective undo via change log |
| Staleness | Graph data is months old | Self-healing with content hash + git-aware repair |

---

## License

MIT

<div align="center">

**Made with 🐻 for AI agents everywhere**

[Report Bug](https://github.com/plumpslabs/kuma/issues) · [Request Feature](https://github.com/plumpslabs/kuma/issues)

</div>

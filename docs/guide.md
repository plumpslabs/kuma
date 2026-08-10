# Kuma Guide

Kuma is a **shadow memory & pre-modification safety engine** for AI coding agents. It records what matters (gotchas, decisions, flows) and injects that knowledge back before every edit — so each session starts smarter than the last.

## Getting Started

### Installation

Kuma runs as an MCP server — no install needed:

```bash
npx -y @plumpslabs/kuma
```

To generate config files for your AI agent:

```bash
npx @plumpslabs/kuma init --all
npx @plumpslabs/kuma init --cursor --claude --aider
```

### Add to MCP Client

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

## Session Workflow

Every session follows this pattern — the full rules live in `.kuma/init.md` (auto-generated, single source of truth).

### Step 1: Init (MUST)

```bash
kuma_context({ action: "init", goal: "add password reset" })
```

Returns:
- Lean project brief + session restore
- Fresh gotchas and injection stats
- Path rules and focus advice

### Step 2: Research (before unfamiliar code)

```bash
kuma_context({ action: "research", scope: "auth" })
```

This triggers the 5-step pipeline:
1. Load research cache from `.kuma/kuma.db` (`research_cache` table)
2. Query knowledge graph for related nodes/edges
3. Run impact analysis (references, tests, API routes)
4. Lookup past decisions and known issues
5. Safety check (risk level)

### Step 3: Edit (Native Agent Tools)

Use your AI agent's native edit capabilities. Kuma is not an editor — and Claude Code hooks inject relevant gotchas automatically before each edit.

### Step 4: Record What Matters

```bash
# Record a gotcha — IMMEDIATELY when a bug/quirk is found
kuma_memory({
  action: "gotcha",
  scope: "src/auth.ts",
  content: "JWT decode expects req.user — missing middleware causes silent 500",
  status: "high"
})

# Record an ADR-style decision when choosing between options
kuma_memory({
  action: "decision",
  title: "Use JWT for password reset tokens",
  context: "Need stateless tokens that expire in 15min",
  rationale: "No session store needed, mobile-compatible",
  outcome: "Implemented JwtPasswordResetService"
})

# Record a traced flow (max 5 core files)
kuma_memory({
  action: "arch_flow",
  content: "domain: AuthFlow | hops: auth.ts → middleware.ts → route.ts"
})

# Cache research findings
kuma_memory({ action: "research_save", scope: "auth" })
```

**Recording rules:** record gotchas/decisions IMMEDIATELY, arch_flow AFTER tracing a complete flow, and SKIP low-value nodes (functions/classes/components — grep is faster).

### Step 5: Verify After Edits

```bash
kuma_safety({ action: "verify", scope: "auth" })
```

### Step 6: Snapshot Before Risky Work

```bash
# Before a risky refactor — the ONE rollback mechanism
kuma_safety({ action: "checkpoint", label: "pre-refactor-auth" })

# If something breaks — restore by label
kuma_safety({ action: "rollback_label", label: "pre-refactor-auth" })
```

---

## Safety Features

### Safety Guard

```bash
kuma_safety({ action: "guard", guardGoal: "refactor auth" })
```

Detects:
- **Missing Research** — editing unfamiliar code without research
- **Missing Recordings** — many tool calls with 0 recordings (knowledge loss)
- **AST Anti-Patterns** — editing generated files, test snapshots, dist directories
- **Scope Mismatch** — editing files outside declared scope
- **Loop Detection** — same tool+params called 10+ times

### Checkpoints & Rollback

Snapshots are the single rollback mechanism (change-ID rollback was removed):

```bash
kuma_safety({ action: "checkpoint", label: "pre-x" })      # snapshot
kuma_safety({ action: "rollback_label", label: "pre-x" })  # restore
```

If `rollback_label` can't find the label, it lists the available labels so you never restore blind.

---

## What Kuma Stores (.kuma/)

Kuma persists project knowledge in `.kuma/` — you can read these files directly, but never edit them by hand (record via the actions instead):

| File | Contents | Read via |
|------|----------|----------|
| `init.md` | Behavioral rules | read directly |
| `KNOWN_GOTCHAS.md` | Gotchas (human-readable) | `history` or read directly |
| `ARCHITECTURE_FLOW.md` | Recorded flows | `flow` or read directly |
| `memories/decisions.md` | Decision log (ADR-style) | `history` or read directly |
| `kuma.db` | SQLite graph (nodes, edges, research cache) | `search` |
| `memory.json` | Session memory (internal) | `init` auto-restores |
| `auto-gotcha.json` | Loop auto-capture state (internal) | — |

---

## Auto-Inject

Kuma auto-injects gotchas, decisions, and history before edits via:
- **Claude Code:** `kuma hook pre-edit` + `kuma hook pre-bash` (PreToolUse hooks)
- **Cursor:** `.cursor/rules/kuma-gotchas/*.mdc` (globs-based gotcha rules)
- **Other agents:** Prompt-level instructions in skill files

Zero extra steps from the agent. Returns `{}` for files with no gotchas.

---

## Kuma Studio

Kuma Studio is a web-based dashboard for visualizing and managing your knowledge graph.

### Starting Studio

```bash
kuma studio
# or
npx -y @plumpslabs/kuma studio
```

Studio runs at `http://localhost:3322` and provides:

- **Knowledge Graph** — Interactive node-edge visualization with physics simulation
- **Gotchas** — Known bugs and quirks with severity levels
- **Shadow Memory** — Injection count, estimated time saved, hook status
- **Efficiency / Staleness / Activity** — Token-savings estimates, drift detection, session activity

---

## Matcha Pairing

Kuma pairs with [Matcha](https://github.com/plumpslabs/matcha) — an engineering philosophy ruleset for deliberate thinking — but **works standalone**:

- **Kuma (standalone):** Shadow memory + pre-edit safety injection
- **Kuma + Matcha:** Matcha adds planning gate, intensity levels, and review discipline on top — Kuma supplies the memory and gotcha layer

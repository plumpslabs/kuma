# Kuma Guide

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

Every session follows this pattern:

### Step 1: Init

```bash
kuma_context({ action: "init", goal: "add password reset" })
```

Returns:
- Project architecture overview
- Framework detection
- Entry points
- Recent session activity
- Known risk areas

### Step 2: Research (WAJIB)

Before modifying any unfamiliar code:

```bash
kuma_context({ action: "research", scope: "auth" })
```

This triggers the 5-step pipeline:
1. Load research cache from `.kuma/research/auth.json`
2. Query knowledge graph for related nodes/edges
3. Run impact analysis (references, tests, API routes)
4. Lookup past decisions and known issues
5. Safety check (policy, locks, risk level)

### Step 3: Edit (Native Agent Tools)

Use your AI agent's native edit capabilities. Kuma is not an editor.

### Step 4: Save Research

```bash
kuma_memory({
  action: "research_save",
  scope: "auth",
  content: "Auth flow uses JWT with refresh tokens",
  confidence: 0.85
})
```

### Step 5: Record & Mine Decisions

Record new decisions or mine historical decisions from git history & comments:

```bash
# Record a new decision
kuma_memory({
  action: "decision",
  decisionAction: "record",
  title: "Use JWT for password reset tokens",
  context: "Need stateless tokens that expire in 15min",
  rationale: "No session store needed, mobile-compatible",
  outcome: "Implemented JwtPasswordResetService"
})

# Mine historical decisions from git history & comments
kuma_memory({ action: "mine", scope: "auth" })
```

### Step 6: Auto-Verification & Safety Guard

```bash
# Run auto-verification on scoped tests
kuma_safety({ action: "verify", scope: "auth" })

# Check safety guard & anti-patterns
kuma_safety({ action: "guard", guardGoal: "add password reset" })
```

Checks:
- Anti-patterns
- Drift (edits without tests)
- Tool loops
- Unresolved failures

### Step 7: Check Changes

```bash
kuma_context({ action: "changes" })
kuma_memory({ action: "changes" })
```

---

## Research Pipeline Details

The 5-step research pipeline is Kuma's core differentiator. Here's what happens at each step:

### STEP 1: Load Cache

Checks `.kuma/research/<scope>.json`:
- If found → compares content hash against current code
- If stale (hash mismatch) → proceeds to STEP 2
- If fresh → returns cached result with confidence score

### STEP 2: Graph Query

Queries the SQLite knowledge graph:
- Finds all nodes related to the scope
- Maps edges (calls, imports, defines, tests)
- Identifies entry points and dependencies

### STEP 3: Impact Analysis

Graph traversal to find:
- **References**: How many places reference each symbol?
- **Files**: Which files would be affected?
- **Tests**: Which test files cover this code?
- **API Routes**: Which endpoints are affected?

### STEP 4: Decision Lookup

Checks persistent memory:
- Previous ADR-style decisions
- Known issues and workarounds
- Recurring failure patterns

### STEP 5: Safety Check

Validates:
- Policy compliance (`.kuma/policy.yml`)
- Active locks on target files
- Risk level assessment

---

## Selective Undo

Kuma tracks **symbol-level changes** per session in the knowledge graph:

```bash
# View changes from current session
kuma_context({ action: "changes" })

# View changes since a specific time
kuma_context({ action: "changes", since: 1722000000000 })

# Filter by file
kuma_context({ action: "changes", target: "src/auth.ts" })
```

The change log enables selective undo — revert specific modifications without affecting other changes in the same session.

---

## Self-Healing

Kuma's knowledge graph automatically detects and repairs stale entries:

```bash
# Check for stale entries
kuma_memory({ action: "heal", healAction: "check" })

# Auto-heal
kuma_memory({ action: "heal" })
```

What it checks:
- **Content Hash**: Files changed since last scan
- **All-Node Scan**: Files, functions, classes, interfaces, modules, tests
- **Git-Aware Repair**: Tracks file renames via `git log --follow --diff-filter=R`
- **Cascading Edges**: Stale node edges get weight reduced to near-zero
- **Confidence Scoring**: Age + file existence + edge weight

---

## New in This Release

### 🧬 3-Layer Memory Engine (Issue #17)

Kuma now has structured memory across 3 layers:

| Layer | Action | What it stores |
|-------|--------|----------------|
| **Layer 1 — Domain Rules** | `kuma_memory({ action: 'domain_rules' })` | Business logic constraints, project invariants |
| **Layer 2 — Architecture Flow** | `kuma_memory({ action: 'arch_flow' })` | Code flow maps, entry-to-exit paths |
| **Layer 3 — Gotchas** | `kuma_memory({ action: 'gotcha' })` | Known pitfalls, workarounds, anti-regression facts |

```bash
# View all layers
kuma_memory({ action: "layers" })
```

### 📜 Policy-as-Code Engine (Issue #24)

Evaluate commands against `.kuma/policy.yml` before execution:

```bash
kuma_safety({ action: "policy", command: "rm -rf node_modules" })
```

**Returns:** Command verdict (allowed/blocked), blocked-by rule, warnings, and override instructions.

### 🔬 AST-Based Code Validation (Issue #22)

Validate JS/TS code structure & patterns:

```bash
# Validate a file
kuma_safety({ action: "ast", scope: "src/auth.ts" })

# Validate inline code
kuma_safety({ action: "validate", command: "function foo() { return bar; }", scope: "example.ts" })
```

### ⚡ Context Digest & Drift Detection

```bash
# Ultra-compact project briefing (<500 tokens)
kuma_context({ action: "digest" })

# Detect memory staleness & code drift
kuma_context({ action: "drift" })
```

### 🎨 Knowledge Graph Visualizer (Issue #16)

Generate interactive Mermaid diagrams:

```bash
kuma_context({ action: "visualize", scope: "auth" })
```

### 🔄 Unified Batch API (Issue #12)

Combine init + health + memory in one call (~60-70% token savings):

```bash
kuma_context({ action: "sync", goal: "add password reset" })
```

---

## Safety Features

### Safety Guard

```bash
kuma_safety({ action: "guard", guardGoal: "refactor auth" })
```

Detects:
- **Anti-patterns**: Script patching, bash grep, unsafe patterns
- **Drift**: Edits made without corresponding tests
- **Tool Loops**: Same tool called 4+ times in last 10 calls
- **Unresolved Failures**: Previous session failures not addressed

### Safety Check

```bash
kuma_safety({ action: "check", actionCheck: "edit", filePath: "auth.ts" })
```

Validates:
- Path is within project directory
- File is not in `never_touch` policy
- Command is not blocked
- No active locks on the file

### Safety Policy

Configure via `.kuma/policy.yml`:

```yaml
never_touch:
  - "src/config/*"
  - "package.json"
require_review:
  - "src/database/*"
  - "src/api/*"
require_tests:
  - "src/services/*"
block_commands:
  - "rm -rf"
  - "git push --force"
```

### Multi-Agent Lock

```bash
kuma_safety({ action: "lock", lockAction: "acquire", lockFilePath: "auth.ts" })
kuma_safety({ action: "lock", lockAction: "release", lockFilePath: "auth.ts" })
kuma_safety({ action: "lock", lockAction: "list" })
kuma_safety({ action: "lock", lockAction: "clean" })
```

### Security Leak Scanner

Scan files for leaked credentials/tokens:

```bash
kuma_safety({ action: "security", filePath: "src/config.ts" })
```

### Kuma Hygiene — GC, Doctor, Clean

```bash
# Garbage collection — orphan cleanup, VACUUM, index maintenance
kuma_safety({ action: "gc" })

# Health diagnostics — DB integrity, schema health, process monitoring
kuma_safety({ action: "doctor" })

# Purge scratch directory + reset drift warnings
kuma_safety({ action: "clean" })
```

---

## config.json

```json
{
  "collective": {
    "url": "http://your-vps:3001",
    "autoSync": true,
    "syncIntervalMinutes": 60
  }
}
```

---

## Matcha Pairing

Kuma pairs with [Matcha](https://github.com/plumpslabs/matcha) — an engineering philosophy ruleset for deliberate thinking:

- **Kuma**: Runtime safety (rollback, circuit breaker, sandbox)
- **Matcha**: Session discipline (planning gate, cleanup scan, intensity levels)

---

## Kuma Studio

Kuma Studio is a web-based dashboard for visualizing and managing your knowledge graph.

### Starting Studio

```bash
# Start Kuma Studio
kuma studio

# Or via npx
npx -y @plumpslabs/kuma studio
```

Studio runs at `http://localhost:3322` and provides:

- **Knowledge Graph** — Interactive node-edge visualization with physics simulation
- **Features** — High-level module tracking with owns edges to files
- **Gotchas** — Known bugs and quirks with severity levels
- **Health** — Project health scores over time
- **Efficiency** — Session metrics, time saved, verification pass rates
- **Staleness** — Detection of stale nodes with missing file references
- **Activity** — Agent usage intensity, success rates, and session history

### Copy Report

The Activity tab includes a **Copy Report** button that exports all activity data to clipboard for analysis.

---

## Feature Recording

Features are high-level modules (e.g., Auth, Billing, Dashboard) that own multiple files.

### Recording Features

```bash
kuma_memory({
  action: "feature",
  title: "Authentication",
  content: "User login, logout, session management",
  scope: "src/auth/login.ts,src/auth/session.ts,src/auth/middleware.ts",
  tags: "security,core",
  status: "high"
})
```

### Auto-Detection

Kuma automatically suggests feature recording when:
- Agent explores 3+ files in the same directory
- Session miner detects directory exploration patterns

### Benefits

- Creates `owns` edges from feature to files
- Helps future sessions understand module boundaries
- Improves impact analysis accuracy

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

### Step 5: Record Decisions

```bash
kuma_memory({
  action: "decision",
  decisionAction: "record",
  title: "Use JWT for password reset tokens",
  context: "Need stateless tokens that expire in 15min",
  rationale: "No session store needed, mobile-compatible",
  outcome: "Implemented JwtPasswordResetService"
})
```

### Step 6: Safety Guard

```bash
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

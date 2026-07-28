# Kuma API Reference

Kuma V3 provides **3 coarse-grained tools**. Each tool accepts an `action` parameter that triggers a multi-step deterministic pipeline.

---

## kuma_context

Context, research, and understanding. **Call `init` first every session.**

### Actions

#### `init`

Load project brief. Call first every session.

```json
{
  "action": "init",
  "goal": "add password reset",
  "compact": false
}
```

**Returns:** Project architecture, entry points, framework detection, recent activity, risk areas.

#### `research`

5-step research pipeline. **WAJIB before editing unfamiliar code.**

```json
{
  "action": "research",
  "scope": "auth",
  "compact": false
}
```

**Pipeline:** Load cache → check staleness → query graph → impact analysis → decision lookup.

**Returns:** Entry points, flow, dependencies, test files, risk areas, past decisions, confidence score.

#### `impact`

Analyze what would break if you change a symbol or file.

```json
{
  "action": "impact",
  "target": "validateToken"
}
```

**Returns:** Reference count, affected files, test files, API routes, dependencies.

#### `navigate`

Trace code flow from entry point to leaf.

```json
{
  "action": "navigate",
  "target": "login"
}
```

**Returns:** Full call chain with file:line references.

#### `changes`

View change log for selective undo.

```json
{
  "action": "changes",
  "target": "src/auth.ts",
  "since": 1722000000000,
  "compact": false
}
```

**Returns:** Modified files, timestamps, diff summaries per change.

#### `health`

Project health dashboard (0-100 score).

```json
{
  "action": "health",
  "goal": "add password reset"
}
```

**Returns:** Safety score, dimension breakdown, risk level, summary.

#### `rollback`

Rollback a specific change by ID from the change log.

```json
{
  "action": "rollback",
  "target": "5"
}
```

**Returns:** Rollback result with restored file content.

#### `researches`

List all cached research scopes.

```json
{
  "action": "researches"
}
```

**Returns:** List of cached research with scope, confidence, and age.

#### `sync`

Unified batch API — combines init + health + memory state in single roundtrip (~60-70% token savings).

```json
{
  "action": "sync",
  "goal": "add password reset",
  "compact": false
}
```

**Returns:** Session state, health score, graph stats, proactive memories.

#### `visualize`

Generate Mermaid knowledge graph diagrams.

```json
{
  "action": "visualize",
  "scope": "auth"
}
```

**Returns:** Mermaid flowchart diagram of the knowledge graph.

#### `digest`

Ultra-compact project briefing (<500 tokens). Fastest way to bootstrap context.

```json
{
  "action": "digest"
}
```

**Returns:** Compact summary: 3-layer memory status, overview, gotchas.

#### `drift`

Detect memory staleness & code drift between knowledge graph and filesystem.

```json
{
  "action": "drift"
}
```

**Returns:** Stale records, code drift warnings, freshness status.

---

## kuma_memory

Decision recording, knowledge persistence, and graph maintenance.

### Actions

#### `decision`

ADR-style decision recording.

```json
{
  "action": "decision",
  "decisionAction": "record",
  "title": "Use JWT for password reset tokens",
  "context": "Need stateless tokens that expire in 15min",
  "rationale": "No session store needed, mobile-compatible",
  "outcome": "Implemented JwtPasswordResetService"
}
```

Sub-actions: `record` (save decision), `template` (show template), `suggest` (detect scope and suggest recording).

#### `mine`

Mine historical decisions from git log and inline code comments (`HACK`, `FIXME`, `TODO`, `XXX`, `WARNING`).

```json
{
  "action": "mine",
  "scope": "auth",
  "since": "1 year",
  "confirm": false
}
```

Set `confirm: true` to confirm and record mined candidate decisions into the knowledge graph & decision log.

#### `research_save`

Save research results to graph + `.kuma/research/`.

```json
{
  "action": "research_save",
  "scope": "auth",
  "content": "Auth flow uses JWT with refresh tokens",
  "confidence": 0.85
}
```

To pass a pre-built record:

```json
{
  "action": "research_save",
  "record": "{\"scope\":\"auth\",\"confidence\":0.9,\"entryPoints\":[\"AuthController.login\"],\"flow\":[\"POST /login → AuthController.login → AuthService.validate → UserRepository.findByEmail\"]}"
}
```

#### `session`

Current session summary.

```json
{
  "action": "session",
  "topic": "auth",
  "compact": false
}
```

**Returns:** Modified files, failures, goal progress, tool call history.

#### `heal`

Self-heal knowledge graph.

```json
{
  "action": "heal",
  "healAction": "check"
}
```

Sub-actions: `check` (scan for stale nodes), `heal` (auto-repair).

#### `search`

Search across memories + knowledge graph.

```json
{
  "action": "search",
  "query": "jwt token",
  "scope": "auth",
  "limit": 20
}
```

#### `changes`

View change log (alternative to `kuma_context` changes).

```json
{
  "action": "changes",
  "target": "src/auth.ts",
  "since": 1722000000000
}
```

#### `todo`

Persistent todo CRUD with scope, dependencies, and success criteria.

```json
{
  "action": "todo",
  "title": "Refactor auth service",
  "scope": "auth",
  "description": "Split monolithic auth service into smaller modules",
  "deps": "[\"Create UserService\"]",
  "success_criteria": "All auth tests pass, auth.ts < 300 lines"
}
```

**Returns:** Todo list or creation confirmation.

#### `context`

Inject context notes from external sources.

```json
{
  "action": "context",
  "source": "slack",
  "content": "Per discussion in #engineering: we're moving to JWT for auth tokens",
  "scope": "auth"
}
```

#### `benchmark`

Before/after metric capture & diff.

```json
{
  "action": "benchmark",
  "label": "phase-3",
  "metrics": "{\"tsc_errors\": 245, \"test_count\": 120}"
}
```

#### `decision_log`

Living decision document with active/superseded/deprecated status tracking.

```json
{
  "action": "decision_log",
  "title": "Use JWT for auth",
  "rationale": "Stateless, mobile-compatible",
  "status": "active"
}
```

#### `domain_rules`

Layer 1 — Read/write business domain rules (Issue #17).

```json
{
  "action": "domain_rules",
  "content": "All password reset tokens expire in 15 minutes. Refresh tokens last 7 days."
}
```

#### `arch_flow`

Layer 2 — Read/write architecture flow maps (Issue #17).

```json
{
  "action": "arch_flow",
  "content": "Auth Flow: POST /login → AuthController.login → AuthService.validate → UserRepository.findByEmail"
}
```

#### `gotcha`

Layer 3 — Record/list known gotchas & anti-regression facts (Issue #17/#21).

```json
{
  "action": "gotcha",
  "scope": "src/auth.ts",
  "content": "PasswordResetService uses synchronous bcrypt — will block event loop",
  "status": "high",
  "description": "Use bcrypt.hash() with async/await instead"
}
```

#### `layers`

Show all 3 memory layers summary.

```json
{
  "action": "layers"
}
```

**Returns:** Summary of domain rules, architecture flows, and known gotchas.

---

## kuma_safety

Safety checks, policy enforcement, and multi-agent coordination.

### Actions

#### `guard`

Anti-pattern and drift detection.

```json
{
  "action": "guard",
  "guardGoal": "refactor auth",
  "guardCheck": "all"
}
```

Check types: `anti-pattern`, `loop`, `drift`, `context`, `all`.

#### `verify`

Integrated auto-verification. Automatically detects project test runner and executes tests scoped to impact or file paths.

```json
{
  "action": "verify",
  "scope": "auth"
}
```

#### `check`

Pre-execution safety check.

```json
{
  "action": "check",
  "actionCheck": "edit",
  "filePath": "src/auth.ts",
  "toolName": "native_edit"
}
```

#### `audit`

Query safety audit trail.

```json
{
  "action": "audit",
  "limit": 20
}
```

#### `lock`

Multi-agent file locking.

```json
{
  "action": "lock",
  "lockAction": "acquire",
  "lockFilePath": "src/auth.ts",
  "agentId": "agent-1"
}
```

Lock actions: `acquire`, `release`, `list`, `clean`.

#### `health`

Project health score.

```json
{
  "action": "health"
}
```

#### `override`

Logged safety bypass.

```json
{
  "action": "override",
  "toolName": "native_edit",
  "reason": "Trusted minor refactor"
}
```

#### `security`

Security leak scanner — regex-based credential/token detection.

```json
{
  "action": "security",
  "filePath": "src/config.ts"
}
```

#### `gc`

Kuma garbage collection — orphan cleanup, VACUUM, index maintenance.

```json
{
  "action": "gc"
}
```

#### `doctor`

Kuma health diagnostics — DB integrity check, schema audit, process monitoring.

```json
{
  "action": "doctor"
}
```

#### `portability`

Check path portability — ensure no absolute paths in stored data.

```json
{
  "action": "portability"
}
```

#### `gitignore`

Auto-configure `.gitignore` to include `.kuma/`.

```json
{
  "action": "gitignore"
}
```

#### `clean`

Purge scratch directory + reset drift warnings (Issue #10).

```json
{
  "action": "clean"
}
```

#### `policy`

Policy-as-Code engine — evaluate commands against `.kuma/policy.yml` (Issue #24).

```json
{
  "action": "policy",
  "command": "rm -rf node_modules"
}
```

**Returns:** Command verdict (allowed/blocked), blocked-by rule, warnings.

#### `ast` / `validate`

AST-based code validation — validate JS/TS code structure & patterns (Issue #22).

```json
{
  "action": "ast",
  "scope": "src/auth.ts"
}
```

Or validate inline code:

```json
{
  "action": "validate",
  "command": "function foo() { return bar; }",
  "scope": "example.ts"
}
```

**Returns:** Validation findings with line numbers, severities, and descriptions.

---

## Parameter Types

| Parameter | Type | Used In |
|-----------|------|---------|
| `action` | `enum` | All tools |
| `scope` | `string?` | context, memory, safety |
| `target` | `string?` | context, memory |
| `goal` | `string?` | context, safety |
| `query` | `string?` | memory |
| `content` | `string?` | memory |
| `record` | `string?` | memory |
| `confidence` | `number (0-1)?` | memory |
| `confirm` | `boolean?` | memory |
| `decisionAction` | `enum?` | memory |
| `title` | `string?` | memory |
| `context` | `string?` | memory |
| `rationale` | `string?` | memory |
| `outcome` | `string?` | memory |
| `healAction` | `enum?` | memory |
| `topic` | `string?` | memory |
| `guardGoal` | `string?` | safety |
| `guardCheck` | `enum?` | safety |
| `actionCheck` | `enum?` | safety |
| `toolName` | `string?` | safety |
| `reason` | `string?` | safety |
| `lockAction` | `enum?` | safety |
| `lockFilePath` | `string?` | safety |
| `agentId` | `string?` | safety |
| `since` | `number?` | context, memory |
| `limit` | `number?` | memory, safety |
| `compact` | `boolean?` | context, memory |
| `force` | `boolean?` | safety (verify) |
| `command` | `string?` | safety (check/policy/ast) |
| `description` | `string?` | memory (todo/gotcha) |
| `deps` | `string?` | memory (todo) |
| `success_criteria` | `string?` | memory (todo) |
| `source` | `string?` | memory (context) |
| `label` | `string?` | memory (benchmark) |
| `metrics` | `string?` | memory (benchmark) |
| `labelB` | `string?` | memory (benchmark diff) |
| `todoId` | `number?` | memory (todo status update) |
| `status` | `string?` | memory (todo/gotcha/decision_log) |
| `filePath` | `string?` | safety (check/lock/security) |

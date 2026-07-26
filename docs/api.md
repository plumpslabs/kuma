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

---

## Parameter Types

| Parameter | Type | Used In |
|-----------|------|---------|
| `action` | `enum` | All tools |
| `scope` | `string?` | context, memory |
| `target` | `string?` | context, memory |
| `goal` | `string?` | context, safety |
| `query` | `string?` | memory |
| `content` | `string?` | memory |
| `record` | `string?` | memory |
| `confidence` | `number (0-1)?` | memory |
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

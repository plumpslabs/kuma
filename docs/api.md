# Kuma MCP — API Reference

Kuma exposes **3 coarse-grained tools** with **15 core actions**. Anything else was removed —
the MCP schema rejects unknown actions, so the agent never has to choose from 30+ options.

---

## kuma_context — Context & Research

### `init`
Lean project brief + session restore (<500 tokens). Auto-injects focus advice, fresh gotchas, injection stats, and path rules. **MUST be called at session start.**

```json
{ "action": "init", "goal": "add password reset" }
```

**Returns:** Session state, proactive memories, fresh gotchas, injection metrics.

### `research`
5-step pipeline before editing unfamiliar code: cache → graph/scan → impact → decision lookup.

```json
{ "action": "research", "scope": "auth" }
```

### `map`
Analyze workspace topology, detect package boundaries, and map package dependencies in monorepos (pnpm, npm, yarn, lerna).

```json
{ "action": "map" }
```

**Returns:** Workspace root, package manager type, package list with dependencies, cross-package dependencies, and boundary isolation rules.

### `impact`
Calculate blast radius and safety risk before modifying a file or package. Traces direct and transitive consumers, affected test suites, and evaluates risk score.

```json
{ "action": "impact", "target": "packages/core/src/index.ts" }
```

**Parameters:**
- `target` (required) — relative path to file or package name
- `depth` (optional) — traversal depth limit (default: 3)

**Returns:** Direct consumers, transitive consumers, affected tests, risk level (`low`, `medium`, `high`, `critical`), and safety recommendations.

### `history`
Cross-session trace — "why is this file written this way". Shows change log, fresh gotchas, resolved gotchas, relevant decisions.

```json
{ "action": "history", "target": "src/services/auth.ts" }
```

Also injected automatically via `kuma hook pre-edit` before edits.

### `flow`
Read a recorded architecture flow (recorded via `kuma_memory arch_flow`).

```json
{ "action": "flow", "target": "WhatsApp Omnichannel" }
```

---

## kuma_memory — Knowledge Recording

### `gotcha`
Record, resolve, or deprecate a codebase bug/quirk with full lifecycle management (`candidate` → `active` → `verified` → `resolved` → `deprecated`).

```json
{
  "action": "gotcha",
  "scope": "path/to/file.ts",
  "content": "useEffect causes infinite loop when state change triggers re-render",
  "status": "active",
  "severity": "high",
  "description": "Use useCallback on the handler",
  "trigger_command": "npm run build"
}
```

**Resolving or Deprecating:**
```json
{
  "action": "gotcha",
  "scope": "path/to/file.ts",
  "status": "resolved",
  "resolution": "Fixed by memoizing handler in PR #42"
}
```
*(Also accepts alias actions `resolve_gotcha` and `deprecate_gotcha`)*

**Parameters:**
- `scope` (required) — file path or gotcha ID
- `content` (required when creating) — bug description
- `severity` — severity level: `low`, `medium`, `high`, `critical`
- `status` — lifecycle status: `active`, `verified`, `resolved`, `deprecated`
- `description` — workaround or remediation instructions
- `resolution` — explanation when marking as resolved
- `reason` — explanation when marking as deprecated
- `trigger_command` — command that triggers this gotcha (e.g. "npm run seed")

### `arch_flow`
Record architecture flow (max 5 core files).

```json
{
  "action": "arch_flow",
  "content": "domain: AuthFlow | hops: auth.ts → middleware.ts → route.ts | gotchas: rate-limit, token-expiry"
}
```

### `decision`
ADR-style decision recording.

```json
{
  "action": "decision",
  "title": "Use JWT vs Session Cookies",
  "context": "Need stateless tokens that expire in 15min",
  "rationale": "JWT allows stateless verification across services without DB lookup",
  "outcome": "Chose JWT with 15min expiry + refresh tokens"
}
```

### `research_save`
Save research findings to cache + graph.

```json
{ "action": "research_save", "scope": "auth" }
```

To pass a pre-built record:

```json
{ "action": "research_save", "scope": "auth", "record": "{\"scope\":\"auth\",\"confidence\":0.9,\"entryPoints\":[\"AuthController.login\"],\"flow\":[\"POST /login → AuthController.login → AuthService.validate → UserRepository.findByEmail\"]}" }
```

### `search`
Quick lookup of memory + knowledge graph.

```json
{ "action": "search", "query": "auth flow" }
```

---

## kuma_safety — Safety & Verification

### `guard`
Anti-pattern detection before risky edits.

```json
{ "action": "guard", "guardGoal": "Refactoring auth middleware" }
```

### `verify`
Auto-run scoped tests after edits. Rate-limited (30s cooldown).

```json
{ "action": "verify", "scope": "auth" }
```

### `checkpoint`
Create a labeled snapshot before risky work — the ONE rollback mechanism.

```json
{ "action": "checkpoint", "label": "pre-refactor-auth" }
```

### `rollback_label`
Restore from a checkpoint by label. If the label is not found, Kuma lists the available labels.

```json
{ "action": "rollback_label", "label": "pre-refactor-auth" }
```

---

## Auto-Inject Hooks

Kuma auto-injects gotchas, decisions, and history before edits via:

- **Claude Code:** `.claude/settings.json` — `kuma hook pre-edit` + `kuma hook pre-bash`
- **Cursor:** `.cursor/rules/kuma-gotchas/*.mdc` — globs-based gotcha rules
- **Other agents:** Prompt-level instructions in skill files (generated by `kuma init`)

The hook is invisible — it returns `{}` for files with no gotchas, and injects relevant context only when available. No extra steps from the agent.

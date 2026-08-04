# Kuma MCP — API Reference

**Actions listed here are the impactful core. Removed actions (add_node, feature, heal, harvest, session_mine, todo, context, benchmark, decision_log, domain_rules, layers, noise_policy, progressive, sync, visualize, researches, lock, override, policy, contract, portability, doctor, gitignore, clean, template, suggest, record) are no longer documented — they were gimmick features that duplicated grep/glob or added overhead without measurable impact.**

---

## kuma_context

### `init`
Lean project brief + session restore (<500 tokens). Auto-injects focus advice, fresh gotchas, injection stats, and path rules.

```json
{ "action": "init", "goal": "add password reset" }
```

**Returns:** Session state, proactive memories, fresh gotchas, injection metrics.

### `research`
5-step pipeline: cache → staleness → graph/scan → impact → decision lookup.

```json
{ "action": "research", "scope": "auth" }
```

### `impact`
Analyze change effects: references, test files, risk level, entry points.

```json
{ "action": "impact", "target": "src/services/auth.ts" }
```

### `navigate`
Trace code flow from entry point.

```json
{ "action": "navigate", "target": "src/services/auth.ts" }
```

### `flow`
Hash-verified derived domain flow cache (F13). Re-derives from imports when stale.

```json
{ "action": "flow", "target": "WhatsApp Omnichannel" }
```

### `history`
Cross-session trace — "why is this file written this way". Shows change log, fresh gotchas, resolved gotchas, relevant decisions.

```json
{ "action": "history", "target": "src/services/auth.ts" }
```

Also injected automatically via `kuma hook pre-edit` before edits.

### `changes`
View session change log.

```json
{ "action": "changes" }
{ "action": "changes", "since": 1722000000000 }
{ "action": "changes", "target": "src/auth.ts" }
```

### `rollback`
Undo a change by change ID.

```json
{ "action": "rollback", "target": "42" }
```

### `digest`
Ultra-compact project briefing (<500 tokens). Fastest way to bootstrap context.

### `drift`
Detect memory staleness & code drift.

```json
{ "action": "drift" }
```

**Returns:** Stale records, code drift warnings, freshness status.

### `resume`
Load previous session context (goal, progress, changes).

```json
{ "action": "resume" }
```

---

## kuma_memory

Decision recording, knowledge persistence, and gotcha tracking.

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

To pass pre-built record:

```json
{ "action": "research_save", "scope": "auth", "record": "{\"scope\":\"auth\",\"confidence\":0.9,\"entryPoints\":[\"AuthController.login\"],\"flow\":[\"POST /login → AuthController.login → AuthService.validate → UserRepository.findByEmail\"]}" }
```

### `session`
Session summary — goal, duration, recordings, modified files, unresolved issues.

```json
{ "action": "session" }
```

### `search`
Search memory + knowledge graph with impact analysis.

```json
{ "action": "search", "query": "auth flow" }
```

### `mine`
Mine decisions from git log & comments.

```json
{ "action": "mine", "scope": "auth" }
```

### `gotcha`
Record bug/quirk (IMMEDIATELY when found).

```json
{
  "action": "gotcha",
  "scope": "path/to/file.ts",
  "content": "useEffect causes infinite loop when state change triggers re-render",
  "status": "high",
  "description": "Use useCallback on the handler",
  "trigger_command": "npm run build"
}
```

**Parameters:**
- `scope` (required) — file path
- `content` (required) — bug description
- `status` — severity: `low`, `medium`, `high`, `critical`
- `description` — workaround
- `trigger_command` (I2) — command that triggers this gotcha (e.g. "npm run seed")

### `arch_flow`
Record architecture flow (max 5 core files).

```json
{
  "action": "arch_flow",
  "content": "domain: AuthFlow | hops: auth.ts → middleware.ts → route.ts | gotchas: rate-limit, token-expiry"
}
```

### `delete_node`
Remove node + graph + table entries.

```json
{ "action": "delete_node", "target": "gotcha::auth.ts::useEffect infinite loop" }
{ "action": "delete_node", "scope": "gotcha", "target": "42" }
```

### `clear`
Wipe all nodes, edges, and gotchas from disk and memory.

```json
{ "action": "clear" }
```

### `goal_progress`
Update goal completion percentage.

```json
{ "action": "goal_progress", "confidence": 75, "content": "Done with auth refactor" }
```

### `changes`
View change log (alternative to `kuma_context changes`).

```json
{ "action": "changes" }
```

---

## kuma_safety

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

### `check`
Pre-execution safety check.

### `audit`
Query audit trail.

```json
{ "action": "audit", "toolName": "kuma_safety", "limit": 10 }
```

### `health`
Project health score (0-100). Optional/cosmetic.

```json
{ "action": "health" }
```

### `security`
Security leak scanner for credentials/tokens/secrets in code.

```json
{ "action": "security", "filePath": "src/controllers/user.ts" }
```

### `gc`
Garbage collection — deduplicate, remove orphans, vacuum.

```json
{ "action": "gc" }
```

### `ast` / `validate`
AST-based code validation.

```json
{ "action": "ast", "scope": "src/services/auth.ts" }
```

### `checkpoint`
Create atomic snapshot before risky refactors.

```json
{ "action": "checkpoint", "label": "pre-refactor-auth" }
```

### `rollback_label`
Restore from a checkpoint by label.

```json
{ "action": "rollback_label", "label": "pre-refactor-auth" }
```

### `checkpoint_list`
List all available checkpoints.

### `gotcha_staleness`
Verify recorded gotchas still reference real files/symbols.

```json
{ "action": "gotcha_staleness" }
```

---

## Auto-Inject Hooks (Roadmap F2)

Kuma auto-injects gotchas, decisions, and history before edits via:

- **Claude Code:** `.claude/settings.json` — `kuma hook pre-edit` + `kuma hook pre-bash`
- **Cursor:** `.cursor/rules/kuma-gotchas/*.mdc` — globs-based gotcha rules
- **Other agents:** Prompt-level instructions in skill files (generated by `kuma init`)

The hook is invisible — it returns `{}` for files with no gotchas, and injects relevant context only when available. No extra steps from the agent.
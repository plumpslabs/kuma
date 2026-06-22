# 🧠 CORE MANDATES — System Doctrine

> **Absolute rules that the AI Agent MUST follow during coding sessions.**
> Injected by the `initialize_session_rules` tool.

---

## 10 Mandatory Mandates

| # | Mandate | Description |
|---|---------|-------------|
| 1 | **READ BEFORE WRITE** | Read the file before editing. 90% of errors come from AI editing without reading. |
| 2 | **QUALITY OVER SPEED** | Prioritize correctness over speed. A wrong AI is more expensive than a slow AI. |
| 3 | **VALIDATE ASSUMPTIONS** | Never assume a library/framework exists. Check package.json or config files first. |
| 4 | **CONVENTIONS** | Follow existing coding style in the project. Don't create new patterns. |
| 5 | **PARALLELIZE** | Gather context from multiple sources at once. Don't go sequential. |
| 6 | **MINIMAL CHANGES** | Edit as little as possible. Every existing line of code has a purpose. |
| 7 | **TEST YOUR WORK** | If you make changes, run typecheck/tests. Don't just assume it works. |
| 8 | **NO 'any' TYPE** | Never use type casting to 'any' in TypeScript. |
| 9 | **ERROR IS OK** | Error is not failure. Error is information. Report with details and fix suggestions. |
| 10 | **LOOP DETECTION** | If calling the same tool >3 times, stop and try a different approach. |

---

## Failure Prevention Rules

### Tool Call Limits
- Max 50 tool calls per session
- Max 10 diff edits per batch
- Max 5 terminal executions per minute
- Max 3 consecutive failures = circuit breaker

### Anti-Hallucination
- Always read actual file content before editing
- Never assume API/library exists without checking
- If unsure, use `smart_grep` or `project_conventions`

### Token Economy
- Keep responses concise (Caveman doctrine)
- Reference session memory instead of repeating details
- Prioritize unresolved failures over completed work

# Fennec — Database Tool Onboarding (Kuma)

Fennec is an optional database helper exposed by Kuma. Use it when a task
requires direct database inspection/mutation that Kuma's context/memory layer
does not cover.

## When to use

- Inspecting or querying a live database during debugging.
- Running one-off migrations or data fixes.
- Verifying DB state after a backend change.
- Any task where kuma_context / kuma_memory are insufficient because the
  source of truth is the database, not the code.

## When NOT to use

- Code navigation, impact analysis, gotchas, decisions -> use Kuma context/memory.
- File edits or refactors -> use native tools + Kuma safety.
- Tasks that only need repository structure -> kuma_context({ action: "map" }).

## Quick start

1. db_list - see active connections.
2. db_ping({ name }) - health check.
3. Run queries via the appropriate Fennec DB tool.
4. db_disconnect_all - cleanup when done.

## Notes

- Fennec is complementary to Kuma, not a replacement. Prefer Kuma for
  code-level memory; use Fennec only for DB-level work.
- Keep connections short-lived to avoid leaking resources.

# Changelog

## [2.3.0] — 2026-07-26

### V3 Coarse-Grained Pipeline — Complete

Kuma V3 consolidates 46+ micro-tools into **3 pipeline-driven tools** with mandatory research enforcement.

#### Added
- **kuma_context** — 6 actions: init, research (5-step pipeline), impact (graph traversal), navigate (BFS call chain), changes (selective undo), health (project score)
- **kuma_memory** — 6 actions: decision (ADR-style), research_save, session, heal (self-heal), search, changes
- **kuma_safety** — 6 actions: guard (anti-pattern/drift/loop), check (policy+path+lock), audit (queryable trail), lock (multi-agent), health, override (logged bypass)
- `bump-version.sh` — version bumping script for package.json + docs/index.html

#### Changed
- Research pipeline: 5-step deterministic flow — cache → staleness → graph → impact → decisions
- Safety layer: coarse-grained guard/check/audit with SQLite-backed audit trail
- Self-healing: content hash staleness detection, git-aware rename tracing, cascading edge cleanup
- Knowledge graph: SQLite WASM, FTS5 full-text search, node/edge/session model
- Session memory: real-time state tracking (files, failures, goal, tool history)

#### Removed
- 15 dropped tools (precise_diff_editor, safe_terminal_exec, smart_grep, batch_file_writer, code_reviewer, static_analysis, git_log, git_diff, lsp_query, project_structure, project_conventions, and more)
- 45+ legacy V2-era files completely unreachable from entry point
- All dead exports and unused code across remaining 26 source files

#### Fixed
- All `db.exec()` calls replaced with parameterized prepared statements
- Type safety: proper confidence casting, guard check literal unions
- Zero unused exports — every exported symbol is consumed
- TypeScript strict mode compliance (tsc --noEmit passes cleanly)

#### Chore
- Source reduced from ~78+ to 26 `.ts` files
- Clean build via tsup

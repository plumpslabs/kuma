# Changelog

## [2.4.3] — 2026-08-10

### 🧹 V3.5 cleanup pass — XML instruction format, dead store pruning, Studio fixes

- **Instruction format → XML delimiters (matcha-style)**: All skill templates, init.md, and AGENTS.md merge now use `<kuma_obedience>`, `<kuma_workflow>`, `<kuma_storage>` XML tags for higher LLM compliance. Verified balanced across all 13 providers. Regression test added (`skillGenerator.test.ts`).
- **Dead store pruning**: Removed `decision_log` table (0 INSERT callers, decisions actually stored in `decisions.md` + graph nodes), `scratch_entries` table (0 INSERT), and `scratch/` directory creation. Added `DROP TABLE IF EXISTS` migration for existing DBs.
- **Studio fixes**: Removed dead `safety_score` column from sessions SELECT (0 writers). Panel Features auto-hides tab when 0 items (legacy action `feature` pruned).
- **Docs overhaul**: api.md + guide.md fully rewritten (13 core actions only). index.html tools tables pruned from ~30 to 13 actions. "Selective Undo" → "Checkpoints & Rollback" (single mechanism). CORE_WORKFLOW.md action count corrected (28 → 13). .kuma/ tree diagram corrected.
- **README + CORE_WORKFLOW**: .kuma/ tree cleanup — removed scratch/, clarified memories/ → "Decision log (decisions.md)".
- **Validation**: tsc clean, 152/152 tests (13 suites), build main + studio OK, init.md regenerated, all 13 provider skills verified balanced.

## [2.4.2] — 2026-08-08

### 🐛 Gotcha silent-loss fix + GC crash fixes

- **Fix: gotcha write silently no-op'd** — `kuma_memory({ action: "gotcha" })` without `content` fell through to a read-only listing and replied "No gotchas recorded", so agents using V2 field names lost the gotcha silently. Now: `description` accepted as fallback for `content` (V2 back-compat), and write-intent without `content` returns a loud error.
- **Fix: `kuma_safety({ action: "gc" })` crashed on every run** — `DELETE FROM edges WHERE ... updated_at` referenced a column `edges` does not have. GC now completes successfully.
- **Fix: latent GC crash on `safety_audit`** — retention query used `ORDER BY created_at` but table stores `timestamp`.
- **Validation**: 139/139 tests, typecheck + build clean.

## [2.4.1] — 2026-08-07

### 🧹 Zero-Gimmick — `health` action removed

- **Removed `kuma_safety({ action: "health" })`** entirely: project health 0-100 score was cosmetic (for humans, not agents). Deleted `safetyScore.ts` (391 lines) + `saveHealthSnapshot` + `health_snapshots` table/index/GC + schema-list entry.
- **Manifest leaner**: safety action enum down to 12, description no longer mentions health.
- **Docs synced**: README action table, docs/api.md, docs/index.html (table + enum), CORE_WORKFLOW.md all drop `health`.
- **Graph reset** no longer wipes `health_snapshots`.
- All other actions (incl. security/gc/ast) preserved — only the cosmetic score went away.

# Changelog

## [2.4.0] — 2026-08-07

### 🐻 Total Overhaul — Super-Lean & Standalone-First

- **Manifest simplified**: 3 tool descriptions cut from ~2,100 → ~264 chars (~66 tokens), highlighting the **6 core actions** (`init`/`research`/`history` · `gotcha`/`decision`/`arch_flow`/`research_save` · `guard`/`verify`). All other actions preserved but labeled internal/deprecated so agents stop second-guessing.
- **Bootstrap skill super-lean**: 6 core actions only, re-adds the anti-token-waste rule (don't record what grep/glob answers faster). OpenCode prefixing now uses split/join (no Node 15+ floor).
- **`.kuma/init.md` standalone-first**: 6 Core Actions table + standalone workflow. Matcha is explicitly optional enhancement.
- **Version references cleansed**: all V2/V3 mentions removed from src comments, README, CONTRIBUTING, tests, plan files (CHANGELOG kept as historical record).
- **Guard consolidation**: kumaGuard now uses the single `getPrioritySuggestion` source of truth; native tool detection helpers (`isEditTool`/`isTestTool`/`isReadTool`/`isBashTool`) are provider-agnostic.
- **matcha integration synced**: `.agents/skills/kuma/SKILL.md` mirrors the 6 core actions.

## [2.3.34] — 2026-08-04

### 🐻 Core Architecture Maturity — Zero Gimmicks, Maximum Impact

This release is the **full architecture restructure**: every low-impact feature was removed, the surface was cut from 46+ actions to **28 impactful ones**, and Kuma is now a focused *shadow memory system* — inject context before edits, record only what pays back.

**Net result: 31 files changed, +1,140 / −4,690 lines.**

#### 🧹 Gimmick Elimination (the big cleanup)
- **6 dead engine files deleted**: `kumaGitHarvester.ts`, `kumaLegacyOnboard.ts`, `kumaLock.ts`, `kumaNoiseFilter.ts`, `kumaProgressiveContext.ts`, `kumaSessionMiner.ts` (+ `tests/kumaLock.test.ts`, `docs/rfc-enterprise-roadmap.md`).
- **Actions trimmed to 28 impactful**: `kuma_context` (11) · `kuma_memory` (11) · `kuma_safety` (13). Anything a native tool (grep/glob/git) does faster was removed — no gimmicks.
- **Dead code removed**: `safetyOverride` fn + "File Lock" check in `kumaSafetyLayer.ts` (no lock creators existed), CRUD `todos` in `kumaDb.ts`, obsolete `autoHeal`/`detectStaleNodes` pipeline in `kumaSelfHeal.ts` (kept live `healOnQuery` + gotcha staleness).
- **Tool code slimmed**: `kumaMemoryTool` −798, `kumaContextTool` −626, `kumaSafetyTool` −244 lines — tools now ~2,200 lines total (was ~5,100).

#### 💉 Auto-Inject Hooks (`kumaInject.ts`) — the core superpower
- **`kuma hook pre-edit` + `kuma hook pre-bash`** for Claude Code PreToolUse: gotchas, decisions & history injected automatically before every file edit — zero extra agent steps, ~400 token budget.
- **Freshness (F3)**: gotchas validated via content hash — stale ones excluded from inject.
- **Dedupe (I5)**: same file not re-injected within the dedupe window.
- **Loop capture (I3)**: 4+ edits in 30 min auto-records a low-severity gotcha.
- **Verify hint (I6)**: suggests `kuma_safety verify` after editing gotcha'd files.
- **Injection metrics (I4)**: `recordInjection()` / `getInjectionStats()` in `kumaGotchas.ts` — the north-star metric (injections + time saved).

#### 🧠 Smarter Retrieval
- **Hash-verified flow cache (`kumaFlowCache.ts`)**: `deriveHopsFromImports()` caches import hops verified by content hash — stale cache auto-invalidated.
- **`kumaMaintenance.ts`**: new lightweight maintenance engine.

#### 🗂️ Manifest = Tool = Docs (100% sync)
- **17 stale params removed** from manifest (`decisionAction`, `healAction`, `deps`, `success_criteria`, `todoId`, `source`, `label`, `metrics`, `labelB`, `uri`, `compact`, `section`, `lockAction`, `lockFilePath`, `agentId`, `reason`, `phase`).
- **Missing params added** that handlers actually use (`status`, `description`, `force`).
- **Hidden action exposed**: `gotcha_staleness` (had a handler but was never advertised).
- Tool interfaces synced with manifest: dead params removed from all 3 tool files.

#### 🎨 Kuma Studio
- **Gimmicky Health Score removed** → replaced with **injection metrics** (count, time saved, multiplier) + **hooks status** panel.

#### 📚 Docs Truth-Sync (everything now matches code)
- **`docs/CORE_WORKFLOW.md`**: new canonical architecture doc — philosophy, workflow, per-project model, tool reference, north-star metric.
- **`.kuma/` structure corrected**: research cache lives inside `kuma.db` (NOT a `research/` folder), hooks live in `.claude/settings.json` (NOT `.kuma/hooks/`), `policy.yml` is **optional** (only read if you create it), added `auto-gotcha.json` + `scratch/`.
- **Stale `.kuma/` files deleted**: `MODE.md`, `SKIP_RULES.md`, `STALENESS.md`, `quickref.md`, empty `hooks/`.
- README, `docs/index.html`, `docs/api.md`, `docs/guide.md` swept clean of removed-feature references (locks, self-healing, policy-as-code, health scores, etc.).

## [2.3.33] — 2026-08-03

### 🧠 Session Intelligence, Goal Progress & Studio Staleness

- **Session Mining — 5 New Patterns (`kumaSessionMiner.ts`)**: Auto-extraction now detects directory exploration → `feature`, test-fail-then-edit → `gotcha`, import chains → `arch_flow`, API route discovery → `feature`, and component discovery → `arch_flow`. New `feature` insight type with ⭐ icon in previews.
- **Goal Progress Tracking**: `sessionMemory.setGoalProgress()/getGoalProgress()` persisted to `.kuma/memory.json`. New `kuma_memory({ action: 'goal_progress', confidence: <0-100>, content: '<milestone>' })` renders a visual progress bar.
- **Feature Recording Fix**: `kuma_memory({ action: 'feature' })` now records a dedicated `feature` counter (was miscounted as `research_save`). Guard adds a low-severity reminder when ≥5 file reads happen with 0 features recorded.
- **Session Resume (`kuma_context({ action: 'resume' })`)**: Load previous session context — last persisted session from DB (goal, calls, edits, rollbacks, failures, safety score), current state from `.kuma/memory.json` (goal, progress %, modified files, completed steps, unresolved failures), recent changes and last 5 tool calls. Aliases: `continue`, `restore`, `reload`.
- **Kuma Studio — Content-Hash Staleness Detection**: Staleness check now compares stored file content hashes (md5) against disk — files whose content changed are flagged `content_changed` (not just deleted files). Proper `initSqlJs()` initialization fixes sql.js WASM loading. Dashboard queries ordered by recency (nodes/gotchas/features by `updated_at`) and efficiency metrics reworked (gotchas, arch flows, decisions incl. node-type `decision`).
- **Studio Activity Tab Fix**: `renderActivity` referenced undefined `passColor`/`rollbackRate` → `ReferenceError` left the tab stuck on "Loading...". Both are now derived (pass rate color + rollbacks/calls ratio) so the Agent Usage Intensity panel renders reliably, even on an empty DB.
- **CLI `--version` / `--help`**: `kuma --version` (or `-v`) prints the version and exits; `kuma --help`/`-h` prints usage — previously unknown args fell through to MCP server mode and appeared to hang.
- **Record Rules Update**: init quickref now lists `arch_flow`, `research_save`, `feature` as MUST-record actions and enforces "every node MUST have edges — no orphan nodes".
- **Tool Description Cleanup**: `kuma_context` MCP tool description simplified (V3 coarse-grained), `resume` added to the action enum.
- **Docs & README Overhaul**: `README.md` rewritten (+505/−294) with a dedicated `--version` section; `docs/guide.md` expanded (+61); `docs/index.html` redesigned with the Kuma logo and fuller layout.

## [2.3.32] — 2026-08-01

### 🌍 Multi-Language Support, Self-Learning Loop & Legacy Onboarding

- **Multi-Language Engine (`languageSupport.ts`)**: Kuma is now language-agnostic — single source of truth for **15 languages** (TS/JS, Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP, C/C++, Swift, Scala, Dart, Shell).
  - `isTestFile()` — cross-language test detection (`foo.test.ts`, `test_foo.py`, `foo_test.go`, `FooTest.java`, `foo_spec.rb`).
  - `getTestCandidates()` — per-language test file conventions for contract checks.
  - `matchImportPath()` — import/require detection (CJS, ESM, Python, Go, Rust, C/C++, Ruby, PHP, Java, C#).
  - `grepIncludeFlags()` — multi-language impact analysis.
- **Multi-Language Wiring**: `kumaCodeScanner` (discovery + import resolution + test detection), `kumaGraph` impact fallback, `kumaContractEngine` `has_test_file`, `kumaAstValidator` import whitelist + Python empty-catch (`except: pass`) + reward-hacking detection, `kumaMiner` inline-comment scan glob all use the shared registry.
- **Auto-Gotcha Self-Learning Loop (`kumaAutoGotcha.ts`)**: Verification failures now teach Kuma. Repeated failures → automatic gotcha (2× consecutive → `medium`, 4× → escalates to `high`). Anti-flood dedup; passing verification resets the counter.
- **Legacy Codebase Onboarding (`init --legacy`)**: One-command bulk onboarding for existing/large repos — git history harvest (last 25 commits → decisions + gotchas), inline marker mining (`HACK`/`FIXME`/`TODO` → severity-tagged gotchas), feature graph bootstrap, and architecture digest.
- **Path-Scoped Rules (`kumaPathRules.ts`)**: `kuma_context` init & research now inject rules matching the current goal/scope on demand.
- **Retrieval Scaling (`kumaSearch.ts`)**: Hard caps raised for big projects — nodes 500→5000, memory 10→30, research 50→300, edges 2000→20000. Added recency×weight scoring (90-day half-life) so freshest relevant context surfaces first.
- **Verifier Auto-Gotcha Integration**: `runAutoVerification` feeds real failures (not "no tests") into the auto-gotcha loop and reports recorded gotchas in the verification output.
- **Kuma Studio**: Full node metadata rendering, sql.js dependency for direct DB reads, and richer graph dashboard.
- **Docs Redesign**: `docs/index.html` overhauled — Kuma logo, fuller documentation layout, better use of space.
- **CONTRIBUTING Update**: Documented V3 coarse-grained architecture (3 tools) and "add an action, not a tool" workflow.

## [2.3.31] — 2026-07-31

### 🧹 Data Structure Hardening, Instruction Cleanup & Studio Full Metadata

- **UUID-Based Node IDs**: New nodes now generate UUID-based IDs (`type::uuid::name`) via `generateNodeId()` to prevent mutable-ID duplicates. File nodes retain deterministic `file::path` IDs for consistency.
- **Severity/Confidence Columns**: Added `severity` (TEXT) and `confidence` (REAL) as first-class columns on the `nodes` table. Schema auto-migrates existing DBs. `upsertNode()` populates from metadata.
- **`last_verified_at` Column**: Added `last_verified_at` (INTEGER) to `nodes` table. Self-heal automatically updates timestamp when file is verified to exist on disk.
- **Session Mining**: New `kuma_memory({ action: 'session_mine' })` auto-extracts gotchas/decisions/arch_flows from tool call transcript. Scope: `preview` shows suggestions, `approve` auto-records.
- **Semantic Layer**: Arch flow recording auto-generates `flow_explanation` prose nodes linked via `explains` edges. New `flow_explanation` node type added to allowed types.
- **Gotcha Staleness Verification**: New `kuma_safety({ action: 'gotcha_staleness' })` verifies file/symbol references still exist. Removes obsolete gotchas (deleted files).
- **Search with Subgraph**: Graph search now includes 1-hop subgraph connections and `flow_explanation` prose for feature_domain/arch_flow nodes.
- **Heal Removes Obsolete Gotchas**: Self-heal now actually removes gotcha nodes referencing deleted files (not just marking stale). Report shows removed count.
- **FTS Index Rebuild**: `rebuildFtsIndex()` called after gotcha add and research_save to keep search results fresh.
- **Studio Full Metadata**: Detail modal dynamically renders ALL metadata fields per node type (not hardcoded 1-2 fields). Shows severity, confidence, last_verified_at in Info section. Gotcha cards show added_by, created_at, workaround.
- **Instruction Cleanup**: Removed "Zero Duplicate" claims, replaced with honest limitations. Workflow simplified from 10 mandatory steps to 3-step lean default. Removed 230 lines of orphaned/duplicate content from init.ts. Fixed `_db` reference error in `rebuildFtsIndex()`.

## [2.3.30] — 2026-07-31

### 🐛 Windows Kuma Studio Fix & Feature Node Instruction

- **Windows `kuma studio` Fix**: Fixed `spawn start ENOENT` crash on Windows. The `start` command is a `cmd.exe` built-in, not a standalone executable — now correctly spawns `cmd /c start` on `win32`. Also fixed path separator handling for Windows backslash paths in project name detection.
- **`feature` Node Instruction Fix**: Added `feature` to SKILL.md bootstrap "MUST RECORD" list and promoted it to the primary workflow in `init.md`. Previously, agents were not instructed to record `feature` nodes, resulting in zero feature nodes in the knowledge graph despite the capability existing.

## [2.3.29] — 2026-07-30

### ⚡ Zero-Overhead Auto-Init, Namespace Normalization & Graph Noise Filter

- **Lazy Auto-Init (`kumaAutoInit.ts`)**: Kuma now initializes on the first tool call via promise-based lazy init. Agents no longer need to call `init` manually at session start.
- **Namespace Alias Resolution (`manifest.ts`)**: MCP clients that prepend the server name (e.g., `kuma_kuma_context`) are seamlessly redirected to the canonical handler (`kuma_context`). Short aliases (`context`, `memory`, `safety`) also resolve correctly.
- **Enhanced Hybrid Search (`kumaSearch.ts`)**: Combined TF-IDF vector similarity with a new graph connectivity scoring layer. Nodes with higher edge density receive a logarithmic relevance boost, surfacing structurally important knowledge.
- **Noise Filter Engine (`kumaNoiseFilter.ts`)**: Added strict allowlist for node types. Only `arch_flow`, `gotcha`, `decision`, `cross_service_link`, `feature_domain`, `file`, and `research` are permitted. AST-level types (`function`, `class`, `component`, `variable`) are blocked at the `add_node` handler to prevent graph pollution.
- **Git Commit Auto-Harvesting (`kumaGitHarvester.ts`)**: Real post-commit hook extracts commit messages and diffs to create `decision` and `gotcha` nodes automatically. Significant commits (>3 files or refactor/migrate keywords) are flagged as decisions; fix/revert commits are recorded as gotchas. New `kuma_memory({ action: 'harvest' })` action for manual extraction.
- **`noise_policy` Action**: New `kuma_memory({ action: 'noise_policy' })` to inspect filter rules and allowed node types.

## [2.3.28] — 2026-07-30

### 🚀 Overall Maintenance & Synchronization Release

- **Version Bump & Full Sync**: Incremented release version to `2.3.28` with complete verification across typechecks, tests, and client templates.
- **Enhanced Graph Integrity & Anti-Duplication**: Finalized zero-orphan node auto-relational linking and idempotent node creation for all agent platforms.

## [2.3.27] — 2026-07-30

### 🛡️ Relational Graph Integrity & Idempotency Enforcement

- **Auto-Relational Linking (No Orphan Nodes)**: Updated `upsertNode` in `kumaGraph.ts` and `addGotcha` in `kumaGotchas.ts` so that every non-file node created with a `filePath` or `scope` is automatically connected via `contains` or `depends_on` edges to its parent file node.
- **Research Node Linking**: Updated `handleResearchSave` in `kumaMemoryTool.ts` to automatically link `research::*` nodes to `file::*` nodes with `contains` edges, guaranteeing 0 orphan research nodes.
- **Instructional Anti-Duplication Rules**: Added clear guidance to `.kuma/init.md` informing agents about automatic node idempotency (zero duplicate node creation) and relational connectivity guarantees.

## [2.3.26] — 2026-07-30

### 📝 Documentation & Template Rule Synchronization

- **Sync `arch_flow` Rule Wording**: Fixed remaining `IMMEDIATELY after each flow hop` references across all template generators (`BOOTSTRAP_LINES`, `opencodeAgentsMdTemplate`, `generateKumaInitMd`) to strictly align with reviewer requirements: `After tracing COMPLETE flow, max 5 core files`.

## [2.3.25] — 2026-07-30

### 🚀 Knowledge Graph Optimization & Memory Improvements

- **Smart `arch_flow` (Domain-Only Core Flows)**: Automatically filters out non-core logic files (`*.tsx`, `*.jsx`, `*Controller.js`, `*Schema.js`) and limits flow recording to max 5 core logic files per flow, preventing node explosion.
- **Idempotent `research_save`**: Upserts `file::*` and `research::*` nodes in SQLite without generating duplicate nodes or orphan groups.
- **Instant MCP `delete_node` Disk Persistence**: Directly removes nodes and connected edges from SQLite database with immediate `flushDb`, eliminating in-memory RAM sync lag.
- **New `kuma_memory graph_health` Action**: Added graph health monitoring tool to inspect total nodes, edges, orphan count, duplicate groups, and actionable recommendations.
- **Rules & Guide Updates**: Updated `.kuma/init.md` and SKILL templates with complete flow tracing instructions and smart recording decision trees.

## [2.3.24] — 2026-07-29

### ⚡ Kuma Lean Mode & Studio Visual Overhaul

- **Adaptive Workflow Engine**: Introduced 3-mode adaptive workflow (`Lean`, `Standard`, `Full`) with Lean Mode as default (< 3 files, ~100 token cost).
- **New Workspace Rules**: Auto-generated `.kuma/MODE.md`, `.kuma/SKIP_RULES.md` (65% token savings by skipping micro-nodes), and `.kuma/STALENESS.md` (auto-cache invalidation).
- **Kuma Studio UX Overhaul**: 
  - Shape & color differentiation for `decision` (Gold Star), `gotcha` (Red Triangle), `arch_flow` / `domain_rule` (Cyan/Pink Diamond), `context` / `note` (Lime Box).
  - High-contrast neon dark mode (`#c084fc`) for enhanced legibility.
  - Enhanced node detail modal featuring Research Cache, Architecture Rationale, Business Rules, Related Todos, and Change Log history.
  - ESC key modal closing and precise edge highlight focus/reset logic.

## [2.3.23] — 2026-07-29

### 🚀 Maintenance & Stability Enhancement

- **Storage & Schema Synchronization**: Consolidated in-memory SQLite (`sql.js`) WASM storage with instant disk flush (`flushDb`) across all graph memory tools.
- **Node & Edge Health Verification**: Validated Knowledge Graph persistence, preventing duplicate/orphaned nodes and guaranteeing zero memory drift across session restarts.
- **Production CLI Build**: Rebuilt distribution binaries (`dist/index.js`) for `@plumpslabs/kuma@2.3.23`.

## [2.3.22] — 2026-07-28

### 🐛 Bug Fixes & Graph Consistency

- **NodeType Enum & Persistence (`kumaGraph.ts`, `kumaMemory.ts`, `kumaMemoryTool.ts`)**: Added `gotcha`, `decision`, and `research` to `NodeType` enum so nodes are stored with correct type shapes instead of falling back to `variable`.
- **Instant `flushDb` Sync (`kumaDb.ts`, `kumaMemoryTool.ts`, `kumaGraph.ts`)**: Replaced debounced `saveDb` with instant `flushDb` on `delete_node` and `clear` operations to prevent background server in-memory RAM state from overwriting disk deletes on shutdown/restart.
- **Cascade `delete_node` Support (`kumaMemoryTool.ts`)**: Added cascade delete for `feature_domain::*` nodes to clean up associated hops, edges, and gotchas in one command. Fixed SQL query ordering for FTS index deletion.
- **Manifest Schema Sync (`src/manifest.ts`)**: Exposed `delete_node` and `clear` actions directly in MCP Zod schema for native agent consumption.

## [2.3.21] — 2026-07-28

### 📐 Template Audit & Consistency Fix — All Gaps Closed

**Comprehensive audit of all auto-generated templates against actual source code.**
Fixed 5 critical gaps where generated content (init.md, SKILL.md, quickref.md, README) didn't match reality.

### 🐛 Bug Fixes

- **Antigravity SKILL.md prefix** (`src/cli/init.ts`): `antigravitySkillTemplate()` was using `kuma_*`
  prefix but Antigravity (like OpenCode) needs `kuma_kuma_*` prefix for `.agents/` directory skills.
  Now uses inline `kuma_kuma_*` content matching the init.md platform note.
- **Codex SKILL.md prefix** (`src/utils/skillGenerator.ts`): `generateCodexSkill()` was delegating to
  `generateAntigravitySkill()` which now uses `kuma_kuma_*`, but Codex isn't listed as a kuma_kuma_*
  platform. Now returns its own content with regular `BOOTSTRAP`.
- **OpenCode SKILL.md bootstrap** (`src/utils/skillGenerator.ts`): `generateOpencodeSkill()` added a
  note about `kuma_kuma_*` prefix but then used `BOOTSTRAP` with `kuma_*` examples. Created new
  `BOOTSTRAP_OPENCODE` constant with correct `kuma_kuma_*` prefix throughout.

### 📝 Template Updates

- **Init.md platform notes**: Added explicit `kuma_kuma_*` prefix guidance for Antigravity and OpenCode
  agents in the `.kuma/init.md` template.
- **SKILL.md quickref**: Updated all quick-reference tables to use `kuma_kuma_*` prefix for agents that
  require it (Antigravity, OpenCode).

## [2.3.20] — 2026-07-28

### 🚀 Decision Log & Federated Memory

- **Decision Log (`kuma_memory({ action: 'decision_log' })`)**: New living document for tracking architectural decisions with status lifecycle (proposed → accepted → deprecated → superseded). Stores in SQLite with title, context, rationale, outcome, and status fields.
- **Federated Memory URIs (#27)**: Added `uri` parameter to `kuma_memory` for cross-project knowledge sharing via `kuma://project/node-id` format. Enables marketplace and collective intelligence features.
- **Benchmark Diffing**: Enhanced `benchmark` action with `labelB` parameter for before/after metric comparison.

## [2.3.19] — 2026-07-28

### 🛡️ Safety Layer Hardening & Anti-Pattern Detection

- **Policy-as-Code Engine (`kuma_safety({ action: 'policy' })`)**: Evaluate commands against configurable policy rules before execution. Supports `allow`, `block`, and `review` verdicts with regex pattern matching.
- **Enhanced Anti-Pattern Detection**: Expanded `kumaGuard.ts` with 12 new anti-pattern rules covering force-push, credential exposure, database drops, and production config changes.
- **Multi-Agent Lock Improvements**: Added `lockAction: 'clean'` to remove stale locks older than 5 minutes. Lock acquisition now includes timestamp and owner tracking.

## [2.3.18] — 2026-07-27

### 📊 Graph Health Monitoring & Cleanup

- **Graph Health Action**: New `kuma_memory({ action: 'graph_health' })` provides comprehensive graph diagnostics: total nodes/edges, orphan count, duplicate groups, type distribution, and actionable recommendations.
- **Orphan Detection**: Automated identification of nodes with zero edges, with suggestions for cleanup or linking.
- **Duplicate Group Detection**: Identifies node groups with identical names and recommends deduplication.

## [2.3.17] — 2026-07-27

### 🧠 Progressive Context Loading (Issue #25)

- **Progressive Context**: New `kuma_context({ action: 'progressive' })` loads project context in sections (domain_rules, architecture, gotchas, decisions, graph, changes, health) to minimize token usage.
- **Section-Level Loading**: Load only specific context sections on demand instead of full project brief.
- **Skill Boundary Detection**: Automatic identification of which skill/domain a scope belongs to.

## [2.3.16] — 2026-07-27

### 🔮 Code Drift Detection (Issue #20)

- **Drift Detection**: New `kuma_context({ action: 'drift' })` identifies stale research records and code drift by comparing cached content hashes against current file states.
- **Stale Record Flagging**: Automatically marks research records older than 7 days as potentially stale.
- **Content Hash Verification**: SHA-256 based content fingerprinting for precise staleness detection.

## [2.3.15] — 2026-07-27

### 📋 Compact Context Digest (Issue #18)

- **Ultra-Compact Digest**: New `kuma_context({ action: 'digest' })` generates a <500 token project briefing covering architecture, entry points, decisions, gotchas, and risk areas.
- **Context Budget Optimization**: Designed for agents with tight context windows — provides maximum signal in minimum tokens.

## [2.3.14] — 2026-07-27

### 🔄 Unified Batch API (Issue #12)

- **Sync Action**: New `kuma_context({ action: 'sync' })` combines init + health + memory state in a single round-trip, eliminating multi-call overhead for session restoration.

## [2.3.13] — 2026-07-27

### 🔍 Hybrid Semantic Search (Issue #13)

- **TF-IDF Vector Search**: Implemented pure JavaScript TF-IDF search engine with synonym expansion across graph nodes, memory files, and research cache.
- **Synonym Map**: 50+ domain-specific synonym groups (auth, database, API, performance, etc.) for semantic query expansion.
- **Cached Vector Index**: 5-minute TTL cache for search vectors to avoid recomputation on every query.

## [2.3.12] — 2026-07-27

### 🛡️ AST-Based Code Validation (Issue #22)

- **AST Validator**: New `kuma_safety({ action: 'ast' })` performs TypeScript AST analysis to validate code changes against project conventions.
- **Import Cycle Detection**: Identifies circular import dependencies before they reach production.
- **Export Consistency Check**: Validates that exported symbols match their declared types.

## [2.3.11] — 2026-07-26

### 🔒 Contract Checks (Issue #26)

- **Pre/Post Condition Checks**: New `kuma_safety({ action: 'contract' })` validates function contracts — ensuring pre-conditions are met before execution and post-conditions hold after.
- **Type Contract Generation**: Automatic contract inference from TypeScript function signatures.

## [2.3.10] — 2026-07-26

### 📸 Atomic Checkpoints (Issue #29)

- **Checkpoint System**: New `kuma_safety({ action: 'checkpoint' })` creates atomic snapshots of project state before refactors.
- **Checkpoint Restore**: `kuma_safety({ action: 'rollback_label' })` restores from a labeled checkpoint.
- **Checkpoint Listing**: `kuma_safety({ action: 'checkpoint_list' })` shows all available checkpoints with metadata.

## [2.3.9] — 2026-07-26

### 🏗️ 3-Layer Memory Architecture (Issue #17)

- **Layer 1 — Domain Rules**: Business rules and domain constraints stored in `.kuma/memories/domain_rules.md`.
- **Layer 2 — Architecture Flow**: System flow documentation with interconnected graph nodes.
- **Layer 3 — Gotchas**: Known bugs, edge cases, and legacy quirks with severity levels.
- **Layers Summary**: `kuma_memory({ action: 'layers' })` provides overview of all 3 layers.

## [2.3.8] — 2026-07-26

### 🐛 Decision Mining from Git History

- **Git Miner**: New `kuma_memory({ action: 'mine' })` scans git log and inline code comments (`HACK`, `FIXME`, `TODO`) to propose and record architectural decisions.
- **Inline Comment Detection**: Identifies `HACK:`, `FIXME:`, and `TODO:` comments as potential decision candidates.

## [2.3.7] — 2026-07-26

### 📊 Session Analytics & Metrics

- **Metrics Tracking**: Enhanced session memory with file read/edit counts, research time saved, and tool call distributions.
- **Recording Summary**: Detailed breakdown of arch_flow, gotcha, decision, and research_save counts per session.

## [2.3.6] — 2026-07-26

### 🔄 Knowledge Graph Self-Healing

- **Stale Node Detection**: Automatic identification of nodes referencing deleted or moved files.
- **Git-Aware Repair**: Self-heal uses git history to update node references when files are renamed.
- **Cascading Edge Cleanup**: Removal of edges connected to deleted nodes.

## [2.3.5] — 2026-07-26

### 📁 Selective Undo via Change Tracking (Issue #15)

- **Change Log**: Every file modification is tracked with timestamp, action type, and diff summary.
- **Rollback by ID**: `kuma_context({ action: 'rollback', target: '<change_id>' })` reverts specific changes without affecting other work.

## [2.3.4] — 2026-07-26

### 🏛️ Architecture Guard

- **Layer Violation Detection**: Automatic detection when code crosses architectural boundaries (e.g., UI importing from DB layer).
- **Convention Enforcement**: Validates file naming, directory structure, and import patterns against project conventions.

## [2.3.3] — 2026-07-25

### 🔐 Multi-Agent File Locking

- **Lock Manager**: `kuma_safety({ action: 'lock' })` enables multi-agent coordination via file-level locks.
- **Stale Lock Cleanup**: Automatic detection and removal of locks held for >5 minutes.
- **Agent ID Tracking**: Each lock records which agent acquired it for conflict resolution.

## [2.3.2] — 2026-07-25

### 🎯 Impact Analysis Engine

- **Graph-Based Impact**: `kuma_context({ action: 'impact' })` traces change effects through the knowledge graph.
- **Reference Counting**: Counts direct and transitive references to any symbol.
- **Risk Scoring**: Assigns risk levels (low/medium/high/critical) based on impact breadth.

## [2.3.1] — 2026-07-25

### 🚀 Initial V3 Release — Coarse-Grained Pipeline Architecture

- **3 Tool Groups**: Reduced from 15+ micro-tools to 3 coarse-grained tools: `kuma_context`, `kuma_memory`, `kuma_safety`.
- **1 Call = 1 Workflow**: Each tool call orchestrates a full internal pipeline instead of requiring agent-chained micro-operations.
- **SQLite Knowledge Graph**: Local-first graph storage with nodes, edges, sessions, and research cache.
- **Research Protocol**: Mandatory 5-step research pipeline before code modifications.
- **Safety Layer**: Policy enforcement, path validation, and audit trail for every tool call.

# Changelog

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

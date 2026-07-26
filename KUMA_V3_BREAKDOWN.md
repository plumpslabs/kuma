# Kuma V3 — Refactoring Breakdown

## Filosofi Baru

**"Safety-first Context & Orchestration Engine for AI Agents"**

Bukan tentang kecepatan edit. Bukan saingan agent CLI. Tapi **safety & documentation layer** yang mastiin AI agent gak pernah ngerusak business logic — baik project baru maupun legacy codebase besar.

### Prinsip

1. **Safety over speed** — Lebih lambat 5 detik tapi aman, lebih baik dari cepat tapi business logic rusak.
2. **Research WAJIB sebelum touch code** — Agent wajib riset, catat, dan validasi dulu. Gak bisa langsung edit.
3. **1 call = 1 workflow** — Satu panggilan Kuma nge-orchestrate multi-step pipeline: riset → cek graph → impact analysis → dokumentasi.
4. **Trigger-based documentation** — Pas ada perubahan signifikan, Kuma trigger "catet decision?" Bukan auto-track diam-diam.
5. **Legacy code first** — Kuma paling kuat di codebase besar yang udah jalan bertahun-tahun, bukan project baru.
6. **Deterministic, not AI-dependent** — Pipeline Kuma pake SQLite + graph + file operations. Gak perlu LLM call buat operasi inti.
7. **Long-term continuity** — Dokumentasi bertahan untuk human DAN AI agent di masa depan. Bukan cuma buat session sekarang.

---

## ❌ DROP: Yang Dihapus

Tools ini udah bisa dilakukan native oleh AI agent CLI (Claude Code, Cursor, dll):

| Tool | Alasan |
|------|--------|
| `precise_diff_editor` | Agent punya edit tool sendiri yang lebih matang |
| `safe_terminal_exec` | Agent bisa execute command sendiri |
| `smart_grep` | Agent punya search sendiri (ripgrep, semantic search) |
| `batch_file_writer` | Agent bisa create files sendiri |
| `code_reviewer` | Agent bisa review code sendiri |
| `static_analysis` | Agent bisa run linter sendiri |
| `git_log` / `git_diff` | Agent punya native git access |
| `lsp_query` | Agent bisa pake LSP sendiri |
| `project_structure` | Agent bisa ls/glob sendiri |
| `project_conventions` | Udah termasuk di init ringan |

**Total tool dihapus: ~15 tools**

---

## ✅ KEEP: Yang Dipertahankan (Refactored)

### Core Engine (Dependency)

| Komponen | File | Fungsi |
|----------|------|--------|
| **Knowledge Graph** | `kumaDb.ts`, `kumaGraph.ts` | SQLite database — nodes, edges, sessions. Jantungnya Kuma. |
| **Session Memory** | `sessionMemory.ts` | State tracker: modified files, failures, goal, tool history. |
| **Self-Heal** | `kumaSelfHeal.ts` | Auto-detect stale graph nodes, repair via git hash. |
| **Safety Layer** | `kumaSafetyLayer.ts`, `kumaSafetyProxy.ts` | Policy check, path validation, audit trail. |
| **Safety Audit** | `safetyAudit.ts` | Setiap tool call tercatat di SQLite. |
| **Lock** | `kumaLock.ts` | Multi-agent file locking. |
| **Config** | `kumaConfig.ts` | .kuma/config.json. |

### Bagian ini tetap, tapi disederhanakan kodenya.

---

### Tool Groups (Refactored → 3 Groups, ~5 Coarse-Grained Tools)

**1 call = 1 workflow.** Bukan micro-tools yang agent chain sendiri.

#### 🧠 `kuma_context` — Context & Understanding

| Tool | Pipeline (Internal) | Fungsi |
|------|--------------------|--------|
| `action: "init"` | Load graph → cek research → project brief → safety check | **Wajib panggil pertama.** Agent langsung paham project. |
| `action: "research"` | Load cache → cek staleness → graph query → impact analysis → decision lookup → safety check | **WAJIB sebelum edit.** Balikin context record lengkap. |
| `action: "impact"` | Graph traversal → reference count → test coverage → risk scoring | "Ubah validateToken() → 42 refs, 15 files, 3 test files." |
| `action: "navigate"` | Graph BFS → flow reconstruction → diagram | "Gimana flow login? Dari route sampe DB." |

#### 📝 `kuma_memory` — Decision & Knowledge

| Tool | Pipeline (Internal) | Fungsi |
|------|--------------------|--------|
| `action: "decision"` | Detect scope → check existing → prompt rationale → save to graph + file | ADR-style. Trigger-based. |
| `action: "research_save"` | Validate hasil riset → compute hash → save graph + `.kuma/research/*.json` | Simpan hasil riset. |
| `action: "session"` | Aggregate tool calls → modified files → failures → goal progress | "Apa aja yang berubah session ini?" |
| `action: "heal"` | Scan stale nodes → git-aware repair → cascading edge cleanup | Self-heal graph. Otomatis. |

#### 🛡️ `kuma_safety` — Safety & Policy

| Tool | Pipeline (Internal) | Fungsi |
|------|--------------------|--------|
| `action: "guard"` | Anti-pattern check → drift detection → tool loop check → unresolved failures | Safety guard sebelum/sesudah edit. |
| `action: "check"` | Policy enforcement → path validation → lock check → risk level | Pre-exec safety check. |
| `action: "audit"` | Query audit trail → stats → override log | "Siapa ngapain aja?" |
| `action: "lock"` | Acquire/release/list/clean locks | Multi-agent coordination. |
| `action: "health"` | Safety score → git status → backup check → LSP status | 0-100 health dashboard. |

### Additional Modules (Standalone, bukan tool group)

| Modul | Fungsi |
|-------|--------|
| **kumaAnalytics.ts** | Session stats, tool calls, edits |
| **kumaHealthDashboard.ts** | Project health — bug density, test pass rate |
| **kumaHeatMap.ts** | Activity heatmap per file/directory |
| **kumaDNA.ts** | Project fingerprint — architecture, risk areas |
| **kumaPredict.ts** | Predict next file/tool based on context |
| **kumaConfidence.ts** | Confidence score 0-100 |
| **kumaLearning.ts** | Auto-prioritize high-usage patterns |
| **kumaReplay.ts** | Replay session sebagai narrative |
| **kumaFailureKB.ts** | Failure knowledge base |
| **kumaCollective.ts** | Sync anonymized patterns ke VPS |
| **kumaMarketplace.ts** | Graph templates untuk framework |
| **kumaTimeMachine.ts** | Symbol evolution timeline |

---

## 🔄 NEW: Yang Ditambahkan

### 0. Arsitektur Tool: Coarse-Grained Pipeline

**Ini keputusan arsitektur paling penting.** Berdasarkan riset dari AWS MCP Guide, MCP co-creator (David Soria Parra), Pinterest production MCP, dan industi:

> **"Tools as actions, not endpoints. Design the verb the agent actually wants."** — David Soria Parra, MCP co-creator

> **"Coarse-grained tools: bundle operations that commonly occur together. All complexity remains hidden from the LLM layer."** — AWS MCP Prescriptive Guidance

**Artinya:** Kuma V3 gak pake 15 micro-tools yang agent harus chain sendiri. Tiap group cuma punya 1-2 coarse-grained tools yang internally nge-orchestrate pipeline.

```
Agent: kuma_context({ action: "research", scope: "auth" })
                                        │
                             1 MCP call ┘
                                        ▼
                    ┌────────────────────────────────────┐
                    │     Kuma Internal Pipeline          │
                    │     (deterministic, no LLM call)   │
                    ├────────────────────────────────────┤
                    │  1. Load research record           │
                    │  2. Check staleness (content hash) │
                    │  3. Query graph (flow, edges)      │
                    │  4. Run impact analysis            │
                    │  5. Lookup decisions & failures    │
                    │  6. Return structured result       │
                    └────────┬───────────────────────────┘
                             ▼
                    Structured JSON Response
```

**Kenapa ini best practice MCP:**
- **Deterministic** — Pipeline jalan di Kuma, bukan di agent. Agent gak bisa salah urut.
- **Context hemat** — 1 tool call instead of 5-6 chained calls. Deskripsi tool juga lebih sedikit.
- **Atomic** — Satu tujuan, satu hasil. Kalo gagal, gagal di satu tempat.
- **Auditable** — Semua langkah tercatat di audit trail. Agent cuma lihat hasil akhir.

---

### 1. Safety Research Pipeline (Wajib)

**Inti Kuma V3.** Setiap kali agent mau ubah sesuatu, WAJIB jalanin pipeline ini. Bukan opsional.

#### Alur Wajib (di-enforce lewat `.kuma/init.md`)

```
kuma_context({ action: "research", scope: "auth" })
  ↓ Internal pipeline otomatis:

  ╔═══════════════════════════════════════════════════╗
  ║  STEP 1 — Load Research Cache                     ║
  ║  Cek .kuma/research/auth.json                     ║
  ║  ├─ Ada? → Check content hash vs current code     ║
  ║  └─ Gak ada / stale → lanjut STEP 2               ║
  ╠═══════════════════════════════════════════════════╣
  ║  STEP 2 — Graph Query                             ║
  ║  "Cari semua node & edge terkait auth"            ║
  ║  Output: entry points, flow, dependencies         ║
  ╠═══════════════════════════════════════════════════╣
  ║  STEP 3 — Impact Analysis                         ║
  ║  "Kalo ubah AuthController.login, efek kemana?"   ║
  ║  Output: 42 references, 15 files, 3 API routes    ║
  ╠═══════════════════════════════════════════════════╣
  ║  STEP 4 — Decision & Failure Lookup               ║
  ║  Cek .kuma/memories/ + failure KB                 ║
  ║  Output: previous decisions, known issues         ║
  ╠═══════════════════════════════════════════════════╣
  ║  STEP 5 — Safety Check                            ║
  ║  Policy violation? Lock aktif? Risk level?        ║
  ╚═══════════════════════════════════════════════════╝
      ↓
  Structured JSON → Agent baca, validasi, baru kerja
```

**Setelah selesai** — agent WAJIB catet hasilnya:

```
kuma_memory({ action: "research_save", scope: "auth", ... })
  ↓ Otomatis:
  ├─ Update .kuma/research/auth.json
  ├─ Update graph nodes/edges
  └─ Update confidence score + content hash
```

#### Output Context Record

Disimpan di 2 tempat:
1. **SQLite graph** (`kuma.db`) — query cepat
2. **`.kuma/research/<scope>.json`** — dibaca manusia/agent lain

Format:

```json
{
  "scope": "auth",
  "version": 2,
  "confidence": 0.85,
  "entryPoints": ["AuthController.login", "AuthMiddleware.authenticate"],
  "flow": [
    "POST /login → AuthController.login → AuthService.validate → UserRepository.findByEmail",
    "AuthService.validate → JwtService.sign"
  ],
  "dependencies": ["JwtService", "SessionStore", "UserRepository"],
  "tests": ["tests/auth/login.test.ts", "tests/auth/middleware.test.ts"],
  "riskAreas": [
    { "area": "JWT expiry config", "file": "src/config/auth.ts:12" }
  ],
  "decisions": ["dec_001: Pake JWT instead of session"],
  "contentHash": "a1b2c3d4...",
  "validatedAt": "2026-07-26T10:00:00Z"
}
```

### 2. Change Manager — Selective Undo

**Masalah:** AI implement feature C, tapi rusak. Code sebelum C udah ada feature A + B. Kalo `git checkout` ke sebelum C, feature A + B ilang.

**Solusi:** Bukan file-level rollback, tapi **change-aware selective undo via session tracking di graph**.

```
┌─────────────────────────────────────────┐
│  Knowledge Graph tahu:                  │
│  - Session 1: auth.ts, middleware.ts    │ ← Feature A
│  - Session 2: routes.ts, controller.ts  │ ← Feature B  
│  - Session 3: routes.ts, db.ts          │ ← Feature C (RUSAK)
├─────────────────────────────────────────┤
│  Kuma bilang: "Feature C cuma ubah      │
│  routes.ts baris 42-67 dan db.ts.       │
│  Mau undo specific changes itu aja?"    │
└─────────────────────────────────────────┘
```

Cara kerja:
- Kuma track **symbol-level changes** per session di graph
- `kuma_context({ action: "changes" })` → "Session ini modified: X, Y, Z"
- Integrasi dengan git diff + graph untuk mapping symbol → perubahan
- Generate **selective undo command**: "git revert ini doang, sisanya aman"

### 3. Decision Trigger

Pas agent selesai operasi signifikan, graph deteksi perubahan → Kuma trigger:

```
Kuma:  "Ini perubahan signifikan. Mau catet decision?
        - Goal: refactor JWT → session-based auth
        - Files: auth.ts, middleware.ts, types.ts
        - Rationale: [biarkan agent jelasin]
        - Impact: middleware.ts dipanggil 12 routes → semuanya kena"
```

Agent decide: catet atau skip. Kalo catet → `kuma_memory({ action: "decision" })` → tersimpan di SQLite + `.kuma/memories/decisions.md`.

### 4. Project Brief (Auto)

Pas `kuma_context({ action: "init" })`, Kuma generate project brief otomatis:
- Arsitektur (dari graph + arch guard)
- Entry points & dependensi utama
- Konvensi project
- Decision + research history
- Risk areas (dari failure KB)
- Recent session activity

**Output:** Ringkasan padat biar agent langsung paham project tanpa baca semua file.

---

## 📊 Competitor Analysis

Riset dari 12+ sumber (HN, DEV.to, AWS blog, MCP official, artikel industri):

### Memory/Context MCP Servers

| Tool | Approach | Kelemahan |
|------|----------|-----------|
| **agentmemory** (25K★) | Auto-capture, 53 tools, hybrid search | Auto-track (lawan filosofi Kuma). 53 tools = overload. Butuh LLM API key. |
| **PMB** | SQLite local, hooks, 10 tools | Gak ada safety policy, gak ada impact analysis, gak ada multi-agent lock. |
| **PLUR** | YAML human-readable, MCP | Gak ada graph traversal, gak ada staleness detection. Memory-only. |
| **Memex** | Neo4j + Gemini (Graphiti) | Butuh Docker + API key. Berat. Bukan local-first murni. |
| **Cognee** | Graph-native, 14 retrieval modes | Infra kompleks. Overkill buat single project. |
| **Cloudflare AM** | Managed service | Cloud-dependent. Gak bisa local-only. |
| **Zep** | Temporal KG, enterprise | Berbayar. Enterprise-oriented. |

### Gap yang Cuma Kuma Isi

| Fitur | Kuma | Competitor |
|-------|------|-----------|
| **Research Protocol WAJIB** | ✅ Unik | ❌ Gak ada yang punya |
| **Safety Policy (never_touch dll)** | ✅ Unik | ❌ Gak ada |
| **Change-aware Selective Undo** | ✅ Unik | ❌ Gak ada |
| **Multi-agent File Lock** | ✅ Unik | ❌ Gak ada |
| **Architecture Guard (layer violation)** | ✅ Unik | ❌ Gak ada |
| **Impact Analysis via Graph** | ✅ SQLite, no LLM needed | 🔶 Memex tapi pake Neo4j + Gemini |
| **Confidence + Staleness** | ✅ Ada (self-heal) | 🔶 Memex ada tapi mahal |
| **Coarse-grained Pipeline (1 call)** | ✅ V3 architecture | ❌ Semua micro-tools |
| **Local-first, zero infra** | ✅ SQLite | 🔶 Ada yang butuh Docker/cloud |

### Posisi Kuma V3

**"Safety-first context & orchestration engine for AI agents"**

Bukan memory auto-track (itu udah banyak). Tapi:
- **Research WAJIB** sebelum sentuh code
- **Impact analysis** biar tau efek perubahan
- **Safety policy** biar gak sembarangan
- **Selective undo** kalo ada yang rusak
- **Multi-agent coordination** kalo kerja tim
- **Coarse-grained pipeline** — 1 call = full workflow

| Aspek | Kuma V2 (Sekarang) | Kuma V3 (Target) |
|-------|-------------------|-------------------|
| Tool Groups | 10 | 3 |
| Total Tools | 46+ | ~15 |
| Filosofi | "Safety toolkit" | "Context & documentation engine" |
| Editing | Execute sendiri | Agent native |
| Rollback | File backup | Change-aware selective undo |
| Decision | Manual | Trigger-based, agent decide |
| Knowledge Graph | Auto-track semua | Track signifikan + trigger |
| Codebase Complexity | Tinggi (banyak overlap) | Rendah (fokus, minimal) |
| Context Window Usage | Boros (46 tools) | Hemat (15 tools) |

---

## 📊 Perbandingan V2 vs V3

| Aspek | Kuma V2 (Sekarang) | Kuma V3 (Target) |
|-------|-------------------|-------------------|
| Tool Groups | 10 | 3 |
| Total Tools | 46+ | ~5 (coarse-grained) |
| Filosofi | "Safety toolkit" | "Safety-first context & orchestration" |
| Editing | Execute sendiri | Agent native |
| Tool Architecture | Micro-tools, agent chain sendiri | **Coarse-grained pipeline (1 call = full workflow)** |
| Rollback | File backup | Change-aware selective undo |
| Decision | Manual | Trigger-based, agent decide |
| Knowledge Graph | Auto-track semua | Pipeline-based tracking |
| Research | Gak ada | **WAJIB 5-step pipeline** |
| Codebase Complexity | Tinggi (banyak overlap) | Rendah (fokus, pipeline) |
| Context Window Usage | Boros (46 tool descriptions) | Minimal (3 groups, ~5 tools) |

---

## 📁 Struktur Baru

```
src/
├── index.ts                    # Entry point — MCP server
├── manifest.ts                 # Tool registration (3 groups)
├── cli/
│   └── init.ts                 # `kuma init` — generate config files
├── engine/
│   ├── kumaDb.ts               # SQLite manager
│   ├── kumaGraph.ts            # Knowledge graph engine
│   ├── kumaMemory.ts           # Decision recording
│   ├── kumaRouter.ts           # Tool router (3 groups)
│   ├── kumaLock.ts             # Multi-agent lock
│   ├── kumaSelfHeal.ts         # Graph self-healing
│   ├── kumaNavigator.ts        # Code flow navigation
│   ├── kumaInvestigator.ts     # Impact analysis (REFACTOR)
│   ├── kumaMermaid.ts          # Diagram generator
│   ├── kumaArchGuard.ts        # Architecture detection
│   ├── kumaConfig.ts           # Config manager
│   ├── kumaPredict.ts          # Predictive next
│   ├── kumaConfidence.ts       # Confidence score
│   ├── kumaLearning.ts         # Pattern learning
│   ├── kumaAnalytics.ts        # Session analytics
│   ├── kumaHealthDashboard.ts  # Code health dashboard
│   ├── kumaHeatMap.ts          # Activity heatmap
│   ├── kumaDNA.ts              # Project DNA
│   ├── kumaReplay.ts           # Session replay
│   ├── kumaFailureKB.ts        # Failure knowledge base
│   ├── kumaTimeMachine.ts      # Symbol timeline
│   ├── kumaCollective.ts       # Collective intelligence
│   ├── kumaMarketplace.ts      # Graph templates
│   ├── kumaIntent.ts           # Intent graph
│   ├── kumaExperience.ts       # Experience patterns
│   ├── kumaContextEngine.ts    # Auto-context engine
│   ├── safetyAudit.ts          # Safety audit
│   ├── safetyScore.ts          # Safety score
│   ├── kumaSafetyLayer.ts      # Safety layer
│   ├── kumaSafetyProxy.ts      # Safety proxy
│   └── sessionMemory.ts        # Session state
├── guards/
│   └── antiPatternDetector.ts  # Anti-pattern detection
├── tools/
│   ├── kumaGuard.ts            # Guard tool
│   ├── kumaContext.ts          # Context tool
│   ├── kumaInit.ts             # Init tool
│   ├── kumaRisk.ts             # Risk tool
│   ├── kumaPolicy.ts           # Policy tool
│   ├── kumaSafetyCheck.ts      # Safety check tool
│   └── kumaStats.ts            # Stats tool
├── agents/
│   └── projectConventions.ts   # Lightweight conventions
└── utils/
    ├── pathValidator.ts        # Path validation
    ├── kumaShared.ts           # Shared utilities
    ├── kumaOutput.ts           # Output formatter
    ├── tokenCounter.ts         # Token counter
    ├── gitUtils.ts             # Git utilities
    └── errorHandler.ts         # Error handler
```

### Dihapus (langsung)

```
src/tools/preciseDiffEditor.ts
src/tools/safeTerminalExec.ts
src/tools/smartGrep.ts
src/tools/smartFilePicker.ts
src/tools/batchFileWriter.ts
src/tools/gitLog.ts
src/tools/gitDiff.ts
src/tools/lspTools.ts
src/tools/kumaFind.ts
src/tools/projectStructure.ts
src/tools/staticAnalysis.ts
src/tools/kumaReflect.ts
src/tools/kumaDependencyGuard.ts
src/agents/codeReviewer.ts
src/utils/processRunner.ts
src/utils/conventionsDetector.ts
src/utils/skillGenerator.ts
src/utils/agentDetector.ts
src/utils/processRunner.ts
src/engine/kumaShadow.ts
src/engine/kumaSemantic.ts
```

---

## 🚀 Migration Path

1. **Phase 1** — Buat markdown ini sebagai blueprint. Diskusi & konfirmasi.
2. **Phase 2** — Hapus semua tools yang di-drop. Refactor kumaRouter.ts jadi 3 groups.
3. **Phase 3** — Implement Change Manager (selective undo via graph).
4. **Phase 4** — Implement Decision Trigger (deteksi perubahan signifikan + suggest).
5. **Phase 5** — Simplify kode yang di-KEEP. Hapus dead code, reduce complexity.
6. **Phase 6** — Update README, init template, publish.

---

---

## 📁 `.kuma/` Structure (After Refactor)

Ini isi folder `.kuma/` yang digenerate otomatis — **per project, bukan global.** Setiap project punya konteks sendiri.

```
.kuma/
├── kuma.db                 # SQLite — knowledge graph, sessions, research records, audit trail
├── init.md                 # Behavioral rules untuk AI agent (WAJIB baca)
├── config.json             # Per-project config (collective endpoint, autoSync, dll)
├── policy.yml              # Safety policy (never_touch, require_review, block_commands)
│
├── research/               # Hasil riset agent — WAJIB diisi setiap riset
│   ├── auth.json           # Context record: auth flow
│   ├── payment.json        # Context record: payment system
│   └── ...                 # Per scope
│
├── memories/               # Catatan persisten (optional, trigger-based)
│   ├── decisions.md        # ADR — keputusan arsitektur
│   ├── conventions.md      # Konvensi yang disepakati
│   ├── glossary.md         # Istilah-istilah project
│   └── known-issues.md     # Masalah yang diketahui
│
└── .instance-id            # Anonymous ID buat collective sync
```

### Kenapa `.kuma/` bukan global?

Karena konteks tiap project **berbeda** — auth flow di project A belum tentu sama dengan project B. Graph, research, decision semuanya **project-specific**.

### Research Format (`research/*.json`)

Bukan markdown biasa. **JSON terstruktur** yang:
- Bisa di-query lewat graph
- Punya confidence score
- Bisa di-validasi staleness-nya (via content hash)
- Langsung dipahami agent tanpa parsing prosa

Kalo mau dibaca manusia, Kuma bisa render:  
`kuma_context({ action: "research", scope: "auth", format: "readable" })`

---

Kesimpulan: **Rollback tetap penting** tapi bentuknya berubah. Bukan backup file (precise_diff_editor), tapi **change-aware selective undo via knowledge graph + git**. Kuma tau "session ini ngubah apa aja" dan bisa bantu revert specific changes tanpa nyenggol yang lain.

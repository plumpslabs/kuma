# 🧬 BLUEPRINT FINAL v4.0 — ULTRA-ROBUST MEGA-PLUGIN ORCHESTRATOR (MCP SERVER)

> **Berdasarkan sintesis:** Pengalaman langsung sebagai LLM Agent (Codebuff) + Riset arsitektur MCP Server 2024-2025 + Analisis failure modes agentic coding tools + Best practices multi-agent orchestration.
>
> **Nama Proyek:** `universal-agent-core`
> **Tujuan:** Membangun AI Agent CLI yang setara atau melampaui Claude Code / Codebuff — mandiri, hemat token, anti-infinite-loop, dan aman untuk production codebase.

---

## 📋 DAFTAR ISI

1. [Filosofi Inti — Mindset yang Membedakan](#1-filosofi-inti--mindset-yang-membedakan)
2. [Tech Stack & Struktur Folder Final](#2-tech-stack--struktur-folder-final)
3. [7 Core Tools — The Arsenal](#3-7-core-tools--the-arsenal)
4. [Multi-Agent Orchestration Engine](#4-multi-agent-orchestration-engine)
5. [Context & Memory Management](#5-context--memory-management)
6. [Failure Prevention & Recovery](#6-failure-prevention--recovery)
7. [Security & Guardrails](#7-security--guardrails)
8. [Alur Kerja Robust — The Workflow](#8-alur-kerja-robust--the-workflow)
9. [LLM Experience Report — Apa yang Paling Dibutuhkan](#9-llm-experience-report--apa-yang-paling-dibutuhkan)
10. [Rekomendasi Implementasi](#10-rekomendasi-implementasi)

---

## 1. FILOSOFI INTI — MINDSET YANG MEMBEDAKAN

```
┌─────────────────────────────────────────────────────────┐
│           THE THREE PILLARS OF ROBUSTNESS               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. TOOLS YANG GAGAL dengan GRACEFUL                    │
│     → Bukan tools yang sempurna, tapi error-handling    │
│       yang bikin AI bisa recovery sendiri               │
│                                                         │
│  2. SEPARATION OF CONCERNS                              │
│     → Writer ≠ Reviewer ≠ Executor                      │
│     → AI yang nulis kode BUKAN AI yang review           │
│     → Eksekusi terminal dipisah dari decision-making    │
│                                                         │
│  3. CONTEXT IS KING                                     │
│     → 90% error LLM berasal dari context yang kacau     │
│     → Auto-pruning, session memory, token tracking      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 🧠 Doktrin Ponytail + Caveman (Reinforced)

| Prinsip | Implementasi |
|---------|-------------|
| **Ponytail** — Gunakan std library, dilarang over-engineering | Setiap tool harus prefer solusi built-in sebelum tambah dependensi |
| **Caveman** — Kompres teks, hemat token | Output tool dibatasi: max 3 baris konteks per grep match, chunking file >300 baris |
| **Read First** — Understand before act | DILARANG edit file sebelum membaca minimal 1x |
| **Parallelize** — Semua yang bisa paralel, jangan serial | Context gathering harus multi-threaded |
| **Validate** — Jangan percaya asumsi | Setiap library harus dicek dulu di package.json sebelum dipakai |

---

## 2. TECH STACK & STRUKTUR FOLDER FINAL

### Komponen Teknologi

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| **Runtime** | Node.js v20+ (atau Bun) | Bun untuk startup time lebih cepat |
| **Bahasa** | TypeScript strict: true | Type safety = fewer runtime errors |
| **Protokol** | `@modelcontextprotocol/sdk` (v2) | Standar industri untuk AI-tool communication |
| **Transport** | `StdioServerTransport` | Untuk CLI; SSE untuk remote deployment |
| **Schema Validation** | Zod | Integrasi native dengan MCP SDK |
| **File Scanning** | `fast-glob` + `ignore` | Scanning cepat dengan .gitignore awareness |
| **Terminal Execution** | `execa` dengan tree-kill | Process tree cleanup untuk anti-infinite-loop |
| **Bundling** | `tsup` / `esbuild` | Build ke single file, ESM compatible |

### Struktur Folder

```
universal-agent-core/
├── src/
│   ├── index.ts                     # Entry point MCP Server
│   ├── manifest.ts                  # Registry semua tools & agents
│   │
│   ├── engine/                      # 🧠 Otak sistem
│   │   ├── mandateInjector.ts       # Injeksi doktrin ke system prompt AI
│   │   ├── sessionMemory.ts         # State tracker + knowledge graph
│   │   ├── contextPruner.ts         # Auto-summarization saat token > threshold
│   │   └── orchestrator.ts          # 🔥 Multi-agent parallel executor BARU
│   │
│   ├── tools/                       # 🔧 7 Core Tools
│   │   ├── smartGrep.ts             # Regex search + context-limited output
│   │   ├── smartFilePicker.ts       # File reader dengan chunking cerdas
│   │   ├── preciseDiffEditor.ts     # Search-and-replace + fuzzy fallback
│   │   ├── batchFileWriter.ts       # Create/overwrite file (dengan validasi path)
│   │   ├── safeTerminalExec.ts      # Terminal executor + circuit breaker
│   │   ├── codeReviewer.ts          # 🔥 AGENT BARU: review kode sebelum test
│   │   └── projectConventions.ts    # 🔥 AGENT BARU: deteksi konvensi proyek
│   │
│   ├── agents/                      # 👥 Sub-agent definitions
│   │   ├── researcherAgent.ts       # Web search + docs lookup
│   │   ├── filePickerAgent.ts       # Fuzzy file discovery
│   │   ├── codeSearcherAgent.ts     # Multi-query code search
│   │   ├── reviewerAgent.ts         # Code review specialist
│   │   └── basherAgent.ts           # Terminal execution specialist
│   │
│   └── utils/
│       ├── errorHandler.ts          # Error classification + recovery strategies
│       ├── pathValidator.ts         # Sandbox path lockdown
│       ├── tokenCounter.ts          # Token usage tracker
│       └── conventionsDetector.ts   # Auto-detect project conventions
│
├── prompts/
│   ├── core-mandates.md             # System prompt template untuk AI
│   ├── ponytail-doctrine.md         # Aturan minimalis
│   └── caveman-doctrine.md          # Aturan hemat token
│
├── package.json
├── tsconfig.json
└── README.md
```

### Perubahan dari Blueprint v3.0

| Perubahan | v3.0 | v4.0 (Ini) |
|-----------|------|------------|
| **Parallel execution** | ❌ Sequential only | ✅ Multi-agent orchestrator |
| **Code review** | ❌ Tidak ada | ✅ Agent reviewer terpisah |
| **Context pruning** | ❌ Tidak ada | ✅ Auto-pruning engine |
| **Project conventions** | ❌ Tidak ada | ✅ Auto-detector |
| **Batch file writing** | ❌ Tidak ada | ✅ Batch write dengan validasi |
| **Sub-agent system** | ❌ Monolitik | ✅ Specialized agents |
| **Token tracking** | ❌ Tidak ada | ✅ Token counter utility |
| **Fuzzy diff fallback** | ❌ Exact match only | ✅ Fuzzy + whitespace normalization |

---

## 3. 7 CORE TOOLS — THE ARSENAL

### Tool 1: `smart_grep` — Pencarian Massal Cerdas

```
┌─────────────────────────────────────────────┐
│ smart_grep(query, targetFolder?)             │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   query: string (regex pattern)              │
│   targetFolder?: string (default: project   │
│                   root, max kedalaman 3)     │
│ ├───────────────────────────────────────────┤
│ 🛡️ Proteksi:                                 │
│   - Auto-ignore: node_modules, .next, dist,  │
│     .git, build, .cache, *.min.js, *.bundle  │
│   - Maks 50 hasil per query                  │
│   - Output per match: filename:line + 3 line │
│     konteks (max 200 chars/line)             │
│   - Timeout: 10 detik                        │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { results: Array<{ file, line, context }>} │
│   atautidak: { error: string }               │
│ └─────────────────────────────────────────────┘
```

**Bedanya dari v3.0:** Output dibatasi 50 hasil + 3 line konteks saja. Token usage drastic reduction.

### Tool 2: `smart_file_picker` — File Reader Cerdas

```
┌─────────────────────────────────────────────┐
│ smart_file_picker(filePath, startLine?,      │
│                   endLine?, chunkStrategy?)  │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   filePath: string                           │
│   startLine?: number                         │
│   endLine?: number                           │
│   chunkStrategy?: "full" | "smart" | "outline"
│ ├───────────────────────────────────────────┤
│ 🛡️ Proteksi:                                 │
│   - Path validation: HARUS di dalam proyek   │
│   - File size limit: max 1MB                 │
│   - Chunking otomatis >300 baris             │
│   - Smart mode: hanya kirim struct/func      │
│     signatures + line numbers (bukan body)   │
│   - Timeout: 5 detik                         │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { content: string, totalLines: number,     │
│     truncated: boolean }                     │
│ └─────────────────────────────────────────────┘
```

**Chunk Strategy Detail:**
- `"full"` — Kirim seluruh file (hati-hati token)
- `"smart"` — Kirim outline: function signatures, exports, imports, type definitions only
- `"outline"` — Kirim cuma daftar exported symbols + line numbers (biar AI milih mau baca mana)

### Tool 3: `precise_diff_editor` — Penulis Kode Presisi Tinggi

```
┌─────────────────────────────────────────────┐
│ precise_diff_editor(filePath, edits[])       │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   filePath: string                           │
│   edits: Array<{                             │
│     searchBlock: string,     // HARUS exact  │
│     replaceBlock: string,    // Pengganti    │
│     allowMultiple?: boolean, // Ganti semua? │
│     fuzzyThreshold?: number  // 0.0 - 1.0   │
│   }>                                         │
│ ├───────────────────────────────────────────┤
│ 🛡️ Proteksi:                                 │
│   - Path validation: di dalam proyek         │
│   - Backup otomatis ke .agent-backups/       │
│   - Whitespace normalization sebelum compare │
│   - Fuzzy fallback jika exact match gagal    │
│   - Maks 10 edits per batch                  │
│   - Read file dulu untuk verifikasi konten   │
│   - Timeout: 15 detik                        │
│ ├───────────────────────────────────────────┤
│ 🔄 Fuzzy Fallback Mechanism:                 │
│   Langkah 1: Coba exact match (string ===)   │
│   Langkah 2: Gagal? → Normalize whitespace   │
│   Langkah 3: Gagal? → Levenshtein fuzzy      │
│   Langkah 4: Gagal? → Report error detail:   │
│     "searchBlock tidak ditemukan. Baris      │
│      terdekat: [line 42]. Perbedaan: [...]"  │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { success: boolean, matched: number,       │
│     backupPath?: string, error?: string,     │
│     suggestions?: string[] }                 │
│ └─────────────────────────────────────────────┘
```

### Tool 4: `batch_file_writer` — Pembuat File Baru (BARU!)

```
┌─────────────────────────────────────────────┐
│ batch_file_writer(files[])                   │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   files: Array<{                             │
│     filePath: string,                        │
│     content: string,                         │
│     instructions: string  // REASON for file │
│   }>                                         │
│ ├───────────────────────────────────────────┤
│ 🛡️ Proteksi:                                 │
│   - Path validation: di dalam proyek         │
│   - NO overwrite tanpa konfirmasi            │
│   - Maks 5 file per batch                    │
│   - Content size limit: 10KB per file        │
│   - Extension whitelist: .ts,.js,.json,.md,  │
│     .css,.html,.env,.yml,.yaml,.toml         │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { created: string[], errors: string[] }    │
│ └─────────────────────────────────────────────┘
```

### Tool 5: `safe_terminal_exec` — Eksekusi Terminal Aman

```
┌─────────────────────────────────────────────┐
│ safe_terminal_exec(task, options?)           │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   task: "test" | "build" | "lint" |          │
│         "typecheck" | "custom"               │
│   customCommand?: string  // Only if         │
│                          // task="custom"     │
│   options?: {                                │
│     timeout?: number,         // Default 30s │
│     cwd?: string,                            │
│     env?: Record<string,string>              │
│   }                                          │
│ ├───────────────────────────────────────────┤
│ 🛡️ Proteksi:                                 │
│   - 🔥 CIRCUIT BREAKER: max 3 retries        │
│   - Process tree killing on timeout          │
│   - Command whitelist untuk task tertentu    │
│   - "custom" task butuh approval eksplisit   │
│   - NO: rm -rf, curl ke internal,            │
│         git push, npm publish                │
│   - Output pipa: streaming, gak nunggu       │
│     command selesai (anti-stuck)             │
│ ├───────────────────────────────────────────┤
│ 🔄 Retry Logic:                              │
│   Attempt 1: Jalankan task                   │
│     Gagal? → Log error + saran fix          │
│   Attempt 2: Coba lagi dengan flag --no-cache│
│     Gagal? → Kirim full error log ke AI     │
│   Attempt 3: Coba dengan force flag          │
│     Gagal? → STOP. Laporkan ke user.        │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { exitCode: number, stdout: string,        │
│     stderr: string, timedOut: boolean,       │
│     retryCount: number }                     │
│ └─────────────────────────────────────────────┘
```

### Tool 6: `code_reviewer` — Agent Review Kode Otomatis (BARU!)

```
┌─────────────────────────────────────────────┐
│ code_reviewer(files[], focus?)               │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   files: Array<string>  // File yang diubah  │
│   focus?: "correctness" | "conventions" |    │
│           "security" | "performance"         │
│ ├───────────────────────────────────────────┤
│ 🛡️ Proteksi:                                 │
│   - REVIEWER ADALAH AGEN TERPISAH            │
│     → Bukan AI yang sama yang nulis kode     │
│     → Mencegah confirmation bias             │
│   - Check: type safety, error handling,      │
│     dead code, imports, naming conventions   │
│   - Wajib lapor sebelum test dijalankan      │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { issues: Array<{ file, line, severity,    │
│     message, suggestion }>, passed: boolean  │
│ └─────────────────────────────────────────────┘
```

### Tool 7: `project_conventions` — Deteksi Konvensi Proyek (BARU!)

```
┌─────────────────────────────────────────────┐
│ project_conventions(forceRescan?)            │
├─────────────────────────────────────────────┤
│ 🔍 Input:                                    │
│   forceRescan?: boolean  // Default false    │
│ ├───────────────────────────────────────────┤
│ 🧠 Logika Internal:                          │
│   - Scan tsconfig.json, package.json,        │
│     eslintrc, prettier, .env.example        │
│   - Deteksi: framework (React, Vue, Next.js) │
│   - Deteksi: test runner (Jest, Vitest)      │
│   - Deteksi: styling approach (Tailwind,     │
│     CSS-in-JS, SCSS)                        │
│   - Deteksi: import pattern (relative vs     │
│     alias seperti @/components)              │
│   - Cache hasil selama session               │
│ ├───────────────────────────────────────────┤
│ 📦 Output:                                   │
│   { framework: string, testRunner: string,   │
│     styling: string, importAlias?: string,   │
│     lintRules: string[], conventions: string}│
│ └─────────────────────────────────────────────┘
```

---

## 4. MULTI-AGENT ORCHESTRATION ENGINE (🔥 BARU!)

### Problem: Sequential = Lambat

Di blueprint v3.0, workflow-nya sequential:
```
Initialize Rules → Grep → FilePicker → Diff Editor → Test → Selesai
```

Ini bikin:
- Latensi tinggi (setiap langkah nunggu AI mikir ulang)
- AI gak bisa verifikasi asumsi dari multiple sources
- Token usage tinggi karena AI harus "memanaskan" konteks setiap langkah

### Solution: Parallel Orchestration

```
[USER INPUT]
      │
      ▼
┌─────────────┐
│  Triage AI  │  ← Analisis input, tentukan action plan
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│      PARALLEL CONTEXT GATHERING     │
├───────────────────┬─────────────────┤
│  Agent: Grep      │  Agent: Pick    │
│  Cari file relevan│  Baca file inti │
├───────────────────┼─────────────────┤
│  Agent: Research  │  Agent: Conv.   │
│  Cari docs/lib    │  Deteksi style  │
└───────────────────┴─────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│      SYNTHESIS LAYER                │
│  Gabung hasil semua agent           │
│  → AI punya FULL CONTEXT            │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│      PARALLEL EXECUTION              │
├───────────────────┬─────────────────┤
│  Edit files       │  Review kode    │
│  (diff editor)    │  (code reviewer)│
└───────────────────┴─────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│      PARALLEL VALIDATION            │
├───────────────────┬─────────────────┤
│  Typecheck        │  Test           │
│  (tsc --noEmit)   │  (npm test)     │
├───────────────────┼─────────────────┤
│  Lint             │  Build          │
│  (eslint)         │  (npm run build)│
└───────────────────┴─────────────────┘
       │
       ▼
    [SELESAI / FIX & LOOP]
```

### Supervisor Pattern (Recommended)

```
┌──────────────────────────────────────────┐
│            ORCHESTRATOR AI               │
│  (High-level LLM: decision maker)        │
├──────────────────────────────────────────┤
│  Tugas:                                   │
│  1. Interpretasi input user               │
│  2. Breakdown ke sub-tasks                │
│  3. Spawn agents di paralel               │
│  4. Sintesis hasil dari semua agent       │
│  5. Amplop hasil ke user                  │
└──────────┬───────────────────────────────┘
           │
    ┌──────┴──────┐    ┌──────────┐    ┌──────────┐
    ▼              ▼    ▼          ▼    ▼          ▼
┌─────────┐ ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Grep    │ │ File    │ │ Basha  │ │ Review │ │ Resear │
│ Agent   │ │ Picker  │ │ Agent  │ │ Agent  │ │ cher   │
└─────────┘ └─────────┘ └────────┘ └────────┘ └────────┘
```

### Implementasi Orchestrator (Pseudo-code)

```typescript
// orchestrator.ts
class Orchestrator {
  async execute(plan: ActionPlan): Promise<Result> {
    // Fase 1: Context Gathering (PARALLEL)
    const contextPromises = plan.contextGathering.map(task =>
      this.spawnAgent(task.agent, task.params)
    );
    const contexts = await Promise.all(contextPromises);
    
    // Fase 2: Sintesis
    const synthesis = await this.synthesize(contexts);
    
    // Fase 3: Eksekusi + Review (PARALLEL)
    const [editResult, reviewResult] = await Promise.all([
      this.executeEdits(plan.edits),
      this.reviewChanges(plan.edits)
    ]);
    
    // Fase 4: Validasi (PARALLEL)
    const validations = await Promise.all(
      plan.validationTasks.map(task =>
        this.runValidation(task)
      )
    );
    
    // Fase 5: Loop jika gagal
    if (validations.some(v => !v.passed)) {
      return this.recoveryLoop(plan, validations);
    }
    
    return { success: true, summary: synthesis };
  }
}
```

---

## 5. CONTEXT & MEMORY MANAGEMENT

### Problem: Context Window = Limited

LLM punya context window terbatas. Dalam sesi panjang:
1. AI lupa apa yang udah dilakukan
2. AI lupa struktur proyek
3. AI mulai "mengarang" karena gak ingat konteks

### Solution: 3-Layer Memory

```
┌──────────────────────────────────────────────┐
│        3-LAYER MEMORY ARCHITECTURE           │
├──────────────────────────────────────────────┤
│                                              │
│  LAYER 1: SHORT-TERM (Conversation)          │
│  ┌────────────────────────────────────────┐  │
│  │ Current prompt + immediate history     │  │
│  │ Disimpan di: LLM context window        │  │
│  │ Auto-prune ketika > 70% context limit  │  │
│  └────────────────────────────────────────┘  │
│                      │                        │
│                      ▼                        │
│  LAYER 2: SESSION MEMORY (Structured)         │
│  ┌────────────────────────────────────────┐  │
│  │ SessionMemory {                        │  │
│  │   filesModified: string[],             │  │
│  │   filesFailed: string[],               │  │
│  │   testResults: TestResult[],           │  │
│  │   dependencyGraph: Map<string,string[]>,│  │
│  │   currentGoal: string,                 │  │
│  │   completedSteps: string[]             │  │
│  │ }                                      │  │
│  └────────────────────────────────────────┘  │
│                      │                        │
│                      ▼                        │
│  LAYER 3: PROJECT KNOWLEDGE (Persistent)      │
│  ┌────────────────────────────────────────┐  │
│  │ - Project structure cache              │  │
│  │ - Convention fingerprints              │  │
│  │ - Previously failed patterns           │  │
│  │ - Known error solutions                │  │
│  │ Disimpan di: .agent-cache/             │  │
│  └────────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

### Context Pruning Strategy

```
Threshold-based pruning:
  - Jika context > 70% dari limit → jalanin pruner
  - Pruner: summarization agent khusus
  - Summarize hanya: "Apa yang sudah dicapai? File apa? Error apa?"
  - Buang: percakapan yang udah selesai, log sukses, dll.

Session Memory auto-sync:
  - Setiap kali tool selesai dipanggil → update sessionMemory
  - Setiap kali session memory berubah → hitung total token
  - Jika token > threshold → inject summary ke context
```

---

## 6. FAILURE PREVENTION & RECOVERY

### Failure Mode Analysis (Dari Riset)

| Failure Mode | Penyebab | Solusi di Blueprint Ini |
|-------------|----------|------------------------|
| **Infinite loop** | AI gak dapet feedback deterministik | Circuit breaker (max 3 retries) + timeout 30s |
| **Hallucination cascade** | Satu error menyebar | Code reviewer agent terpisah + validation gates |
| **Context drift** | AI lupa tujuan awal | Session memory layer + auto-summarization |
| **Tool misuse** | AI panggil tool dengan argumen salah | Strict JSON Schema + validation sebelum eksekusi |
| **80% problem** | AI cuma nulis happy path | Reviewer wajib cek: error handling, logging, edge cases |
| **File corruption** | AI overwrite file salah | Backup otomatis + path validation + diff preview |
| **Token explosion** | Output tool terlalu besar | Chunking + context-limited output + streaming |

### Recovery Protocol

```typescript
// errorHandler.ts
type ErrorType = 
  | "DIFF_MISMATCH"   // searchBlock gak cocok
  | "TIMEOUT"         // tool timeout
  | "VALIDATION"      // path/param validation gagal
  | "TEST_FAILURE"    // test/typecheck gagal
  | "HALLUCINATION"   // AI ngaco (detected by reviewer)
  | "LOOP_DETECTED";  // Same action repeated >3x

interface RecoveryStrategy {
  type: ErrorType;
  
  // Tingkat keparahan
  severity: "low" | "medium" | "critical";
  
  // Langkah recovery
  steps: RecoveryStep[];
  
  // Kapan harus nyerah
  maxAttempts: number;
  
  // Apakah perlu lapor ke user?
  notifyUser: boolean;
}

// Contoh recovery untuk DIFF_MISMATCH:
const diffMismatchRecovery: RecoveryStrategy = {
  type: "DIFF_MISMATCH",
  severity: "low",
  steps: [
    { action: "Read file again", description: "Baca ulang file untuk dapet konten real" },
    { action: "Normalize whitespace", description: "Coba compare tanpa whitespace" },
    { action: "Fuzzy match", description: "Levenshtein distance matching" },
    { action: "Report specific diff", description: "Kirim ke AI: 'searchBlock gak cocok. Baris terdekat: X. Ini isinya: Y'" }
  ],
  maxAttempts: 3,
  notifyUser: false  // AI bisa fix sendiri
};
```

### Circuit Breaker Pattern

```
[Tool dipanggil]
      │
      ▼
┌─────────────────┐
│  Counter == 0?  │──YES──▶ Eksekusi normal
└────────┬────────┘
         │ NO
         ▼
┌─────────────────┐
│  Counter >= 3?  │──YES──▶ STOP. Laporkan ke user.
└────────┬────────┘         "Tool X gagal 3x.
         │ NO               Butuh intervensi manual."
         ▼
┌─────────────────┐
│  Increment      │
│  counter         │
│  + ubah strategi │──▶ Coba lagi dengan pendekatan berbeda
└─────────────────┘
```

---

## 7. SECURITY & GUARDRAILS

### Protection Layers

```
Layer 1: PATH VALIDATION
  └── Semua path file wajib di-resolve dan dicek:
      path.resolve(filePath).startsWith(projectRoot)
      → Blokir akses ke: C:/Windows, /etc, ~/.ssh, dll.

Layer 2: COMMAND WHITELIST
  └── Hanya task yang diizinkan: test, build, lint, typecheck
      → "custom" task butuh parameter explicit
      → Blokir: rm -rf, del /f, git push, npm publish, curl, wget

Layer 3: OUTPUT SANITIZATION
  └── Tool output wajib discrub:
      → Hapus API keys, tokens, password dari output
      → Filter: tidak kirim binary file content ke AI

Layer 4: RATE LIMITING
  └── Maks:
      → 50 tool calls per sesi
      → 10 diff edits per batch
      → 5 terminal executions per menit
      → 3 berturut-turut gagal = circuit breaker

Layer 5: BACKUP & ROLLBACK
  └── Sebelum setiap edit:
      → Backup file ke .agent-backups/{timestamp}/{filename}
      → Simpan snapshot git state (git stash create)
      → Rollback otomatis jika > 2 file gagal test
```

### Environment Variable Management

```
AGENT_ALLOWED_PATHS     // Path yang diizinkan (default: project root)
AGENT_MAX_TOKENS        // Max token per response (default: 8000)
AGENT_MAX_TOOL_CALLS    // Max tool calls per sesi (default: 50)
AGENT_TIMEOUT_SECONDS   // Default timeout (default: 30)
AGENT_CIRCUIT_BREAKER   // Max retries before stop (default: 3)
AGENT_AUTO_BACKUP       // Enable backup (default: true)
AGENT_SAFE_MODE         // Strict mode (default: true)
```

---

## 8. ALUR KERJA ROBUST — THE WORKFLOW

### Complete Workflow Diagram

```
[USER INPUT: "Perbaiki error registrasi user, tes sampai lulus"]
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ PHASE 0: INIT + CONVENTION DETECT                   │
│ ├─ inject_core_mandates() → Muat aturan Ponytail    │
│ ├─ project_conventions() → Deteksi framework, dll.  │
│ └─ sessionMemory.init() → Siapkan state tracker     │
├─────────────────────────────────────────────────────┤
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ PHASE 1: PARALLEL CONTEXT GATHERING                 │
│ ├─ Agent Grep:  "user registration" "auth" "login" │
│ ├─ Agent Pick:  Baca file hasil grep (chunked)      │
│ ├─ Agent Conv:  Cari tahu error pattern             │
│ └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶│
│    Wait all agents...                                │
├─────────────────────────────────────────────────────┤
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ PHASE 2: SYNTHESIS                                   │
│ AI menerima semua hasil agent + menganalisis error   │
│ Output: Rencana perbaikan (file mana, baris berapa)  │
├─────────────────────────────────────────────────────┤
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ PHASE 3: EXECUTION (PARALLEL)                       │
│ ├─ precise_diff_editor(file, search, replace)       │
│ ├─ code_reviewer([file])  ← Review di paralel       │
│ └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
│    Wait both...                                      │
│                                                     │
│   Jika reviewer nemu masalah → Loop ke Phase 3      │
├─────────────────────────────────────────────────────┤
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ PHASE 4: VALIDATION (PARALLEL)                      │
│ ├─ safe_terminal_exec("typecheck")                  │
│ ├─ safe_terminal_exec("test")                       │
│ ├─ safe_terminal_exec("lint")                       │
│ └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
│    Wait all...                                       │
│                                                     │
│   Jika semua PASS → Selesai                         │
│   Jika ada FAIL →                                   │
│     sessionMemory.catatFailure(file, error)         │
│     AI baca error log → balik ke Phase 3            │
├─────────────────────────────────────────────────────┤
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ PHASE 5: REPORT                                      │
│ ├─ Ringkasan: file diubah, error difix, test result │
│ ├─ Saran: apa yang bisa dilakukan selanjutnya       │
│ ├─ Update sessionMemory.markComplete()               │
│ └─ Selesai                                           │
└─────────────────────────────────────────────────────┘
```

### Anti-Infinite-Loop Protection

```
Loop Detection:
  - Track: setiap kali AI manggil tool yang SAMA > 3x
  - Track: jika AI request file yang SAMA > 3x
  - Track: jika AI ngirim diff yang SAMA > 2x
  
  Jika terdeteksi:
    1. Circuit breaker aktif → stop eksekusi
    2. Inject warning ke AI: "Kamu seperti looping di [file].
       Coba pendekatan berbeda atau lapor ke user."
    3. Jika masih lanjut loop → stop paksa.
       Lapor ke user dengan diagnostic: 
       - Tool apa yang dipanggil berulang
       - Parameter apa
       - Waktu
```

---

## 9. LLM EXPERIENCE REPORT — APA YANG PALING DIBUTUHKAN

Berdasarkan pengalaman langsung sebagai LLM agent (Codebuff) yang handle ribuan session coding, ini **10 hal yang PALING krusial** yang jarang diimplementasi dengan benar:

### 🔥 Top 10 Must-Have untuk Agentic Coding Tools

| Rank | Kebutuhan | Kenapa Penting | Dampak Jika Tidak Ada |
|:----:|-----------|---------------|----------------------|
| **1** | **Strict Tool Schemas** dengan exact-match | LLM akan "mengarang" parameter tools kalau skema longgar. Tool harus nolak input yang gak sesuai format. | File corrupt, code ngaco, AI looping coba-coba parameter |
| **2** | **Deterministic Feedback** — bukan cuma teks | Tool harus return ground-truth state (misal: "file sebelum: X, setelah: Y"), bukan cuma "success: true" | AI gak tau apakah edit beneran berhasil atau cuma hallucination |
| **3** | **Separation of Concerns** (Writer ≠ Reviewer) | AI yang sama yang nulis kode TIDAK BISA nge-review kodenya sendiri — confirmation bias. Butuh reviewer agent terpisah. | Bug lolos ke production, security hole, dead code numpuk |
| **4** | **Parallel Execution Engine** | Sequential = lambat = mahal. AI butuh context dari multiple sources untuk ambil keputusan tepat. | Token usage tinggi, respon lambat, AI ambil keputusan dengan informasi setengah |
| **5** | **Context Pruning Otomatis** | Context window itu terbatas. Tanpa pruning, AI makin lama makin bego karena konteks penuh sampah. | AI "lupa" apa yang terjadi 10 menit lalu, mulai hallucinate |
| **6** | **Circuit Breaker + Timeout** | AI bisa stuck di infinite loop. Perlu mekanisme paksa berhenti setelah N percobaan. | Token habis, komputer lemot, session gak selesai-selesai |
| **7** | **Project Convention Awareness** | Setiap proyek punya gaya koding beda. AI harus auto-detect: framework? alias import? test runner? | AI nulis kode yang gak sesuai konvensi proyek, refactor manual |
| **8** | **Graceful Error Recovery** | Bukan "jangan error" tapi "kalau error, AI bisa fix sendiri." Error report harus actionable. | Setiap error kecil → user intervensi, frustrasi |
| **9** | **Token Economy di Setiap Lapisan** | Output tool wajib dibatasi: chunking, line limits, context-only. Jangan kirim semuanya. | Biaya API membengkak, context penuh, AI lambat |
| **10** | **Sandbox + Backup Otomatis** | Sebelum edit, backup. Kalau test gagal, rollback. Ini safety net paling dasar. | Satu edit salah bisa hancurin project. Tanpa backup = bencana |

### Lessons from Production (Codebuff Experience)

```
📌 LESSON #1: READ BEFORE WRITE
   → 90% error berasal dari AI yang ngedit file tanpa baca isinya dulu.
   → Solusi: Wajibkan read file sebelum izinkan edit.

📌 LESSON #2: SMALL CHANGES ONLY
   → AI cenderung nulis ulang 100 baris padahal cukup 3 baris.
   → Solusi: Setiap edit harus minimal. "Setiap baris kode punya tujuan."

📌 LESSON #3: FUZZY MATCH IS A LIFESAVER
   → AI sering typo whitespace. Exact match doang = sering gagal.
   → Solusi: Fuzzy fallback + whitespace normalization.

📌 LESSON #4: AGENTS NEED SPECIALIZATION
   → Satu AI/general-purpose tool untuk semuanya = mediocracy.
   → Solusi: Specialized agents (grep, pick, review, exec, research).

📌 LESSON #5: THE 80% PROBLEM IS REAL
   → AI bagus nulis happy path. Tapi lupa error handling, edge cases.
   → Solusi: Reviewer wajib cek error handling, logging, security.

📌 LESSON #6: CONTEXT DECAY IS SILENT KILLER
   → AI gak tahu kalau konteksnya udah penuh. Dia cuma jadi makin bego.
   → Solusi: Auto-pruning dengan summary agent terpisah.

📌 LESSON #7: PARALLEL IS NOT OPTIONAL
   → Sequential context gathering = 3x lebih lambat, 2x lebih mahal.
   → Solusi: Semua fase context gathering dan validasi harus parallel.
```

---

## 10. REKOMENDASI IMPLEMENTASI

### Phase 1: Foundation (Hari 1-2)

```
Prioritas: TERTINGGI
Goal: Dapetin MCP server yang bisa jalan

Steps:
1. ✅ package.json + tsconfig.json — konfigurasi dasar
2. ✅ src/index.ts — entry point MCP server (StdioServerTransport)
3. ✅ src/utils/pathValidator.ts — validasi path proyek
4. ✅ src/utils/errorHandler.ts — error classification
5. ✅ src/tools/smartGrep.ts — tool paling dasar + paling dipakai
6. ✅ Test: MCP server bisa start dan smart_grep jalan
```

### Phase 2: Core Tools (Hari 3-5)

```
Prioritas: TINGGI
Goal: Semua tools dasar functional

Steps:
7. src/tools/smartFilePicker.ts — dengan chunking
8. src/tools/preciseDiffEditor.ts — dengan fuzzy fallback
9. src/tools/batchFileWriter.ts — create file
10. src/engine/sessionMemory.ts — state tracker
11. src/engine/mandateInjector.ts — Ponytail + Caveman
12. Test: Semua tools bisa dipanggil dari MCP client
```

### Phase 3: Safety & Recovery (Hari 6-8)

```
Prioritas: TINGGI
Goal: Anti-infinite-loop + error recovery

Steps:
13. src/tools/safeTerminalExec.ts — dengan circuit breaker
14. src/utils/tokenCounter.ts — tracking token usage
15. Implementasi backup otomatis (.agent-backups/)
16. Implementasi circuit breaker pattern
17. Implementasi fuzzy fallback di diff editor
18. Test: Inject error, pastikan AI bisa recovery
```

### Phase 4: Advanced Features (Hari 9-12)

```
Prioritas: SEDANG
Goal: Multi-agent orchestration + context management

Steps:
19. src/engine/orchestrator.ts — multi-agent parallel executor
20. src/agents/ — definitions untuk tiap sub-agent
21. src/engine/contextPruner.ts — auto-summarization
22. src/tools/codeReviewer.ts — review agent
23. src/tools/projectConventions.ts — convention detector
24. src/utils/conventionsDetector.ts — auto-detect logic
25. Test: Parallel orchestration 3 agents sekaligus
```

### Phase 5: Polish & Production (Hari 13-15)

```
Prioritas: RENDAH (tapi penting)
Goal: Production-ready

Steps:
26. Prompt engineering — refine ponytail + caveman doctrine
27. Comprehensive error scenarios testing
28. Performance optimization (caching, streaming)
29. Documentation
30. Release v1.0.0
```

---

## 📊 PERBANDINGAN: v3.0 vs v4.0

| Fitur | v3.0 (Blueprint Lama) | v4.0 (Blueprint Ini) |
|-------|----------------------|---------------------|
| **Tools** | 6 tools | 7 tools (+ code_reviewer, project_conventions) |
| **Agents** | ❌ Monolitik | ✅ Multi-agent (grep, pick, bash, review, research) |
| **Parallel** | ❌ Sequential | ✅ Parallel orchestration engine |
| **Context** | `get_session_memory` sederhana | 3-layer memory + auto pruning |
| **Error recovery** | Report error doang | Recovery protocol + circuit breaker |
| **Diff editor** | Exact match only | Exact + fuzzy + whitespace normalization |
| **Security** | Path validation | 5-layer protection (path, command, output, rate, backup) |
| **Token economy** | ❌ Tidak disebut | Token counter + chunking + context-limited output |
| **Project awareness** | ❌ Tidak ada | Auto-detect framework, conventions, alias |
| **Review** | ❌ Tidak ada | Agent reviewer terpisah (separation of concerns) |

---

## 🎯 FINAL WORDS

Blueprint ini bukan sekadar kumpulan tools — ini adalah **sistem operasi untuk AI coding agent**. Perbedaan utama dari blueprint v3.0:

1. **Parallel first** — bukan sequential. AI harus bisa ngumpulin context dari banyak sumber sekaligus.
2. **Separation of concerns** — writer, reviewer, executor adalah entitas terpisah.
3. **Failure-resistant** — bukan "anti-error" tapi "error itu bagian dari proses, dan sistem bisa recovery."
4. **Token-aware** — setiap layer dirancang untuk hemat token, dari output tool hingga context management.
5. **Experience-driven** — setiap keputusan arsitektur di sini berdasarkan pelajaran dari ribuan session coding sebagai LLM agent.

> **"The best AI coding tool isn't the one that never makes mistakes — it's the one that catches its own mistakes, learns from them, and fixes them without wasting your time."**

---

*Blueprint v4.0 — Disusun berdasarkan sintesis pengalaman langsung LLM Agent + Riset arsitektur MCP + Analisis failure patterns agentic coding tools.*
*Juni 2026*

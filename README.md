<div align="center">

# 🧬 Universal Agent Core

### **The MCP Server That Supercharges Every AI Coding Agent**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs)](https://nodejs.org/)
[![MCP SDK](https://img.shields.io/badge/MCP-1.7-000000?logo=modelcontextprotocol)](https://github.com/modelcontextprotocol/sdk)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)
[![npm version](https://img.shields.io/badge/npm-v1.0.0-red?logo=npm)](package.json)

**Not a plugin for one agent — an infrastructure layer for ALL agents.**  
Works with Claude Code, GitHub Copilot (Codex), Gemini CLI, Cursor, and any MCP-compatible client.

<br/>

---

[Features](#-features) • [Quick Start](#-quick-start) • [Usage](#-usage) • [Architecture](#-architecture) • [Configuration](#%EF%B8%8F-configuration) • [Development](#-development) • [Roadmap](#-roadmap) • [FAQ](#-faq)

---

</div>

<br/>

## ✨ Features

Universal Agent Core provides **10 specialized tools** that turn any AI coding agent into a production-grade codebase manager.

### 🔧 The Tool Arsenal

| # | Tool | What It Does |
|---|------|-------------|
| 1 | `smart_grep` | 🔍 Regex search across your project with context-limited output (3 lines per match) |
| 2 | `smart_file_picker` | 📖 Read files with 3 strategies: full content, smart (signatures-only), or outline |
| 3 | `precise_diff_editor` | ✏️ Search-and-replace edits with **exact + fuzzy + whitespace-normalized** fallback |
| 4 | `batch_file_writer` | 📝 Create new files in batch with path validation & extension whitelist |
| 5 | `execute_safe_test` | 🛡️ Safe terminal execution with **circuit breaker**, timeout, and process tree kill |
| 6 | `code_reviewer` | 👁️ **Separate agent** that reviews code for correctness, conventions, security, & performance |
| 7 | `project_conventions` | 🏗️ Auto-detect framework, test runner, styling, import aliases, and lint rules |
| 8 | `initialize_session_rules` | 🧠 Injects **Ponytail + Caveman** minimalist doctrine into AI prompts |
| 9 | `get_session_memory` | 💾 Anti-amnesia — tracks modified files, failures, and dependency graphs |
| 10 | `context_pruner_advice` | ✂️ Token usage monitoring & pruning suggestions to stay within context limits |

### 🛡️ Built-in Safety

| Feature | Description |
|---------|-------------|
| **Path Traversal Protection** | Sandboxed to project directory — no escaping to system files |
| **Circuit Breaker** | Auto-stops after 3 identical failures (prevents infinite loops) |
| **Auto-Backup** | Every edit creates a `.agent-backups/` snapshot before modifying |
| **Command Whitelist** | Only `test`, `build`, `lint`, `typecheck`, and explicit custom commands allowed |
| **Dangerous Pattern Blocking** | `rm -rf`, `git push`, `npm publish` — blocked by default |

### 🧠 Smart Memory System

- **3-Layer Memory**: Short-term (context), Session (state tracker), Project (conventions cache)
- **Loop Detection**: Detects when AI calls the same tool >3x and triggers circuit breaker
- **Token Budget Tracking**: Warns at 70% usage, critical alert at 90%

<br/>

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (recommended: 20+)
- **npm** or **pnpm** or **yarn**
- An MCP-compatible AI coding client (Claude Code, Cursor, Codex, etc.)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/universal-agent-core.git
cd universal-agent-core

# Install dependencies + auto-build
npm install
# (postinstall script otomatis menjalankan build)

# Atau manual:
npm run build
```

### Jalankan Langsung

```bash
# Via npx (di dalam folder project)
npx universal-agent-core

# Atau via node langsung
node dist/index.js

# Atau via npm script
npm start
```

### Integrate with Your AI Client

Semua client pake config yang sama, tinggal ganti path-nya:

```json
{
  "mcpServers": {
    "universal-agent-core": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/kuma/dist/index.js"]
    }
  }
}
```

> 💡 **Untuk project ini**, absolute path-nya:
> `/home/mawa/My_File/Development/kuma/dist/index.js`

<details>
<summary><b>🔵 Claude Code</b></summary>

Add to your `~/.claude/settings.json` or project `.claude/settings.json`:

```json
{
  "mcpServers": {
    "universal-agent-core": {
      "command": "node",
      "args": ["/home/mawa/My_File/Development/kuma/dist/index.js"]
    }
  }
}
```
</details>

<details>
<summary><b>🟢 Cursor</b></summary>

In Cursor: **Settings → MCP Servers → Add New**

| Field | Value |
|-------|-------|
| Name | `universal-agent-core` |
| Type | `command` |
| Command | `node /absolute/path/to/universal-agent-core/dist/index.js` |
</details>

<details>
<summary><b>🟣 GitHub Copilot / Codex</b></summary>

Follow the MCP server configuration guide for your client. Point to:

```bash
node /absolute/path/to/universal-agent-core/dist/index.js
```
</details>

<details>
<summary><b>🟡 Gemini CLI</b></summary>

Configure your Gemini CLI to use the MCP server at:

```bash
node /absolute/path/to/universal-agent-core/dist/index.js
```
</details>

<br/>

## 🎯 Usage

Once integrated, your AI agent can use these tools immediately. Here are real-world examples:

### Search Your Codebase

```bash
# AI prompt: "Find where authentication is handled"
→ smart_grep({ query: "authenticate" })
→ 🔍 12 results from 45 files scanned
```

### Read Files Intelligently

```bash
# AI prompt: "Show me the auth module structure"
→ smart_file_picker({ filePath: "src/auth.ts", chunkStrategy: "outline" })
→ 📤 Exports: login(), logout(), refreshToken(), validateSession()
```

### Edit Code with Auto-Backup

```bash
# AI prompt: "Fix the login function to handle errors"
→ precise_diff_editor({
    filePath: "src/auth.ts",
    edits: [{
      searchBlock: "function login() {",
      replaceBlock: "function login(): Promise<boolean> {"
    }]
  })
→ ✅ Backup saved to .agent-backups/1712345678/src/auth.ts
```

### Run Tests Safely

```bash
# AI prompt: "Run typecheck to verify my changes"
→ execute_safe_test({ task: "typecheck" })
→ 💻 $ npx tsc --noEmit
→ ✅ PASS — Exit code: 0
```

### Review Changes Automatically

```bash
# AI prompt: "Review my changes for security issues"
→ code_reviewer({ files: ["src/auth.ts"], focus: "security" })
→ 🔴 [L15] Potential hardcoded secret
→ 🟡 [L42] innerHTML can lead to XSS
```

<br/>

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     MCP SERVER                                │
│                  universal-agent-core                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│   │  Tools   │  │  Engine  │  │  Agents  │  │  Utils   │   │
│   │ (7 ops)  │  │ (4 mods) │  │ (2 ops)  │  │ (4 mods) │   │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│        │              │              │              │        │
│   ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  │
│   │ smart_    │  │ Session   │  │ Code      │  │ Error     │  │
│   │ grep      │  │ Memory    │  │ Reviewer  │  │ Handler   │  │
│   ├───────────┤  ├───────────┤  ├───────────┤  ├───────────┤  │
│   │ smart_    │  │ Context   │  │ Project   │  │ Path      │  │
│   │ file_pick │  │ Pruner    │  │ Convents  │  │ Validator │  │
│   ├───────────┤  ├───────────┤  └───────────┘  ├───────────┤  │
│   │ precise_  │  │ Mandate   │                 │ Token     │  │
│   │ diff_edit │  │ Injector  │                 │ Counter   │  │
│   ├───────────┤  ├───────────┤                 ├───────────┤  │
│   │ batch_    │  │Orchestrtr │                 │Convents   │  │
│   │ file_writ │  └───────────┘                 │Detector   │  │
│   ├───────────┤                                └───────────┘  │
│   │ safe_     │                                               │
│   │ term_exec │                                               │
│   └──────────┘                                               │
│                                                              │
└──────────────────┬───────────────────┬───────────────────────┘
                   │                   │
                   ▼                   ▼
         ┌──────────────┐   ┌──────────────────┐
         │ Claude Code  │   │ Cursor / Codex   │
         │ Gemini CLI   │   │ Any MCP Client   │
         └──────────────┘   └──────────────────┘
```

### Design Philosophy

This project is built on **Three Pillars of Robustness**:

1. **Tools That Fail Gracefully** — Not about perfection, but about error recovery. Every tool has multiple fallback strategies.
2. **Separation of Concerns** — The AI that writes code is **not** the same AI that reviews it. Writers, reviewers, and executors are separate entities.
3. **Context Is King** — 90% of LLM errors come from messy context. Auto-pruning, session memory, and token tracking keep the AI sharp.

<br/>

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_ALLOWED_PATHS` | project root | Paths the agent is allowed to access |
| `AGENT_MAX_TOKENS` | 8000 | Max tokens per response |
| `AGENT_MAX_TOOL_CALLS` | 50 | Max tool calls per session |
| `AGENT_TIMEOUT_SECONDS` | 30 | Default timeout for operations |
| `AGENT_CIRCUIT_BREAKER` | 3 | Max retries before stopping |
| `AGENT_AUTO_BACKUP` | true | Enable automatic file backups |
| `AGENT_SAFE_MODE` | true | Strict security mode |

### Tool Capabilities

| Tool | Input Schema | Output |
|------|-------------|--------|
| `smart_grep` | `query: string`, `targetFolder?: string`, `maxResults?: number` | Array of `{ file, line, context }` |
| `smart_file_picker` | `filePath: string`, `startLine?: number`, `endLine?: number`, `chunkStrategy?: "full" \| "smart" \| "outline"` | `{ content, totalLines, truncated }` |
| `precise_diff_editor` | `filePath: string`, `edits: Array<{ searchBlock, replaceBlock, allowMultiple?, fuzzyThreshold? }>` | `{ success, matched, backupPath }` |
| `batch_file_writer` | `files: Array<{ filePath, content, instructions }>` | `{ created, errors }` |
| `execute_safe_test` | `task: "test" \| "build" \| "lint" \| "typecheck" \| "custom"`, `customCommand?: string`, `timeout?: number` | `{ exitCode, stdout, stderr, timedOut }` |
| `code_reviewer` | `files: string[]`, `focus?: "correctness" \| "conventions" \| "security" \| "performance"` | `{ issues, passed }` |
| `project_conventions` | `forceRescan?: boolean` | `{ framework, testRunner, styling, importAlias, lintRules }` |
| `initialize_session_rules` | — | Injects Ponytail + Caveman doctrine |
| `get_session_memory` | — | `{ filesModified, filesFailed, testResults, callHistory }` |
| `context_pruner_advice` | — | Token usage report + pruning suggestions |

<br/>

## 📁 Project Structure

```
universal-agent-core/
├── src/
│   ├── index.ts                    # MCP Server entry point
│   ├── manifest.ts                 # Tool registry (10 tools)
│   ├── engine/
│   │   ├── sessionMemory.ts        # State tracker + knowledge graph
│   │   ├── contextPruner.ts        # Token usage & pruning advice
│   │   ├── mandateInjector.ts      # Ponytail + Caveman doctrine
│   │   └── orchestrator.ts         # Multi-agent orchestration
│   ├── tools/
│   │   ├── smartGrep.ts            # Regex search engine
│   │   ├── smartFilePicker.ts      # File reader with chunking
│   │   ├── preciseDiffEditor.ts    # Search-replace + fuzzy fallback
│   │   ├── batchFileWriter.ts      # Batch file creator
│   │   └── safeTerminalExec.ts     # Safe terminal executor
│   ├── agents/
│   │   ├── codeReviewer.ts         # Code review agent
│   │   └── projectConventions.ts   # Convention detector
│   └── utils/
│       ├── errorHandler.ts         # Error classification + circuit breaker
│       ├── pathValidator.ts        # Sandbox directory locking
│       ├── tokenCounter.ts         # Token usage estimation
│       └── conventionsDetector.ts  # Auto-detect project config
├── prompts/
│   ├── core-mandates.md            # 10 mandatory AI rules
│   ├── ponytail-doctrine.md        # Minimalist coding doctrine
│   └── caveman-doctrine.md         # Token efficiency doctrine
├── tests/                          # Unit tests
├── LICENSE
├── package.json
├── tsconfig.json
└── README.md
```

<br/>

## 🛣️ Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** ✅ | **Done** | Foundation (package.json, tsconfig, MCP entry, smartGrep) |
| **Phase 2** ✅ | **Done** | Core tools (filePicker, diffEditor, batchWriter) |
| **Phase 3** ✅ | **Done** | Safety (terminalExec, circuit breaker, backup) |
| **Phase 4** ✅ | **Done** | Advanced (orchestrator, contextPruner, sessionMemory) |
| **Phase 5** 🔄 | **In Progress** | Plugin SDK — community plugins |
| **Phase 6** 🚧 | **Planned** | Parallel execution engine — real multi-agent parallelism |
| **Phase 7** 🚧 | **Planned** | Testing suite — comprehensive unit + integration tests |

<br/>

## 🧪 Development

```bash
# Clone and setup
git clone https://github.com/your-org/universal-agent-core.git
cd universal-agent-core
npm install

# Development server with hot reload
npm run dev

# TypeScript type checking
npm run typecheck

# Run tests
npm test

# Build for production
npm run build

# Lint code
npm run lint
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage report
npx jest --coverage

# Run specific test file
npx jest tests/smartGrep.test.ts
```

<br/>

## 🤝 Contributing

We welcome contributions! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Guidelines

- Follow the **Ponytail Doctrine**: use standard library first, minimize dependencies
- Follow the **Caveman Doctrine**: write concise, token-efficient code
- All new features **must** include tests
- All code **must** pass typecheck (`npm run typecheck`)
- Write clear, self-documenting code with minimal comments

<br/>

## ❓ FAQ

### What is MCP?

**Model Context Protocol (MCP)** is an open standard by Anthropic that allows AI agents to interact with external tools, data sources, and services. Universal Agent Core implements an MCP server that exposes 10 coding-specific tools.

### Which AI clients are supported?

Any client that supports the MCP protocol: **Claude Code**, **Cursor**, **GitHub Copilot (Codex)**, **Gemini CLI**, and more.

### Is this safe to use on production code?

Yes — the system includes path traversal protection, automatic backups, circuit breakers, and dangerous command blocking. Every operation is sandboxed to your project directory.

### How is this different from just using an agent's built-in tools?

Universal Agent Core provides **specialized tools** that are optimized for token efficiency and reliability — context-limited output, fuzzy fallback for edits, auto-backup, session memory to prevent AI amnesia, and a separate code reviewer to catch mistakes.

<br/>

## 📄 License

This project is [MIT licensed](LICENSE). Use freely, contribute back.

```
MIT License
Copyright (c) 2026 Universal Agent Core
See the LICENSE file for details.
```

<br/>

## 🙏 Acknowledgments

Built based on synthesis of:

- **LLM Agent Experience** — Architecture patterns from Codebuff and similar tools
- **MCP Protocol** — [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Failure Mode Research** — MAST taxonomy, Galileo, Augment Code
- **Multi-Agent Orchestration Patterns** — Supervisor, Handoff, Concurrent patterns

<br/>

<div align="center">

**Made with 🧬 for AI agents everywhere**

[Report Bug](https://github.com/your-org/universal-agent-core/issues) · [Request Feature](https://github.com/your-org/universal-agent-core/issues) · [Discussions](https://github.com/your-org/universal-agent-core/discussions)

</div>

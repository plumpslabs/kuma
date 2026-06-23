<div align="center">

<img src="https://raw.githubusercontent.com/farhank15/kuma/main/public/kuma.png" alt="Kuma Logo" width="200" />

# Kuma

**The MCP that questions the code before writing it.**

[![npm](https://img.shields.io/npm/v/@farhan22/kuma.svg?logo=npm&color=red)](https://www.npmjs.com/package/@farhan22/kuma)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-18+-339933?logo=nodedotjs)](https://nodejs.org/)

Works with **Claude Code**, **Cursor**, **Gemini CLI**, **GitHub Copilot**, and any MCP-compatible client.

</div>

---

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@farhan22/kuma"]
    }
  }
}
```

That's it. Your AI agent now has access to all 12 tools.

<details>
<summary><b>Where does this config go?</b></summary>

| Client | Config Location |
|--------|----------------|
| **Claude Code** | `~/.claude/settings.json` |
| **Cursor** | Settings → Features → MCP → Add Server |
| **Gemini CLI** | `~/.gemini/settings.json` |
| **Copilot / Codex** | VS Code MCP extension settings |

</details>

---

## Tools

| Tool | Description |
|------|-------------|
| `smart_grep` | Narrow down to the specific code you need. Returns filename, line number, and 3 lines of context. |
| `smart_file_picker` | Read files with chunking: `full`, `smart` (signatures only), `outline` (exports only). Saves token budget. |
| `precise_diff_editor` | Search-and-replace with exact → whitespace → fuzzy fallback. Auto-backup before every edit. Use `action: "rollback"` to undo. |
| `batch_file_writer` | Create up to 15 files in one call. Warns when creating too many — asks if each is necessary. |
| `execute_safe_test` | Run `test`/`build`/`lint`/`typecheck` with timeout, circuit breaker, and process tree kill. |
| `code_reviewer` | Senior-level static analysis. Supports focus modes: correctness, conventions, security, performance, and **over-engineering**. |
| `project_conventions` | Auto-detect framework, test runner, package manager, import aliases. Know your stack before you code. |
| `get_session_memory` | Session state tracker. Accepts `{ topic }` to load specific memory files (architecture, conventions, known-issues, decisions, glossary). |
| `lsp_query` | Go-to-definition, find references, get type info, or **rename symbols** via TypeScript Language Server. Falls back to regex when LSP is unavailable. |
| `git_log` | Structured commit history with optional file filter. |
| `kuma_reflect` | **Reflection tool** — checks if you're on track, detects drift (edits without tests, loops, unresolved failures), and suggests the next action. |
| `write_memory` | Persist project knowledge (decisions, glossary) to `.kuma/memories/`. Append, prepend, or overwrite. |

### Safety

- **Sandboxed** — all file operations locked to project directory, path traversal blocked
- **Auto-backup** — `.agent-backups/<timestamp>/` snapshot before every edit
- **Circuit breaker** — stops after 3 identical failures to prevent loops
- **Command whitelist** — only `test`, `build`, `lint`, `typecheck`, and explicit custom commands
- **Dangerous pattern blocking** — `rm -rf`, `git push --force`, `npm publish` blocked by default

---

## Philosophy

Kuma is built around a simple ladder that runs before every action:

1. **Does this code need to exist?**
2. **Does the standard library or an installed dependency already cover it?**
3. **Is there a one-liner that does the same thing?**
4. **Only then, write it.**

Most tools generate more code. Kuma generates **less**.

Three things no other MCP does:
- A reviewer that catches **over-engineering** (`code_reviewer` with `focus: "over-engineering"`)
- A reflector that catches **drift** (`kuma_reflect` — edits without tests, tool-call loops, unresolved failures)
- A memory that **survives sessions** like an IDE (`get_session_memory` with topic filter, auto-generated architecture/conventions/known-issues)

---

## Development

```bash
git clone https://github.com/farhank15/kuma.git
cd kuma
npm install
npm run build
```

```bash
npm test           # run all tests (136 tests, 9 suites)
npm run typecheck  # type checking
npm run dev        # watch mode
```

To use your local build instead of npm:

```json
{
  "mcpServers": {
    "kuma": {
      "command": "node",
      "args": ["/path/to/kuma/dist/index.js"]
    }
  }
}
```

---

## Contributing

1. Fork → branch → commit → PR
2. All new features **must** include tests
3. All code **must** pass `npm run typecheck`

---

## License

[MIT](LICENSE)

<div align="center">

**Made with 🐻 for AI agents everywhere**

[Report Bug](https://github.com/farhank15/kuma/issues) · [Request Feature](https://github.com/farhank15/kuma/issues)

</div>

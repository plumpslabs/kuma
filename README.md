<div align="center">

<img src="https://raw.githubusercontent.com/farhank15/kuma/main/public/kuma.png" alt="Kuma Logo" width="200" />

# Kuma

**MCP server that gives AI coding agents better tools.**

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
| `smart_grep` | Regex search with 3-line context, max 100 results. Token-efficient alternative to native grep. |
| `smart_file_picker` | Read files with chunking strategies: `full`, `smart` (signatures only), `outline` (exports only). |
| `precise_diff_editor` | Search-and-replace with exact → whitespace-normalized → fuzzy fallback chain. Auto-backup before every edit. |
| `rollback_last_edit` | Restore file from backup. Supports version selection (`version: 'list'` to browse, `version: N` to pick). |
| `batch_file_writer` | Create up to 15 files in one call. Path validation + extension whitelist. |
| `execute_safe_test` | Run `test`/`build`/`lint`/`typecheck` with timeout, circuit breaker, and process tree kill. |
| `code_reviewer` | Static analysis for correctness, conventions, security, and performance. Outputs text or structured JSON. |
| `project_conventions` | Auto-detect framework, test runner, styling, import aliases, and lint config. |
| `get_session_memory` | Session state tracker — modified files, failures, tool call history, loop detection. |
| `lsp_query` | Go-to-definition, find references, or get type info via TypeScript Language Server. |
| `rename_symbol` | Global rename across all files using LSP. |
| `git_log` | Structured commit history with optional file filter. |

### Safety

- **Sandboxed** — all file operations locked to project directory, path traversal blocked
- **Auto-backup** — `.agent-backups/<timestamp>/` snapshot before every edit
- **Circuit breaker** — stops after 3 identical failures to prevent loops
- **Command whitelist** — only `test`, `build`, `lint`, `typecheck`, and explicit custom commands
- **Dangerous pattern blocking** — `rm -rf`, `git push --force`, `npm publish` blocked by default

---

## Development

```bash
git clone https://github.com/farhank15/kuma.git
cd kuma
npm install
npm run build
```

```bash
npm test           # run all tests (105 tests, 6 suites)
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

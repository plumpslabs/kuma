# Kuma IDE — VS Code Extension

Visual dashboard for Kuma inside VS Code's sidebar. Displays knowledge graph, gotchas, trajectories, checkpoints, and more.

## Features

- 📊 **Health Score** — at-a-glance project health
- 🔗 **Knowledge Graph** — Mermaid diagram of nodes and edges
- ⚠️ **Gotchas** — Known issues with severity indicators
- 🧠 **Trajectories** — Agent action timeline with success rates
- 📋 **Status Report** — Full text-based report
- 🔄 **Auto-refresh** — Updates on file save

## Usage

1. Open a workspace that has Kuma configured (has `.kuma/kuma.db`)
2. Click the Kuma icon in the activity bar
3. The dashboard loads automatically

### Commands

| Command | Description |
|---------|-------------|
| `Kuma: Open Dashboard` | Switch to Kuma sidebar |
| `Kuma: Refresh Dashboard` | Force refresh data |

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Package for VS Code marketplace
pnpm package
```

## Requirements

- VS Code >= 1.85.0
- A project with Kuma initialized (`.kuma/kuma.db` exists)

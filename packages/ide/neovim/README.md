# kuma.nvim — Kuma Dashboard for Neovim

Visual dashboard for Kuma inside Neovim. Displays knowledge graph stats, gotchas, trajectories, checkpoints, and more.

## Requirements

- Neovim >= 0.9.0
- `sqlite3` CLI binary (for querying `.kuma/kuma.db`)

## Installation

### lazy.nvim

```lua
{
  dir = "/path/to/kuma/packages/ide/neovim",
  name = "kuma",
  config = function()
    require("kuma").setup()
  end,
}
```

### packer.nvim

```lua
use {
  "/path/to/kuma/packages/ide/neovim",
  config = function()
    require("kuma").setup()
  end,
}
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `:KumaDashboard` | Open Kuma dashboard |
| `:KumaClose` | Close Kuma dashboard |

### Keymaps

| Key | Description |
|-----|-------------|
| `<leader>kd` | Toggle Kuma dashboard |
| `<leader>ko` | Open Kuma dashboard |
| `<leader>kc` | Close Kuma dashboard |

## Configuration

```lua
require("kuma").setup({
  keymaps = true, -- Set to false to disable default keymaps
})
```

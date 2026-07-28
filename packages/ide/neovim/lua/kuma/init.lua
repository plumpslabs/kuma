-- ============================================================
-- KUMA NEOVIM — Plugin Entry Point
-- ============================================================

local M = {}

local db = require("kuma.db")
local ui = require("kuma.ui")

-- State
M._namespace = vim.api.nvim_create_namespace("kuma")
M._buf = nil
M._win = nil

-- ============================================================
-- Commands
-- ============================================================

--- Open Kuma Dashboard floating window
function M.open_dashboard()
  local data, err = db.load_all()

  if not data then
    vim.notify("[Kuma] " .. (err or "Failed to load Kuma data"), vim.log.levels.ERROR)
    return
  end

  -- Close existing window if open
  M.close_dashboard()

  -- Create floating window with dashboard content
  local lines = {}
  table.insert(lines, "╔══════════════════════════════════════╗")
  table.insert(lines, "║           KUMA DASHBOARD            ║")
  table.insert(lines, "╚══════════════════════════════════════╝")
  table.insert(lines, "")

  -- Health Score
  local score = data.health_score or "N/A"
  table.insert(lines, "📊 Health Score: " .. score)
  table.insert(lines, "")

  -- Knowledge Graph
  table.insert(lines, "── Knowledge Graph ──")
  table.insert(lines, "  Nodes: " .. (data.node_count or 0))
  table.insert(lines, "  Edges: " .. (data.edge_count or 0))
  table.insert(lines, "")

  -- Gotchas
  table.insert(lines, "── Gotchas ──")
  if data.gotchas and #data.gotchas > 0 then
    for _, g in ipairs(data.gotchas) do
      local icon = g.severity == "critical" and "🔴" or
                   g.severity == "high" and "🟠" or
                   g.severity == "medium" and "🟡" or "🟢"
      table.insert(lines, string.format("  %s [%s] %s", icon, g.severity, g.description))
    end
  else
    table.insert(lines, "  No gotchas recorded.")
  end
  table.insert(lines, "")

  -- Trajectories
  table.insert(lines, "── Trajectories ──")
  if data.trajectories and #data.trajectories > 0 then
    for _, t in ipairs(data.trajectories) do
      local rate = math.floor((t.success_rate or 0) * 100)
      table.insert(lines, string.format("  %s (%d%%)", t.goal, rate))
    end
  else
    table.insert(lines, "  No trajectory data.")
  end
  table.insert(lines, "")

  -- Checkpoints
  table.insert(lines, "── Checkpoints ──")
  table.insert(lines, "  Count: " .. (data.checkpoint_count or 0))
  table.insert(lines, "")

  -- Skills
  table.insert(lines, "── Skills ──")
  table.insert(lines, "  Distilled Skills: " .. (data.skill_count or 0))
  table.insert(lines, "")

  if data.db_path then
    table.insert(lines, "📁 " .. data.db_path)
  end

  M._buf, M._win = ui.create_floating_window(lines, {
    title = " Kuma Dashboard ",
    width = 56,
    height = math.min(#lines + 2, 30),
  })
end

--- Close Kuma Dashboard
function M.close_dashboard()
  if M._win and vim.api.nvim_win_is_valid(M._win) then
    vim.api.nvim_win_close(M._win, true)
  end
  if M._buf and vim.api.nvim_buf_is_valid(M._buf) then
    vim.api.nvim_buf_delete(M._buf, { force = true })
  end
  M._win = nil
  M._buf = nil
end

--- Toggle Kuma Dashboard
function M.toggle_dashboard()
  if M._win and vim.api.nvim_win_is_valid(M._win) then
    M.close_dashboard()
  else
    M.open_dashboard()
  end
end

-- ============================================================
-- Setup
-- ============================================================

function M.setup(opts)
  opts = opts or {}

  -- Create commands
  vim.api.nvim_create_user_command("KumaDashboard", M.open_dashboard, {})
  vim.api.nvim_create_user_command("KumaClose", M.close_dashboard, {})

  -- Default keymaps
  if opts.keymaps ~= false then
    vim.keymap.set("n", "<leader>kd", M.toggle_dashboard, { desc = "Toggle Kuma Dashboard" })
    vim.keymap.set("n", "<leader>ko", M.open_dashboard, { desc = "Open Kuma Dashboard" })
    vim.keymap.set("n", "<leader>kc", M.close_dashboard, { desc = "Close Kuma Dashboard" })
  end

  vim.notify("[Kuma] Neovim plugin loaded. Use :KumaDashboard or <leader>kd to open.", vim.log.levels.INFO)
end

return M

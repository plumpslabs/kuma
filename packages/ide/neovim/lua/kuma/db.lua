-- ============================================================
-- KUMA NEOVIM — SQLite Database Reader
-- ============================================================

local M = {}

-- Try to load sqlite.lua from luarocks or lazy.nvim
local sqlite_ok, sqlite = pcall(require, "sqlite")
if not sqlite_ok then
  -- Fallback: use vim.fn.system call to sqlite3 CLI
  M._use_cli = true
end

--- Find .kuma/kuma.db relative to cwd
function M._find_db()
  local cwd = vim.fn.getcwd()
  local db_path = cwd .. "/.kuma/kuma.db"

  -- Walk up directories
  local dir = cwd
  while vim.fn.filereadable(db_path) == 0 do
    local parent = vim.fn.fnamemodify(dir, ":h")
    if parent == dir then
      return nil, "Kuma database not found. Run Kuma in this project first."
    end
    dir = parent
    db_path = dir .. "/.kuma/kuma.db"
  end

  return db_path
end

--- Execute SQL query via sqlite3 CLI
function M._query_cli(db_path, sql)
  local cmd = string.format("sqlite3 -json '%s' '%s'", db_path, sql:gsub("'", "'\\''"))
  local ok, result = pcall(vim.fn.system, cmd)

  if not ok or vim.v.shell_error ~= 0 then
    return nil, result or "SQLite query failed"
  end

  if not result or result == "" then
    return {}
  end

  local ok2, parsed = pcall(vim.fn.json_decode, result)
  if not ok2 then
    return {}
  end

  return parsed
end

--- Load all dashboard data from Kuma DB
function M.load_all()
  local db_path, err = M._find_db()
  if not db_path then
    return nil, err
  end

  local data = {
    db_path = db_path,
    gotchas = {},
    trajectories = {},
    node_count = 0,
    edge_count = 0,
    checkpoint_count = 0,
    skill_count = 0,
    health_score = "N/A",
  }

  -- Nodes count
  local nodes = M._query_cli(db_path, "SELECT COUNT(*) as c FROM nodes")
  if nodes and #nodes > 0 then
    data.node_count = nodes[1].c or 0
  end

  -- Edges count
  local edges = M._query_cli(db_path, "SELECT COUNT(*) as c FROM edges")
  if edges and #edges > 0 then
    data.edge_count = edges[1].c or 0
  end

  -- Gotchas
  local gotchas = M._query_cli(db_path, "SELECT * FROM known_gotchas ORDER BY severity DESC")
  if gotchas then
    data.gotchas = gotchas
  end

  -- Trajectories
  local trajectories = M._query_cli(db_path, "SELECT goal, success_rate, total_duration_ms, complexity FROM trajectories ORDER BY created_at DESC LIMIT 10")
  if trajectories then
    data.trajectories = trajectories
  end

  -- Checkpoints count
  local checkpoints = M._query_cli(db_path, "SELECT COUNT(*) as c FROM checkpoints")
  if checkpoints and #checkpoints > 0 then
    data.checkpoint_count = checkpoints[1].c or 0
  end

  -- Skills count
  local skills = M._query_cli(db_path, "SELECT COUNT(*) as c FROM distilled_skills")
  if skills and #skills > 0 then
    data.skill_count = skills[1].c or 0
  end

  -- Health score
  local health = M._query_cli(db_path, "SELECT score FROM health_snapshots ORDER BY created_at DESC LIMIT 1")
  if health and #health > 0 then
    data.health_score = tostring(health[1].score)
  end

  -- Compute health score from node count
  if data.health_score == "N/A" then
    local s = 100
    if data.node_count == 0 then s = s - 20 end
    if data.node_count and data.node_count < 5 then s = s - 10 end
    data.health_score = tostring(math.max(0, s))
  end

  return data
end

return M

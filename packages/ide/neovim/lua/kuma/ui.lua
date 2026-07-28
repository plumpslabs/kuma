-- ============================================================
-- KUMA NEOVIM — Floating Window UI
-- ============================================================

local M = {}

--- Create a floating window with content lines
--- @param lines string[] Line content to display
--- @param opts table Options: title, width, height, border
--- @return number buf, number win
function M.create_floating_window(lines, opts)
  opts = opts or {}

  local width = opts.width or 60
  local height = opts.height or math.min(#lines + 2, 20)
  local title = opts.title or " Kuma "

  -- Calculate centered position
  local ui = vim.api.nvim_list_uis()[1]
  local row = math.floor(((ui and ui.height or 24) - height) / 2)
  local col = math.floor(((ui and ui.width or 80) - width) / 2)

  -- Create buffer
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

  -- Set buffer options
  vim.bo[buf].modifiable = false
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].filetype = "kuma"

  -- Window configuration
  local win_config = {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = opts.border or "rounded",
    title = title,
    title_pos = "center",
  }

  -- Create window
  local win = vim.api.nvim_open_win(buf, true, win_config)

  -- Window options
  vim.wo[win].cursorline = true
  vim.wo[win].number = false
  vim.wo[win].relativenumber = false
  vim.wo[win].signcolumn = "no"
  vim.wo[win].winhl = "Normal:NormalFloat,FloatBorder:FloatBorder"

  -- Close on 'q' or <Esc>
  vim.keymap.set("n", "q", function()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    if vim.api.nvim_buf_is_valid(buf) then
      vim.api.nvim_buf_delete(buf, { force = true })
    end
  end, { buffer = buf, nowait = true })

  vim.keymap.set("n", "<Esc>", function()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    if vim.api.nvim_buf_is_valid(buf) then
      vim.api.nvim_buf_delete(buf, { force = true })
    end
  end, { buffer = buf, nowait = true })

  return buf, win
end

return M

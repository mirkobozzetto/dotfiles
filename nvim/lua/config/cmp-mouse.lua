-- Mouse in the completion menu, VSCode-style: wheel to scroll through
-- suggestions, click to pick one. blink.cmp has no mouse support at all.

local M = {}

local function menu_ouvert()
  local ok, cmp = pcall(require, "blink.cmp")
  return ok and cmp.is_menu_visible(), cmp
end

local function fenetre_du_menu()
  local ok, menu = pcall(require, "blink.cmp.completion.windows.menu")
  if not ok or not menu.win:is_open() then
    return nil
  end
  return menu.win:get_win()
end

--- The wheel scrolls through suggestions instead of scrolling the text.
--- @param sens "next"|"prev"
local function molette(sens)
  local ouvert, cmp = menu_ouvert()
  if not ouvert then
    -- menu closed: wheel goes back to its normal role
    return sens == "next" and "<ScrollWheelDown>" or "<ScrollWheelUp>"
  end
  if sens == "next" then
    cmp.select_next()
  else
    cmp.select_prev()
  end
  return "<Ignore>"
end

--- A click in the menu picks the pointed-at line and inserts it.
local function clic()
  local win = fenetre_du_menu()
  if not win then
    return "<LeftMouse>"
  end

  local pos = vim.fn.getmousepos()
  if pos.winid ~= win then
    return "<LeftMouse>"
  end

  local ok, cmp = pcall(require, "blink.cmp")
  if not ok then
    return "<LeftMouse>"
  end

  -- getmousepos gives the line within the window, blink indexes its items the same way
  local liste = require("blink.cmp.completion.list")
  vim.schedule(function()
    if liste.select(pos.line, { is_explicit_selection = true }) ~= false then
      cmp.accept()
    end
  end)
  return "<Ignore>"
end

function M.setup()
  local opts = { expr = true, silent = true }

  vim.keymap.set("i", "<ScrollWheelDown>", function()
    return molette("next")
  end, vim.tbl_extend("force", opts, { desc = "Next suggestion" }))

  vim.keymap.set("i", "<ScrollWheelUp>", function()
    return molette("prev")
  end, vim.tbl_extend("force", opts, { desc = "Previous suggestion" }))

  vim.keymap.set("i", "<LeftMouse>", clic, vim.tbl_extend("force", opts, { desc = "Pick suggestion" }))
end

return M

local bottom_terminal_buf = nil

local function toggle_bottom_terminal()
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    if vim.api.nvim_win_get_buf(win) == bottom_terminal_buf then
      vim.api.nvim_win_close(win, true)
      return
    end
  end

  vim.cmd("botright split")
  vim.cmd("resize 15")

  if bottom_terminal_buf and vim.api.nvim_buf_is_valid(bottom_terminal_buf) then
    vim.api.nvim_win_set_buf(0, bottom_terminal_buf)
  else
    vim.cmd("terminal")
    bottom_terminal_buf = vim.api.nvim_get_current_buf()
  end

  vim.cmd("startinsert")
end

local function open_right_terminal()
  vim.cmd("botright vsplit")
  vim.cmd("vertical resize 60")
  vim.cmd("terminal")
  vim.cmd("startinsert")
end

vim.keymap.set("n", "<leader>tt", toggle_bottom_terminal, { desc = "Toggle terminal (bottom)" })
vim.keymap.set("n", "<D-j>", toggle_bottom_terminal, { desc = "Toggle terminal (bottom)" })
vim.keymap.set("n", "<leader>tv", open_right_terminal, { desc = "Terminal (right)" })
vim.keymap.set("n", "<leader>tc", "<cmd>close<cr>", { desc = "Close window" })

vim.keymap.set("t", "<C-q>", "<cmd>close<cr>", { desc = "Close Terminal" })
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit Terminal mode" })

-- Trackpad was scrolling the view into empty space: without "wrap", Neovim obeys
-- horizontal notches without checking there's still text to the right. zl/zh still work.
-- Expr rather than <Nop>: the toggle has to be readable at keypress time, and a
-- returned "" swallows the notch just like <Nop> did.
local scroll_horizontal = false
for _, cran in ipairs({ "<ScrollWheelLeft>", "<ScrollWheelRight>", "<S-ScrollWheelUp>", "<S-ScrollWheelDown>" }) do
  vim.keymap.set({ "n", "i", "v", "t" }, cran, function()
    return scroll_horizontal and cran or ""
  end, { expr = true, remap = false, desc = "Horizontal scroll (toggle: <leader>uS)" })
end

local function toggle_scroll_horizontal()
  scroll_horizontal = not scroll_horizontal
  vim.notify("Horizontal scroll " .. (scroll_horizontal and "on" or "off"))
end

-- Every switch is named Toggle*: ":Toggle" then Tab lists them all, which is the
-- only way to find them again without reading this file.
vim.api.nvim_create_user_command("ToggleHScroll", toggle_scroll_horizontal, {
  desc = "Toggle horizontal mouse scroll",
})
vim.keymap.set("n", "<leader>uS", toggle_scroll_horizontal, {
  desc = "Toggle Horizontal Scroll",
})

local function toggle_wrap()
  vim.wo.wrap = not vim.wo.wrap
  vim.notify("Wrap " .. (vim.wo.wrap and "on" or "off"))
end

vim.api.nvim_create_user_command("ToggleWrap", toggle_wrap, {
  desc = "Toggle word wrap (current window)",
})

-- LazyVim maps <esc> in its own config, loaded before this one: we need to
-- reclaim the key here. Definitely not "expr": Neovim forbids an expression
-- from closing a window, the call failed silently.
vim.keymap.set({ "n", "i", "s" }, "<esc>", function()
  if require("config.hover-mouse").fermer_toute_popup() then
    return
  end
  vim.cmd("noh")
  local ok, snacks = pcall(require, "snacks")
  if ok then
    pcall(snacks.notifier.hide)
  end
  -- give Escape back its native role: exit insert mode, cancel the operator
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<esc>", true, false, true), "n", false)
end, { desc = "Close the popup, otherwise LazyVim behavior" })
vim.keymap.set("t", "<D-j>", toggle_bottom_terminal, { desc = "Toggle terminal (bottom)" })

vim.keymap.set("c", "<C-j>", "<Down>", { desc = "Cmdline next item" })
vim.keymap.set("c", "<C-k>", "<Up>", { desc = "Cmdline previous item" })
vim.keymap.set("c", "<M-j>", "<Down>", { desc = "Cmdline next item" })
vim.keymap.set("c", "<M-k>", "<Up>", { desc = "Cmdline previous item" })

-- Arrow keys go to the completion list, not the history: Noice's popupmenu
-- accepts neither click nor scroll wheel, only the keyboard can navigate it.
-- C-n/C-p only respond after a Tab, otherwise they recall history;
-- C-j/C-k and M-j/M-k above keep the history behavior.
vim.keymap.set("c", "<Down>", "<C-n>", { desc = "Cmdline completion: next match" })
vim.keymap.set("c", "<Up>", "<C-p>", { desc = "Cmdline completion: previous match" })

local function toggle_inlay_hints()
  local enabled = vim.lsp.inlay_hint.is_enabled({})
  vim.lsp.inlay_hint.enable(not enabled, {})
  vim.notify("Inlay hints " .. (not enabled and "on" or "off"))
end

-- Ctrl+click jumps to definition. Cmd+click is impossible: the terminal mouse
-- protocol only carries Shift, Alt and Ctrl.
vim.keymap.set(
  "n",
  "<C-LeftMouse>",
  "<LeftMouse><cmd>lua vim.lsp.buf.definition()<CR>",
  { desc = "Go to definition" }
)

-- Cmd+Enter: URL under cursor opens in browser, otherwise jump to definition.
-- Ghostty encodes Cmd, unlike the mouse protocol.
local ouvrir = function()
  require("config.open-under-cursor").ouvrir()
end
vim.keymap.set("n", "<D-CR>", ouvrir, { desc = "Open the URL or go to definition" })
vim.keymap.set("n", "<M-CR>", ouvrir, { desc = "Open the URL or go to definition" })

vim.api.nvim_create_user_command("ToggleHints", toggle_inlay_hints, { desc = "Toggle Inlay Hints (global)" })

vim.keymap.set("n", "<leader>h", toggle_inlay_hints, { desc = "Toggle Inlay Hints (global)" })
vim.keymap.set("n", "<leader>uh", toggle_inlay_hints, { desc = "Toggle Inlay Hints (global)" })

-- <C-w> used to be the split prefix: <C-h/j/k/l> and leader cover that usage now
vim.keymap.set({ "n", "i" }, "<C-w>", function()
  Snacks.bufdelete()
end, { desc = "Close buffer" })

-- LazyVim wires these to the "<C-W>x" strings with remap = true, so they run the
-- <C-w> map above instead of the window command. Direct commands dodge the detour.
vim.keymap.set("n", "<leader>wd", "<cmd>close<cr>", { desc = "Delete Window" })
vim.keymap.set("n", "<leader>-", "<cmd>split<cr>", { desc = "Split Window Below" })
vim.keymap.set("n", "<leader>|", "<cmd>vsplit<cr>", { desc = "Split Window Right" })
vim.keymap.set("n", "<leader>wo", "<cmd>only<cr>", { desc = "Close Other Windows" })

-- without this the terminal swallows <C-h/j/k/l> and we get stuck inside it
for touche, direction in pairs({ h = "h", j = "j", k = "k", l = "l" }) do
  vim.keymap.set("t", "<C-" .. touche .. ">", "<C-\\><C-n><C-w>" .. direction, {
    desc = "Go to window " .. direction,
  })
end

local diagnostics_copy = require("config.diagnostics-copy")

vim.api.nvim_create_user_command("DiagCopy", function()
  diagnostics_copy.copier(nil)
end, { desc = "Copy project diagnostics" })

vim.api.nvim_create_user_command("DiagCopyBuf", function()
  diagnostics_copy.copier(0)
end, { desc = "Copy current file diagnostics" })

vim.api.nvim_create_user_command("DiagCopyErrors", function()
  diagnostics_copy.copier(nil, vim.diagnostic.severity.ERROR)
end, { desc = "Copy project errors" })

vim.keymap.set("n", "<leader>xy", function()
  diagnostics_copy.copier(nil)
end, { desc = "Copy diagnostics (project)" })

vim.keymap.set("n", "<leader>xY", function()
  diagnostics_copy.copier(0)
end, { desc = "Copy diagnostics (file)" })

vim.keymap.set("i", "<M-Right>", "<C-o>w", { desc = "Word right" })
vim.keymap.set("i", "<M-Left>", "<C-o>b", { desc = "Word left" })
vim.keymap.set("i", "<M-f>", "<C-o>w", { desc = "Word right" })
vim.keymap.set("i", "<M-b>", "<C-o>b", { desc = "Word left" })
vim.keymap.set("i", "<M-BS>", "<C-w>", { desc = "Delete word backward" })

vim.keymap.set("n", "<M-Right>", "w", { desc = "Word right" })
vim.keymap.set("n", "<M-Left>", "b", { desc = "Word left" })
vim.keymap.set("n", "<M-f>", "w", { desc = "Word right" })
vim.keymap.set("n", "<M-b>", "b", { desc = "Word left" })
vim.keymap.set("v", "<M-Right>", "w", { desc = "Word right" })
vim.keymap.set("v", "<M-Left>", "b", { desc = "Word left" })
vim.keymap.set("v", "<M-f>", "w", { desc = "Word right" })
vim.keymap.set("v", "<M-b>", "b", { desc = "Word left" })

vim.keymap.set("i", "<D-Right>", "<C-o>$", { desc = "Line end" })
vim.keymap.set("i", "<D-Left>", "<C-o>0", { desc = "Line start" })
vim.keymap.set("i", "<C-Right>", "<C-o>$", { desc = "Line end" })
vim.keymap.set("i", "<C-Left>", "<C-o>0", { desc = "Line start" })
vim.keymap.set("i", "<S-Right>", "<C-o>$", { desc = "Line end" })
vim.keymap.set("i", "<S-Left>", "<C-o>0", { desc = "Line start" })
vim.keymap.set("i", "<End>", "<C-o>$", { desc = "Line end" })
vim.keymap.set("i", "<Home>", "<C-o>0", { desc = "Line start" })
vim.keymap.set("n", "<D-Right>", "$", { desc = "Line end" })
vim.keymap.set("n", "<D-Left>", "0", { desc = "Line start" })
vim.keymap.set("n", "<C-Right>", "$", { desc = "Line end" })
vim.keymap.set("n", "<C-Left>", "0", { desc = "Line start" })
vim.keymap.set("n", "<S-Right>", "$", { desc = "Line end" })
vim.keymap.set("n", "<S-Left>", "0", { desc = "Line start" })
vim.keymap.set("n", "<End>", "$", { desc = "Line end" })
vim.keymap.set("n", "<Home>", "0", { desc = "Line start" })
vim.keymap.set("v", "<D-Right>", "$", { desc = "Line end" })
vim.keymap.set("v", "<D-Left>", "0", { desc = "Line start" })
vim.keymap.set("v", "<C-Right>", "$", { desc = "Line end" })
vim.keymap.set("v", "<C-Left>", "0", { desc = "Line start" })
vim.keymap.set("v", "<S-Right>", "$", { desc = "Line end" })
vim.keymap.set("v", "<S-Left>", "0", { desc = "Line start" })
vim.keymap.set("v", "<End>", "$", { desc = "Line end" })
vim.keymap.set("v", "<Home>", "0", { desc = "Line start" })

require("config.hover-mouse").setup()
require("config.buffer-limit").setup()
require("config.cmp-mouse").setup()
require("config.separators").setup()

-- same popup via keyboard: cursor stops on a symbol in normal mode.
-- Goes through the same handler as the mouse, otherwise Escape can't close it.
vim.api.nvim_create_autocmd("CursorHold", {
  callback = function()
    require("config.hover-mouse").au_repos()
  end,
})

-- LazyVim turns spell on for prose filetypes (its lazyvim_wrap_spell group).
-- This runs after it and wins; wrap stays untouched.
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "markdown", "text", "gitcommit", "plaintex", "typst" },
  callback = function()
    vim.opt_local.spell = false
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "c", "h", "cpp", "hpp" },
  callback = function()
    vim.bo.expandtab = false
    vim.bo.tabstop = 4
    vim.bo.shiftwidth = 4
    vim.bo.softtabstop = 0
  end,
})

vim.api.nvim_create_autocmd({ "FocusLost", "BufLeave" }, {
  pattern = "*",
  callback = function()
    if vim.bo.modified and vim.bo.buftype == "" and vim.fn.expand("%") ~= "" then
      vim.cmd("silent! write")
    end
  end,
})

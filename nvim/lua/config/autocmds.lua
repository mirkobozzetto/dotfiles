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

-- Languages whose formatters write four columns per level, against LazyVim's
-- global default of two. The mismatch is invisible until something measures
-- indentation: guides then draw a line halfway through every real level, and
-- `>>` moves half a step.
--
-- C#/F#/VB follow Microsoft's convention, Rust follows rustfmt, Go and Java
-- their own. Python and the two-space languages already agree with the default.
-- C and C++ keep their own rule above; that one is about tabs, not width.
vim.api.nvim_create_autocmd("FileType", {
  pattern = {
    "cs",
    "razor",
    "fsharp",
    "vb",
    "rust",
    "java",
    "kotlin",
    "scala",
    "swift",
    "php",
    "dart",
    "zig",
  },
  callback = function()
    vim.bo.expandtab = true
    vim.bo.tabstop = 4
    vim.bo.shiftwidth = 4
    vim.bo.softtabstop = 4
  end,
})

-- gofmt writes tabs and leaves their width to the reader; two makes nested
-- blocks unreadable, so a tab is four columns wide here.
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "go", "gomod", "gowork", "gotmpl" },
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

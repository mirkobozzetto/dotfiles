return {
  {
    "stevearc/conform.nvim",
    opts = {
      formatters = {
        c_formatter_42 = {
          command = "python3",
          args = { "-m", "c_formatter_42" },
          stdin = true,
        },
      },
      formatters_by_ft = {
        c = { "c_formatter_42" },
        h = { "c_formatter_42" },
      },
      -- LazyVim handles format-on-:w: conform is primary, the LSP is only
      -- a fallback. In C, c_formatter_42 is declared so clangd doesn't touch it.
    },
  },
}

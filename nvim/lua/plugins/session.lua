return {
  {
    "folke/persistence.nvim",
    opts = {},
    init = function()
      vim.api.nvim_create_autocmd("VimEnter", {
        nested = true,
        callback = function()
          if vim.g.started_with_stdin then
            return
          end

          local args = vim.fn.argv()
          -- `nvim file.ts`: he wants that file, not the session
          -- `nvim` or `nvim .`: he wants to resume where he left off
          if #args > 1 then
            return
          end
          if #args == 1 and vim.fn.isdirectory(args[1]) == 0 then
            return
          end

          -- schedule mandatory since nvim 0.11.4: vim.lsp.enable now reacts
          -- to startup events, and the filetype of the first restored buffer
          -- isn't resolved yet on BufReadPost. Without this deferral,
          -- lspconfig never attaches and highlighting stays dead.
          -- nested = true alone isn't enough anymore (LazyVim#6456).
          vim.schedule(function()
            require("persistence").load()
          end)
        end,
      })

      vim.api.nvim_create_autocmd("StdinReadPre", {
        callback = function()
          vim.g.started_with_stdin = true
        end,
      })
    end,
  },
}

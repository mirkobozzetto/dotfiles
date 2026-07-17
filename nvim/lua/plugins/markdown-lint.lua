local CONFIG = vim.fn.expand("~/.markdownlint-cli2.jsonc")

return {
  {
    "mfussenegger/nvim-lint",
    opts = function(_, opts)
      -- markdownlint-cli2 walks up directories but stops at the git repo:
      -- a personal config would never be seen from within a project
      require("lint").linters["markdownlint-cli2"].args = { "--config", CONFIG, "-" }
      return opts
    end,
  },
}

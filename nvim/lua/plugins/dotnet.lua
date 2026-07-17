-- omnisharp is abandoned upstream: it sends an out-of-spec JSON-RPC "null" that
-- Neovim rejects (bug open since 2023, two tolerance PRs rejected). Roslyn
-- is Microsoft's server, the one from VS Code's C# Dev Kit.
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        omnisharp = { enabled = false },
        -- lspconfig now bundles its own roslyn_ls: without this it attaches
        -- alongside roslyn.nvim's, and everything shows up twice
        roslyn_ls = { enabled = false },
      },
    },
  },
  {
    "seblyng/roslyn.nvim",
    ft = { "cs", "razor" },
    opts = {},
  },
  {
    "mason-org/mason.nvim",
    opts = { ensure_installed = { "roslyn-language-server" } },
  },
}

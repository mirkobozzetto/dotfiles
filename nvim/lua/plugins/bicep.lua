-- Neovim has no built-in bicep filetype, so lspconfig never fires on its own.
vim.filetype.add({
  extension = {
    bicep = "bicep",
    bicepparam = "bicep",
  },
})

-- The bicep server is a dotnet dll; Mason's wrapper calls bare `dotnet`, which
-- exits 127 when nvim starts in a pane whose PATH predates the SDK install.
-- Prepending the SDK to nvim's own PATH fixes it without fighting the cmd merge.
local dotnet_dir = "/usr/local/share/dotnet"
if vim.fn.isdirectory(dotnet_dir) == 1 and not (vim.env.PATH or ""):find(dotnet_dir, 1, true) then
  vim.env.PATH = dotnet_dir .. ":" .. vim.env.PATH
end

return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        bicep = {},
      },
    },
  },
  {
    "mason-org/mason.nvim",
    opts = { ensure_installed = { "bicep-lsp" } },
  },
}

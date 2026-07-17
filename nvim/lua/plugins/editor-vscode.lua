return {
  { import = "lazyvim.plugins.extras.lang.clangd" },

  {
    "nvim-treesitter/nvim-treesitter",
    opts = { ensure_installed = { "c", "cpp" } },
  },

  {
    "saghen/blink.cmp",
    opts = {
      keymap = { preset = "super-tab" },
      completion = {
        menu = { auto_show = true },
        documentation = { auto_show = true, auto_show_delay_ms = 200 },
        ghost_text = { enabled = false },
      },
    },
  },

  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        clangd = {
          settings = {
            clangd = {
              InlayHints = {
                Designators = true,
                Enabled = true,
                ParameterNames = true,
                DeducedTypes = true,
              },
            },
          },
        },
      },
    },
  },
}

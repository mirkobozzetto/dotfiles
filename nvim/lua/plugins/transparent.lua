-- Catppuccin rather than tokyonight: it ships a light flavour (Latte) and picks
-- it from vim.o.background on its own. Neovim flips that option by itself when
-- the terminal announces a theme change (mode 2031), so the editor follows the
-- macOS appearance with no plugin and no polling.
return {
  {
    "catppuccin/nvim",
    name = "catppuccin",
    opts = {
      background = { light = "latte", dark = "mocha" },
      transparent_background = true,
      -- these panels keep an opaque background otherwise and break the effect
      float = { transparent = true, solid = false },
      -- Snacks.words highlights every occurrence of the symbol under the cursor.
      -- The default reference highlight is nearly invisible against a
      -- transparent background; a selection colour reads as what this is, and
      -- writes get an underline so they stand apart from reads.
      custom_highlights = function(colors)
        return {
          LspReferenceText = { bg = colors.surface1 },
          LspReferenceRead = { bg = colors.surface1 },
          LspReferenceWrite = { bg = colors.surface1, underline = true },
        }
      end,
    },
  },
  {
    "LazyVim/LazyVim",
    opts = { colorscheme = "catppuccin" },
  },
}

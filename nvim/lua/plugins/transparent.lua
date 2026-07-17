return {
  {
    "folke/tokyonight.nvim",
    opts = {
      transparent = true,
      styles = {
        -- without this these panels keep an opaque background and break the effect
        sidebars = "transparent",
        floats = "transparent",
      },
      -- Snacks.words already highlights every occurrence of the symbol under the
      -- cursor, but tokyonight paints them with fg_gutter (#3b4261), tuned for its
      -- own #222436 background. Transparent means the terminal shows through instead
      -- and that blue-grey vanishes. bg_visual reads like a selection, which is what
      -- this is; writes also get an underline so they stand apart from reads.
      on_highlights = function(hl, c)
        hl.LspReferenceText = { bg = c.bg_visual }
        hl.LspReferenceRead = { bg = c.bg_visual }
        hl.LspReferenceWrite = { bg = c.bg_visual, underline = true }
      end,
    },
  },
}

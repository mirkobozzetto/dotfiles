-- Two families, one per appearance: Catppuccin Mocha in the dark, Quiet Light
-- in the light. Quiet Light keeps a muted foreground on near-white paper and
-- lets the accents carry the meaning, where Catppuccin Latte is pastel on both
-- sides and washes out.
--
-- Neovim flips vim.o.background by itself when the terminal announces a theme
-- change (mode 2031). Reacting to that is all this needs to do - and it must
-- not write the option back, because a colourscheme sets it too: the write
-- re-fires OptionSet, which re-applies, which writes again. That loop froze the
-- editor on startup.
local applying = false

local function apply()
  if applying then
    return
  end
  applying = true
  local want = vim.o.background == "light" and "quietlight" or "catppuccin"
  if vim.g.colors_name ~= want then
    pcall(vim.cmd.colorscheme, want)
  end
  applying = false
end

vim.api.nvim_create_autocmd("OptionSet", {
  pattern = "background",
  callback = vim.schedule_wrap(apply),
})

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
    "HUAHUAI23/nvim-quietlight",
    name = "quietlight",
    main = "nvim-quietlight",
    opts = {
      -- opaque, unlike the dark side: this theme styles few plugins, and with a
      -- transparent background the ones it misses show the terminal through
      -- instead of a readable panel
      transparent_background = false,
      plugins = {
        gitsigns = true,
        lsp = true,
        bufferline = true,
        treesitter = true,
        notify = true,
        nvimtree = true,
        indentline = true,
      },
    },
  },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = function()
        vim.cmd.colorscheme(vim.o.background == "light" and "quietlight" or "catppuccin")
      end,
    },
  },
}

-- nvim-quietlight styles seven plugins, none of which is snacks.nvim - the
-- picker, the explorer and the dashboard therefore land on Neovim's defaults,
-- which is why the tree read as unstyled. Its tabline is also a flat grey with
-- no selected-tab colour at all.
--
-- These fill the gaps with the theme's own palette rather than inventing
-- colours, and only apply when quietlight is the active scheme.
local palette = {
  paper = "#f5f5f5",
  panel = "#eeeeee",
  border = "#d9d9d9",
  text = "#444963",
  muted = "#6f7280",
  -- the theme's own greys for secondary text are #aaaaaa and lighter, which is
  -- around 2:1 on its own paper. These are the darkest values that still read
  -- as "stand back" while clearing roughly 4.5:1.
  dim = "#83868f",
  faint = "#aaaaaa",
  purple = "#7a3e9d",
  blue = "#4b83cd",
  green = "#448c27",
  red = "#aa3731",
  orange = "#ab6526",
  selection = "#e6e6e6",
}

local function fill()
  local p = palette
  local hl = {
    -- floating windows and the pickers built on them
    NormalFloat = { fg = p.text, bg = p.panel },
    FloatBorder = { fg = p.border, bg = p.panel },
    FloatTitle = { fg = p.purple, bg = p.panel, bold = true },

    SnacksNormal = { fg = p.text, bg = p.panel },
    SnacksNormalNC = { fg = p.text, bg = p.panel },
    SnacksWinBar = { fg = p.purple, bg = p.panel, bold = true },
    SnacksBackdrop = { bg = p.faint },

    SnacksPicker = { fg = p.text, bg = p.panel },
    SnacksPickerBorder = { fg = p.border, bg = p.panel },
    SnacksPickerTitle = { fg = p.purple, bg = p.panel, bold = true },
    SnacksPickerInput = { fg = p.text, bg = p.panel },
    SnacksPickerPrompt = { fg = p.purple, bg = p.panel },
    SnacksPickerDir = { fg = p.muted },
    SnacksPickerFile = { fg = p.text },
    SnacksPickerMatch = { fg = p.red, bold = true },
    SnacksPickerSelected = { fg = p.blue },
    SnacksPickerCursorLine = { bg = p.selection },
    -- dimmer than a tracked file, still above the ~3:1 the theme's #aaaaaa gave
    SnacksPickerPathHidden = { fg = p.dim },
    SnacksPickerPathIgnored = { fg = p.dim },
    SnacksPickerGitStatusUntracked = { fg = p.faint },
    SnacksPickerGitStatusModified = { fg = p.orange },
    SnacksPickerGitStatusAdded = { fg = p.green },
    SnacksPickerGitStatusDeleted = { fg = p.red },

    SnacksIndent = { fg = p.border },
    SnacksIndentScope = { fg = p.faint },

    -- the theme's tabline is a flat grey and marks no selection
    TabLine = { fg = p.muted, bg = p.selection },
    TabLineSel = { fg = p.text, bg = p.paper, bold = true },
    TabLineFill = { bg = p.selection },

    -- a purple on paper reads as an accent, not as a status bar
    StatusLine = { fg = p.text, bg = p.selection },
    StatusLineNC = { fg = p.dim, bg = p.panel },
    WinSeparator = { fg = p.border },

    -- comments at the theme's #aaaaaa sit near 2:1 on its paper: readable as a
    -- shape, not as words. Muted still reads as secondary at ~4.6:1.
    Comment = { fg = p.muted, italic = true },
    ["@comment"] = { fg = p.muted, italic = true },
    ["@lsp.type.comment"] = { fg = p.muted, italic = true },
    LineNr = { fg = p.dim },
    Conceal = { fg = p.dim },
    NonText = { fg = p.border },

    -- LazyVim's tabs come from bufferline, which the theme does not style
    BufferLineFill = { bg = p.selection },
    BufferLineBackground = { fg = p.dim, bg = p.selection },
    BufferLineBufferSelected = { fg = p.text, bg = p.paper, bold = true, italic = false },
    BufferLineBufferVisible = { fg = p.muted, bg = p.selection },
    BufferLineSeparator = { fg = p.border, bg = p.selection },
    BufferLineSeparatorSelected = { fg = p.border, bg = p.paper },
    BufferLineSeparatorVisible = { fg = p.border, bg = p.selection },
    BufferLineIndicatorSelected = { fg = p.purple, bg = p.paper },
    BufferLineModified = { fg = p.orange, bg = p.selection },
    BufferLineModifiedSelected = { fg = p.orange, bg = p.paper },
    BufferLineCloseButton = { fg = p.dim, bg = p.selection },
    BufferLineCloseButtonSelected = { fg = p.muted, bg = p.paper },
  }

  for group, spec in pairs(hl) do
    vim.api.nvim_set_hl(0, group, spec)
  end
end

vim.api.nvim_create_autocmd("ColorScheme", {
  pattern = "quietlight",
  callback = fill,
})

return {}

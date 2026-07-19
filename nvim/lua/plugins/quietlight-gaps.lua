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
  muted = "#777777",
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
    SnacksPickerPathHidden = { fg = p.faint },
    SnacksPickerPathIgnored = { fg = p.faint },
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
    StatusLineNC = { fg = p.faint, bg = p.panel },
    WinSeparator = { fg = p.border },
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

-- One colour per indent level instead of a single grey. snacks.indent cycles
-- through whatever list it is given, and the colours are read from the active
-- Catppuccin palette, so latte and mocha each get their own without a second
-- table to maintain.
--
-- Eight hues, spaced around the wheel rather than taken in palette order: at
-- three or four levels deep the eye compares neighbours, and adjacent hues
-- would read as the same colour.
local hues = { "red", "peach", "yellow", "green", "teal", "blue", "mauve", "pink" }

local levels = {}
for i = 1, #hues do
  levels[i] = "SnacksIndent" .. i
end

local function paint()
  local ok, palettes = pcall(require, "catppuccin.palettes")
  if not ok then
    return
  end
  local colors = palettes.get_palette()
  if not colors then
    return
  end
  for i, hue in ipairs(hues) do
    -- nocombine: without it the guide blends with whatever it overlays
    vim.api.nvim_set_hl(0, "SnacksIndent" .. i, { fg = colors[hue], nocombine = true })
  end
end

vim.api.nvim_create_autocmd("ColorScheme", { callback = paint })

return {
  {
    "folke/snacks.nvim",
    opts = {
      -- opts.indent is the module; its own `indent` and `scope` tables are the
      -- guides and the current-block bar. Setting hl one level up lands on
      -- Snacks.config.indent.hl, which nothing reads.
      --
      -- Only the guides cycle. The scope bar keeps SnacksIndentScope: given the
      -- same list it takes its level's colour, becomes indistinguishable from
      -- the guide it sits on, and the animation has nothing to draw attention
      -- to. One bright line against eight quiet ones is the point.
      indent = {
        indent = { hl = levels },
      },
    },
    init = paint,
  },
}

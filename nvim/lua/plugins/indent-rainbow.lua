-- One colour per indent level, and the block you are in picks its level's
-- colour at full strength while every other guide is faded into the background.
-- The eye then reads depth from hue and position from brightness, instead of
-- eight saturated lines all shouting at once.
--
-- Colours come from the active Catppuccin palette, so latte and mocha each get
-- their own without a second table to maintain.
local hues = { "red", "peach", "yellow", "green", "teal", "blue", "mauve", "pink" }

-- how much of the hue survives against the background for the passive guides
local FADED = 0.28

local guides, scopes = {}, {}
for i = 1, #hues do
  guides[i] = "SnacksIndent" .. i
  scopes[i] = "SnacksIndentScope" .. i
end

local function blend(fg, bg, amount)
  local function channel(shift)
    local a = math.floor(fg / shift) % 256
    local b = math.floor(bg / shift) % 256
    return math.floor(a * amount + b * (1 - amount) + 0.5)
  end
  return string.format("#%02x%02x%02x", channel(65536), channel(256), channel(1))
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
  local bg = tonumber(colors.base:sub(2), 16)
  for i, hue in ipairs(hues) do
    local fg = tonumber(colors[hue]:sub(2), 16)
    -- nocombine: without it the guide blends with whatever it overlays
    vim.api.nvim_set_hl(0, guides[i], { fg = blend(fg, bg, FADED), nocombine = true })
    vim.api.nvim_set_hl(0, scopes[i], { fg = colors[hue], nocombine = true })
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
      indent = {
        indent = { hl = guides },
        scope = { hl = scopes },
      },
    },
    init = paint,
  },
}

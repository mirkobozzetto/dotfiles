-- One colour per indent level instead of a single grey, but muted: the guides
-- are scaffolding, not content. Each hue is mixed most of the way into the
-- background so the eight levels stay distinguishable without competing with
-- the code, and the scope bar - the only line at full strength - keeps the
-- contrast its animation needs.
--
-- Colours come from the active Catppuccin palette, so latte and mocha each get
-- their own without a second table to maintain.
local hues = { "red", "peach", "yellow", "green", "teal", "blue", "mauve", "pink" }

-- how much of the hue survives against the background; the rest is base
local STRENGTH = 0.3

local levels = {}
for i = 1, #hues do
  levels[i] = "SnacksIndent" .. i
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
    vim.api.nvim_set_hl(0, levels[i], { fg = blend(fg, bg, STRENGTH), nocombine = true })
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

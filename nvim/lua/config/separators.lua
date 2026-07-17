local M = {}

-- tokyonight's WinSeparator is #1b1d2b, indistinguishable from the background:
-- bump it up to dark3, a shade from the same palette
local function accentuer()
  local ok, palette = pcall(function()
    return require("tokyonight.colors").setup()
  end)

  if ok and palette and palette.dark3 then
    vim.api.nvim_set_hl(0, "WinSeparator", { fg = palette.dark3 })
  else
    vim.api.nvim_set_hl(0, "WinSeparator", { link = "Comment" })
  end
end

function M.setup()
  vim.opt.fillchars:append({
    vert = "│",
    horiz = "─",
    horizup = "┴",
    horizdown = "┬",
    vertleft = "┤",
    vertright = "├",
    verthoriz = "┼",
  })

  vim.api.nvim_create_autocmd("ColorScheme", { callback = accentuer })
  vim.schedule(accentuer)
end

return M

-- Cmd+Enter: opens the URL under the cursor in the browser, otherwise jumps
-- to the symbol definition. Also works in the LSP documentation popup,
-- where rust-analyzer puts its links (Rust by Example, docs.rs...).

local M = {}

local MOTIF_URL = "%f[%w](https?://[%w-_%.%?%.:/%+=&~@#%%]+)"

--- Looks for a URL on the line, preferring the one that contains the cursor.
--- @return string|nil
local function url_sous_curseur()
  local ligne = vim.api.nvim_get_current_line()
  local col = vim.api.nvim_win_get_cursor(0)[2] + 1

  local depuis = 1
  local premiere = nil
  while true do
    local d, f, url = ligne:find(MOTIF_URL, depuis)
    if not d then
      break
    end
    premiere = premiere or url
    if col >= d and col <= f then
      return url
    end
    depuis = f + 1
  end

  -- cursor isn't on it but the line has one anyway: good enough
  return premiere
end

--- In a markdown popup, links are written [text](url).
--- @return string|nil
local function url_markdown()
  local ligne = vim.api.nvim_get_current_line()
  return ligne:match("%]%((https?://[^%)]+)%)")
end

function M.ouvrir()
  local url = url_sous_curseur() or url_markdown()
  if url then
    vim.ui.open(url)
    return
  end

  if #vim.lsp.get_clients({ bufnr = 0 }) > 0 then
    vim.lsp.buf.definition()
  end
end

return M

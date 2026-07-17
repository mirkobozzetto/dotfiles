local M = {}

local ETIQUETTE = {
  [vim.diagnostic.severity.ERROR] = "ERROR",
  [vim.diagnostic.severity.WARN] = "WARN",
  [vim.diagnostic.severity.INFO] = "INFO",
  [vim.diagnostic.severity.HINT] = "HINT",
}

local function chemin(bufnr)
  local nom = vim.api.nvim_buf_get_name(bufnr)
  if nom == "" then
    return "[sans nom]"
  end
  return vim.fn.fnamemodify(nom, ":.")
end

local function ligne(d)
  return string.format(
    "%s:%d:%d: %s: %s%s",
    chemin(d.bufnr),
    d.lnum + 1,
    d.col + 1,
    ETIQUETTE[d.severity] or "?",
    (d.message or ""):gsub("%s+$", ""),
    d.source and (" [" .. d.source .. "]") or ""
  )
end

-- bufnr nil = whole project, 0 = current file
function M.copier(bufnr, severite)
  local opts = severite and { severity = { min = severite } } or nil
  local diags = vim.diagnostic.get(bufnr, opts)
  if #diags == 0 then
    vim.notify("No diagnostic to copy")
    return
  end

  table.sort(diags, function(a, b)
    local ca, cb = chemin(a.bufnr), chemin(b.bufnr)
    if ca ~= cb then
      return ca < cb
    end
    return a.lnum < b.lnum
  end)

  local lignes = vim.tbl_map(ligne, diags)
  local texte = table.concat(lignes, "\n")
  vim.fn.setreg("+", texte)
  vim.notify(#diags .. " diagnostics copied to clipboard")
end

return M

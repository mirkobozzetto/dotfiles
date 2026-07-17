-- Documentation popup under the mouse, like VSCode: hover a symbol,
-- the LSP (language server protocol) doc shows up. Independent of mode and cursor position.
--
-- Single manager: two sources open popups (the mouse here, and keyboard
-- hover on CursorHold). Without shared cleanup, they'd stack up.

local M = {}

local DELAI_MS = 250

local timer = nil
local float_win = nil
local derniere_pos = nil

local actif = true

-- Escape closes it, but moves neither cursor nor mouse: CursorHold re-arms
-- and reopens the same popup a second later. We remember the rejected spot
-- and stay quiet there until it actually moves.
local rejet_curseur = nil
local rejet_souris = nil

local function cle_curseur()
  local pos = vim.api.nvim_win_get_cursor(0)
  return vim.api.nvim_get_current_buf() .. ":" .. pos[1] .. ":" .. pos[2]
end

local function cle_souris()
  local pos = vim.fn.getmousepos()
  return pos.winid .. ":" .. pos.line .. ":" .. pos.column
end

local function est_flottante(win)
  return win ~= nil
    and vim.api.nvim_win_is_valid(win)
    and vim.api.nvim_win_get_config(win).relative ~= ""
end

-- Closes any documentation popup still on screen, wherever it came from.
-- The safety net: sweep floating windows carrying an LSP preview buffer,
-- since an orphaned popup is no longer tracked by anyone.
local function fermer_tout()
  local ferme = false

  -- the window may have closed itself and its id gotten recycled by a
  -- normal window: closing it then would kill a real split
  if est_flottante(float_win) then
    pcall(vim.api.nvim_win_close, float_win, true)
    ferme = true
  end
  float_win = nil

  -- vim.lsp.util.open_floating_preview stores its window id here
  local suivie = vim.b.lsp_floating_preview
  if est_flottante(suivie) then
    pcall(vim.api.nvim_win_close, suivie, true)
    ferme = true
  end
  vim.b.lsp_floating_preview = nil

  for _, win in ipairs(vim.api.nvim_list_wins()) do
    if est_flottante(win) then
      local buf = vim.api.nvim_win_get_buf(win)
      local ok, marque = pcall(vim.api.nvim_buf_get_var, buf, "lsp_floating_preview_source")
      if ok and marque then
        pcall(vim.api.nvim_win_close, win, true)
        ferme = true
      end
    end
  end

  return ferme
end

-- ancrage = "mouse" (mouse hover) or "cursor" (cursor at rest)
local function afficher(buf, ligne, colonne, ancrage)
  local params = {
    textDocument = { uri = vim.uri_from_bufnr(buf) },
    position = { line = ligne, character = colonne },
  }

  vim.lsp.buf_request(buf, "textDocument/hover", params, function(err, result)
    if err or not result or not result.contents then
      return
    end
    local lines = vim.lsp.util.convert_input_to_markdown_lines(result.contents)
    lines = vim.split(table.concat(lines, "\n"), "\n", { trimempty = true })
    if #lines == 0 then
      return
    end

    fermer_tout()

    -- focusable: a click inside enters it instead of passing through to the buffer.
    -- BufLeave is excluded, otherwise entering the popup would close it right away.
    local fbuf, win = vim.lsp.util.open_floating_preview(lines, "markdown", {
      relative = ancrage or "mouse",
      focusable = true,
      border = "rounded",
      max_width = 90,
      max_height = 20,
      close_events = { "InsertCharPre", "WinScrolled" },
    })
    float_win = win
    pcall(vim.api.nvim_buf_set_var, fbuf, "lsp_floating_preview_source", true)

    -- The preview is filetype markdown, so LazyVim's wrap_spell autocmd turns the
    -- spell checker on and underlines every symbol name in red. This is API doc,
    -- not prose.
    pcall(function()
      vim.wo[win].spell = false
    end)

    -- Neovim only installs "q" in its popups, never Escape (issue #27288).
    -- Buffer-local: a global mapping gets overridden by plugins.
    for _, touche in ipairs({ "<Esc>", "q" }) do
      vim.keymap.set("n", touche, function()
        M.fermer_toute_popup()
      end, { buffer = fbuf, nowait = true, desc = "Close the popup" })
    end

    -- Click or jump outside the popup: it closes instead of staying in the way.
    -- Definitely not "once": entering the popup already fires a WinLeave on
    -- the editor, which would consume the autocommand before we leave it.
    local surveillance
    surveillance = vim.api.nvim_create_autocmd({ "WinLeave", "WinClosed" }, {
      callback = function()
        if not est_flottante(win) then
          pcall(vim.api.nvim_del_autocmd, surveillance)
          if float_win == win then
            float_win = nil
          end
          return
        end
        if vim.api.nvim_get_current_win() ~= win then
          return
        end
        vim.schedule(function()
          if est_flottante(win) and vim.api.nvim_get_current_win() ~= win then
            pcall(vim.api.nvim_win_close, win, true)
          end
          if float_win == win then
            float_win = nil
          end
          pcall(vim.api.nvim_del_autocmd, surveillance)
        end)
      end,
    })
  end)
end

local function souris_sur_popup()
  return est_flottante(float_win) and vim.fn.getmousepos().winid == float_win
end

function M.popup_ouverte()
  return est_flottante(float_win)
end

-- Closes everything and gives focus back to the window we came from if we were in it.
-- Returns true if something was closed, so Escape keeps its role otherwise.
function M.fermer_toute_popup()
  local courante = vim.api.nvim_get_current_win()
  if est_flottante(courante) then
    local retour = vim.fn.win_getid(vim.fn.winnr("#"))
    if retour ~= 0 and retour ~= courante and vim.api.nvim_win_is_valid(retour) then
      vim.api.nvim_set_current_win(retour)
    end
  end

  derniere_pos = nil
  rejet_curseur = cle_curseur()
  rejet_souris = cle_souris()
  return fermer_tout()
end

function M.au_survol()
  if not actif then
    return
  end

  local pos = vim.fn.getmousepos()

  -- mouse over the popup itself: keep it, we're here to read or select it
  if souris_sur_popup() then
    return
  end

  if pos.winid == 0 or pos.line == 0 or pos.column == 0 then
    fermer_tout()
    derniere_pos = nil
    return
  end

  local cle = pos.winid .. ":" .. pos.line .. ":" .. pos.column
  if cle == derniere_pos then
    return
  end
  if cle == rejet_souris then
    return
  end
  rejet_souris = nil
  derniere_pos = cle
  fermer_tout()

  if timer then
    timer:stop()
  end

  local ok, buf = pcall(vim.api.nvim_win_get_buf, pos.winid)
  if not ok or vim.bo[buf].buftype ~= "" then
    return
  end

  local supporte = false
  for _, client in ipairs(vim.lsp.get_clients({ bufnr = buf })) do
    if client:supports_method("textDocument/hover") then
      supporte = true
      break
    end
  end
  if not supporte then
    return
  end

  timer = vim.defer_fn(function()
    -- the mouse moved in the meantime: the request is no longer worth anything
    if derniere_pos == cle then
      afficher(buf, pos.line - 1, pos.column - 1, "mouse")
    end
  end, DELAI_MS)
end

-- Keyboard hover: same popup, same marking, so Escape closes it too.
-- vim.lsp.buf.hover used to open a window this module couldn't find again.
function M.au_repos()
  if not actif then
    return
  end
  if vim.bo.buftype ~= "" or vim.fn.mode() ~= "n" then
    return
  end
  if est_flottante(vim.api.nvim_get_current_win()) then
    return
  end
  if cle_curseur() == rejet_curseur then
    return
  end
  rejet_curseur = nil
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    if est_flottante(win) then
      return
    end
  end

  local buf = vim.api.nvim_get_current_buf()
  for _, client in ipairs(vim.lsp.get_clients({ bufnr = buf })) do
    if client:supports_method("textDocument/hover") then
      local pos = vim.api.nvim_win_get_cursor(0)
      afficher(buf, pos[1] - 1, pos[2], "cursor")
      return
    end
  end
end

function M.setup()
  vim.o.mousemoveevent = true
  vim.keymap.set({ "n", "i" }, "<MouseMove>", function()
    M.au_survol()
    return "<Ignore>"
  end, { expr = true, desc = "LSP hover under the mouse" })

  vim.api.nvim_create_user_command("ToggleHover", function()
    actif = not actif
    if not actif then
      fermer_tout()
    end
    rejet_curseur = nil
    rejet_souris = nil
    vim.notify("Hover popups " .. (actif and "on" or "off"))
  end, { desc = "Toggle LSP hover popups (mouse and cursor)" })
end

return M

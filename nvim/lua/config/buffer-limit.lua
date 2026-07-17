-- Only keeps the N most recent open files, the oldest ones close on their own.

local MAX = 5

local function elaguer()
  local ouverts = vim.tbl_filter(function(info)
    -- a modified, unsaved file never closes on its own
    return info.listed == 1 and info.changed == 0 and info.bufnr ~= vim.api.nvim_get_current_buf()
  end, vim.fn.getbufinfo({ buflisted = 1 }))

  local total = #vim.fn.getbufinfo({ buflisted = 1 })
  if total <= MAX then
    return
  end

  -- the least recently used one goes first
  table.sort(ouverts, function(a, b)
    return a.lastused < b.lastused
  end)

  local a_fermer = total - MAX
  for i = 1, math.min(a_fermer, #ouverts) do
    pcall(vim.api.nvim_buf_delete, ouverts[i].bufnr, {})
  end
end

return {
  setup = function()
    vim.api.nvim_create_autocmd("BufEnter", {
      callback = function()
        vim.schedule(elaguer)
      end,
    })
  end,
}

-- Plain `u` walks one line back through history and forgets the branch you left
-- when you undo and then type something new. This exposes the branches.
return {
  {
    "mbbill/undotree",
    keys = {
      { "<leader>uu", "<cmd>UndotreeToggle<cr>", desc = "Undo tree" },
    },
    config = function()
      vim.g.undotree_WindowLayout = 2
      vim.g.undotree_SetFocusWhenToggle = 1
    end,
  },
}

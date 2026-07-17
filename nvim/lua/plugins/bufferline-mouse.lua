return {
  {
    "akinsho/bufferline.nvim",
    opts = {
      options = {
        middle_mouse_command = function(bufnr)
          Snacks.bufdelete(bufnr)
        end,
      },
    },
  },
}

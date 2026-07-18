return {
  {
    "akinsho/bufferline.nvim",
    opts = {
      options = {
        always_show_bufferline = true,
        middle_mouse_command = function(bufnr)
          Snacks.bufdelete(bufnr)
        end,
      },
    },
  },
}

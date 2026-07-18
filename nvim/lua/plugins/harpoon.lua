-- Pin the handful of files a task actually lives in, then reach them by index
-- instead of retyping their names into a picker.
return {
  {
    "ThePrimeagen/harpoon",
    branch = "harpoon2",
    dependencies = { "nvim-lua/plenary.nvim" },
    keys = function()
      local keys = {
        {
          "<leader>a",
          function()
            require("harpoon"):list():add()
          end,
          desc = "Harpoon file",
        },
        {
          "<leader>H",
          function()
            local harpoon = require("harpoon")
            harpoon.ui:toggle_quick_menu(harpoon:list())
          end,
          desc = "Harpoon menu",
        },
      }
      for i = 1, 4 do
        table.insert(keys, {
          "<leader>" .. i,
          function()
            require("harpoon"):list():select(i)
          end,
          desc = "Harpoon file " .. i,
        })
      end
      return keys
    end,
    opts = {
      settings = {
        save_on_toggle = true,
        sync_on_ui_close = true,
      },
    },
  },
}

return {
  {
    "folke/snacks.nvim",
    init = function()
      vim.api.nvim_create_autocmd("VimEnter", {
        nested = true,
        callback = function()
          -- after session restore, otherwise it takes over the layout
          vim.defer_fn(function()
            -- always opened at startup, regardless of the current buffer.
            -- The guard avoids a second picker: Snacks.explorer() opens,
            -- it doesn't toggle.
            if #Snacks.picker.get({ source = "explorer" }) == 0 then
              local retour = vim.api.nvim_get_current_win()
              Snacks.explorer()
              -- the explorer grabs focus on opening: hand focus back to the code
              vim.schedule(function()
                if vim.api.nvim_win_is_valid(retour) then
                  pcall(vim.api.nvim_set_current_win, retour)
                end
              end)
            end
          end, 100)
        end,
      })
    end,
    opts = {
      picker = {
        sources = {
          explorer = {
            layout = {
              -- the input box ate three lines above the tree
              -- (border, title, counter) and captured keystrokes: "h" would
              -- filter instead of collapsing the folder. "/" brings it back.
              hidden = { "input" },
              layout = { position = "right" },
            },
            hidden = true,
            ignored = true,
            win = {
              list = {
                keys = {
                  ["/"] = "toggle_input",
                },
              },
            },
          },
        },
      },
    },
  },
}

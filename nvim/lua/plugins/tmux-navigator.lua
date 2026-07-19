-- One set of keys for both kinds of split: at the edge of a Neovim window,
-- Ctrl+h/j/k/l hands off to the tmux pane next door instead of doing nothing.
-- Requires the matching bindings in ~/.config/tmux/tmux.conf.
return {
  {
    "christoomey/vim-tmux-navigator",
    cmd = {
      "TmuxNavigateLeft",
      "TmuxNavigateDown",
      "TmuxNavigateUp",
      "TmuxNavigateRight",
    },
    keys = {
      { "<M-h>", "<cmd>TmuxNavigateLeft<cr>", desc = "Go to left window/pane" },
      { "<M-j>", "<cmd>TmuxNavigateDown<cr>", desc = "Go to lower window/pane" },
      { "<M-k>", "<cmd>TmuxNavigateUp<cr>", desc = "Go to upper window/pane" },
      { "<M-l>", "<cmd>TmuxNavigateRight<cr>", desc = "Go to right window/pane" },
    },
    init = function()
      vim.g.tmux_navigator_no_mappings = 1
    end,
  },
}

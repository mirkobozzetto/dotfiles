-- git status shown as a column next to each file
require("git"):setup()

-- full frame around the panes
require("full-border"):setup({ type = ui.Border.ROUNDED })

-- Starship prompt in the header, same one as the shell
require("starship"):setup()

-- persistent bookmarks, saved to disk so they survive a restart
require("yamb"):setup({
  path = (ya.target_family() == "windows" and os.getenv("APPDATA") .. "\\yazi\\config\\bookmark")
    or (os.getenv("HOME") .. "/.config/yazi/bookmark"),
  cli = "fzf",
  keys = "hjklasdfghwertyuiopzxcvbnm",
  save_last_directory = true,
})

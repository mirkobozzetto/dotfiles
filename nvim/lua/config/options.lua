vim.opt.smarttab = true
vim.opt.mouse = "a"
vim.opt.mousescroll = "ver:2,hor:2"

vim.opt.textwidth = 80
vim.opt.colorcolumn = "80"

-- long lines fold onto the next row instead of running off screen.
-- breakindent keeps the continuation aligned under the first line, so wrapped
-- code stays readable; :ToggleWrap turns it off per window.
vim.opt.wrap = true
vim.opt.linebreak = true
vim.opt.breakindent = true

-- soft blink: block in normal mode, thin bar in insert mode.
-- the block is required by Ghostty's trail shader.
vim.opt.guicursor = table.concat({
  "n-v-c:block-blinkwait600-blinkon500-blinkoff400",
  "i-ci-ve:ver25-blinkwait400-blinkon400-blinkoff300",
  "r-cr:hor20-blinkwait600-blinkon500-blinkoff400",
  "o:hor50",
}, ",")

vim.g.lazyvim_python_lsp = "basedpyright"

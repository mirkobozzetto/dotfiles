# dotfiles

Editor and terminal configuration, kept under version control.

The real files live in this repo. Each app's expected config path is a
symlink pointing here, so changing a setting from inside the app shows up
directly as a diff in this repo.

## Layout

| Repo directory | Symlinked to      |
|----------------|-------------------|
| `zed/`         | `~/.config/zed`   |
| `warp/`        | `~/.warp`         |

`links.conf` is the single source of truth for that mapping. `install.sh`
reads it and creates the symlinks.

## Set up a new machine

```sh
git clone git@github.com:mirkobozzetto/dotfiles.git ~/dotfiles
~/dotfiles/install.sh
```

Any existing config is moved to `<path>.backup-<timestamp>` before the
symlink is created. Nothing is ever deleted.

## Add another app

1. `mv ~/.config/<app> ~/dotfiles/<app>`
2. Add a line to `links.conf`: `<app>  $HOME/.config/<app>`
3. Run `./install.sh`

## Everyday use

Edit settings from inside Zed or Warp as usual, then commit:

```sh
cd ~/dotfiles && git add -A && git commit -m "..." && git push
```

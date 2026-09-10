---
name: herdr-commands
description: Run shell commands in visible Herdr command tabs with retained history when HERDR_ENV=1. Use automatically for builds, tests, git, and other shell commands inside Herdr.
---

# Visible commands in Herdr

When HERDR_ENV=1 and HERDR_PANE_ID is set, route ordinary shell commands through
~/.prime/agent/bin/herdr-run. Outside Herdr, use normal native bash(). Do not
control a Herdr session from outside it. Do not use a UI-focused pane as caller.

Use Prime's native nonblocking handle, not OMP's synchronous Bash mode:

```python
from pathlib import Path
import os, shlex
command = "git status --short"
h = bash(shlex.join([
    str(Path.home() / ".prime/agent/bin/herdr-run"), os.getcwd(), command
]))
```

The helper creates or reuses a dedicated `Prime commands` tab in the caller's
workspace without changing focus or splitting the user's tab. It reserves each
command pane while the relay runs. Concurrent commands use separate free tabs.
The command runs in the supplied cwd; the destination shell supplies its
environment. Do not assume REPL os.environ changes propagate there. Specify
necessary non-secret environment overrides in the command; never put secret
values in commands or printed output. Use the project's own runtime as usual.

For slow work, keep h, end the turn, and inspect h.output()/h.poll() when its
completion message arrives. No blocking wait loops in the agent. The relay
returns the command's combined output and exit code. Inspect failures yourself.

The tab retains visible output. Private history files remain under
~/.prime/agent/commands/: .sh (command), .out (output), .rc (exit code), and .pane
(destination). The helper reports the pane and history prefix. No automatic
history deletion is configured; logs can contain sensitive command output.
Never publish or commit this directory.

A relay timeout or kill does not prove the pane process stopped. Read the
reported pane before retrying; never duplicate a potentially running command.
Only interrupt a command you own, using an explicit pane ID after inspecting its
current occupant. A lost relay can leave a reservation; do not steal a busy pane.
Do not close command tabs or discard their history unless requested.

Direct bash is permitted for Herdr routing diagnostics, unavailable-Herdr
recovery, and commands that must not be placed in retained terminal history.
Explain a material fallback; never claim hidden execution was visible. Python
file reads/edits are not shell commands and remain in Prime's own transcript.

This is a routing instruction, not a native bash interception hook. Do not wrap
or monkey-patch the kernel's bash function or switch Prime's tools.

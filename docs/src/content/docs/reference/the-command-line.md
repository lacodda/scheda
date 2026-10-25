---
title: The command line
description: Opening a file from a terminal, and using scheda as your $EDITOR.
---

scheda takes one file to open, and one flag.

```sh
scheda notes.md
scheda --wait notes.md
```

A second launch hands its file to the window you already have rather than
opening another one, so `scheda` from a terminal behaves like double-clicking a
file.

## `--wait`

Also spelled `-w`. The process stays alive until the tab is closed, and then
returns — which is what a program needs when it hands you a file and waits for
you to finish with it.

That makes scheda usable as an editor for other programs: with
`EDITOR="scheda --wait"`, `git commit` opens the commit message in scheda and
waits, and so does anything else that goes through `$EDITOR`. Setting it up on
each platform is on [Write commit messages in scheda](/scheda/guides/use-it-as-your-editor/).

Closing the tab is what returns. Not saving, and not closing the window — the
tab. You can keep working in scheda afterwards; the program that was waiting has
already got its answer.

### The exit code

`0` when the tab was closed, which means the edit happened. Non-zero if scheda
went away without the tab ever being closed — a caller like `git` reads that as
"the edit did not happen" and does not commit, which is the honest outcome.

A tab somebody is waiting on says so in the status bar: **waiting — close to
return**.

### On Windows

The installer puts scheda in `%LOCALAPPDATA%\scheda` and leaves `PATH` alone,
so a shell reaches it by that path - `& "$env:LOCALAPPDATA\scheda\scheda.exe" --wait notes.md`
in PowerShell. In Git Bash, give the file a path in the form `C:/…` rather than
`/c/…`, the way every Windows program expects.

## Flags you will not need

`--register` and `--unregister` are used by the installer to add and remove
scheda's entry in the "Open with" list. They do their work and exit without
opening a window. See
[File associations](/scheda/reference/file-associations/).

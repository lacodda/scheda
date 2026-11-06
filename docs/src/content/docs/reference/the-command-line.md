---
title: The command line
description: Opening a file or a folder from a terminal, and using scheda as your $EDITOR.
---

scheda takes one file or folder to open, and one flag.

```sh
scheda notes.md
scheda notes.md:12
scheda ~/notes
scheda --wait notes.md
```

A folder opens as the window's folder, the way **File: Open folder** opens one:
the tree shows it, and its notes are a vault whether or not Obsidian has ever
seen them - see [the root](/scheda/concepts/the-root/#the-folder-the-window-has-open).
A relative path is taken from the directory you typed it in.

A second launch hands its file or folder to the window you already have rather
than opening another one, so `scheda` from a terminal behaves like
double-clicking a file.

## `FILE:LINE`

`scheda notes.md:12` opens the file with the caret at the start of line 12 and
that line in the middle of the pane, from the first launch and from a second one
alike. Lines count from 1; a line past the end of the file is its last. `--wait`
waits on the file, whichever line it was opened at.

This is what a program that found something in a note hands to the editor. A file
whose name really does end in `:12` is that file: the number is read as a line
only when nothing is there under the whole name.

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

`--wait` takes a file. Given a folder it says so and exits with `1` at once:
a folder has no tab to close, and the caller would wait for nothing.

### The exit code

`0` when the tab was closed, which means the edit happened. Non-zero if scheda
went away without the tab ever being closed — a caller like `git` reads that as
"the edit did not happen" and does not commit, which is the honest outcome.

A tab somebody is waiting on says so in the status bar: **waiting — close to
return**.

### On Windows

The install script puts scheda in `%LOCALAPPDATA%\scheda` and adds that directory
to your user `PATH`; a terminal that was already open needs opening again to see
it. In Git Bash, give the file a path in the form `C:/…` rather than `/c/…`, the
way every Windows program expects.

## `--version`

Prints `scheda` and its version, and exits without opening a window. scheda is a
windowed program on Windows, so a shell shows the answer only through a pipe:
`scheda --version | Out-String`.

## Flags you will not need

`--register` and `--unregister` are used by the installer to add and remove
scheda's entry in the "Open with" list. They do their work and exit without
opening a window. See
[File associations](/scheda/reference/file-associations/).

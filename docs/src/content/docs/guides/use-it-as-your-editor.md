---
title: Write commit messages in scheda
description: Set scheda as the editor git and other programs open a file in, and wait for, on every platform.
sidebar:
  order: 4
---

Programs that hand you a file to edit - `git commit`, `git rebase`, `crontab -e`
- start an editor and wait for it to exit. `scheda --wait` is that editor: it
opens the file as a tab and returns when you close the tab. How it decides that
the edit happened is on [The command line](/scheda/reference/the-command-line/#--wait).

## For git only

On macOS and Linux, where the install script put `scheda` in `~/.local/bin`:

```sh
git config --global core.editor "scheda --wait"
```

On Windows, scheda is installed to your account's `AppData\Local` and is not on
`PATH`, so git is given its whole path. In PowerShell:

```powershell
$scheda = "$env:LOCALAPPDATA\scheda\scheda.exe" -replace '\\', '/'
git config --global core.editor "'$scheda' --wait"
```

The forward slashes and the single quotes are for git, which runs the editor
through a shell of its own.

## For every program that reads `$EDITOR`

In `~/.bashrc` or `~/.zshrc`:

```sh
export EDITOR="scheda --wait"
export VISUAL="scheda --wait"
```

On Windows, for the current user, in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('EDITOR', "`"$env:LOCALAPPDATA\scheda\scheda.exe`" --wait", 'User')
```

Programs started after that see it; a terminal that was already open does not.

## Check it

```sh
git commit --allow-empty
```

The message opens as a tab, and its status bar says **waiting — close to
return**. Write the message, save with `Ctrl+S`, close the tab with `Ctrl+W`:
the commit is made. Close the tab without saving anything and git finds the
message empty and does not commit - which is the way out when you change your
mind.

scheda can be open already, with other notes in it; the file arrives as one
more tab, and the rest of the window carries on after git has its answer.

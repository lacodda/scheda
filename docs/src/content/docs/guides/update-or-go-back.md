---
title: Update, or go back a version
description: Move to the newest scheda, install a particular release, and return to an older one without losing your settings.
sidebar:
  order: 8
---

The command that installed scheda is the one that updates it, and the same
command with a version in front of it installs that version instead.

## Update

Close scheda first - the installer refuses to replace a program that has
unsaved text open in it - and run the install command again.

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.ps1 | iex
```

On macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.sh | sh
```

It ends by naming the version it installed. What changed between versions is in
the [changelog](https://github.com/lacodda/scheda/blob/main/CHANGELOG.md).

## Install a particular release

Set `SCHEDA_VERSION` to its tag:

```powershell
$env:SCHEDA_VERSION = 'vX.Y.Z'; irm https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.ps1 | iex
```

```sh
curl -fsSL https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.sh | SCHEDA_VERSION=vX.Y.Z sh
```

The same works in both directions: newer or older than what is installed.

## What happens to your settings

A newer scheda reads the settings, the session and each vault's index written by
an older one and brings them up to date. The first time it writes one in its own
format, it leaves a copy of the file as it was beside it - `settings.1.json`,
named by the old format's number.

An older scheda finds files in a format it does not know. It uses what it
understands and never writes over them: a change you make on the settings
screen applies to the window but is not saved, and the screen says so at the
top. Back on the newer release, every file is as you left it.

If something did go wrong in a step, closing scheda and renaming the copy back
to `settings.json` is the way out. Where these files live, and what each format
changed, is on [What scheda keeps](/scheda/reference/what-scheda-keeps/).

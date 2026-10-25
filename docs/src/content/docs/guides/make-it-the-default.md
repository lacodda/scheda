---
title: Make scheda your markdown editor
description: Have a double-click on any .md file open it in scheda, on Windows, Linux and macOS.
sidebar:
  order: 1
---

Installing scheda offers it as a handler for markdown; it does not take the
file type from whatever opened it before. Making it the default is one choice
you make once.

## On Windows

1. Right-click any `.md` file in Explorer.
2. Choose **Open with** → **Choose another app**.
3. Pick **scheda** and press **Always**.

Or from Settings: **Settings → Apps → Default apps**, search for **scheda**,
and set it for `.md` and any of `.markdown`, `.mdown` and `.mkd` you use.

Either way sticks: Windows records the choice itself and keeps it across
updates of scheda.

## On Linux

The install script adds scheda to the applications menu and to **Open with**
for markdown. To make it the default:

```sh
xdg-mime default scheda.desktop text/markdown
```

## On macOS

There is no registration yet. Open a file with scheda from Finder's
**Open With → Other…**, or from a terminal with `scheda notes.md`.

## Check it

Double-click a `.md` file: it opens in scheda. A second one double-clicked while
scheda is open becomes a tab in the same window rather than a second window.

To put the old editor back, choose it the same way. What the installer wrote,
and how it takes it back out, is on
[Opening .md with scheda](/scheda/reference/file-associations/).

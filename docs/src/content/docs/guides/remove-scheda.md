---
title: Remove scheda
description: Uninstall scheda on each platform, and delete what it kept of its own if you want no trace of it.
sidebar:
  order: 10
---

Removing scheda never touches your notes: it wrote nothing of its own into them.
What it kept for itself - settings, the session, drafts, the index of each vault
- lives in its own directories, and those stay until you delete them, so a
reinstall picks up where you were.

## On Windows

**Settings → Apps → Installed apps → scheda → Uninstall.** The uninstaller takes
scheda out of **Open with** and **Default apps** first, removing only its own
entry from each file type's list; whichever editor opens `.md` after that is
the one you had chosen before, or Windows asks.

## On macOS

Delete the application and the command:

```sh
rm -rf ~/Applications/scheda.app ~/.local/bin/scheda
```

## On Linux

Delete the program, the command, its launcher entry and its icon:

```sh
rm -rf ~/.local/share/scheda
rm -f ~/.local/bin/scheda ~/.local/share/applications/scheda.desktop \
  ~/.local/share/icons/hicolor/128x128/apps/scheda.png
```

If you made scheda the default for markdown with `xdg-mime`, set another editor
the same way.

## Delete what scheda kept

Only if you want it gone - this is the one step that cannot be undone, and the
drafts folder holds text you typed and never saved to a file.

| Platform | Delete |
| --- | --- |
| Windows | `%APPDATA%\scheda` and `%LOCALAPPDATA%\scheda`; the webview's own cache, `%LOCALAPPDATA%\com.lacodda.scheda` |
| Linux | `~/.config/scheda` |
| macOS | `~/Library/Application Support/scheda` |

On Linux, `~/.local/share/scheda` - deleted above with the program - is also
where the index of each vault was kept. What every file in these directories
is, is on [What scheda keeps](/scheda/reference/what-scheda-keeps/).

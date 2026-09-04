---
title: Settings
description: What scheda remembers between runs, and the file it keeps it in.
---

scheda stores its settings in the application's own data directory — never in
the folder you opened. A vault stays exactly as its owner left it: no stray file
to commit, sync or explain.

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\scheda\settings.json` |
| Linux | `~/.config/scheda/settings.json` |
| macOS | `~/Library/Application Support/scheda/settings.json` |

There is no settings screen yet; edit the file and restart. One arrives in a
later version.

## What is in it

```json
{
  "theme": "system",
  "font_size": 15,
  "column_width": 46.0,
  "recent": []
}
```

| Field | What it does |
| --- | --- |
| `theme` | `system`, `light` or `dark`. `system` follows the operating system, which is what a notepad should do unasked. |
| `font_size` | Editor font size in pixels. |
| `column_width` | The width of the reading column, in `rem`. `0` means the full window. |
| `recent` | The last twelve files you opened, most recent first. Shown on an empty window. |

Every field has a default and unknown fields are ignored, so a settings file
written by a newer scheda still opens in an older one.

## The recent list

An empty window shows what you were last in. Opening a file records it; a file
that has gone drops off the list the next time you try it, without an error —
the list is a convenience, not a promise.

To clear it, set `"recent": []` and restart.

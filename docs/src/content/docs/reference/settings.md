---
title: Settings
description: The settings screen, what scheda remembers between runs, and the file it keeps it in.
---

`Ctrl+,` opens the settings. Every change takes effect as you make it — in
every tab and both panes, without a restart — and is stored at once; there is
no Save button to forget.

| Section | What is in it |
| --- | --- |
| Appearance | Theme, text size, the width of the reading column |
| Writing | Autosave, bracket closing, spell check |
| Quick note | The file quick notes go to, and the system-wide key — see [Quick note](/scheda/reference/quick-note/) |
| Keyboard | Every command and its keys, to change — see [Commands and keys](/scheda/reference/commands/) |
| Recent files | How many are remembered, and a button that clears the list |

The theme and autosave are also commands, so `Ctrl+Shift+P` then `dark` is a
quicker way to switch.

## The file

scheda stores its settings in the application's own data directory — never in
the folder you opened. A vault stays exactly as its owner left it: no stray file
to commit, sync or explain.

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\scheda\settings.json` |
| Linux | `~/.config/scheda/settings.json` |
| macOS | `~/Library/Application Support/scheda/settings.json` |

The file can still be edited by hand; scheda reads it when it starts.

## What is in it

```json
{
  "theme": "system",
  "font_size": 15,
  "column_width": 46.0,
  "recent": [],
  "close_brackets": false,
  "spellcheck": false,
  "autosave": false,
  "keys": {},
  "quick_note_file": null,
  "quick_note_key": "Win+Shift+N"
}
```

| Field | What it does |
| --- | --- |
| `theme` | `system`, `light` or `dark`. `system` follows the operating system, which is what a notepad should do unasked. |
| `font_size` | Editor font size in pixels. |
| `column_width` | The width of the reading column, in `rem`. `0` means the full window. |
| `recent` | The last twelve files you opened, most recent first. Shown on an empty window. |
| `close_brackets` | Whether an opening bracket types its partner. See below. |
| `spellcheck` | Whether misspelt words are underlined. See below. |
| `autosave` | Whether a file is written a moment after typing stops. See below. |
| `keys` | The shortcuts you changed, by command id. Only the changes. |
| `quick_note_file` | Where quick notes go; `null` until you choose. |
| `quick_note_key` | The system-wide quick-note key; empty turns it off. |

Every field has a default and unknown fields are ignored, so a settings file
written by a newer scheda still opens in an older one. Numbers are held to a
usable range: the text size to 10–32 pixels, the column to 24–120 `rem` or `0`
for the full window.

What the window had open — its tabs and panes — is kept beside this file in
`session.json`; see [Tabs, panes and the session](/scheda/reference/tabs-and-panes/).

## The recent list

An empty window shows what you were last in. Opening a file records it; a file
that has gone drops off the list the next time you try it, without an error —
the list is a convenience, not a promise.

To clear it, use *Clear the list* in the settings. `Ctrl+P` with nothing typed
lists the same files first.

## Scrollbars

scheda draws overlay scrollbars: a thin bar over the content rather than a
classic one beside it. The distinction is that an overlay bar takes no space in
layout, so the text does not shift sideways every time a document becomes tall
enough to scroll — or short enough not to.

There is no setting for it. The bar appears where the content scrolls, at the
window's edge, and gets out of the way otherwise.

## `close_brackets`

```json
{ "close_brackets": true }
```

Off by default. With it on, typing an opening bracket or quote inserts its
closing partner, and typing the closing one over an inserted one steps past it
instead of doubling it.

It is off because prose is not code. The apostrophe in "don't" is not an opening
quote, and a notepad that inserts characters nobody typed is worse than one that
leaves them alone. Turn it on if you write more code in your notes than prose.

## `autosave`

```json
{ "autosave": true }
```

Off by default. With it on, a file is written a second after you stop typing,
when the window loses focus, and when it closes — the status bar says
`autosave` while it is on.

It never writes over a change it did not see. If another program wrote the file
after scheda last read it, autosave leaves it alone and asks the question an
outside change always asks: load theirs, or keep yours. A draft with no file is
not autosaved (it is kept in scheda's own directory as always), and neither is a
read-only file or one that went to the recycle bin.

## `spellcheck`

```json
{ "spellcheck": true }
```

Off by default. With it on, the system's spell checker underlines misspelt
words. It is off because a note full of code, paths and names is a note full of
red lines. What the checker can and cannot do inside the window is on
[Writing](/scheda/reference/writing/#spelling).

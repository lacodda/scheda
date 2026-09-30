---
title: Quick note
description: A key that works from any program, a small window, and one line added to a file you chose.
---

The thought arrives while you are in a browser, a terminal, a meeting. Press
`Win+Shift+N` wherever you are: a small window comes up over everything, you
type, press `Enter`, and you are back where you were. What you typed is at the
end of one file you chose, stamped with the date and time.

| Keys | What it does |
| --- | --- |
| `Win+Shift+N` | Bring up the window, from any program while scheda is open |
| `Enter` | Add the note to the file and put the window away |
| `Shift+Enter` | A new line inside the same note |
| `Esc` | Put the window away. What you typed stays in it for next time |

## What is written

One list item per note, stamped with local time to the minute. Further lines of
the note stay inside the item:

```markdown
- 2026-09-30 14:05 call the printer shop
  about the covers for the second run
```

The file is appended to the way scheda saves any note: its line endings, its
byte-order mark and every byte already in it stay exactly as they were. A file
without a line break at the end gets one before the new item, so the note is
never glued to your last word. A file that does not exist yet is created.

If the file is open in a tab, the tab takes the new line at once — or, if the
tab has unsaved changes, asks the way any outside change asks.

## Setting it up

The first time, the window asks where quick notes go — an `Inbox.md` in your
vault is the usual answer. Change the file, change the key, or turn the key off
in the settings (`Ctrl+,`, *Quick note*). The settings also say when the key is
not available because another program holds it.

The key is `Win` with something rather than `Ctrl+Alt` with something on
purpose: on keyboards where `AltGr` types letters, `AltGr` *is* `Ctrl+Alt`, and a
system-wide `Ctrl+Alt+N` would stop everyone from typing `ń`.

The key works while scheda is open. Closing scheda's window closes scheda,
quick-note window and all — it does not stay behind in the background.

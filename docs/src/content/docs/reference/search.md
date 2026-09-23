---
title: Searching the vault
description: Every line in every note that matches, narrowed by tag or front-matter field — and replacing across notes, with a preview of every change.
---

`Ctrl+F` finds text in the note you are reading. `Ctrl+Shift+F` finds it in
every note of the vault.

This is a vault feature. A note opened on its own has no vault to search; see
[The root](/scheda/concepts/the-root/) for what makes a folder a vault.

## Searching

Press `Ctrl+Shift+F` and type. The vault is searched as you type, a moment after
you pause, and a search you have typed past is abandoned rather than finished.

Each note with a match is listed by its path in the vault, with the lines that
match under it and the matches marked. Click a line to open the note with the
match selected. Click a note's path to fold its lines away.

Three switches beside the box:

| Switch | What it does |
| --- | --- |
| `Aa` | Match case. Off by default. |
| `ab` | Whole word — `plan` finds `the plan.` but not `planning`. Works in any alphabet. |
| `.*` | Regular expression. `v\d+\.\d+` finds version numbers. |

A match never crosses a line break: what you are shown, and what you open, is a
line.

Press `Ctrl+Shift+F` again to put the cursor back in the box, and `Escape` from
inside the panel to close it and return to the note.

## Narrowing to some notes

The second box takes filters, written the way a vault already writes them:

| Filter | Notes it keeps |
| --- | --- |
| `#projects` | Carrying the tag, or one nested under it — `#projects/scheda` too |
| `status:draft` | With `status` in the front matter and `draft` in its value |
| `status:` | With a `status` field at all, whatever it holds |

Both kinds together keep notes that match both. With a filter and no text, the
list is the notes themselves — which is how to see every note tagged `#inbox`.

The filters are answered from the index, before a single file is opened, so a
narrow filter makes the search itself fast.

## Replacing

Press `Ctrl+Shift+H`, or **Replace** in the panel, and a third box appears. Type
what the matches should become and press **Preview**.

Nothing is written yet. The preview lists every match in every note, each as the
words around it with what is there struck through and what would be there
beside it — and a box to tick. Untick a match to leave it alone; untick a note
to leave all of it alone. **Replace** writes only what is still ticked.

With the regular-expression switch on, `$1` and `${name}` in the replacement are
the pattern's groups: `v(\d+)\.(\d+)` → `$1.$2` turns `v1.2` into `1.2`.

Afterwards a line says how many changes were made in how many notes, with
**Undo**.

### What it will not do

- **Touch anything else in a note.** Each note is written the way a save writes
  it: line endings, byte-order mark and final newline exactly as they were —
  see [Byte for byte](/scheda/concepts/byte-for-byte/). A replacement cannot
  contain a line break, so every line it did not touch stays where it was.
- **Write over a note that changed since the preview.** Each note is checked
  against the exact bytes the preview was made from. One that changed — in
  Obsidian, by a sync client, or by you — is skipped and counted.
- **Write under a tab with unsaved edits.** A note open with changes you have
  not saved is left out, and the result says so. Save it and run the
  replacement again.
- **Undo over newer writing.** Undo puts back the exact bytes of each note it
  changed — except a note that has been written since, which it names and leaves
  as it is.

## How it is read

The list of notes, their tags and their front matter come from the index scheda
keeps in its own data directory — never in the vault. It is checked against the
disk every time the vault is opened and kept current by watching the folder, so
a note written in Obsidian while scheda was closed is read again rather than
remembered wrong.

The text itself is not kept anywhere: a search reads the notes, across every
core of the machine, from the system's cache. On a vault of 5000 notes that is
about a quarter of a second.

---
title: Replace a word across a vault
description: Change a word, a name or a pattern in every note at once, narrowed to the notes you mean, with every change ticked off before it is written.
sidebar:
  order: 5
---

A project was renamed, a person changed their name, a tag grew a better
spelling. The vault search finds every place it is written and the replace
writes only the places you leave ticked.

## Find every place first

1. Press `Ctrl+Shift+H`. The vault search opens with its replace box.
2. Type what to find. Switch on **Aa** if case matters, **ab** to match whole
   words only - `plan` without `planning` - or **.\*** for a regular
   expression.
3. Narrow it if you need to, in the filter box: `#projects` keeps notes with
   that tag, `status:draft` keeps notes whose front matter says so. Both
   together keep notes that match both.

The list under the boxes is every line that matches, note by note. Read it
before going on: a word that also turns up where you did not mean it is easier
to see here than to take back later.

## Preview and write

1. Type the replacement and press **Preview**.
2. Each match is shown with what is there struck through and what would be
   there beside it. Untick a match to leave it alone, or a note to leave all of
   it alone.
3. Press **Replace** - the button counts what is still ticked, and only that is
   written.

A line under the list then says how many changes went into how many notes, and
offers **Undo**.

With a regular expression, the replacement can use its groups: find
`v(\d+)\.(\d+)` and replace with `$1.$2` to turn `v1.2` into `1.2`.

## What can stop a note being written

| The note | What happens |
| --- | --- |
| Is open in a tab with unsaved edits | Left out, and named. Save it and run the replace again. |
| Changed after the preview - in Obsidian, by a sync | Skipped and counted, so nothing is written where the preview did not look. |
| Was written again before you pressed Undo | Named and left as it is; the rest are put back. |

Every note that is written keeps its line endings, byte-order mark and final
newline. The details are on [Searching the vault](/scheda/reference/search/#replacing).

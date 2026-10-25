---
title: Rename a note without breaking its links
description: Rename a note from the file tree, check every link scheda would rewrite before it writes one, and undo it all if the result is not what you meant.
sidebar:
  order: 4
---

A note other notes link to cannot simply change its name: every `[[old name]]`
pointing at it would start pointing at nothing. scheda finds those links, shows
them to you line by line, and rewrites them only when you say so.

## Rename it

1. Open the file tree with `Ctrl+Shift+E`.
2. Right-click the note and choose **Rename**. The name is selected up to the
   extension, so typing replaces it and keeps `.md`.
3. Type the new name and press `Enter`.

If no link in the vault would break, that is all: the file is renamed, and a tab
showing it follows it to the new name with its undo history.

## Read the list

If links would break, a dialog lists every file and every line that would
change, as it reads now and as it would read after. Nothing has been written at
this point.

Look for two things:

- **A note you did not expect.** A line in a note you had forgotten links here
  is the dialog doing its job; a line that makes no sense is worth opening
  before you agree.
- **A note it cannot write.** A note that is not UTF-8, or that another program
  holds open, is named and left alone. It may keep a broken link, and it is
  yours to look at.

Then press **Rename and update** to write the list, or **Cancel** to change
nothing at all.

## Undo it

A bar says what happened - *Renamed to roadmap.md — 3 links in 2 notes updated* -
and offers **Undo** for twelve seconds. Undo puts back the exact bytes of every
note it wrote and then the old name.

## What it leaves alone

Only links this rename would break are rewritten. A link that still lands on a
note after the rename - because another note of the same name exists - stays as
written; an example of a link inside a code span stays an example; the words
after `|` in `[[note|the words]]` stay yours. The whole set of rules is on
[What links here](/scheda/reference/the-network/#renaming-a-note).

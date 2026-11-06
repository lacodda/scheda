---
title: History of a note
description: What git remembers of the note in front - which commits changed it, the lines each changed, and the whole note as it was.
---

A note in a git repository has a past, and scheda shows it without leaving the note.
It reads the repository and never writes to it; nothing of scheda's goes into it, and
it needs no `git` installed.

## The panel

`Ctrl+Shift+G` shows it, and shows it away again; so does **Panel: History of this
note**. Like the other panels, it stays as you left it when you switch tabs, and
follows the note in front.

Each row is one commit that changed this note, newest first: its message, the day,
who wrote it and the start of its id. Hover for the full id and the time. A rename is
followed, as `git log --follow` does, so the list goes on past the commit that moved
the note, and the row says where from. Only commits on the way from `HEAD` down the
first parents count, and a merge counts when it changed the note against the line it
was merged into.

The list goes back 200 changes, and says so when there is more.

## What a commit changed

Click a row to see the lines it changed, with two lines of the note around each place:
added lines marked `+`, removed ones `-`, and the count of both on top. Click the row
again to close it. A change too long to list stops after 2000 lines and says so, and a
version that is not text says that instead.

## The note as it was

**Show this version** opens the whole note as it stood in that commit, in a pane beside
the note as it is. It is in reading mode and takes no typing; text can be selected and
copied out of it, and its links and pictures work the way the note's do. With the pane
open, opening another row takes it to that version.

`Esc` closes it, from inside it, and so does its `×`. It goes by itself when the panel
closes or another note comes to the front: it is a way of looking at this note, not a
document of its own, and it does not come back with the session.

A version whose bytes are not UTF-8 is refused in words rather than shown garbled, the
way [reading a file](/scheda/concepts/byte-for-byte/) refuses to guess.

## When there is nothing to show

| The panel says | Which means |
| --- | --- |
| A draft has no history yet. | The tab has never been saved as a file. |
| This note is not in a git repository. | No `.git` in the note's folder or above it. |
| Git has no record of this note yet. | It has never been committed. |

Nothing here happens before the panel is opened, and a commit made in a terminal shows
up when you come back to the window.

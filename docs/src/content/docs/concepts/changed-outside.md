---
title: Changed outside
description: What scheda does when Obsidian, a sync client or another editor writes a file you have open.
---

A vault is not scheda's alone. Obsidian is editing the same notes, a sync client
is writing files while you type, and a script may rewrite twenty of them at
once. scheda watches the folder your document is in, and it never resolves a
disagreement by quietly picking a side.

## What scheda watches

The vault of whatever tab is in front of you, and only that one. Switching to a
tab in a different vault moves the watch; opening a note that is not in a vault
stops it. `.obsidian/`, `.git/`, `.trash/` and the usual machinery folders are
not watched — `.obsidian/workspace.json` alone is rewritten every time a pane
moves over there, and a tree that redrew for it would flicker for reasons you
could not see.

A burst of changes is allowed to settle before scheda reacts. Saving a file from
another program produces several events, and one save should be one change.

## The three things that can happen

### The file is the same after all

Nothing is said. A sync client rewriting an unchanged file, or a save in another
editor with nothing typed, produces a write without producing a difference — and
an editor that asks "reload?" when nothing differs teaches you to dismiss the
question without reading it.

### The file changed and you had not edited it

The tab takes the new text. The file is the truth, your tab was simply behind
it, and asking would be asking whether you meant to edit the file you just
edited.

The shape comes with the text: a note that came back from a sync client with
CRLF where it had LF is now a CRLF file, and saving it will not rewrite every
line of it.

### The file changed and you had unsaved edits

This is the only case scheda asks about, and it is the one case where either
answer loses somebody's writing:

- **Load theirs** — the tab takes what is on disk. What you had typed is gone.
- **Keep mine** — what is on screen stays, and it overwrites the file when you
  save.

You are not asked again about that same change. The question is about a conflict
you have already answered.

## What else keeps up

- **The tree** redraws, so a note created in Obsidian appears without restarting.
- **[Go to file](/scheda/reference/going-to-a-file/)** searches the vault as it
  is now, not as it was when the window opened.
- **The index** behind the tags, the backlinks and the
  [vault search](/scheda/reference/search/) reads the changed notes again
  before the window is told anything changed, so a panel that asks straight
  away gets the new answer.
- **A tab whose file was deleted** says so in the status bar and offers to save
  the text somewhere else, rather than silently re-creating the file somebody
  just moved to the recycle bin.
- **A tab whose file came back** — restored by a sync client, say — stops being
  an orphan and takes the text.

---
title: What links here
description: Backlinks, links to notes that are not written yet, and renaming a note without breaking the links that point at it.
---

A link points one way, but it is a fact about both notes. scheda shows the other
direction — which notes point at the one you are reading — and keeps those links
working when you rename it.

Both of these are vault features. A note opened on its own has no vault whose
links could point at it; see [The root](/scheda/concepts/the-root/) for what
makes a folder a vault.

## The panel

`Ctrl+Shift+B` shows it, and shows it away again. Like the tree and the outline,
it stays as you left it when you switch tabs.

### Linked here

Every note in the vault that points at the one you are reading, with the line the
link sits on. The sentence is there because it is the useful part: a list of file
names tells you which notes mention this one, a list of sentences tells you what
they say about it. Click a row to open that note at that line.

A note that links here twice appears twice — they are two places, and two things
said. Links are counted by where they **land**, not by how they are written, so
`[[plan]]` and `[[projects/plan]]` both appear when they both resolve to the note
you are reading.

### Not written yet

The links in the open note that point at nothing. A vault accumulates these on
purpose: writing `[[the thing]]` before the thing exists is how notes get
planned. Click one and scheda creates the note, in the folder your vault is set
to use, and opens it.

The same missing target written twice is one row: it is one note left to write.

The panel answers from the vault's index and asks again when something is
written — by you, by Obsidian, or by a sync client. The answer is about the files
on disk, so a link you are in the middle of typing is not in it yet. Where each
link lands is worked out at the moment you look, against the files as they are
then.

## Renaming a note

Rename a note in the tree and the links pointing at it would break. scheda offers
to rewrite them, and shows you exactly what that would mean first.

**Nothing is written while you are looking at it.** The dialog lists every file
and every line, as it reads now and as it would read. What you approve is a write
to notes you did not open, so the list is the lines themselves rather than a
count — a number is not something you can check.

If no link would break, there is no dialog. The file is renamed and that is the
whole of it.

### What gets rewritten, and what does not

Only a link that this rename would actually break. That is a narrower thing than
"a link mentioning the name":

- `[[plan]]` in a vault with one `plan.md` breaks when the file becomes
  `roadmap.md`, and is rewritten.
- `[[plan]]` in a vault that also has `archive/plan.md` does **not** break — it
  lands on the archived note now. scheda leaves it alone, because repointing it
  would move a link you never pointed here.
- A wikilink inside a code span or a fenced block is an example of a link, not a
  link. A note explaining how wikilinks work keeps its examples.
- `[[plan.png]]` and `[[plan]]` are different targets. Renaming the picture does
  not touch the links to the note.

Only the target of the link changes. `[[plan|the plan]]` becomes
`[[roadmap|the plan]]`: the words after the bar are the sentence you wrote, and
the rename has nothing to say about them. Headings survive the same way.

The new link is written in [your vault's own format](/scheda/reference/links/),
not scheda's.

### After it happens

A bar says what changed and offers **Undo** for a few seconds. Undo puts back the
exact bytes of every file that was written, then puts the name back.

The offer is short on purpose, and there is one of it rather than a stack. What
undo restores is what those files held a moment ago, and that is only the right
thing to restore while nothing else has written over them.

### What it will not do

A note that cannot be read — one that is not UTF-8, or that something else has
open — is named in the dialog and left alone. It may hold a link that is about to
break, and you are the one who can go and look.

A note that changes between the preview and your answer is skipped rather than
written at the positions the preview measured. You get told how many links were
actually rewritten, which is the honest number.

Every file scheda writes here keeps its line endings, its byte-order mark and its
final newline, exactly as [any other save
does](/scheda/concepts/byte-for-byte/). A rename is not an exception to that
promise.

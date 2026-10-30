---
title: One root rule
description: How scheda decides whether a file is a note or part of a vault, and what follows from that.
---

scheda is a notepad that becomes a vault editor when there is a vault around
the file. There is no mode to switch: a folder opened, or a vault found around
the file, decides.

## The rule

**A file's root is the nearest folder above it that you opened, or that holds
`.obsidian/`.** `.obsidian/` is the marker Obsidian leaves in a vault, and
scheda reads it without ever writing one of its own. A folder you opened - with
**File: Open folder**, `scheda <folder>` on the command line, or by dropping it
on the window - is a vault because you said so, marker or not.

**Nearest wins, whichever kind it is.** An Obsidian vault inside a folder you
opened is still that vault: its notes were written for it, and their links mean
what they mean there. A folder you opened inside a vault is the part of it you
asked for.

**A file with neither above it has no vault.** It opens as a note, and no tree
of its folder appears - a note on the Desktop is a note, and a tree of the
Desktop is noise.

That is the whole rule, and everything the vault side of scheda does follows
from it: the tree, `[[links]]`, backlinks, tags, the
[vault search](/scheda/reference/search/) and its index, and which folder an
embedded picture may be read from ([ADR 0004](https://github.com/lacodda/scheda/blob/main/docs/adr/0004-images-come-through-a-scoped-protocol.md)).

## The folder the window has open

One folder at a time is the window's own. The tree shows the vault of the note
in front; when that note is in no vault - a note from the Desktop, a new draft,
nothing at all - it shows the window's folder instead, and so do going to a file
(`Ctrl+P`), the vault search and the tags.

With no note in front, the window is the folder's: its name, the notes you
opened in it lately, and the tree beside them. Open a note from it and the note
takes that place.

Opening another folder makes that one the window's. The notes still open from
the first keep it as their root until they are closed, so their links go on
meaning what they meant. **File: Close folder** puts the window back to a
notepad; the session remembers the folder until then, across restarts.

## What the tree leaves out

The vault's own state, and the machinery a notes folder collects: `.obsidian/`,
`.git/`, `.trash/`, `node_modules/`, and anything whose name starts with a dot.
Folders sort before files, and names sort without regard to case.

## Nothing of ours inside the vault

Which folders are open, which file you were last in, the settings, the index of
each vault - all of it lives in the application's own data directory, keyed by
the root's path (see [What scheda keeps](/scheda/reference/what-scheda-keeps/)).
A folder opened in scheda gets no `.obsidian/` and no file of ours; a vault
opened by scheda and by Obsidian in turn sees no foreign files from either.

That is a rule with teeth: it means the vault can be a git repository, a
synchronised folder, or somebody else's, and scheda leaves it exactly as it was
found.

## Handing the note to Obsidian

There is a button in the title bar of any note that is in an Obsidian vault: it
opens that same note in Obsidian.

It is there because the arrangement runs both ways. scheda reads Obsidian's
conventions and writes none of them; the graph, the plugins, the daily note and
everything else built on top of a vault live over there. A note you opened
quickly in scheda and now want the rest of is one click away, and the button
takes nothing away from either program.

It appears only for a note inside a folder holding `.obsidian/`, because that is
the only case where Obsidian has a vault to open it in. A folder you opened in
scheda is not one of Obsidian's.

Both programs can have the same vault open at once — see
[Changed outside](/scheda/concepts/changed-outside/) for what happens when they
both touch the same file.

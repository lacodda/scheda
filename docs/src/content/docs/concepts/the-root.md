---
title: One root rule
description: How scheda decides whether a file is a note or part of a vault, and what follows from that.
---

scheda is a notepad that becomes a vault editor when there is a vault around
the file. There is no mode to switch and no folder to open first: the file
itself decides.

## The rule

**A folder opened explicitly is the root.** Nothing to work out.

**A file's root is the nearest folder above it holding `.obsidian/`.** That is
the marker Obsidian leaves in a vault, and scheda reads it without ever writing
one of its own.

**A file with no `.obsidian/` above it has no vault.** It opens as a note, and
the tree does not appear — a note on the Desktop is a note, and a tree of the
Desktop is noise.

That is the whole rule, and everything the vault side of scheda does follows
from it: the tree, `[[links]]` and backlinks when they arrive, search when it
arrives, and today the one thing that already depends on it — which folder an
embedded picture may be read from ([ADR 0004](https://github.com/lacodda/scheda/blob/main/docs/adr/0004-images-come-through-a-scoped-protocol.md)).

## What the tree leaves out

The vault's own state, and the machinery a notes folder collects: `.obsidian/`,
`.git/`, `.trash/`, `node_modules/`, and anything whose name starts with a dot.
Folders sort before files, and names sort without regard to case.

## Nothing of ours inside the vault

Which folders are open, which file you were last in, the settings — all of it
lives in the application's own data directory, keyed by the root's path. A vault
opened by scheda and by Obsidian in turn sees no foreign files from either.

That is a rule with teeth: it means the vault can be a git repository, a
synchronised folder, or somebody else's, and scheda leaves it exactly as it was
found.

---
title: Going to a file
description: Ctrl+P, and how the list is ordered.
---

`Ctrl+P` opens a list of the files in your vault. Type part of a name and the
list narrows; `Enter` opens the top one.

| Keys | What it does |
| --- | --- |
| `Ctrl+P` | Open the list |
| `↑` / `↓` | Move through it |
| `Enter` | Open the file under the cursor |
| `Esc`, or a click outside | Close without opening anything |

The row under the pointer becomes the row `Enter` would take, so the mouse and
the keyboard never disagree about which file is about to open.

## How a name matches

The letters you type have to appear in the name, in that order, but not next to
each other: `rln` finds `release-notes.md`. Case does not matter.

The order of the list is the point of it. Earlier means:

- **Letters that start words.** `rn` is the initials of `release-notes.md` and
  an accident in `random.md`; the initials come first.
- **Letters next to each other**, because that means you typed a piece of the
  name rather than letters scattered through it.
- **Shorter names**, so `plan` finds `plan.md` before `planning-notes.md`.
- **The name over the folders.** A file matched only through the folders above
  it is still offered, but never ahead of one matched by its own name.

The letters that matched are shown in the product's accent colour, so you can
see why a row is in the list and type one more letter instead of reading all of
them.

## What is not in the list

- **Folders.** `Ctrl+P` opens a file.
- **Hidden folders** and the usual machinery: `.obsidian/`, `.git/`,
  `.trash/`, `node_modules/` and the rest — the same ones the tree hides.
- **Anything outside the vault.** The list is the vault your document is in. A
  note that is not in a vault has no list, and scheda says so instead of
  offering you your whole disk.

The list is read fresh when the vault changes, so a note created in Obsidian is
found without restarting scheda.

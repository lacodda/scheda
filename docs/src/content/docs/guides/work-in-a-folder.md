---
title: Work in a folder of notes
description: Open a plain folder of markdown as a vault - tree, links, tags and search - without Obsidian and without scheda writing anything into it.
sidebar:
  order: 2
---

A folder of markdown files does not need Obsidian to be a vault. Open it in
scheda and it is one: the files in a tree, `[[links]]` between them, their tags
and a search across all of them. Nothing is written into the folder to make that
so.

## Open the folder

Any of these, all the same:

- `scheda ~/notes` from a terminal - a relative path is taken from where you are
- `Ctrl+K` then `Ctrl+O`, or *File: Open folder* from `Ctrl+Shift+P`
- drop the folder onto the window

The window shows the folder: its name, the notes you opened in it lately, and
the tree beside them. Open a note and it takes the folder's place in front; the
tree stays on the folder.

| To | Press |
| --- | --- |
| Show or hide the tree | `Ctrl+Shift+E` |
| Jump to a note by name | `Ctrl+P` |
| Search every note | `Ctrl+Shift+F` |
| See every tag | `Ctrl+Shift+T` |
| See which notes link to this one | `Ctrl+Shift+B` |

`[[links]]` resolve against the whole folder, the way Obsidian would resolve
them in a vault of its own. Following a link to a note that does not exist yet
offers to create it, in the folder of the note you are in.

## A note from somewhere else

Open a note from outside the folder - from the Desktop, say - and it opens as a
plain note. The tree goes on showing the folder, because the note has no vault
of its own to show. A note inside an Obsidian vault is the exception: it is in
that vault, and the tree shows the vault while the note is in front.

If the folder has an Obsidian vault inside it, its notes keep their vault: their
links mean what they mean in Obsidian. See [the root](/scheda/concepts/the-root/)
for the whole rule.

## Close it, or come back to it

The folder stays the window's until you open another one or run
*File: Close folder*, and closing scheda does not close it: the next launch
brings it back, with whatever tabs you had open in front of it.

Opening a second folder makes that one the window's. Notes still open from the
first keep it as their root until you close them.

## Confirm the folder is as you left it

scheda keeps which folder is open, the session and the folder's index in its own
data directory (see [What scheda keeps](/scheda/reference/what-scheda-keeps/)) -
no `.obsidian/`, no hidden file. If the folder is a git repository, browsing it
leaves nothing to commit:

```sh
git status --short    # empty after opening, searching and following links
```

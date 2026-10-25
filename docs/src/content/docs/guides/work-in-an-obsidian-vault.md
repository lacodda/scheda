---
title: Work in an Obsidian vault
description: Open a vault's notes in scheda beside Obsidian, find your way around it, and confirm nothing in the vault was touched.
sidebar:
  order: 2
---

scheda reads an Obsidian vault the way Obsidian writes it, and writes nothing of
its own into it. The two can have the same vault open at once.

## Open the vault

Open any note inside it - double-click it, `scheda path/to/note.md`, or `Ctrl+O`.
scheda walks up from the note to the folder holding `.obsidian/`, and that folder
is the vault. There is nothing to set up and no folder to choose first; a note
with no `.obsidian/` above it opens as a plain note.

Once one note of the vault is open:

| To | Press |
| --- | --- |
| See the vault's files | `Ctrl+Shift+E` |
| Jump to a note by name | `Ctrl+P` |
| See which notes link to this one | `Ctrl+Shift+B` |
| See every tag | `Ctrl+Shift+T` |
| Search every note | `Ctrl+Shift+F` |

`[[links]]` resolve against the whole vault the way Obsidian resolves them, and
`Ctrl+click` is not needed - a click follows a link.

## What scheda takes from the vault

From `.obsidian/app.json`, two things Obsidian lets you set, so that the two
programs never disagree:

- **Where pasted pictures go** (`attachmentFolderPath`): a screenshot pasted with
  `Ctrl+V` lands in the same folder Obsidian would put it in.
- **How a new link is written** (`newLinkFormat`, `useMarkdownLinks`): a link
  scheda writes - completing `[[`, or rewriting one after a rename - is spelled
  the way Obsidian would spell it. See [Links between notes](/scheda/reference/links/).

The rest of `.obsidian/` - the theme, the plugins, the workspace - is
Obsidian's, and scheda neither reads nor touches it.

## Hand a note back to Obsidian

The Obsidian button in the title bar, or **File: Open in Obsidian** in
`Ctrl+Shift+P`, opens the same note there. Use it for what scheda does not do:
the graph, plugins, the daily note.

## When both programs edit one note

Save in one and the other picks the change up. If you had unsaved edits to the
same note in scheda, it asks, and names both versions rather than choosing for
you - see [Changed outside](/scheda/concepts/changed-outside/).

## Confirm the vault is as you left it

scheda keeps its settings, session and the index of each vault in its own data
directory (see [What scheda keeps](/scheda/reference/what-scheda-keeps/)). If
the vault is a git repository, browsing it in scheda leaves nothing to commit:

```sh
git status --short    # empty after reading, searching and following links
```

Only what you save, rename, delete or paste appears there - and each of those
writes the bytes it read back unchanged everywhere you did not edit
([Byte for byte](/scheda/concepts/byte-for-byte/)).

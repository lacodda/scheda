---
title: Working with files
description: Making, renaming and removing notes from the tree, drafts that have no file, and pasting a picture into one.
---

Everything here happens in the file tree — `Ctrl+Shift+E` — and every one of
these operations is performed by scheda's core rather than by the interface.
That is why a refusal arrives as a sentence about your file rather than as an
error number.

## From the tree

Right-click a row, or the empty space below the list.

| On | What the menu offers |
| --- | --- |
| A folder | New note and new folder **inside it**; rename; move to recycle bin |
| A file | New note and new folder **beside it**; rename; move to recycle bin |
| The empty space | New note and new folder in the vault root |

Choosing to make something turns a row of the tree into a text field, at the
place the new file will appear. `Enter` creates it; `Escape`, or clicking
anywhere else, cancels. Making a note opens it.

Renaming offers the current name with everything **before the extension**
selected, so typing replaces the name and keeps the `.md`. A tab showing the
file follows it: the same tab, the same undo history, the new name.

In a vault, renaming a note that other notes link to shows you every link that
would break and offers to rewrite them — see [What links
here](/scheda/reference/the-network/). Nothing is written until you say so, and
it can be undone.

## Moving to the recycle bin

Deleting a note puts it in the operating system's recycle bin — the Windows one,
the desktop trash on Linux — never an outright delete. A misclick in a tree may
not cost anybody their writing, and no confirmation dialog makes an unlink
reversible.

If the tab showing the file is open, it stays open, with the text still in it.
The status bar says `file deleted — save as`, and `Ctrl+S` asks where to put the
text rather than quietly recreating the file you just deleted.

## Names scheda will not accept

A name is one component of a path, so `notes/one.md` is refused: it is an
attempt to put the file somewhere else, and the menu already knows where the
file goes.

Beyond that, `< > : " / \ | ? *` are refused everywhere, including on Linux and
macOS where some of them are legal. A vault is meant to travel between machines
and through a sync, and a note called `what?.md` made on Linux cannot be written
on the other side. Refusing it here is the honest moment to say so. A name
ending in a dot or a space is refused for the same reason — Windows silently
strips both, and the file ends up under a name you cannot find.

## When the filesystem says no

| What you see | What it means |
| --- | --- |
| *"note.md" already exists* | Something of that name is there. Nothing was overwritten. |
| *"note.md" is open in another program* | Another program is holding it — Obsidian, a sync client, a backup. |
| *scheda is not allowed to write in "Notes"* | The folder's permissions, not scheda's opinion. |
| *"note.md" is no longer there* | It was removed between the tree being read and the click. |

## Drafts

`Ctrl+N` opens a tab with no file — a notepad in the literal sense. It has a
name only when you give it one: `Ctrl+S` asks where to put it.

A draft with text in it **survives closing the window**. It is written to
scheda's own data directory, never into your vault, and comes back as a tab on
the next launch. Closing the *tab* discards it, because that is what closing a
tab means; saving it to a file discards it too, since the file is now where the
text lives.

Unsaved edits to a file that *has* a name are not kept this way — see
[ADR 0005](https://github.com/lacodda/scheda/blob/main/docs/adr/0005-a-draft-is-not-a-second-copy-of-a-file.md)
for why a second copy of your notes is worse than the loss it would prevent.

## Pasting a picture

Take a screenshot, press `Ctrl+V` in a note, and the picture becomes a file in
the vault plus a link in the text:

```markdown
![](../assets/Pasted%20image%2020260916143012.png)
```

Where it goes is **the vault's decision, not scheda's**. The
`attachmentFolderPath` setting in `.obsidian/app.json` is read as Obsidian
writes it:

| The setting | Where the picture lands |
| --- | --- |
| `assets` | `assets/` under the vault root |
| `./attachments` | `attachments/` beside the note |
| `/`, or absent | The vault root |

A note that is not in a vault gets the picture beside it. A draft with no file
yet has nothing for the link to be relative to, so the paste is refused with a
sentence saying to save it first.

Text on the clipboard always wins. A copied spreadsheet cell carries both a
picture of itself and the number in it, and pasting the screenshot instead of
the number is not what anyone meant.

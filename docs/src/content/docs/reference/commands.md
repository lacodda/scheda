---
title: Commands and keys
description: The command palette, the block palette, and changing any key.
---

## The command palette

`Ctrl+Shift+P` lists everything scheda can do, each command with its key beside
it. Type a few letters of what you want — `tp` finds *Tab: Pin or unpin* — and
press `Enter`. The key is shown so that next time it need not be looked up.

A command that means nothing at the moment is not listed: *Open in Obsidian*
appears only for a note inside a vault.

## Inserting a block

`Ctrl+Shift+Space` in a note lists the blocks markdown has and scheda draws:

| Block | What goes in |
| --- | --- |
| Callout | `> [!warning]` and the body line under it, for every kind Obsidian ships |
| Table | A header row, the rule and one empty row, caret in the first cell |
| Code block | A fence, with any of the languages scheda colours — or none |
| Task | `- [ ] `; on a line with text, turns that line into a task |
| Divider | `---` |

A block starts on a line of its own: it takes an empty line, or goes after the
caret's line with the blank line markdown needs between two blocks. With lines
selected, a code block goes around them and a callout quotes them.

Nothing is inserted that you could not have typed. The palette is a shorter way
to type the markdown, not a different kind of content.

## Changing a key

Every command's keys are in the settings (`Ctrl+,`, *Keyboard*). Click `+`
beside a command and press the keys you want; `×` on a key removes it;
*Default* puts the command's own keys back.

A key belongs to one command. Giving it to a second one takes it from the first,
and the screen says which: two commands on one key would mean a key that does
something other than what the screen shows.

Keys are recognised by where they are on the keyboard when the layout does not
type Latin letters, so `Ctrl+P` is `Ctrl+P` on a Russian layout too. `AltGr`
with a key is typing — on a Polish or German keyboard it makes a letter — and
is never taken for a shortcut.

The changes are kept in `settings.json` under `keys`, by command id. Only the
changes: a command you have not touched follows its default. The ids are part
of the settings format and do not change between versions; a command that is
ever renamed takes the keys you gave it along (see [What scheda
keeps](/scheda/reference/what-scheda-keeps/)).

---
title: Links between notes
description: Wikilinks in scheda — where they lead, how they are completed, and what happens when the note is not there yet.
---

In a vault, `[[double brackets]]` are how notes point at each other. scheda reads
them the way Obsidian does and writes them in the format your vault is set to —
it does not introduce a second convention into a folder Obsidian already has
opinions about.

Outside a vault there are no wikilinks: a note on the Desktop has nothing to
resolve a name against. See [The root](/scheda/concepts/the-root/) for what makes
a folder a vault.

## The forms

| You write | It means |
| --- | --- |
| `[[plan]]` | The note called `plan`, wherever it sits in the vault |
| `[[projects/plan]]` | That path from the vault root |
| `[[plan\|the plan]]` | The same note, shown as *the plan* |
| `[[plan#Risks]]` | The note, at its **Risks** heading |
| `[[#Risks]]` | A heading in the note you are writing in |
| `![[plan]]` | The note shown here, not linked to |
| `![[shot.png]]` | The picture shown here |

The whole construction is drawn as what you meant to read: `[[plan|the plan]]`
appears as *the plan*, underlined. Step onto the line and the brackets come back,
because that is text you are editing — the same rule every other marker follows
(see [Markup scheda draws](/scheda/reference/markup/)).

An underline is what tells a link to a note in this vault from an ordinary
markdown link to the web.

## What a name resolves to

A name, not a path: `[[plan]]` finds `plan.md` anywhere in the vault. When more
than one file could answer:

1. A note beats anything else that shares the name — the extension you did not
   write is `.md`.
2. The shallower path wins: `plan.md` at the top beats `archive/2024/plan.md`.
3. A tie goes to the lower path alphabetically, so the same link always lands on
   the same file.

The extension is optional and case does not matter. `[[shot.png]]` names that
file exactly, which is how a picture is linked. A path may start anywhere in the
middle — `[[b/c]]` finds `a/b/c.md` — so a link keeps working when its note is
moved into a folder.

Obsidian's own folder is not searched: `.obsidian/` is read for its conventions
and never offered as content.

## Following one

Click a link, or focus it with the keyboard and press `Enter`. The note opens in a
tab. `[[#Risks]]` scrolls this note to that heading instead.

A link to a note that does not exist yet is drawn **dashed and dimmer**. That is
not a broken link — writing the name before the note is how a vault grows.
Following it asks whether to create the note, and opens what it made:

- A bare name goes wherever your vault's **Default location for new notes** says
  — the vault root, the folder of the note you are in, or a folder you named.
- A name with folders in it goes there: `[[projects/2027/plan]]` creates
  `projects/2027/plan.md`, making the folders it needs. You said where.

A name that cannot become a file — one holding `?`, `:` or a path that climbs out
of the vault — is refused with the reason, rather than left to fail later.

## Completion

Type `[[` and keep typing. The notes that match are offered, ranked by the same
matcher `Ctrl+P` uses — see [Going to a file](/scheda/reference/going-to-a-file/)
for how that ranking works. `Enter` takes the highlighted one, `Escape` closes
the list, and the target is written in your vault's link format.

After a `#` the list becomes that note's headings. `[[#` offers the headings of
the note you are writing in.

The list does not open on the bare `[[`; it waits for a letter, so the panel does
not cover the text while you are still deciding whether you are writing a link at
all. `Ctrl+Space` opens it anyway.

## Embeds

`![[note]]` shows the note's opening here, in a card with its name along the top.
The opening rather than the whole thing: an embed is a quotation, and a quotation
of a thousand words is the other note pasted in. The name at the top of the card
opens the real one.

`![[shot.png]]` draws the picture, the same way a markdown `![](...)` image does
and through the same checked path — a picture is only loaded from inside the
vault.

The text in an embed is shown as text rather than re-rendered as markdown. There
is one renderer in scheda and it is the editor; a second one would eventually
disagree with the first about what a document looks like.

## What your vault decides

Read from `.obsidian/app.json`, never written:

| Setting | What it changes |
| --- | --- |
| **New link format** | Whether a written link is `[[note]]`, `[[folder/note]]` or `[[../folder/note]]` |
| **Default location for new notes** | Where a note created from a link lands |
| **Default location for new attachments** | Where a pasted picture goes |

Change them in Obsidian and scheda follows. A vault where the two programs
disagree about how to write a link is a vault somebody has to tidy up by hand,
and that somebody is you.

---
title: Markup scheda draws
description: Every piece of markdown scheda shows on screen, and what it looks like.
---

scheda draws markup **over** the source rather than instead of it, so everything
on this page is still ordinary text in the file. Nothing here changes a byte —
see [Text first, decorations over it](/scheda/concepts/decorations/) for why that
matters and [Byte for byte](/scheda/concepts/byte-for-byte/) for what it
guarantees.

## Inline

| You write | You see |
| --- | --- |
| `# Heading` | Larger, in the heading colour. Six levels. |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | A pill with a background. |
| `~~struck~~` | ~~struck~~ |
| `==highlighted==` | Highlighted, the way Obsidian writes it. |
| `[text](url)` | The text, in the accent colour; the target hides. |

The syntax markers hide on lines your cursor is not on, and come back the moment
you step onto the line. A link's target hides with its brackets — hiding one
without the other would render `[the tracker](https://example.com)` as
`the trackerhttps://example.com`, which is text you never wrote.

## Lists

```markdown
- a bullet
- another
  - nested one deeper
1. numbered
2. and so on
```

The bullet is **coloured, not hidden**: it is what makes a list read as a list.
A wrapped item hangs — its second line lines up under its own text rather than
sliding back under the bullet.

## Tasks

```markdown
- [ ] still to do
- [x] finished
```

The `[ ]` is drawn as a real checkbox, and clicking it **edits the document**:
`[ ]` becomes `[x]`, exactly as if you had typed it. That means undo puts it
back, the change is what gets saved, and nothing is remembered anywhere but the
file.

Put the cursor on the line and the brackets come back, so you can type into them
the ordinary way.

## Quotes and callouts

```markdown
> an ordinary quote

> [!warning] Careful
> the body of the callout
```

A quote carries a rule down its left edge, unbroken through a wrapped paragraph.
A quote whose first line names a kind is a **callout**: the rule and a faint tint
take that kind's colour, and the first line is set in bold.

The kinds are Obsidian's: `note`, `abstract`, `summary`, `tldr`, `info`, `todo`,
`tip`, `hint`, `important`, `success`, `check`, `done`, `question`, `help`,
`faq`, `warning`, `caution`, `attention`, `failure`, `fail`, `missing`,
`danger`, `error`, `bug`, `example`, `quote`, `cite`. Several of those are
aliases and share a colour.

A kind scheda has never heard of still renders as a callout, in the default
colour. A note written for a plugin should not lose its shape here.

## Tables

```markdown
| a | b |
| --- | --- |
| 1 | 2 |
```

The columns line up: each cell is followed by as much space as its column needs,
so the pipes stand under each other however the source was written — including
`|---|---|` with no spaces at all. The row of dashes between the header and the
body is drawn as a rule in each of its cells, so the table's shape reads at a
glance.

None of that space is in the file. It is drawn, the same way a heading is drawn
larger, and the bytes on disk are the ones you typed. Put the caret in a cell
and you are editing the text you wrote, not a grid standing in for it.

The cells are **not** laid out in a real table. That would be a rendering, and
in scheda the source is what you are editing — see
[Text first, decorations over it](/scheda/concepts/decorations/). It is also
twenty-eight times more expensive: on the largest table in the author's own
notes, lining the columns up costs 1.4 ms and rendering a table costs 39.5.

## Code

````markdown
```rust
fn main() { let x = 1; }
```
````

Fenced and indented blocks get a background and their own band. If the fence
names a language scheda carries, the code is coloured:

`javascript` (`js`, `mjs`, `cjs`, `node`, `jsx`), `typescript` (`ts`, `tsx`),
`rust` (`rs`), `python` (`py`, `python3`), `json` (`json5`, `jsonc`), `css`,
`html` (`htm`), `sql` (`postgres`, `postgresql`, `psql`, `mysql`, `sqlite`).

Anything else is left as plain text on the same background — not an error, just
uncoloured. Most grammars are fetched only when a block asks for one, so a note
with no code costs nothing and the first paint never waits for one. (HTML, CSS
and JavaScript come along with the markdown parser itself, which highlights
embedded HTML, so those three are always present.)

Extra words after the language are ignored, so ```` ```js title="example.js" ````
works.

## Rules

```markdown
---
```

Drawn as the line it stands for. The dashes keep their place in the text —
nothing is moved, which is what lets a table's columns stay aligned — and a rule
is painted through them. Put the caret on the line and they are three characters
again, like every other marker.

## Pictures

```markdown
![a diagram](assets/diagram.png)
```

The picture is drawn under the line, and the line stays where it is — it is
still the markdown you are editing.

Links are relative to the note, so `assets/diagram.png` and `../shared/logo.png`
both work. What they may reach is decided by the core: a link is resolved
against the note's root — the vault it belongs to, or its own folder if there is
no vault — and anything outside that root simply does not appear. Nor do remote
images: a note cannot load `https://…`, so it cannot report that you opened it.

A link pointing at nothing shows no picture and no broken-image icon. The line
above it already says what was meant.

## Front matter

```markdown
---
title: A note
tags: [drafts, ideas]
---
```

The fields at the top of a file fold into a single line saying how many there
are. Click it to see them, click again to fold them back; put the caret inside
and they unfold on their own, because a fold over the line you are typing into
would be in the way.

Folding is a view state and nothing else — the file is untouched, and closing the
tab forgets it.

Three dashes anywhere but the very top of a file are a horizontal rule, not
front matter.

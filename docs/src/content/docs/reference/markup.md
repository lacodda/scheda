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

The rows are tinted and the pipes are dimmed so the columns read as columns. The
cells are **not** laid out in a grid: that would be a rendering, and in scheda
the source is what you are editing.

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
uncoloured. Grammars load only when a block needs one, so a note with no code
costs nothing and the first paint never waits for one.

Extra words after the language are ignored, so ```` ```js title="example.js" ````
works.

## Rules

```markdown
---
```

The three dashes stay in the text, dimmed, with a line drawn under them.

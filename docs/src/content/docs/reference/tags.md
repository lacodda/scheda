---
title: Tags
description: Every tag in the vault and the notes carrying each, read from inline hashes and from front matter.
---

A tag is how a note says what it is about without being linked to anything. The
tags panel is the list of them across the whole vault, with the notes carrying
each — the answer to "what have I filed here, and under what".

Press `Ctrl+Shift+T` to show or hide it.

This is a vault feature. A note opened on its own has no vault whose tags could
be collected; see [The root](/scheda/concepts/the-root/) for what makes a folder
a vault.

## What the panel shows

The vault's tags, most-used first, with ties broken by name so the order does
not shuffle between readings of an unchanged vault.

Beside each tag is **how many notes carry it** — not how many times it is
written. A note that mentions the same tag in five paragraphs is one note about
it.

The tags the open note carries are marked with the accent down the left edge,
the same mark the rest of the window uses for "this one".

The panel keeps showing the whole vault even when the note you are reading has
no tags at all. That is deliberate: a note with no tags is the ordinary case,
and it is exactly the moment you are most likely to open the list.

Click a tag to see where it is carried; click a place to go to that note, at the
line the tag is on. A tag that came from the front matter has no line of its own,
so the note opens at the top.

Type in the filter box to narrow the list by name.

## What counts as a tag

scheda reads Obsidian's conventions rather than inventing its own, so a tag is
written either way:

- **inline**, as `#rust` or `#projects/scheda` in the body;
- **in the front matter**, under `tags:`. All three spellings are read —
  `tags: [a, b]`, `tags: a, b`, and a list of `- a` lines — and the leading `#`
  is optional there.

A tag may hold letters, digits, `_`, `-` and `/` for nesting, and must hold at
least one non-digit.

## What does not count

A `#` is not a tag when it is:

- **a heading.** `# Plan` is a heading, and so is `# Plan for #rust` — the whole
  line is a heading, and none of it is a tag. The rule is CommonMark's, which is
  the one the editor itself applies: a hash and then a space. `#Plan` has no
  space, so it is a tag, both here and in the text;
- **inside code.** A code span or a fenced block, so a note about shell scripts
  does not file itself under `#!/bin/sh`;
- **a colour.** `#fff` and `#d9704a` are what a note about design is full of;
- **a year.** `#2024` is all digits;
- **attached to a word.** The hash has to follow a line start or a space, which
  is what leaves the fragment in `page.md#section` and the sharp in `C#` alone.

## How it is read

The vault's notes are read when the panel is opened, and again when something on
disk changes. There is no stored index — it would be a second truth about a
folder that Obsidian writes to as well, and wrong every time a note changed
while this window was closed.

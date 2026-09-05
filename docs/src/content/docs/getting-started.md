---
title: Getting Started
description: Install scheda, open a markdown file, and see what it does to it.
---

scheda is a markdown notepad. You double-click a `.md` file, the text is on
screen, and the markup is drawn over it without hiding what you typed. When you
save, the file goes back to disk with the bytes it arrived with.

Today scheda is a notepad: tabs, find and replace, recent files, a theme, and
an installer that offers itself as the handler for `.md`. There is no file tree
and no `[[links]]` yet — those arrive with the vault. What is already here is
the part everything else depends on: a file that opens fast and comes back
unharmed.

## Install

Download the build for your platform from the
[releases page](https://github.com/lacodda/scheda/releases) and run it. The
Windows installer registers scheda as a markdown handler, so it shows up under
*Open with* — see [Opening .md with scheda](/scheda/reference/file-associations/)
for how to make it the default.

Building from source needs [Rust](https://rustup.rs/), Node 22 and pnpm:

```sh
git clone https://github.com/lacodda/scheda
cd scheda
pnpm install
pnpm tauri build
```

## Open a file

Three ways, all of them equivalent:

- pass a path when starting scheda: `scheda notes.md`
- press `Ctrl+O` and pick one
- drop a file onto the window

Passing the path on the command line is the fastest of the three, and not by a
little: the core reads the file before the window exists, so the text is in
hand by the time there is somewhere to put it.

## Edit and save

Type. `Ctrl+S` saves; on a file that has never been saved it asks where to put
it. `Ctrl+Z` and `Ctrl+Y` undo and redo.

The markup you write is drawn as you write it. A `# heading` becomes a heading,
`**bold**` becomes bold — and the `#` and the `**` stay in the file, visible
whenever your cursor is on their line. Move away and they step back; move back
and they return, because they are what you are editing.

## What it will not do to your file

scheda writes back what it read:

- **Line endings** stay as they were, including a file that mixes CRLF and LF
  line by line.
- **A byte-order mark** stays present, or stays absent.
- **A missing trailing newline** stays missing.
- **A file that is not UTF-8** opens read-only rather than being guessed at and
  saved back as something else.

Opening a file and saving it without an edit produces the same bytes. That is
checked on every build against a corpus of deliberately awkward files — see
[Byte for byte](/scheda/concepts/byte-for-byte/).

## Where scheda keeps its own things

Nowhere near your files. Settings and, later, the index and the session live in
the application's data directory. scheda never writes into a folder you opened,
and it never writes `.obsidian/`.

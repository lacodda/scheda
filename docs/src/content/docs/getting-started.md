---
title: Getting Started
description: Install scheda, open a markdown file, and see what it does to it.
---

scheda is a markdown notepad. You double-click a `.md` file, the text is on
screen, and the markup is drawn over it without hiding what you typed. When you
save, the file goes back to disk with the bytes it arrived with.

Open a single file and scheda is a notepad. Open a folder, or a note inside an
Obsidian vault, and the same window grows a file tree, `[[links]]` between
notes, tags and search across them. Underneath both is the part everything else
depends on: a file that opens fast and comes back unharmed.

## Install

One command, on Windows in PowerShell:

```powershell
irm https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.ps1 | iex
```

and on macOS (Apple silicon) or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.sh | sh
```

Run it again to update. It installs for your account only and needs no
administrator. On Windows it registers scheda as a handler for markdown, so it
shows up under *Open with*; on Linux it adds scheda to the applications menu with
the same offer. See [Opening .md with scheda](/scheda/reference/file-associations/)
for making it the default. On macOS and Linux it also puts `scheda` in
`~/.local/bin`, for [the command line](/scheda/reference/the-command-line/).

To install a particular release, set `SCHEDA_VERSION` to its tag (`vX.Y.Z`)
before running the command.

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

## Open a folder

A folder of markdown is a vault as soon as you open it - Obsidian need never
have seen it:

- pass it when starting scheda: `scheda ~/notes`
- press `Ctrl+K` then `Ctrl+O`, or run *File: Open folder* from `Ctrl+Shift+P`
- drop the folder onto the window

The window shows the folder: the tree of its files, and the notes you opened in
it lately. `Ctrl+P` finds a note in it by name, `Ctrl+Shift+F` searches its
text, and `[[links]]` between its notes resolve. scheda writes nothing into the
folder to remember it - see [the root](/scheda/concepts/the-root/).

## Edit and save

Type. `Ctrl+S` saves; on a file that has never been saved it asks where to put
it. `Ctrl+Z` and `Ctrl+Y` undo and redo.

The markup you write is drawn as you write it. A `# heading` becomes a heading,
`**bold**` becomes bold — and the `#` and the `**` stay in the file, visible
whenever your cursor is on their line. Move away and they step back; move back
and they return, because they are what you are editing.

Lists, tasks, quotes, callouts, tables and fenced code are drawn too — see
[Markup scheda draws](/scheda/reference/markup/) for the whole list.

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

Nowhere near your files. Settings, unsaved drafts and the index of a vault live
in the application's data directory - see
[What scheda keeps](/scheda/reference/what-scheda-keeps/). scheda never writes
its own files into a vault, and it never writes `.obsidian/`.

## Where next

- [Make scheda your markdown editor](/scheda/guides/make-it-the-default/), so a
  double-click opens it.
- [Work in a folder of notes](/scheda/guides/work-in-a-folder/), with or
  without Obsidian.
- [Work in an Obsidian vault](/scheda/guides/work-in-an-obsidian-vault/), beside
  Obsidian.
- [Keyboard](/scheda/reference/keyboard/), for everything one key does.

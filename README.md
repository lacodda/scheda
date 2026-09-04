# scheda

**A markdown notepad that turns into a vault when there is a folder around it.**

Double-click a `.md` file and the text is on screen before you notice the window. Headings, emphasis, code and links are drawn over the source as you type; the source itself never changes shape. Open a folder — or a file inside an Obsidian vault — and the same window grows a file tree, `[[wikilinks]]`, backlinks and search. Close it and the folder is exactly as you found it.

> **Status: founded, no release yet.** The plan is fixed and the first stage is a cold-start measurement with a hard threshold — see [Roadmap](#roadmap). Nothing to install until `v0.1.0`.

## Why another editor

- **Obsidian** is built around a vault. Opening a stray file, reading it and closing it is not what it is for, and it is heavy.
- **VS Code** is a code editor with markdown as an afterthought, and it is heavy too.
- **Notepad** is instant and understands nothing.

scheda is the notepad with a lean towards markdown: the speed of the third, the reading comfort of the first, and no workspace to set up before the text appears.

## What it will do

- **Open anything, instantly.** A file from the command line, from a dialog, from a drop. Bytes are on screen before anything else initialises.
- **Show markdown without hiding the source.** Decorations over the text — markers appear on the active line and step back elsewhere. Not WYSIWYG: the source is the truth and round-trips byte for byte.
- **Save exactly what you opened.** Line endings, BOM, trailing newline — preserved. Opening and saving without an edit is a no-op, and a test proves it on every build.
- **Become a vault by walking up.** A file's folder is its root; an `.obsidian/` directory above it moves the root there; an explicitly opened folder is the root. Tree, quick switcher, `[[links]]`, backlinks and full-text search follow from the root.
- **Leave the vault clean.** The index, the session and the settings live in the application's own data directory. scheda reads Obsidian's conventions and writes none of its files.
- **Reach a second machine, then a phone.** Sync arrives after 1.0 through [efema](https://github.com/lacodda/efema), a relay that cannot read what it carries; the Android build is a replica of the vault, not a folder on the phone.

## Roadmap

| Version | Promise |
| --- | --- |
| 0.1 | A file on screen: open, decorate, save byte for byte. Cold start measured against a 0.5 s threshold — miss it and the stack is reconsidered before anything else is built. |
| 0.2 | **The notepad.** Windows installer, file associations, tabs, recent files, find and replace, themes. This is the first version meant to replace Notepad. |
| 0.3 – 0.7 | Full markup, reading mode, the vault root rule, links and backlinks, search and index, sessions and a command palette. |
| 1.0 | Desktop complete; the index and settings formats are frozen. |
| 1.x | Sync between desktops via efema, then the Android replica. |

## Built with

[Tauri v2](https://v2.tauri.app/) · Rust · [CodeMirror 6](https://codemirror.net/) · React

Architecture decisions live in [docs/adr](https://github.com/lacodda/scheda/tree/main/docs/adr).

## License

MIT

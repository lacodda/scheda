<img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/banner.svg" alt="scheda" width="720">

# scheda

**A markdown notepad that turns into a vault when there is a folder around it.**

Double-click a `.md` file and the text is on screen before you notice the window. Headings, emphasis, code and links are drawn over the source as you type; the source itself never changes shape. Open a folder — or a file inside an Obsidian vault — and the same window grows a file tree, `[[wikilinks]]`, backlinks and search. Close it and the folder is exactly as you found it.

> **Status: `v0.2.2` — the notepad.** Windows installer, file associations, tabs in the window's own title bar, find and replace, recent files, themes. Enough to replace Notepad for markdown. The file tree and `[[links]]` come next; see the [roadmap](#roadmap).

<img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/screenshot.png" alt="scheda showing a markdown file with headings, emphasis and inline code drawn over the source" width="880">

## Why another editor

- **Obsidian** is built around a vault. Opening a stray file, reading it and closing it is not what it is for, and it is heavy.
- **VS Code** is a code editor with markdown as an afterthought, and it is heavy too.
- **Notepad** is instant and understands nothing.

scheda is the notepad with a lean towards markdown: the speed of the third, the reading comfort of the first, and no workspace to set up before the text appears.

## What it does today

- **Opens instantly.** A file from a double-click, from the command line, from `Ctrl+O`, from a drop on the window. The core reads it before the window exists, so the text is in hand by the time there is somewhere to put it — 440 ms from process start to the first character on screen, measured, against a 500 ms gate.
- **Shows markdown without hiding the source.** Headings, emphasis, code and links are drawn over the text. Their syntax markers step back on lines you are not editing and return the moment the cursor arrives. Not WYSIWYG: the source is the document.
- **Saves exactly what it opened.** Line endings — including a file that mixes CRLF and LF line by line — a byte-order mark, and a missing trailing newline all survive. A file that is not UTF-8 opens read-only rather than being guessed at. A corpus of deliberately awkward files proves it on every build, and the owner's own vault of 5000 notes is checked before every release.
- **Holds several files at once.** Tabs with their own undo history, in the window's own title bar rather than a band of their own — one strip of screen instead of two. A second launch hands its file to the window you already have instead of opening another one.
- **Finds and replaces.** `Ctrl+F`, with every match highlighted and the current one standing apart.
- **Remembers.** The files you last opened, shown on an empty window. Theme, font size and column width in a settings file — in the application's own directory, never in the folder you opened.
- **Says what it is holding.** The status bar reports the line endings and the encoding it will write, before you save.

## What it will do

- **Become a vault by walking up.** A file's folder is its root; an `.obsidian/` directory above it moves the root there; an explicitly opened folder is the root. Tree, quick switcher, `[[links]]`, backlinks and full-text search follow from the root.
- **Leave the vault clean.** The index, the session and the settings live in the application's own data directory. scheda reads Obsidian's conventions and writes none of its files.
- **Reach a second machine, then a phone.** Sync arrives after 1.0 through [efema](https://github.com/lacodda/efema), a relay that cannot read what it carries; the Android build is a replica of the vault, not a folder on the phone.

## Roadmap

| Version | Promise |
| --- | --- |
| 0.1 | **Released.** A file on screen: open, decorate, save byte for byte. Cold start measured at 440 ms against the 0.5 s threshold. |
| 0.2 | **Released.** The notepad: installer, file associations, tabs in a custom title bar, recent files, find and replace, themes. |
| 0.3 – 0.7 | Full markup, reading mode, the vault root rule, links and backlinks, search and index, sessions and a command palette. |
| 1.0 | Desktop complete; the index and settings formats are frozen. |
| 1.x | Sync between desktops via efema, then the Android replica. |

## Install

Grab the build for your platform from the [releases page](https://github.com/lacodda/scheda/releases). The Windows installer registers scheda as a markdown handler — it appears under *Open with*, and making it the default is one click in Settings, because Windows does not let a program take that decision for you.

Building from source needs Rust, Node 22 and pnpm:

```sh
pnpm install
pnpm tauri build
```

Full documentation is at [lacodda.github.io/scheda](https://lacodda.github.io/scheda/).

## Built with

[Tauri v2](https://v2.tauri.app/) · Rust · [CodeMirror 6](https://codemirror.net/) · React

Architecture decisions live in [docs/adr](https://github.com/lacodda/scheda/tree/main/docs/adr).

## License

MIT

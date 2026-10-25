<p align="center"><img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/banner.svg" alt="scheda - a markdown notepad that grows into a vault" width="720"></p>

> Double-click a `.md` file and the text is on screen before you notice the window. Inside an Obsidian vault, the same window grows a file tree and links between notes.

<p align="center">
  <a href="https://github.com/lacodda/scheda/releases/latest"><img src="https://img.shields.io/github/v/release/lacodda/scheda?style=flat-square" alt="Release"></a>
  <a href="https://github.com/lacodda/scheda/actions"><img src="https://img.shields.io/github/actions/workflow/status/lacodda/scheda/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://github.com/lacodda/scheda/blob/main/LICENSE"><img src="https://img.shields.io/github/license/lacodda/scheda?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lacodda/scheda/main/assets/screenshot-dark.png">
    <img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/screenshot.png" alt="scheda with a note of a sample vault open: headings, a callout, a table and a task list drawn over the source, the file tree and the outline beside it" width="880">
  </picture>
</p>

## Why

Opening one markdown file should not be a project. **Obsidian** is built around
a vault, so reading a stray note and closing it is not what it is for - and it
is heavy. **VS Code** is a code editor with markdown as an afterthought, and
heavy too. **Notepad** is instant and understands nothing.

scheda is the notepad with a lean towards markdown: the speed of the third, the
reading comfort of the first, and no workspace to set up before the text
appears. The core reads the file before the window exists, and nothing but the
text is loaded ahead of it - 440 ms from start to the first character, measured.

## What you get

- **Markup drawn over the source, never instead of it.** The markers step back
  on lines you are not editing; the source stays the document.
- **Saved exactly as opened.** Line endings, a byte-order mark, a missing final
  newline - byte for byte, including a file that mixes CRLF and LF.
- **Your Obsidian vault, read the way Obsidian writes it.** A file tree,
  `[[links]]`, backlinks, tags and search - and nothing of scheda's in the vault.
- **Renames and replaces you check first.** Every line they would change is
  listed before a byte is written, and one click puts it all back.
- **A notepad's habits.** Tabs in the title bar, a split, drafts that outlive
  the window, and `Win+Shift+N` for a quick note from any program.
- **Every command under one key.** `Ctrl+Shift+P` finds any of them by name,
  and any key can be changed.

## Install

```powershell
irm https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.ps1 | iex   # Windows
```

```sh
curl -fsSL https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.sh | sh   # macOS (Apple silicon), Linux
```

The same command updates an installed scheda. It installs for your account
only, needs no administrator, and offers scheda as a handler for markdown - it
appears under *Open with*, and making it the default stays your choice.

## Status

v0.18.0. Everything above works on Windows, where every release is run live
before it ships; the macOS and Linux builds come out of the same CI. What scheda
keeps is in frozen, numbered formats, and each release is checked against a
5000-note vault, byte for byte. [CHANGELOG](https://github.com/lacodda/scheda/blob/main/CHANGELOG.md).

## Documentation

**[lacodda.github.io/scheda](https://lacodda.github.io/scheda/)** - getting
started, guides for the everyday jobs, every key and setting, and why a file is
saved byte for byte. Decisions are in
[`docs/adr`](https://github.com/lacodda/scheda/tree/main/docs/adr); the editor
is also a package for any CodeMirror 6 program,
[`@lacodda/scheda-editor`](https://lacodda.github.io/scheda/editor-package/).
Building it yourself:
[CONTRIBUTING.md](https://github.com/lacodda/scheda/blob/main/CONTRIBUTING.md).

## License

MIT (c) [Kirill Lakhtachev](https://lacodda.com)

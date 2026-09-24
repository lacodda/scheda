<p align="center"><img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/banner.svg" alt="scheda - a markdown notepad that grows into a vault" width="720"></p>

> Double-click a `.md` file and the text is on screen before you notice the window. Open a folder around it and the same window grows a file tree and links between notes.

<p align="center">
  <a href="https://github.com/lacodda/scheda/releases/latest"><img src="https://img.shields.io/github/v/release/lacodda/scheda?style=flat-square" alt="Release"></a>
  <a href="https://github.com/lacodda/scheda/actions"><img src="https://img.shields.io/github/actions/workflow/status/lacodda/scheda/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://github.com/lacodda/scheda/blob/main/LICENSE"><img src="https://img.shields.io/github/license/lacodda/scheda?style=flat-square" alt="License"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/screenshot.png" alt="scheda showing a markdown file with headings, emphasis and inline code drawn over the source" width="880"></p>

## Why

Opening one markdown file should not be a project. **Obsidian** is built around
a vault, so reading a stray note and closing it is not what it is for - and it
is heavy. **VS Code** is a code editor with markdown as an afterthought, and
heavy too. **Notepad** is instant and understands nothing.

scheda is the notepad with a lean towards markdown: the speed of the third, the
reading comfort of the first, and no workspace to set up before the text
appears. 440 ms from process start to the first character on screen, measured
against a 500 ms gate on every build.

## What you get

- **Markdown shown without hiding the source.** Headings, emphasis, code and
  links are drawn over the text; the syntax markers step back on lines you are
  not editing. Not WYSIWYG - the source is the document.
- **Saved exactly as opened.** Line endings, a byte-order mark, a missing
  trailing newline - all survive, including a file that mixes CRLF and LF line
  by line. A file that is not UTF-8 opens read-only rather than being guessed
  at.
- **A vault when there is one.** A folder - or a file inside an Obsidian vault -
  brings a file tree and `[[wikilinks]]`. Close it and the folder is exactly as
  you found it.
- **Links that lead somewhere.** `[[a note]]` resolves against the whole vault
  the way Obsidian resolves it, completes as you type, and shows the note's
  opening when you hover it. A link to a note you have not written yet offers to
  write it. `![[embeds]]` show the picture or the note's first lines.
- **Both directions of a link.** A panel shows which notes point at the one you
  are reading, and which of your links point at nothing yet. Rename a note and
  scheda lists every link that would break, line by line, before it rewrites a
  single one - and puts it all back if you change your mind.
- **Every tag in the vault, in one list.** Read from `#inline` hashes and from
  front matter, counted by notes rather than by mentions, with the tags of the
  note you are reading marked. A heading, a colour and a fragment are not tags,
  which is most of what a tag panel gets wrong.
- **Search the whole vault, and replace with a preview.** `Ctrl+Shift+F` finds
  a word, a whole word or a pattern in every note, narrowed by `#tag` or a
  front-matter field. Replacing lists every match with a box beside it and
  writes only what you leave ticked - byte for byte everywhere else.
- **Diagrams while reading.** A `mermaid` block is code while you write it and
  the diagram while you read.
- **Room to write.** Focus mode fades everything but the section you are in; the
  status bar counts words and minutes to read. Front matter opens as a form that
  writes the YAML for you, tables take `Tab` and `Enter`, sections move by
  dragging their heading, and a note prints or saves as one HTML file.
- **Tabs in the title bar**, with their own undo history, so one strip of screen
  does the work of two. A second launch hands its file to the window you have.
- **A draft you never named.** `Ctrl+N` opens a tab with no file; its text
  survives closing the window - written to scheda's own directory, never into
  your vault.
- **Screenshots straight into a note.** `Ctrl+V` writes the picture into the
  vault's attachment folder and links it, reading where that is from the
  vault's own `.obsidian/app.json` so scheda and Obsidian never disagree.
- **Honest about the folder changing under you.** A note edited elsewhere is
  picked up; if you had unsaved edits to the same file, scheda asks and names
  both versions rather than calling either one right. If the bytes came back
  identical it says nothing, because nothing happened.

## Install

Grab the build for your platform from the
[latest release](https://github.com/lacodda/scheda/releases/latest): `.msi` or
`.exe` for Windows, `.dmg` for macOS, `.AppImage`, `.deb` or `.rpm` for Linux.

The Windows installer registers scheda as a markdown handler - it appears under
*Open with*, and making it the default is one click in Settings, because
Windows does not let a program take that decision for you.

## Status

v0.10.0, in daily use. Everything above works, including file management from
the tree - into the recycle bin, never an unlink - folder watching, use as
`$EDITOR`, and an index of the vault kept in scheda's own directory and checked
against the disk on every open. Checked on every build against a corpus of deliberately awkward
files, and against the owner's own 5000-note vault before release. What landed
in each version:
[CHANGELOG](https://github.com/lacodda/scheda/blob/main/CHANGELOG.md).

## Documentation

**[lacodda.github.io/scheda](https://lacodda.github.io/scheda/)** - the
keyboard, the markup it draws, settings, file associations, and why a file is
saved byte for byte. Architecture decision records are in
[`docs/adr`](https://github.com/lacodda/scheda/tree/main/docs/adr).

Building it yourself:
[CONTRIBUTING.md](https://github.com/lacodda/scheda/blob/main/CONTRIBUTING.md).

## License

MIT (c) [Kirill Lakhtachev](https://lacodda.com)

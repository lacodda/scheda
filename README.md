<img src="https://raw.githubusercontent.com/lacodda/scheda/main/assets/banner.svg" alt="scheda" width="720">

# scheda

**A markdown notepad that turns into a vault when there is a folder around it.**

Double-click a `.md` file and the text is on screen before you notice the window. Headings, emphasis, code and links are drawn over the source as you type; the source itself never changes shape. Open a folder — or a file inside an Obsidian vault — and the same window grows a file tree, `[[wikilinks]]`, backlinks and search. Close it and the folder is exactly as you found it.

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
- **Manages the files in front of you.** Make, rename and remove notes and folders from the tree. Deleting goes to the recycle bin, never straight out; a rename carries the open tab with it; a refusal from the filesystem says which file and what is wrong, not an error number.
- **Keeps a draft you never named.** `Ctrl+N` opens a tab with no file. Text in it survives closing the window and comes back next launch — written to scheda's own directory, never into your vault. Unsaved edits to a *named* file are not shadowed anywhere: one copy of every note, in the vault where you put it.
- **Takes a screenshot straight into a note.** `Ctrl+V` writes the picture into the vault's attachment folder and links it. Which folder that is comes from `attachmentFolderPath` in the vault's own `.obsidian/app.json`, so scheda and Obsidian never disagree about where pictures live.
- **Keeps up with the folder.** A note edited in Obsidian or arriving from a sync client is picked up in the tree and in the open tab. If you had unsaved edits to the same file, scheda asks — naming both versions and calling neither the right one. If the file came back identical, it says nothing, because nothing happened.
- **Goes to a file by name.** `Ctrl+P`, matching letters that need not be adjacent, ordered so that initials and whole words win over letters that merely happen to be in the name. The letters that matched are shown, so you can see why a row is in the list.
- **Works as your `$EDITOR`.** `scheda --wait notes.md` returns when the tab closes, with an exit code that tells the caller whether the edit happened. `export EDITOR="scheda --wait"` and `git commit` opens here.
- **Hands the note to Obsidian.** A button in the title bar opens the file you are looking at over there, where the graph and the plugins are. It adds; it takes nothing away.
- **Says what it is holding.** The status bar reports the line endings and the encoding it will write, before you save.

## Install

Grab the build for your platform from the [releases page](https://github.com/lacodda/scheda/releases). The Windows installer registers scheda as a markdown handler — it appears under *Open with*, and making it the default is one click in Settings, because Windows does not let a program take that decision for you.

Building from source needs Rust, Node 22 and pnpm:

```sh
pnpm install
pnpm tauri build
```

Full documentation is at [lacodda.github.io/scheda](https://lacodda.github.io/scheda/). Architecture decisions live in [docs/adr](https://github.com/lacodda/scheda/tree/main/docs/adr).

## Status

`v0.6.0`: everything under "What it does today" works, including file management from the tree — into the recycle bin, never an unlink — folder watching with an honest question on conflicting edits, and use as `$EDITOR`. Checked on every build against a corpus of deliberately awkward files, plus the owner's own 5000-note vault before release. See the [CHANGELOG](https://github.com/lacodda/scheda/blob/main/CHANGELOG.md) for what landed in each version.

## License

MIT

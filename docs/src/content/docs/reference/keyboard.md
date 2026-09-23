---
title: Keyboard
description: Every shortcut scheda responds to.
---

## Files and tabs

| Keys | What it does |
| --- | --- |
| `Ctrl+O` | Open a file — focuses the tab already showing it, if there is one |
| `Ctrl+N` | New draft — a tab with no file, kept until you close it |
| `Ctrl+S` | Save; asks where on a file that has never been saved |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+W` | Close the tab, asking first if it holds unsaved work |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next or previous tab, wrapping at the ends |
| `Ctrl+P` | Go to a file by name — see [Going to a file](/scheda/reference/going-to-a-file/) |

Dropping files on the window opens them, and launching scheda again with a file
adds it to the window you already have rather than opening a second one.

A draft with text in it survives closing the window and comes back as a tab next
time. Closing its tab discards it. See
[Working with files](/scheda/reference/files/).

## The window

scheda draws its own title bar, so the tabs live in it rather than in a band of
their own — that is one strip of screen instead of two.

| Gesture | What it does |
| --- | --- |
| Drag the bar | Moves the window, including the snap gestures at the screen edges |
| Double-click the bar | Maximise, or restore a maximised window |
| Drag an edge or corner | Resizes |

The buttons at the right end are the usual three. Closing goes through the same
unsaved-work check as `Ctrl+W` and the system's own close.

## Reading

| Keys | What it does |
| --- | --- |
| `Ctrl+E` | Reading mode on or off |

In reading mode every syntax marker hides — including on the line the caret is
on, which is the one difference from editing — and the document refuses changes.
Not a preview pane: it is the same view with two things switched, so what you
read is what you were just editing. A ```` ```mermaid ```` block is drawn as its
diagram while reading and is code again when you go back — see
[Markup](/scheda/reference/markup/#diagrams).

## Getting around a long note

| Keys | What it does |
| --- | --- |
| `Ctrl+Shift+E` | Show or hide the file tree |
| `Ctrl+Shift+O` | Show or hide the outline |
| `Ctrl+Shift+B` | Show or hide what links here |
| `Ctrl+Shift+T` | Show or hide the tags of the vault |
| `Ctrl+Shift+[` | Fold the section the caret is in |
| `Ctrl+Shift+]` | Unfold it |
| `Ctrl+Alt+[` / `Ctrl+Alt+]` | Fold or unfold every section |

Right-clicking a row of the tree makes, renames or removes files — see
[Working with files](/scheda/reference/files/).

The file tree appears only when the open document is inside a vault — a folder
with `.obsidian/` somewhere above it. A note opened on its own stays a note:
there is no tree of the Desktop beside a Desktop file. Opening the tree opens
the branch holding the document and marks it, so you can see where you are;
clicking a file opens it in a tab.

The outline lists the document's headings, indented by level; clicking one puts
the caret at that heading. It is hidden until you ask for it — most notes have
three headings or none, and a sidebar that is always there is not a notepad.

A folded section shows `⋯` in place of what it holds. There is no arrow column
beside the text: folding is a thing you do now and then, and a permanent strip
for it costs more than it gives.

## Links between notes

| Keys | What it does |
| --- | --- |
| Click a link, or `Enter` on a focused one | Opens the note it points at |
| `[[` then letters | Offers the notes that match, ranked like `Ctrl+P` |
| `#` inside a link | Offers that note's headings; `[[#` offers this note's |
| `Ctrl+Space` | Opens the list on a bare `[[`, before anything is typed |
| `Enter` | Takes the highlighted note |
| `Escape` | Closes the list |

Following a link to a note that does not exist yet offers to create it. See
[Links between notes](/scheda/reference/links/).

## Finding

| Keys | What it does |
| --- | --- |
| `Ctrl+F` | Find in this note, with replace in the same panel |
| `Enter` / `Shift+Enter` | Next or previous match |
| `Escape` | Close the panel |
| `Ctrl+Shift+F` | Search every note in the vault |
| `Ctrl+Shift+H` | Search and replace across the vault, with a preview |
| `Escape` in the vault search | Close it and return to the note |

Matches are highlighted as you type, and the one you are on stands apart from
the rest. The vault search, its filters and what replacing across notes will and
will not do are on [Searching the vault](/scheda/reference/search/).

## Editing

| Keys | What it does |
| --- | --- |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select all |
| `Ctrl+V` with a picture on the clipboard | Writes it into the vault's attachment folder and links it |
| `Ctrl+Home` / `Ctrl+End` | Jump to the start or end of the document |
| `Home` / `End` | Jump to the start or end of the line |

### In a list

| Keys | What it does |
| --- | --- |
| `Enter` | Continues the list, the numbering or the quote you are in |
| `Enter` on an empty item | Ends the list |
| `Tab` / `Shift+Tab` | Moves the item a level deeper or shallower |
| `Backspace` on an empty item | Takes the marker off, leaving the indent; again removes that |

Numbering counts up on its own, and a finished task continues as an unfinished
one — `- [x]` followed by another `- [x]` would claim work nobody did.

Outside a list none of this applies: `Tab` in a paragraph is a tab.

Undo history belongs to the tab, so switching away and back does not lose it.

Text editing beyond this is CodeMirror's default keymap: word-wise movement
with `Ctrl+←` and `Ctrl+→`, line deletion with `Ctrl+Shift+K`, and the usual
selection modifiers.

A command palette arrives in a later version; see the
[changelog](https://github.com/lacodda/scheda/blob/main/CHANGELOG.md) for what
each version brought.

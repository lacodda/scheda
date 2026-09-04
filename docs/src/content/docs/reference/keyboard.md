---
title: Keyboard
description: Every shortcut scheda responds to.
---

## Files and tabs

| Keys | What it does |
| --- | --- |
| `Ctrl+O` | Open a file — focuses the tab already showing it, if there is one |
| `Ctrl+N` | New empty tab |
| `Ctrl+S` | Save; asks where on a file that has never been saved |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+W` | Close the tab, asking first if it holds unsaved work |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next or previous tab, wrapping at the ends |

Dropping files on the window opens them, and launching scheda again with a file
adds it to the window you already have rather than opening a second one.

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

## Finding

| Keys | What it does |
| --- | --- |
| `Ctrl+F` | Find, with replace in the same panel |
| `Enter` / `Shift+Enter` | Next or previous match |
| `Escape` | Close the panel |

Matches are highlighted as you type, and the one you are on stands apart from
the rest.

## Editing

| Keys | What it does |
| --- | --- |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select all |
| `Ctrl+Home` / `Ctrl+End` | Jump to the start or end of the document |
| `Home` / `End` | Jump to the start or end of the line |

Undo history belongs to the tab, so switching away and back does not lose it.

Text editing beyond this is CodeMirror's default keymap: word-wise movement
with `Ctrl+←` and `Ctrl+→`, line deletion with `Ctrl+Shift+K`, and the usual
selection modifiers.

A command palette and search across a whole folder arrive in later versions;
see the [roadmap](https://github.com/lacodda/scheda#roadmap).

---
title: Tabs, panes and the session
description: Two notes side by side, pinned tabs, and a window that opens the way you left it.
---

## The strip

Every open document has a tab in the title bar. Click to show it, middle-click
to close it, drag it along the strip to put it somewhere else. Right-click for
its menu:

| Item | What it does |
| --- | --- |
| Pin / Unpin | A pinned tab stands first, shows a pin instead of a close button, and is left alone by *Close others* and *Close all* |
| Open beside | Splits the window with this tab in the second pane |
| Move to the other pane | When the window is already split |
| Close | The same as `Ctrl+W` |
| Close others / Close all | Leave pinned tabs alone; one question lists every tab with unsaved work |

`Ctrl+W` still closes a pinned tab: pinning protects it from the bulk closes and
from a stray click, not from asking.

## Two notes side by side

`Ctrl+\` splits the window. The second pane shows the tab you were in before
the current one — the plan beside the diary you just switched from — and the
keyboard stays where it was. `Ctrl+\` again closes the split, keeping the pane
you are typing in.

Dragging a tab down onto the right half of the text opens it there; dragging it
onto a pane when the window is already split puts it in that pane, and a tab
that was in the other pane changes places with the one it lands on.

| Keys | What it does |
| --- | --- |
| `Ctrl+\` | Split the window, or close the split |
| `Ctrl+1` / `Ctrl+2` | The keyboard to the first or the second pane |

There is one strip for both panes. The tab the keyboard is in has the accent
line; the tab in the other pane has a quiet grey one. A tab is shown in one pane
at a time: choosing a tab that is already in the other pane moves the keyboard
there rather than opening a second copy of the same note. Everything that acts
on "the note" — saving, the status bar, the outline, printing — acts on the pane
with the keyboard.

Each tab keeps its own undo history, caret and scroll position, through switches
and through moves between panes.

## The session

Closing the window remembers what it had open: the tabs in their order, which
are pinned, where the caret was in each, how far each was scrolled, whether the
window was split, and the folder it had open. The next launch puts it back -
with no file in front, if there was none: a folder's own empty window comes back
as itself, tree and all.

- **Launched with nothing**, scheda reads the note that was in front before the
  window appears — the first frame already shows it — and the other tabs come
  back a moment later.
- **Launched with a file** — a double-click on a `.md` — that file is in front,
  and the session comes back behind it.
- **Launched with a folder** — `scheda ~/notes` — that folder is the window's
  and in front, and the session comes back behind it.
- A file that has gone since is left out without a word. Drafts with no file
  come back in their places.

The session is kept in scheda's own directory, beside the settings
(`session.json`), never in a vault. It is written a moment after the window
settles and once more as it closes. Where exactly, and what an older or newer
version of scheda does with it, is in [What scheda keeps](/scheda/reference/what-scheda-keeps/).

## Recent files

`Ctrl+P` with nothing typed lists the files you opened lately first, from every
vault and from none, then the files of the current vault. Once you type, the
vault's matches lead and recent files from outside it follow — a note on the
Desktop is still a few letters away.

*Tab: Reopen closed* in the command palette opens the last tab you closed. It
has no key by default — assign one in the settings.

# 0012 — Two panes share one strip, and a tab is in one of them

Accepted, 2026-09-30.

## Context

v0.12.0 puts two files side by side: the plan and the diary, a note and the
note it links to. Every editor that does this has had to answer three
questions — where the second pane's tabs live, whether one file can be open in
both panes, and what "the active document" means once there are two.

The first answer scheda cannot copy from anyone. Its tab strip *is* the title
bar (ADR 0010): a second group of tabs needs a second strip, and the product
spent v0.2 removing one.

The second is about the document model. A tab's `EditorState` holds its text,
its undo history and its caret; one `EditorView` shows one state. Showing a
file in two views means two states, and two states of one file are two copies
that disagree from the first keystroke — which the product does not allow
anywhere else (ADR 0002).

## Decision

- **One strip for the window.** Every tab is in it, in one order, pinned tabs
  first. The panes do not own tabs; each pane *shows* one.
- **A tab is shown in at most one pane.** Choosing a tab that is in the other
  pane moves the keyboard there instead of opening a copy. Dragging a tab onto
  the pane that shows another swaps the two.
- **Each pane has its own view; tabs keep their states.** Moving a tab between
  panes moves its state, so its undo history, caret and scroll go with it.
- **"Active" means the pane with the keyboard.** Everything that acts on "the
  note" — the status bar, the panels, save, print, the commands — acts on the
  tab in the focused pane. The strip marks it with the accent line and the
  other pane's tab with a quiet one.
- **Window properties stay window properties.** Focus mode, spelling, bracket
  closing and autosave apply to both panes; a new pane reads them the way a new
  tab does.
- **At most two panes, side by side.** The case asked for is two notes at once;
  a grid is a different product.

## Consequences

- The same note cannot be read in two places at once — scrolling the top of a
  long note while writing its end. Worth reconsidering only if asked for, and
  then as one state shown in two views, not two states.
- The editor handle's `view` is now "the focused pane's view". Code that must
  reach both (window properties, a reload of a tab shown in the other pane)
  asks for `views()` or the pane showing the tab.
- A closed pane's tab stays in the strip; closing the last tab a pane can show
  closes the pane rather than leaving it empty.

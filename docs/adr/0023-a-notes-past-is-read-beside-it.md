# 0023 — A note's past is read beside it

Accepted, 2026-11-06.

## Context

A note in a git repository has a history that scheda could not show: what changed
it, when, and what it said then. furca-core reads that in process through
gitoxide, with `file_log` (from `HEAD` down the first parents, following renames),
`file_at` (a blob's bytes) and `changes`/`diff`.

Showing a past version raises a question the window has answered for every other
document: what is it? A tab is a document that can be edited and saved, has a path
every panel takes as the note in front, is filed as a draft when it has no path, and
comes back with the session. A past version is none of those, and a tab with a kind
would have to be told apart at each of those places.

## Decision

- **furca-core reads; scheda runs no `git`.** Nothing here writes to a repository
  and nothing of scheda's reaches one (ADR 0003). A repository is opened afresh for
  each question, after the panel is opened (ADR 0001); nothing about git is part of
  a launch.
- **A repository is looked for by a `.git` going up from the note**, separately from
  opening it: the error from opening says the same for no repository and for a
  damaged one, and only the first is an ordinary answer.
- **The core answers in text**: a past version is decoded by `document::decode`, the
  rule that reads a file off the disk, and one that is not UTF-8 is refused in words.
- **A past version is a pane of its own, not a tab.** It is drawn beside the panes
  of the tabs, in the same editor in reading mode, with the note's path for its links
  and pictures. It belongs to the panel: it goes when the panel closes or another
  note comes to the front. So the panels stay on the note, nothing is drafted or
  remembered, and there is no second way of being a document.
- **Going down the list with the pane open follows it**, since that is what reading
  a note's past is. The lines a commit changed are read when its row is opened: a
  list of two hundred commits is one question, and those would be two hundred.

## Consequences

- Restoring a past version is a copy from the pane for now, on the window's terms:
  the text goes in as an edit, under the note's undo.
- The panel lists 200 changes and draws 2000 lines of one, and says so past either.
- The list is re-read when the window comes back, since a commit made in a terminal
  says nothing to the vault.
- A release grows by what gitoxide weighs, and the launch by nothing: it is linked,
  and not called until the panel opens.

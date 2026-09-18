# 8. A link is resolved by the core, against the vault's own settings

Date: 2026-09-18

## Status

Accepted. Follows from [ADR 0001](0001-a-rust-core-behind-a-web-editor.md) and
[ADR 0003](0003-the-vault-stays-clean.md).

## Context

`[[wikilinks]]` are how notes in a vault point at each other, and scheda had to
answer three questions about them: where one leads, what to write when somebody
types a new one, and where the note goes when the link names one that does not
exist yet.

None of the three is local to the text on screen. Obsidian resolves `[[plan]]`
against the *whole vault* — the target is any file with that name, wherever it
sits, and when several share the name the rules pick one. So the answer needs
the list of every file in the vault. That list is the core's: it comes from the
same directory walk the tree and the go-to-file picker already use.

The window could have had it. The picker's list is a few thousand paths, and
sending it across on open would have let the frontend resolve links itself,
synchronously, with no round trip per note.

That was rejected for the reason `resolve_link` was put in `root` rather than in
a component: it would put a **second opinion in the window about what is inside
the root and what the vault contains**. Two implementations of "which file does
this name mean" drift, and the one that drifts is the one that decides whether a
click lands on a note or offers to create a duplicate of it.

The second half of the question is whose conventions to follow. Obsidian keeps
three settings that bear directly on this — how a new link is written, where a
new note goes, where an attachment goes — in `.obsidian/app.json`. A vault where
Obsidian writes `[[folder/note]]` and scheda writes `[[note]]` is a vault two
programs disagree about, and the person who has to tidy up is the owner.

## Decision

**Resolving is the core's, and the rules are the vault's.**

- `links.rs` holds Obsidian's resolution rules: a note beats anything else
  sharing the name, then the shallower path, then the lower path so the same
  link always lands on the same file. The window sends a target and receives a
  path or nothing.
- Several links are resolved in one call. A note of a hundred wikilinks is
  ordinary, and a call per link is the round-trip-per-item shape this product
  keeps refusing.
- One flattened list of the vault's files serves both the picker and the links,
  read once per root and dropped whole when the watcher says the folder changed.
  Two lists would mean two directory walks and two moments of staleness.
- `vault.rs` is the only reader of `.obsidian/app.json`, with Obsidian's own
  defaults for everything absent. Before this, `attachments` opened that file for
  one key; three more keys that way would have meant three readers and three
  places for a default to drift.
- The window keeps exactly the part that is a question about the text on screen:
  splitting `path#heading|alias`, drawing the link, and deciding when the source
  comes back.

## Consequences

A link cannot be drawn as resolved on the first frame — the answer is a round
trip — so it is drawn as a link with an unknown destination until the answer
lands, the same arrangement pictures use.

Because the answers are cached per document while the *nudge* to redraw is a
transaction to one view, a view that mounts while a request is in flight has to
be told too. The views on screen are therefore kept in a set, and an answer
nudges those showing that document. A link that resolves is not a thing a person
should have to reopen a tab to see.

A failed lookup forgets its claim rather than recording "no such note". The two
are not the same: offering to create a note that already exists would put a
second one of that name in the vault's new-note folder while the first sits
wherever it sits.

Writing a link needs the vault's format, which needs the file list to know
whether a bare name is unambiguous — so `target_for` takes the same list the
resolver uses rather than asking the disk again.

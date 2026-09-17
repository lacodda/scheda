# 7. An external change is answered by comparing, not by asking

Date: 2026-09-17

## Status

Accepted. Follows from [ADR 0002](0002-the-text-is-the-truth.md).

## Context

scheda shares its vaults. Obsidian is editing the same notes, a sync client is
writing files while someone types, and a script may rewrite twenty at once. When
a file under an open tab is written by something else, the window has to do
something about it.

The two easy answers are both wrong:

- **Always reload.** Silently throws away whatever the person had typed.
- **Always ask.** A sync client rewriting an unchanged file produces a write
  without producing a difference, and a dialog for that teaches people to
  dismiss the dialog without reading it. After a week of that, the one question
  that mattered is dismissed too.

## Decision

**Compare first, and ask only about a real conflict.**

When the watcher reports a file that an open tab is showing, the core is asked
whether the file's text still equals what is on screen. Then:

| On disk | The tab | What happens |
| --- | --- | --- |
| Same as the screen | anything | Nothing is said. The tab is marked as being in step. |
| Different | no unsaved edits | The tab takes the new text, silently. |
| Different | unsaved edits | The person is asked. |

The question names both versions and calls neither correct: **Load theirs (lose
yours)** or **Keep mine (overwrite on save)**. Keeping yours marks the text on
screen as being in step, without writing anything — so the same change is never
asked about twice.

**The shape travels with the text.** A re-read replaces the tab's line endings
and byte-order mark as well as its characters. A note that came back from a sync
client with CRLF where it had LF is now a CRLF file.

## Consequences

**The silent cases are the common ones**, which is the point. Most external
writes are either identical bytes or a file the person was not editing, and
neither deserves a word.

**The one question that appears is worth reading**, because it only ever appears
when both sides changed the same file and no answer is free.

**"In step" is a state the window can set without writing.** Marking text as
saved when it is not on disk sounds like a lie, and would be one if it meant
anything else — but what the flag actually records is "this tab has no unanswered
disagreement with its file", and after the person chooses to keep their version,
it has none.

**A comparison costs a read per changed file.** Only for files an open tab is
showing, and only after a burst of events has settled, so a sync client writing
forty notes into a window with two tabs open costs at most two reads.

**Identical bytes clear the dirty dot.** If a tab thought it had unsaved changes
and the file now matches it exactly, somebody else has typed the same thing or
saved our text for us. Either way there is nothing unsaved, and saying otherwise
would be the window disagreeing with the disk about the disk.

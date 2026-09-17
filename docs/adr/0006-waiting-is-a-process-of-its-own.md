# 6. Waiting is a process of its own

Date: 2026-09-17

## Status

Accepted.

## Context

`scheda --wait FILE` has to block until the tab holding `FILE` is closed, and
then return with an exit code. That is what makes scheda usable as `$EDITOR`: a
program that hands a file to an editor spawns it and waits, and an editor that
returns immediately makes the caller read back a file nobody has touched.

scheda is a single-instance application. When a window is already open, a second
launch hands its file over and the running window opens the tab. So the process
that must block is almost never the process that owns the tab, and the two have
to agree across a boundary.

The obvious design — the same process both owns a window and waits — does not
work, and this was measured rather than reasoned about. `tauri-plugin-single-
instance` ends a second launch by calling `std::process::exit(0)` from inside its
own plugin setup. Nothing written after `Builder::run` is reached, and no
destructor runs. A first implementation blocked after `run`, and the second
launch returned instantly.

A second problem sits behind the first: the running window cannot be *told*
anything. The plugin forwards the second process's `std::env::args()` verbatim,
and a process cannot append to its own command line after it has started. So no
token, handle or identifier invented by the waiting process can reach the window.

## Decision

**`--wait` is a separate role. The waiting process never builds a window.**

Given `--wait`, the process:

1. creates a sentinel file in scheda's own data directory;
2. spawns a second scheda **without** the flag — which either becomes the window
   or hands its file to the window already running, and either way is not our
   concern;
3. blocks watching the sentinel, and exits when it goes.

**The sentinel's name is derived, not passed.** Both sides compute it from the
absolute path of the document — case-folded and separator-normalised, because
the caller passes what was typed and the window compares against what the
filesystem returned. The window learns it has a promise to keep by looking for a
sentinel, not by reading a flag.

Closing the tab releases *every* sentinel for that path.

## Consequences

**A `--wait` invocation costs two processes.** The waiter does nothing but sleep
and stat a file every fifth of a second, so the cost is a few hundred kilobytes
and no CPU. This is the price of the only arrangement that survives being the
second launch.

**Two callers waiting on the same file are both released** when the tab closes.
That is the right answer rather than a compromise: the file they were both
waiting for has been edited.

**A window killed without the tab closing leaves the caller blocked** until the
twelve-hour abandonment guard fires, after which the waiter exits non-zero. A
caller like `git` reads that as "the edit did not happen" and does not commit,
which is the honest outcome.

**The mechanism is a file, not a socket.** A socket, a named pipe or a port
would each need a permission, a cleanup path and a platform branch, for a signal
that carries no data and happens once. A file in a directory we already own
needs none of those, and a stale one is visible to anybody who looks.

**Nothing from outside becomes a path to delete.** The window computes the name
from a document it already has, and removes a file only when its name starts
with that computed prefix.

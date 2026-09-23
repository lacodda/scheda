# 0011 — The index is a cache of a reading, reconciled on open

Accepted, 2026-09-23.

## Context

v0.8 and v0.9 refused a stored index twice, in the comments of `network.rs` and
`tags.rs`: a vault of a few thousand notes reads in tens of milliseconds, and an
index on disk is "a second truth about the vault that is wrong every time
Obsidian writes a note while this window is closed".

The first half stopped being true when it was measured. On the owner's vault —
5347 notes, 59 MB of markdown — reading every note for the backlinks panel took
~590 ms each time the panel opened, nearly all of it the disk. Read for the
first time after a restart, with an antivirus opening every file behind the
reader, the same pass took 78 seconds. The second half is still true of any
index that is trusted on its own word.

v0.10.0 also needs things a per-panel reading cannot give cheaply: a search
filtered by tag or front-matter field before a single file is opened, and a
hash and a tombstone for every note, which a sync transport (efema) will
compare across machines.

## Decision

**The index is a cache of the same reading, never a replacement for it.**

- **What is kept.** Per note: size and modification time (nanoseconds),
  SHA-256 of the bytes, headings, wikilinks with their line and context, tags
  with theirs, and the top-level front-matter fields. Notes that are not UTF-8
  are hashed and listed but hold nothing else. The reading that produces it is
  the one that already existed — `links::scan`, `tags::scan`,
  `notes::headings_in` — plus `frontmatter::fields`.
- **Where.** `%LOCALAPPDATA%\scheda\index\` (the XDG data directory elsewhere),
  one JSON file per vault, named by the first 16 hex digits of the SHA-256 of
  the root path (lowercased on Windows). Never in the vault (ADR 0003). Local,
  not roaming: stamps mean nothing on another machine.
- **The format carries its version** — `"format": 1` — from the first file ever
  written. A file of another version, of another root, or one that does not
  parse is not read but rebuilt: until 1.0 the index is a cache, and the answer
  to a cache that cannot be used is to read again. At 1.0 the format freezes
  and a change becomes a migration.
- **Reconciled on open.** When the window points its watcher at a vault — after
  the first frame (ADR 0001) — the stored index is loaded and compared with the
  disk: every note's size and modification time; a note whose stamp moved is
  read again; a note that is gone is buried; a new one is read. The comparison
  is a directory walk and a `stat` per note (353 ms on the vault above); the
  reading is spread over the machine's cores.
- **Fed by the watcher, in the core, before the window hears.** The watch
  callback updates the index and drops the file list, and only then emits the
  change. A panel that asks the moment it is told is answered from lists that
  already know. Commands that write — save, rename, replace, create from a link
  — tell the index about the files they touched directly.
- **Tombstones.** A note that disappears leaves its path, its last hash and the
  moment it was found gone; a note that reappears at the path lifts it; a
  tombstone older than 90 days is dropped.
- **Asked off the main thread.** Commands that need the index are `async` and
  wait for the build on a pool thread, up to five minutes — above the 78-second
  cold read, below forever. Opening a file never waits for it.

## Consequences

- The tags panel answers in ~4 ms instead of ~590; backlinks likewise.
- Deleting the index directory costs one full reading and nothing else.
- The text of notes is **not** in the index. Searching it reads the files
  (`search.rs`), across all cores, from the system's cache: 262 ms for a word in
  the vault above. Holding 59 MB of text in memory, or a second copy of the
  vault on disk, is the wrong trade for a notepad.
- Anything that wants to know "what changed since" — a sync transport, a
  future "recently deleted" list — has the hashes and the tombstones to ask.

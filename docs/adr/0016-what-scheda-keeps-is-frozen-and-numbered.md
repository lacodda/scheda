# 0016 - What scheda keeps is frozen and numbered

Accepted, 2026-10-12. Freezes the index format of ADR 0011.

## Context

scheda keeps three JSON files of its own: the settings and the session in the
configuration directory, and an index per vault in the local data directory
(ADR 0003, 0011). Up to v0.14 only the index carried a format number, and a
file of another number was thrown away and rebuilt. The settings and the
session had no number at all: a field renamed in a later version would have
been read as missing and reset to its default, silently, on the one machine
that matters.

The plan for 1.0 says the formats of the index and the settings freeze, and
that from then on a change is a migration. Freezing a format is a promise about
two directions:

- **forward** - a file written by an older scheda opens in a newer one with
  everything it said;
- **backward** - a person who goes back to an older release (the install
  script takes `SCHEDA_VERSION`) and then forward again finds the newer files
  as they left them.

Before the freeze, the settings file spelled its fields in snake case while the
session and the index used camel case, and a system-wide key recorded on the
settings screen came out as `Shift+Win+N` while the default was `Win+Shift+N`.
Both would have been frozen into the format.

## Decision

- **One module reads and writes every JSON file scheda keeps** (`stored.rs`).
  The format number is written first in each file. A file with no number was
  written before formats were numbered and is format 0.
- **An older file is migrated**, a step at a time from format `n` to `n + 1`,
  on the JSON before it becomes a struct - the struct that read format `n` no
  longer exists in the build that runs the step. The index migrates too rather
  than rebuilding: its tombstones are the one part a fresh reading cannot give
  back.
- **A newer file is never written over.** It is read as far as this build
  understands it (unknown fields are ignored), and the one function that writes
  checks the number on disk and refuses. Settings changed while that is so live
  in memory for the rest of the run, and the settings screen says they are not
  saved; the session is not saved; the index lives in memory. The refusal is in
  the writer rather than in a rule that formats may only grow, because a rule
  is kept by discipline and the writer by code.
- **A migrated file leaves a copy** of what it started as beside it, under its
  format number (`settings.0.json`), the first time it is written in the new
  format.
- **The last cheap break is taken now.** Format 1 of the settings spells its
  fields in camel case like the other two files, and every chord with its
  modifiers in one order - `Win`, `Ctrl`, `Alt`, `Shift`, the order Windows
  writes them in. The step from format 0 renames the fields and reorders the
  chords of an existing file.
- **Command ids are part of the settings format**, since rebound keys are kept
  under them. Every id that shipped is listed in a test; a renamed command
  keeps its old id in `RENAMED`, and the key follows it.

Formats now: settings 1, session 1, index 1.

## Consequences

- `tests/formats/<file>/<n>.json` holds a sample of every format of every file,
  all saying the same thing. The tests require each older sample to read as
  the newest, the writer to write the newest, a sample for every number and a
  step between each pair, and the hash of each sample's meaning to match
  `tests/formats/FROZEN` - so a shipped sample is not edited to make a test
  pass without a second, visible edit.
- A change to what is stored is a new format: the number rises, a step and a
  sample are added, the old sample stays. A change an older build would
  misread is a major version of scheda.
- The name of an index file (the first sixteen hex digits of the SHA-256 of
  the root) is frozen by a test as well; another name would orphan every
  vault's index.
- Going back to v0.14 or earlier after a file has been written in format 1
  loses the settings in it: those versions know nothing of formats and read the
  renamed fields as missing. The copy `settings.0.json` is what they wrote.
- The reference page *What scheda keeps* lists every file, where it lives and
  its format number; a test holds the numbers on the page to the code.

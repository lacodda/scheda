# 0009 — A rename says what it would do before it does it

Accepted, 2026-09-19.

## Context

Renaming a note in a vault breaks every link that points at it. Keeping those
links working means writing to files the person never opened — the only thing in
scheda that does.

Every other write in this product goes to the file in front of you, after you
asked for it, and is checked byte for byte against what was there before. A
feature that silently rewrites eighty notes is a different kind of thing, and it
has to be built like one.

There is also a parsing question underneath it. Finding links in the open
document is the editor's job, done with a CodeMirror inline parser over a
document it holds in a state. Backlinks and rename-rewriting need the links in
files *nobody opened* — every note in the vault.

## Decision

**The rename is two steps, and the first one writes nothing.** `plan_rename`
reads the vault, works out which links would break, and answers with the list:
which files, which lines, what each line reads now and what it would read. The
window shows it. Only `apply_rename` touches the disk, and it is handed the same
plan that was shown, so what happens is what was approved.

**A link needs rewriting exactly when this rename would break it** — not when it
mentions the name. Each link is resolved twice: against the vault as it is, and
against the vault as it would be. A link that still resolves afterwards is left
alone, even when it now means a different note. A vault holding `plan.md` and
`archive/plan.md` keeps `[[plan]]` working after the first is renamed; it points
at the archived note, which is what the vault says and not ours to overrule.

**Only the target is replaced.** `[[plan|the plan]]` becomes
`[[roadmap|the plan]]`. The alias is the sentence the person wrote.

**Undo restores bytes, not intentions.** Every file's original text is held, and
undoing writes it back verbatim before the name is moved back. A rewrite run
backwards would have to get the same resolution answers in a vault that has moved
on; an undo that has to be right about anything is an undo nobody trusts. There
is one of it, with a horizon, because held bytes stop being the right bytes as
soon as something else writes over them.

**The core scans links itself** (`links::scan`), separately from the editor's
parser. It reads text and yields byte ranges, and it knows the three things that
make a `[[` not a link: a code span or fence, a newline inside the brackets, and
`[[]]`.

## Consequences

The dialect is implemented twice — once in the editor's inline parser, once in
the core's scanner. That is the cost, and it is paid deliberately: the
alternative is either a CodeMirror state per note in a vault of five thousand, or
the whole vault's text crossing the boundary, or a round trip to the core per
keystroke to redraw a decoration. The two implementations are held together by
tests that hold the same cases.

The gate is not the unit tests. `cargo run --example rename_gate -- <folder>`
copies a real vault aside, renames the most-linked note in it, and checks that
planning wrote nothing, that exactly the planned files changed, that each of them
actually changed, that they all still decode, and that undo restored every byte.
Measured at 6100 files: 128 links in 82 notes, and nothing else touched.

A note that cannot be read is named in the plan rather than passed over. It may
hold a link that is about to break, and only the person can go and look.

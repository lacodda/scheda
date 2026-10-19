# 0018 - The keys are the line's list of commands

Accepted, 2026-10-19. Supersedes the key handler and the notation of ADR 0013.

## Context

ADR 0013 gave scheda one list of commands, one key handler and a notation of
its own (`Ctrl+Shift+P`). dowel v0.35 then shipped the same idea for the whole
line - built partly from scheda's list - with what scheda's lacked: sequences,
commands that answer only inside an element, conflicts resolved and reported,
and `Mod`, the word for the command key on a Mac that scheda's notation did not
have (Cmd arrived as `Ctrl`, and was stored as it). Two notations in one line
means a person's keys mean different things in two programs, and the line has
one design system so that it does not.

Three things stood in the way:

- **The editor's keymap.** scheda listened in the capture phase, so a key the
  person gave a command won over CodeMirror (ADR 0013's promise). dowel
  listened in the bubble phase and leaves alone a key something nearer
  handled - and CodeMirror handles dozens of `Ctrl` keys.
- **The note's own commands.** Reading mode, folding and the block palette
  answer their keys only in a note, and are run from the palette on the note
  in front. dowel kept every command scoped to an element out of the palette.
- **Tailwind.** dowel's components are copied into a product as Tailwind code
  (ADR 0010), and scheda has none.

## Decision

- **dowel answers both.** v0.38.1 adds `capture`, which takes a command's key
  before whatever has the focus, and `offered`, which keeps a scoped command
  in the palette (dowel's ADR 0009). Neither is scheda's code.
- **The list and the notation are copied, not imitated.** `src/ui/shortcut.tsx`
  and `src/ui/commands.tsx` are dowel's registry files, which carry no Tailwind
  and no markup; `src/ui/registry.test.ts` fails when either differs from the
  registry of the installed `dowel-ui`. Kbd and ShortcutsDialog are not taken:
  they are Tailwind and Base UI, and scheda already shows every key - beside
  each command in the palette, and on the settings screen that rebinds them.
- **The catalogue stays scheda's.** Every id, title and default key is in
  `src/commands.ts`, whether or not its owner is mounted: the ids are part of
  the settings format (ADR 0016), and the settings screen rebinds a command
  that is not on screen. Owners declare their command with `useCommand`, and
  the catalogue gives it its title and keys.
- **Every command is declared `whileTyping` and `capture`.** It fires in the
  note and in fields, and takes its key before CodeMirror. The note's own
  commands are declared `within` the element the panes live in and
  `offered`; the palette's own command is not offered.
- **The settings write keys in dowel's notation**: format 2, whose step
  rewrites every key a person rebound (`Ctrl` to `Mod`, `Ctrl+Shift+[` to
  `Mod+{`, `Up` to `ArrowUp`). The step and the window are held to one table,
  `src-tauri/tests/keys-1-to-2.json`: the Rust test requires the step to turn
  each format-1 key into its format-2 string, and the window's test presses
  the key format 1 recorded and requires dowel to read that same string.
- **The quick note's key keeps its own notation.** It is a key the system is
  asked for, and its whole point is the Windows key, which dowel's notation
  refuses because inside a window it is the system's.

## Consequences

- A change to how keys are read or answered is made in dowel and reaches
  scheda by moving `dowel-ui` forward and copying two files again.
- On a Mac, scheda's keys are `⌘` keys, and the palette and the settings screen
  say so; `Ctrl+Tab` stays the control key, as tab switching is there.
- Keys a field types with - letters, `Enter`, `Tab`, the arrows - can no longer
  be given to a command: inside the note, where scheda's commands answer, they
  would type.
- The palette lists commands in the catalogue's order, not the order their
  owners mounted in.

# 0013 — Commands and their keys are data

Accepted, 2026-09-30.

## Context

By v0.11 scheda had eleven `keydown` listeners, one per panel or feature, each
holding its own hard-coded letter, plus reading mode, focus mode and folding in
the editor's keymap. v0.12.0 asks for three things that list cannot give: a
command palette that shows every command beside its key, keys a person can
change, and a settings screen that shows what they are.

A second fact came up on the way. The listeners compared `event.key`, and on a
Russian layout `Ctrl+P` arrives as `з` — every shortcut in the window stopped
working the moment somebody switched language to write a sentence.

## Decision

- **One list of commands** (`src/commands.ts`): an id, a title, default keys,
  and a scope — the window, or only while the keyboard is in a note.
- **Owners attach the work.** A panel attaches "show or hide me" while it is
  mounted; the shell attaches the file and tab commands. A command with nothing
  attached is not in the palette.
- **One key handler**, on the window in the capture phase, so a key taken back
  from the editor (`Ctrl+E` is "end of line" in CodeMirror's defaults) is the
  window's without competing with the keymap. Keys that are not bound go on to
  the editor untouched.
- **What stays in the editor's keymap is typing**: list continuation, table
  cells, search in the note — keys whose meaning depends on where the caret is.
  They are not commands and are not rebindable.
- **Keys are a notation** (`Ctrl+Shift+P`), with the modifiers in one order.
  The letter is the one a Latin layout types, and the physical key on a layout
  that does not type Latin. AltGr with a key is typing, never a chord.
- **The settings keep only the changes**, by command id. A default that moves
  in a later version reaches everybody who did not change it. A chord bound to
  one command is taken from another with a sentence saying so, never silently
  shared.

## Consequences

- Adding a command is one line in the list plus the code that does it; the
  palette, the settings screen and the key handler know about it at once.
- A key assigned in the settings to a chord the editor also uses wins over the
  editor, because the handler runs first. That is the point of assigning it.
- The system-wide quick-note key uses the same notation plus `Win`, which only
  the system-wide hook accepts.

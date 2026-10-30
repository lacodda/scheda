---
title: Give a command your own key
description: Change the key of any command, take one away, or put the default back - and what happens when the key you want is already taken.
sidebar:
  order: 7
---

Every command scheda has can answer a key you choose, the ones with no key of
their own included: *Tab: Pin or unpin*, *Tab: Reopen closed*, the themes,
*Autosave*.

## Change it

1. Press `Ctrl+,` and open **Keyboard**.
2. Find the command, by the name the command palette gives it.
3. Press **+** beside it, then the keys you want - say `Ctrl+D`.

The key works at once, in every tab and both panes, and is saved with the
settings. It is shown beside the command in `Ctrl+Shift+P` from then on.

## Take one away, or go back

- **×** on a key removes it from the command.
- **Default** puts back the keys the command came with.

## When the key is taken

A key belongs to one command. Giving it to a second takes it from the first,
and the screen names which command lost it - so that what the screen shows is
always what the key does.

A key you give a command wins over the editor's own use of it inside a note:
`Ctrl+D` given to *Tab: Pin or unpin* pins the tab rather than selecting the
next occurrence of a word.

## Keys you cannot give

The keys that type - letters, `Enter`, `Tab`, the arrows - on their own: the
screen waits for a key with `Ctrl` or `Alt`, or a function key. `AltGr` with a
key is typing a character on many keyboards and is never taken for a shortcut.

The quick note's key is set separately, in **Quick note** on the same screen,
because it is a key of the whole system rather than of the window - see
[Quick note](/scheda/reference/quick-note/).

What is stored, and in which notation, is on
[Commands and keys](/scheda/reference/commands/#changing-a-key).

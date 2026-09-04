---
title: The order of operations
description: Why the file is read before the window exists, and how the startup budget is measured rather than assumed.
---

The reason to reach for a notepad instead of a full editor is that it is
*there* — you double-click, and the text is on screen. Everything scheda does
about startup follows from taking that literally.

## The core reads first

When scheda is launched with a path, the file is read on the first lines of
`main`: before a window, before the web runtime, before any plugin registers.
By the time the frontend exists, the text is already in hand and the first
request it makes returns it immediately.

The alternative — open a window, boot a framework, then ask the disk for a
file — costs a frame the product does not have to spend.

## The shell waits for the text

The editor is mounted directly, without a framework in front of it. The status
bar, the shortcuts and the drop handling are a separate module, loaded *after*
the first character is painted. Nothing in that module is worth a frame of the
text, so nothing in it is allowed to take one.

The same rule applies to everything that comes later. The file tree, the
watcher, the index, backlinks: each starts after the first frame, and each has
to prove by measurement that it did not move it.

## Measured, not asserted

A startup budget nobody measures is a wish. The process clock starts on the
first line of `main`, and the frontend reports back the moment it has painted
the first character. `SCHEDA_STARTUP_LOG` turns both into output — set it to a
path and the timings are appended there:

```sh
SCHEDA_STARTUP_LOG=timings.txt scheda notes.md
```

```
scheda startup: file read 1.2 ms
scheda startup: first paint 331.4 ms
```

A path rather than a stream, because on Windows a release build is a GUI binary
with no console attached: anything written to `stdout` goes nowhere, and a
measurement read from nowhere is not a measurement. In a development build,
setting the variable to `1` prints to the terminal instead.

`v0.1.0` set the threshold at 500 ms from process start to first character on
the owner's machine, as a gate: missing it meant reconsidering the stack before
building anything else on top of it.

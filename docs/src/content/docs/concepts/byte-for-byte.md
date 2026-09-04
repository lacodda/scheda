---
title: Byte for byte
description: Why opening a file in scheda and saving it leaves the file unchanged, and how that is enforced.
---

Open a file, save it, change nothing: the bytes on disk are the bytes that were
there before. This is the promise scheda cannot break, because an editor that
quietly rewrites a file you only looked at is worse than no editor at all — the
damage is invisible until a diff, a sync conflict or a `git status` finds it
weeks later.

## What a naive editor loses

A text file carries more than its characters:

- **A byte-order mark.** Three bytes at the start that most editors either drop
  or add without asking.
- **Line endings.** LF, CRLF, or — in files that have passed through several
  tools — both, line by line, in the same file.
- **A trailing newline.** Present or absent, and both are meaningful.

A round trip through `read_to_string` and `write` loses every one of them.
That is why scheda's core does not read a file as a string. It reads the bytes,
records their *shape* — the endings, the mark, the per-line record when a file
is mixed — and hands the editor only the characters. On save it replays the
shape.

## What happens when you add a line

The shape has to answer for text that did not exist when it was recorded:

- In an LF file, a new line ends with LF. In a CRLF file, CRLF.
- In a mixed file, each existing line keeps the ending it had. Lines past the
  end of the record take the file's *first* ending — there is no correct answer
  there, and the first one is the least surprising.

## Encodings other than UTF-8

scheda writes UTF-8 and nothing else. A file it cannot decode as UTF-8 opens
**read-only**, with the status bar saying so. Guessing an encoding, editing the
guess and saving it back would produce a file that is not the one you opened,
which is the exact failure this whole design exists to prevent.

## How it is enforced

Not by care. By a test that runs on every build.

The repository carries a corpus of deliberately awkward files: every
combination of ending and mark, an empty file, a file that is one newline, a
file with no line breaks at all, multi-byte characters, significant trailing
whitespace, a lone carriage return used as content. Three tests run over all of
them — decode-then-encode in memory, the same through the disk, and the shape
surviving an edit — and any file that fails one of them fails the build.

The corpus only grows. Every defect found in the wild gets a file, so the same
defect cannot come back.

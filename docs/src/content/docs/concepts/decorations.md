---
title: Text first, decorations over it
description: Why scheda draws markup on top of the source instead of replacing it.
---

scheda is not a WYSIWYG editor, and the difference is not a matter of degree.

In a WYSIWYG editor the rendered document is the thing you edit and the markdown
is generated from it. Round-tripping through that is how a file loses its
formatting conventions: the editor has an opinion about how a bold run should be
written, and it applies that opinion to every line it touches.

In scheda **the text is the document**. The markdown you type is what is in the
file, in the order and shape you typed it. What the editor adds is a layer of
drawing on top: a heading is shown larger, a bold run is shown bold, an inline
code span gets a background.

## Markers on the active line

The syntax markers — the `#`, the `**`, the backticks, the brackets — are part
of the text, so they cannot simply disappear. But leaving them visible on every
line makes a document harder to read than the plain file was.

So scheda hides them **only on lines your cursor is not on**. Step onto a line
and its markers come back; step away and they step back. You are never editing
text you cannot see, and you are never reading punctuation you did not need.

They are hidden by collapsing them to nothing, not by making them transparent.
Leaving the width behind is the tell of a fake: the cursor jumps over a gap that
looks like nothing is there.

## What this rules out

Anything that would require scheda to have an opinion about how markdown should
be written. There is no "convert this document to setext headings", no
reformatting on save, no normalising of list markers. scheda does not write
markdown; you do.

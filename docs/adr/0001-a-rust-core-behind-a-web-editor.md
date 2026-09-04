# 0001 — A Rust core behind a web editor, held to a cold-start threshold

Date: 2026-09-03
Status: Accepted

## Context

scheda has to be light enough to replace Notepad for `.md` files and rich enough to show markdown as it is written — on Windows first, on Android later, from one codebase. Three shapes were considered.

**A native immediate-mode UI (winit + wgpu + egui).** Starts in well under 100 ms and weighs almost nothing; a sibling product uses it for an image viewer. But egui has no editor widget of the class this product needs: long documents, IME, soft wrap, selection, undo, syntax-aware decorations. Writing one is not a feature of a notepad; it is a text-editor engine, and it would be the whole project.

**A WYSIWYG document model (ProseMirror family).** Comfortable to type in, but the document is an AST and markdown is a serialisation of it. Serialising back loses formatting the parser did not model, which breaks the promise that opening and saving a file changes nothing.

**A system webview with CodeMirror 6 over a Rust core (Tauri v2).** CodeMirror 6 is what Obsidian's live preview is built on, desktop and mobile alike: the source stays a plain text buffer and markdown is rendered as decorations over it. Tauri v2 builds Android as a second target of the same repository, so the phone does not fork the codebase. The cost is that a webview will never start as fast as Notepad.

## Decision

**Tauri v2, a Rust core, and CodeMirror 6 in the webview.**

The core owns every file operation, the vault root, the index and later the sync state; the webview owns the editor and never touches the disk. The frontend is React with the line's design system, kept thin — the product is text and a sidebar.

**The cost is bounded by a gate, not accepted on faith.** The first task of `v0.1.0` is a cold-start measurement on the owner's machine: an empty window with the editor loaded from the local bundle, timed to the first visible character. The threshold is **0.5 s**. Missing it stops the stage; the stack is reconsidered and the outcome recorded before any further work.

Speed within the budget comes from ordering, not from optimisation: the file's bytes are read and shown first, and everything else — the vault root, the watcher, the index — initialises after the text is on screen.

## Consequences

**Positive.** The editor is a proven engine rather than a project of its own. Decorations preserve the source by construction (see ADR 0002). Android is a build target, not a rewrite. The design system and tooling are shared with the rest of the line.

**Negative.** Startup depends on the platform webview and will sit in the hundreds of milliseconds, not tens; the gate makes this explicit. The renderer is a browser, so memory is higher than a native widget's. Two languages live in one repository, with an IPC boundary that every file operation crosses.

## Outcome of the gate (2026-09-04)

Measured on the owner's machine (Windows 11, WebView2) with the release build,
seven launches, each timed from the first line of `main` to the frame after the
first character was painted:

| Run | First paint |
| --- | --- |
| 1 | 454.7 ms |
| 2 | 446.9 ms |
| 3 | 441.7 ms |
| 4 | 453.9 ms |
| 5 | 444.4 ms |
| 6 | 478.7 ms |
| 7 (after an idle pause) | 440.4 ms |

Median 448 ms, worst 478.7 ms — **under the 0.5 s threshold**. Reading the file
itself takes 0.1–0.3 ms, which is the ordering working: by the time the window
exists the bytes are already in hand.

The margin is thin, and that is the useful part of the number. Roughly 440 ms of
the budget is the webview coming up, and none of it is scheda's code; the
remaining headroom is about 50 ms. So the rule that every later subsystem — the
tree, the watcher, the index, backlinks — starts *after* the first frame is not
a preference, it is the only place the budget can come from. Each of them is to
be measured the same way rather than assumed to be free.

The very first launch on a machine that has not run a WebView2 application
recently costs roughly twice this (one such run measured 882.6 ms). That is the
platform's cold cache, not the application's, and it is not what the threshold
was set against.

## Re-measured at v0.2.2 (2026-09-04)

Drawing the window's own title bar puts more markup in front of the first frame,
so the budget was measured again. Interleaved A/B on the same machine, minutes
apart, alternating the two builds so that whatever else the machine was doing
landed on both sides:

| Build | First paint (sorted) | Median |
| --- | --- | --- |
| v0.2.1, system frame | 459, 517, 528, 553, 556, 557 | 553 ms |
| v0.2.2, own title bar | 423, 482, 554, 575, 593, 594 | 575 ms |

**The title bar costs about 22 ms**, inside the spread of either series. That is
the answer to the question this measurement was for: the change is affordable.

The other thing the numbers say is that **both builds are now slower than the
440 ms recorded at v0.1.0**, and both sit above the 500 ms threshold. Nothing in
the application accounts for it — the core still hands over the file's bytes in
0.1 ms, and the frame is drawn by the same webview as before. What has changed
is the machine's state, not the code: measuring the *installed* v0.2.1 the same
evening gives the same numbers as the fresh build of it.

This is recorded rather than quietly re-baselined. The threshold was set on a
particular machine on a particular day; a number from one evening cannot
invalidate it, and neither can it be declared met by measuring on a good one. The
honest reading is that the budget is tighter than the first measurement
suggested, which makes the rule it produced — every later subsystem starts after
the first frame — more binding, not less.

Two things to do about it, in this order: measure again on a quiet machine
before the next release, and if the numbers hold, find the 100 ms rather than
move the line.

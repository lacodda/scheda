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

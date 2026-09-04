# 0002 — The text is the truth: decorations over the source, saved byte for byte

Date: 2026-09-03
Status: Accepted

## Context

A markdown editor can hold the document in two ways. It can parse the text into a model and render the model, writing markdown back out when saving — the WYSIWYG approach. Or it can keep the text as the only document and draw the markup over it — the approach of source editors with live preview.

scheda will live on the same folders as Obsidian, git and file synchronisation. Whatever it writes back is read by other tools, some of which the user cannot see. A file that changes shape because it was opened is a silent defect for everyone downstream. The line has already paid for this once, in a scripting environment whose editing tool added a byte-order mark and rewrote line endings without saying so.

## Decision

**The text buffer is the document.** Headings, emphasis, code, links, lists, checkboxes, callouts and tables are decorations drawn over the source by the editor. Markers are shown on the active line and hidden elsewhere; hiding is a view state, not an edit.

**Saving writes the buffer and nothing else.** Line endings (`CRLF` or `LF`) are detected on open and kept on save, mixed endings included. A byte-order mark is kept if present and never added. The trailing newline is neither added nor removed. Only UTF-8 is written; a file in another encoding opens read-only with a notice rather than being transcoded on save.

**Round-trip fidelity is a test, not a guideline.** The repository carries a synthetic corpus of markdown files, including hostile ones — mixed endings, nested lists, pipes inside code in tables, unicode in links. Opening and saving each without an edit must produce identical bytes on every build. The owner's own vault is checked the same way by hand before a release, outside the repository.

## Consequences

**Positive.** Nothing the parser does not understand can be lost, because the parser never rewrites anything. Unknown syntax — a plugin's directive, an unusual table — passes through untouched. The editor can be trusted on files it does not fully understand, which is most files in the world.

**Negative.** Rendering is limited to what decorations can express in place; a rendered table cannot be reflowed like a spreadsheet, and an image is shown where its markup stands. A true reading view is a separate mode over the same text rather than a richer document model. Preserving mixed line endings means the editor must track endings per line, not per file.

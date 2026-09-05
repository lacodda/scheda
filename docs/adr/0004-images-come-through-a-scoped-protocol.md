# 0004 — Images come through a scoped protocol, and the core keeps the key

Date: 2026-09-05
Status: Accepted

Amends ADR 0003 on one point: what "only the core touches the disk" means once a note contains pictures.

## Context

A note that embeds `![diagram](assets/diagram.png)` has to show that picture, and the picture is a file on disk beside the note. Until now nothing in the webview could reach a file at all: the core read text and handed it over, and the content policy allowed no images from anywhere.

There are two ways to put a picture on screen, and they differ in what they hand the webview.

**Read it in the core and pass the bytes.** A command takes a path, checks it, reads the file and returns base64. The webview never learns a path it can fetch; every byte has passed through code that could refuse it. But base64 grows a file by a third, the whole thing crosses the IPC boundary as one JSON string, and it crosses again on every re-render unless cached by hand. A vault of screenshots is exactly the case that hurts: several megabytes per image, decoded twice, held in memory as a string.

**Let the webview fetch it over a protocol whose reach the core controls.** Tauri's `asset:` protocol serves files to the webview directly — streamed, ranged, cached by the webview like any other resource — but only from directories the application has allowed. The allow-list is not static: `asset_protocol_scope().allow_directory(path, recursive)` extends it at runtime.

## Decision

**Images are served over the `asset:` protocol, and the core decides what it may reach.** The scope starts empty. When a document is opened, the core resolves its root by the rule in ADR 0003 and allows exactly that directory. Nothing else is ever added, and a webview that asks for a path outside it gets nothing.

**The content policy is widened by exactly one source.** `img-src 'self' asset: http://asset.localhost` and nothing more — no remote images, so a note cannot phone home by embedding a tracking pixel, which is a real pattern in shared vaults.

**The frontend still never resolves a path itself.** It asks the core to turn a document-relative link into a URL. That keeps the decisions — which root, which separators, what counts as escaping it — in one place, and it means a link like `../../../../etc/passwd` is rejected by the same code that established the root rather than by a check bolted onto a component.

## Consequences

**Positive.** Large images cost what they cost on disk and no more; the webview caches them, so scrolling past a picture twice reads it once. Streaming means a big photograph paints progressively instead of arriving as one blocking string. The invariant that matters — the webview reaches only what the core has allowed — is unchanged, and it is now enforced by the runtime rather than by the absence of an API.

**Negative.** The statement in ADR 0003 that "the webview has no file access" is no longer literally true, and this ADR is the amendment: the webview has read access to one directory tree, granted per document by the core. That is a wider surface than none, and it is only as good as the scope logic — so the scope is a gate with tests, including one that walks out of the root with `..` and must come back empty. A second consequence is that the allowed directory is the *root*, which for a vault is the whole vault: a note can therefore display a picture from anywhere in the vault it belongs to, the same as in Obsidian, and not from outside it.

**What this does not open.** No writing: the protocol is read-only. No directory listing. No remote fetch. And no second path for text — documents still arrive as text over the same commands as before, because byte fidelity (ADR 0002) has to be enforced in one place.

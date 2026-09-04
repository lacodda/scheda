# 0003 — The vault stays clean: one root rule, nothing of ours inside it, only the core touches the disk

Date: 2026-09-03
Status: Accepted

## Context

Two products hide in the brief: a notepad that opens any file without ceremony, and a vault editor with a tree, links and search. They pull in different directions. A notepad has no workspace; a vault is a workspace. Obsidian solves this by only being the second thing, which is why it is not a notepad.

The folder scheda works on is not its own. Obsidian keeps its state in `.obsidian/`, git keeps its history, a synchronisation tool watches every write. Anything scheda leaves behind — an index, a lock, a session file — is noise to all of them and a conflict to some.

## Decision

**One root rule instead of two modes.** When a folder is opened explicitly, it is the root. When a file is opened, the root is found by walking up from its folder until a directory containing `.obsidian/` is met; if none is, the file's own folder is the root. The tree, `[[links]]`, backlinks and search all derive from the root and appear whenever there is one — the vault is a property of the surroundings, not a screen to switch to.

**Nothing of scheda's is written inside the root.** The index, the session, the settings and every cache live in the platform's application data directory, keyed by the root's path. `.obsidian/` is read for what it says about the vault and never written. Obsidian's conventions — wikilink resolution by shortest unique path, callouts, front matter, embeds, ignored directories — are honoured on read and not extended: scheda reads the format, it does not fork it.

**Only the core touches the disk.** The webview has no file access. Reading, writing, watching, renaming and deleting go through the Rust core over one boundary, so byte fidelity (ADR 0002), the root rule and later the sync journal are enforced in one place.

## Consequences

**Positive.** The notepad case costs nothing: a lone file gets a root of one folder and the vault features simply have little to show. A vault opened by scheda and by Obsidian in turn sees no foreign files from either. The index is disposable and can be rebuilt from the files at any time, which is also what makes it a safe seed for the change journal that synchronisation will need.

**Negative.** Per-vault state does not travel with the vault — copying a folder to another machine brings the files and not the session, the recent list or the index; the index is rebuilt, the rest is lost. Walking up on every open is a small cost paid before the tree can appear; it is paid after the text is on screen, never before. A root found by `.obsidian/` may be larger than the user expected when opening a file deep in a vault; the sidebar makes the chosen root visible.

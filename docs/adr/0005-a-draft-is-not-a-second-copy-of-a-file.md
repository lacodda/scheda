# 0005 — A draft with no file is kept for you; a file that has one is not

Date: 2026-09-16
Status: Accepted

## Context

`Ctrl+N` opens a tab with no path — a notepad in the literal sense, for the three lines you want somewhere before deciding whether the three lines matter. The tab has nowhere to be saved, so closing the window throws the text away, and a notepad that throws away what you typed is not one.

The obvious fix is a recovery journal: write every tab's text somewhere periodically, restore it all on the next launch, and no work is ever lost. Every editor with a crash-recovery feature works this way, and it is also how an editor acquires a second copy of every file you have open.

That second copy is the problem. scheda's promise is that the file on disk is the document (ADR 0002): what you see is the source, saving reproduces the bytes, and nothing of scheda's is written inside the vault (ADR 0003). A journal of unsaved edits to *named* files creates a second version of `note.md` in `%APPDATA%` that disagrees with the one in the vault, and then has to answer for the disagreement — the "recovered file" dialog, the one that appears after a clean quit and asks which of two documents you meant. Worse, Obsidian is editing the same vault, and a recovered copy of a note that Obsidian has since changed is not a recovery. It is an overwrite waiting for a click.

## Decision

**Only a tab with no path is kept.** Its text is written to `drafts/` in the application's data directory, beside the settings, after half a second of no typing and again when the window closes. One file per draft, named by a key the core generates; the frontend never learns where it lives. An empty draft is not filed at all, so a `Ctrl+N` that was opened and closed unused leaves nothing behind.

**A tab with a path is never kept.** Unsaved edits to a named file are unsaved edits: the tab shows a dot, closing it asks, and closing the window asks. That is the whole guarantee, and it is the same one every editor that does not keep a shadow copy makes.

**A draft ends when the text becomes a file, or when the tab is closed on purpose.** Saving under a name discards the draft after the write, never before. Closing the tab discards it — the person said to close this. Closing the *window* does not: nobody said anything about that tab.

## Consequences

**Positive.** The scratch case works the way the name suggests — type, close, come back, it is there — without scheda ever holding an opinion about a file it did not write. There is exactly one copy of every named note, in the vault, which is what makes opening the same vault in Obsidian safe. The draft folder is disposable: deleting it loses only text that was never a file.

**Negative.** A crash with unsaved edits to a named file loses them, which a journal would not. That is accepted: the alternative is a second truth about every note, and the class of bug it brings — the recovery prompt that overwrites a file changed elsewhere — is worse than the loss it prevents. Drafts also accumulate if a person makes many and never closes their tabs; each is a few hundred bytes, and a tab closed is a draft gone.

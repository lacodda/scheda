# 0021 — A folder opened is a root the core keeps

Date: 2026-10-30
Status: Accepted

## Context

ADR 0003 states one root rule with two halves: a folder opened explicitly is the root; a file's root is the nearest folder above it holding `.obsidian/`. Only the second half was ever built. There was no way to open a folder, the command line and a second launch passed on files and nothing else, and a vault existed only where Obsidian had made one. The README, the Vision and the getting-started page promised the first half until 0.18 took the promise back.

Building it raises three questions the ADR did not answer. Where does the list of opened folders live, when every question about a root - the tree, a link, a picture, a rename - is the core's? Which root wins when a folder opened and a folder holding `.obsidian/` are both above a note? And what does the window show for a folder with no note open in it?

## Decision

**The opened folders are the core's, kept with the session.** The session file gains format 2 (ADR 0016): `folder`, the one the window has open, and `roots`, every folder opened explicitly that the window still uses. The core holds the session (`session::Kept`), reads it the first time a root is asked about rather than before the first frame (ADR 0001), and writes it whole when either half changes. The window writes its half - the tabs - and never sends the folders; it is told them. One list, one owner: a window echoing back a list it was given would be a second copy of it.

**The root rule takes the opened folders as an argument.** `root::for_vault(path, opened)` walks up from the note and stops at the nearest folder that was opened or holds `.obsidian/`. Every caller passes the list; none reads it from somewhere on its own, so a caller that forgot it would not compile rather than quietly answer with the rule as it was before 0.19. Obsidian's button asks `root::for_obsidian`, which ignores the opened folders: a folder opened here is not a vault Obsidian knows.

**Nearest wins, whichever kind.** A vault inside an opened folder keeps its notes - their links were written for it. A folder opened inside a vault is the part somebody asked for. One rule, no precedence table.

**A root stays while it is used.** The open folder, and any opened folder a tab is in. A root is let go only when the window writes its tabs: that is the one moment the core knows them. Pruning on open or close would act on tabs a second or more stale and could take the root from a note opened just before.

**The window asks about what is in front; a note asks about itself.** The tree, going to a file, the search, the tags and the watcher ask `Kept::in_front`: the vault of the note in front, or the window's folder when that note is in none - or when no note is in front. Links, backlinks, pictures, pasting and renaming ask about the note's own vault and never fall back to the folder: a note from the Desktop does not resolve its links in a folder it is not in.

**A path from outside is made absolute by text.** Command line, second launch, drop: relative to the directory it was given in (for a second launch, that launch's), with `.` and `..` resolved and no `\\?\` prefix. `canonicalize`, used for files until now, answered with that prefix on Windows, and a vault reached through it was another vault to the tree, the recent list and the index.

## Consequences

**Positive.** Any folder of markdown is a vault on request, with nothing written into it. The rule the product hangs on is stated once and asked with the same arguments everywhere. A folder arrives through the same door as a file - the mailbox in `handover.rs`, one event, one `receive` - so a folder named on the command line, handed over by a second launch or dropped on the window is opened the same way.

**Negative.** With a vault inside an opened folder, the tree follows a note from that vault to the vault and back to the folder for a note outside it. The alternative - the folder in the tree whatever the note - would give the window two roots at once, and the index and the watcher hold one. Opening a folder with a note from another vault in front puts an empty tab in front, so the folder is what is seen; the next note opened takes that tab's place.

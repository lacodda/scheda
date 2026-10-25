# 0020 — A scheda apart: one directory named by SCHEDA_HOME

Date: 2026-10-24
Status: Accepted

## Context

scheda keeps its own things in two directories of the platform's: the settings, the session, the drafts and the waiting files in the configuration directory, the index of each vault in the local one (ADR 0003, ADR 0011). On Windows both come from the shell's known folders, so no environment variable moves them.

Every release is run live before it ships, and a live run needs a scheda that does not read or write the one its owner lives in: a settings migration under test migrates the real settings, a session written by the run replaces the real one. Each run so far moved the two directories aside by renaming them, ran, put them back and compared hashes. A run that stopped in between would have left the person without their settings and their unsaved drafts until somebody noticed. The README's pictures, taken from the release build, needed the same ritual every time.

## Decision

**`SCHEDA_HOME` names one directory for both.** When it is set and not empty, the configuration and the local data go there together, the way they already share one directory on macOS. Empty means unset: `SCHEDA_HOME=` in a shell is "not this time", and an empty path would put the files in the working directory.

**One module asks the platform.** `home.rs` is the only part of the core that calls `dirs`; a test reads every other source file and fails on a call to it, because a part that asked for itself would write into the real directories under `SCHEDA_HOME` - the one thing the variable promises it does not.

**It moves scheda's files and nothing else.** The webview's own profile is the platform's and moves with `WEBVIEW2_USER_DATA_FOLDER`. One scheda per machine still holds: started while another is open, it hands its file to that window, whatever `SCHEDA_HOME` says.

## Consequences

**Positive.** A live run and `tools/shoot.mjs` start the release build in a directory of their own and leave the real ones unread and unwritten, which the run checks by hash. A person can try a release on a copy of their vault without touching their settings.

**Negative.** A second place the files can be. It is a variable for runs kept apart, not a setting: documented on *What scheda keeps*, never written by scheda, and never offered on the settings screen.

---
title: What scheda keeps
description: Every file scheda writes outside your notes, where it lives, the format it is in, and what happens when another version of scheda reads it.
---

scheda writes nothing into a vault of its own accord - see [the
root](/scheda/concepts/the-root/#nothing-of-ours-inside-the-vault). What it
remembers between runs lives in two directories that belong to it:

| Directory | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Configuration | `%APPDATA%\scheda` | `~/.config/scheda` | `~/Library/Application Support/scheda` |
| Local data | `%LOCALAPPDATA%\scheda` | `~/.local/share/scheda` | `~/Library/Application Support/scheda` |

The configuration directory travels with a roaming Windows profile; the local
one does not, because what is in it describes one machine's disk.

## The files

| File | Directory | Format | What it is |
| --- | --- | --- | --- |
| `settings.json` | configuration | 2 | The [settings](/scheda/reference/settings/). Indented, and meant to be edited by hand. |
| `session.json` | configuration | 2 | The tabs and panes the window had open, and the folder it had open - see [the session](/scheda/reference/tabs-and-panes/). |
| `index/<name>.json` | local data | 1 | One per vault: its notes, links, tags, front matter, a hash of every note and the notes that went away. `<name>` is the first sixteen hex digits of the SHA-256 of the vault's path. |
| `drafts/<key>.md` | configuration | - | The text of a [draft with no file](/scheda/reference/files/), as it was typed, in UTF-8. |
| `waiting/` | configuration | - | Empty files that a `scheda --wait` is watching; each goes when its tab closes. See [the command line](/scheda/reference/the-command-line/). |

The webview keeps a cache of its own in `%LOCALAPPDATA%\com.lacodda.scheda` on
Windows. That one is the platform's, not scheda's, and holds nothing you wrote.

## A scheda kept apart

`SCHEDA_HOME` names one directory for everything in the tables on this page -
configuration and local data together:

```powershell
$env:SCHEDA_HOME = "$env:TEMP\scheda-trial"; & "$env:LOCALAPPDATA\scheda\scheda.exe" notes.md
```

```sh
SCHEDA_HOME=/tmp/scheda-trial scheda notes.md
```

It is for a run that must not touch the scheda you live in: trying a release on
a copy of a vault, taking pictures of the window, a check before a release. The
settings, the session, the drafts and the indexes of that run are written there
and nowhere else; set but empty, the variable counts as unset. The webview's
cache is the platform's and stays where it is, unless `WEBVIEW2_USER_DATA_FOLDER`
moves it too.

One scheda runs at a time on a machine. Started while another is open, it hands
its file to that window, whatever `SCHEDA_HOME` says - close the first one
before starting one apart.

## Formats

Each JSON file starts with the number of its format:

```json
{
  "format": 2,
  "theme": "system",
  ...
}
```

The number changes only when what is stored changes, and every format that
shipped is kept as a sample in the repository
([`src-tauri/tests/formats`](https://github.com/lacodda/scheda/tree/main/src-tauri/tests/formats)),
where the tests hold the code to it. The rules are
[ADR 0016](https://github.com/lacodda/scheda/blob/main/docs/adr/0016-what-scheda-keeps-is-frozen-and-numbered.md).

### A file from an older scheda

It is read and brought up to date, one format at a time, with everything it
said. A file with no number was written by scheda 0.14 or earlier and is format
0; format 1 of the settings spells the fields differently (`fontSize` rather
than `font_size`) and writes every key with `Win` first (`Win+Shift+N`), and
the step between them takes care of both. Format 2 (scheda 0.17) writes the
window's keys the way every program of the line writes them - `Mod` for the
command key, `Ctrl` on Windows and `⌘` on a Mac, and a character with the
Shift already in it: `Ctrl+Shift+[` becomes `Mod+{`. The quick note's
system-wide key keeps its own spelling. Format 2 of the session (scheda 0.19) adds the folder
the window has open and the other folders its tabs came from; a session from
before it had none open.

The first time the file is written in the new format, a copy of it as it was
stays beside it, named with its old number: `settings.0.json`. If a step turned
out wrong, renaming the copy back is the way out.

### A file from a newer scheda

If you go back to an older release - `SCHEDA_VERSION` in the [install
script](/scheda/getting-started/) - the older scheda finds files in a format it
does not know. It reads them as far as it understands them and never writes
over them:

- the settings are applied as read, and a change you make applies to the window
  but is not saved - the settings screen says so at the top;
- the session is read and not saved;
- each vault's index is built afresh, in memory, for that run.

Coming back to the newer release, every file is as it was left.

scheda 0.14 and earlier know nothing about formats. Going back to one of them
after a newer scheda has written the settings resets the text size, the reading
column, bracket closing and the quick note's file and key, because those fields
are spelled differently now; `settings.0.json` still holds what they were.

## Starting over

Any of these can be deleted while scheda is closed.

| Deleted | What happens |
| --- | --- |
| `settings.json` | Every setting is back to its default. |
| `session.json` | The next launch opens an empty window. |
| `index/` | The next vault opened is read in full once - a second or so for a few thousand notes, longer the first time after a restart. |
| `drafts/` | The drafts are gone. This is the one folder that holds text you typed. |
| `waiting/` | Any program waiting on `scheda --wait` stops waiting at once. |
| `*.0.json` | Nothing; they are copies kept in case a migration went wrong. |

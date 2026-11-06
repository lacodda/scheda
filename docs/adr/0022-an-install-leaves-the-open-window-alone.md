# 0022 — An install leaves the open window alone

Accepted, 2026-11-06. Amends ADR 0015.

## Context

ADR 0015 made `tools/install.ps1` refuse while scheda is running, because the
release's own installer, run silently, shuts down whatever holds the file it
replaces, and a window may hold unsaved text. So an update waited for the person to
close the window, and a release could not be installed and proven by the release
engine (`furca release`) while a window stood open.

The engine's proof asks three more things of an installer, the same of every
program of the line: that the program is on the `PATH`, that it says its version,
and that it hashes the same as the binary in the release's archive for this
machine's target. Its check of a release that already went out installs into a
temporary directory with `SCHEDA_INSTALL_DIR` and `SCHEDA_NO_PATH`. scheda's script
did none of it: it left the `PATH` alone on Windows, had no `--version`, and the
release carried no archive, only the setup.

## Decision

- **On Windows, the running program steps aside.** A running `.exe` cannot be
  overwritten but can be renamed. The script moves it to `scheda.exe.old-<guid>`
  and runs the setup, which then finds nothing at that path to shut down. The window
  goes on as the version it was, with its text; the next launch is the new one. If
  the install fails, the program comes back. The next install deletes what stepped
  aside and no longer runs, and so does the uninstaller.
- **macOS and Linux still refuse.** The order was for Windows, where the setup is the
  danger. Nothing there closes a window on its own, and the person is told.
- **`scheda` is on the command line on every platform.** On Windows the script adds
  its directory to the user `PATH`, in the registry and as `REG_EXPAND_SZ`, so that
  entries like `%JAVA_HOME%\bin` keep expanding.
- **An install apart is the program alone.** With `SCHEDA_INSTALL_DIR` the script
  does not run the setup, which would register the copy as the handler for markdown
  and in Apps: on Windows it takes `scheda.exe` from the archive, and elsewhere it
  puts the same file it always fetches in that directory, with no launcher entry.
- **The release carries the program's archive on Windows**,
  `scheda-vX.Y.Z-x86_64-pc-windows-msvc.zip`: the same bytes the setup installs, so
  the engine's `build` check means what it says. The workflow takes it from where
  the setup puts it on the runner, because Tauri writes the bundle's type into the
  program it packs, and the file left in `target/` differs from it by those three
  bytes.
- **The AppImage and the macOS app keep their names.** The script from `main` also
  installs older tags (`SCHEDA_VERSION`), and in the hours between a push and a
  published release it installs the previous one; renaming them to carry the target
  would make it answer 404 for all of those.
- **A release is still published by hand.** `furca release run` stops at `verify`
  while the page is a draft, the draft is checked on a real machine and published
  with `gh release edit --draft=false`, and `furca release resume` proves it. An
  editor that can corrupt a file has no business auto-publishing.

## Consequences

- The engine's `build` proof holds on Windows, where the owner releases from. On
  macOS and Linux `furca release verify --install` says the page has no archive for
  the target: what is there is an AppImage and a `.app.tar.gz` without the target in
  their names.
- A `PATH` entry outlives an uninstall, harmlessly; removing it is on the
  uninstall guide.
- `release_consistency` holds the scripts to the archive's name, to reading
  `SCHEDA_NO_PATH` before any edit of the `PATH`, and to stepping aside before the
  setup runs.

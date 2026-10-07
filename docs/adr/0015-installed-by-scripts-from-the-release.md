# 0015 — Installed by scripts, from the release

Accepted, 2026-10-07. Replaces the npm half of ADR 0014.

## Context

Up to v0.13 a person installed scheda by picking one of seven files on the
releases page - `.msi` or `.exe` for Windows, `.dmg` for macOS, `.AppImage`,
`.deb` or `.rpm` for Linux - and ADR 0014 sent the editor package to npm, whose
first publish has to be made by hand and whose login had expired before it ever
happened.

The owner's decision, the same for scheda, furca, nitid, nooma and midda: no
npm, and an application is installed only by a script, the way kasl is - one
command per platform, which also updates.

## Decision

- **One command per platform.** `tools/install.ps1` on Windows
  (`irm … | iex`) and `tools/install.sh` on macOS and Linux (`curl … | sh`).
  `SCHEDA_VERSION` pins a release; otherwise the latest is taken from the
  `/releases/latest` redirect, not the rate-limited API.
- **Windows runs the release's own installer**, silently and for the current
  user (`/S /CURRENTUSER`, falling back to `/UPDATE` when the old version's
  uninstaller stops an upgrade). Its hooks already register the markdown handler
  (`src/associations.rs`) and put scheda in the Start menu
  and in Apps; a script that copied the program by itself would have to redo all
  three. The script refuses while scheda is running, since closing a window that
  may hold unsaved text is the person's call, and checks the installed file's
  version rather than the installer's exit code.
- **macOS** gets the `.app` in `~/Applications`, **Linux** the AppImage in
  `~/.local/share/scheda` with a launcher entry that offers `text/markdown`
  without taking it. Both get `scheda` in `~/.local/bin` as a link, for the
  terminal and for `$EDITOR`.
- **The release carries exactly what the scripts download**: the bundles are
  `nsis`, `app` and `appimage`. The `.msi` (which needed an administrator and
  sat beside the NSIS install as a second entry in Apps), the `.dmg`, `.deb`
  and `.rpm` are no longer built.
- **The editor package reaches no registry.** It is `private`, so a publish
  refuses; the release carries the tarball `check:package` passed, and a program
  installs it by URL. The lockfile keeps its checksum.

## Consequences

- `release_consistency` holds the README and the getting-started page to the
  commands the scripts name in their own headers, the bundle targets to the
  file names the scripts fetch, and the package to `private` with no workflow
  that publishes.
- `.github/workflows/install.yml` installs every published release with the
  scripts on Windows, macOS and Linux, and runs whenever the scripts change.
- Intel Macs and Linux on ARM have no build; the script says so and points at
  building from source.
- An AppImage needs FUSE 2, which several distributions no longer ship; the
  script names the package when the library is missing.

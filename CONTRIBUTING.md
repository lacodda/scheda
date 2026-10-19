# Contributing to scheda

## Building

Needs Rust, Node 22 and pnpm.

```sh
pnpm install
pnpm tauri dev      # the app, with the frontend hot-reloading
pnpm tauri build    # installers for this platform
```

The repository is a pnpm workspace of two: the window at the root, and the
editor in `packages/editor`, released on its own as `@lacodda/scheda-editor`
(ADR 0014). The window reads the editor from its source, so a change to either
shows up in `pnpm tauri dev` without building anything first.

## The gate

```sh
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
pnpm lint
pnpm check:layout
pnpm check:package
```

That is what CI runs, so a green terminal means a green pull request.
`pnpm lint` runs the editor package's tests alongside the window's;
`check:package` packs the package, unpacks it and imports it by name in a
separate Node process, which is the only way to know a program installing it
can load it.

The corpus of deliberately awkward files - mixed line endings, a byte-order
mark, a missing trailing newline, text that is not UTF-8 - runs as part of
`cargo test`, and through the editor in the package's tests. A change that
touches reading or writing a file has to keep it green: scheda's promise is that
a file comes back byte for byte.

What scheda keeps of its own - the settings, the session, the index - is frozen
and numbered (ADR 0016). Changing what one of them stores means a new format:
raise `current` in its `Kind`, add a step from the previous format, add a sample
to `src-tauri/tests/formats` with its line in `FROZEN`, and leave the earlier
samples as they are. The tests say which of these is missing. Command ids are
frozen with the settings: a renamed command keeps its old id in `RENAMED`.

The keyboard is the line's list of commands (ADR 0018). `src/ui/shortcut.tsx`
and `src/ui/commands.tsx` are dowel's, copied from its registry, and
`src/ui/registry.test.ts` holds them equal to the registry of the `dowel-ui`
this repository installs - a change to them is made in dowel and arrives by
moving `dowel-ui` forward and copying them again. A new command is a line in
the catalogue in `src/commands.ts`, its id in `SHIPPED` in
`src/commands.test.ts`, and a `useCommand` where its work lives.

Every colour a glyph is drawn in is measured (ADR 0017): text clears 4.5:1 on
every ground in both themes, and `--faint` is for marks that are not read. A
new colour goes into the palette in `src/styles.css`, in the light block and in
both copies of the dark one; `src/contrast.test.ts` measures it, and
`check:layout` measures the rendered page. A rule that needs `--faint` or an
opacity adds itself, with its reason, to the lists in that test.

## Releases

A tag drafts the release on three platforms (`.github/workflows/release.yml`):
the Windows NSIS installer, the macOS app and the Linux AppImage - exactly what
`tools/install.ps1` and `tools/install.sh` download, and nothing beside them -
plus the editor package's tarball, which is how programs install
`@lacodda/scheda-editor`. Nothing goes to a registry (ADR 0015).

The draft is installed and checked on a real machine before it is published.
Publishing it runs `.github/workflows/install.yml`, which installs the new
release with the scripts on Windows, macOS and Linux and checks the version
they installed.

## Architecture decisions

Anything that would be asked about again later is written down in
[`docs/adr/`](https://github.com/lacodda/scheda/tree/main/docs/adr) as a short
Context / Decision / Consequences note, in the same commit as the change.

## Commits

Conventional Commits, English, no trailers.

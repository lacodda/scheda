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

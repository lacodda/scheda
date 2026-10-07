# Contributing to scheda

## Building

Needs Rust, Node 22 and pnpm.

```sh
pnpm install
pnpm tauri dev      # the app, with the frontend hot-reloading
pnpm tauri build    # installers for this platform
```

The repository is a pnpm workspace of two: the window at the root, and the
editor in `packages/editor`, published on its own as `@lacodda/scheda-editor`
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

## The editor package

It is released with the window, under the same version number, and published
to npm when the release is (`.github/workflows/npm.yml`, by trusted publishing).

The very first version cannot go that way: npm attaches a trusted publisher
only to a package that already exists. So once, by hand, from a logged-in npm:

```sh
cd packages/editor
npm publish --provenance=false
```

`prepack` builds it and copies the licence in. Then, on npmjs.com, the
package's settings get a trusted publisher - GitHub Actions, `lacodda/scheda`,
workflow `npm.yml` - and every later version goes up from CI with provenance.

## Architecture decisions

Anything that would be asked about again later is written down in
[`docs/adr/`](https://github.com/lacodda/scheda/tree/main/docs/adr) as a short
Context / Decision / Consequences note, in the same commit as the change.

## Commits

Conventional Commits, English, no trailers.

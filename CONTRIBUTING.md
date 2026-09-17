# Contributing to scheda

## Building

Needs Rust, Node 22 and pnpm.

```sh
pnpm install
pnpm tauri dev      # the app, with the frontend hot-reloading
pnpm tauri build    # installers for this platform
```

## The gate

```sh
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
pnpm lint
```

That is what CI runs, so a green terminal means a green pull request.

The corpus of deliberately awkward files - mixed line endings, a byte-order
mark, a missing trailing newline, text that is not UTF-8 - runs as part of
`cargo test`. A change that touches reading or writing a file has to keep it
green: scheda's promise is that a file comes back byte for byte.

## Architecture decisions

Anything that would be asked about again later is written down in
[`docs/adr/`](https://github.com/lacodda/scheda/tree/main/docs/adr) as a short
Context / Decision / Consequences note, in the same commit as the change.

## Commits

Conventional Commits, English, no trailers.

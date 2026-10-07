# 0014 — The editor is a package of this repository

Accepted, 2026-10-07. How the package is distributed - npm, below - is
replaced by ADR 0015: it is attached to each release and installed by URL.

## Context

kilna, the line's desktop workbench for writing, needs to edit markdown, and
scheda already has the editor for it: the CodeMirror 6 setup that draws
markdown over its source (ADR 0002), lines up tables, ticks tasks, colours
callouts and reads notes. A second copy in kilna would drift from the first
within a release. So the editor becomes a package, scheda its first program
and kilna its second.

Where the package lives was the open question, and there were four answers:

1. **dowel's registry**, as a component copied into each program. dowel's
   model is "a component is copied, the theme is imported": a primitive is a
   few hundred lines that become the program's own code. The editor is forty
   modules and two dozen dependencies; a copy in each program is exactly the
   drift this is meant to end.
2. **A package in dowel's workspace**, imported. dowel's packages are its
   theme, its CLI and its lint rules — things every product of the line
   carries. An editor with CodeMirror, eight grammars and a diagram library
   would be the one thing in dowel only two products use, released on dowel's
   cadence and tested away from the corpus that defines it.
3. **A repository of its own.** Every change to the editor that scheda needs
   would cross two repositories and two releases, and the corpus that proves the
   editor survives every awkward file would have to be copied or fetched.
4. **A package in this repository.** The editor is changed where it is used
   every day, tested against the same corpus as the core, and released by the
   same tag.

## Decision

- The editor is `@lacodda/scheda-editor`, in `packages/editor`, a pnpm
  workspace member. Its version is scheda's version, held by
  `release_consistency`; the package is published when the release it belongs
  to is (`.github/workflows/npm.yml`).
- **What stays in scheda** is everything about files: tabs and panes
  (`src/editor/mount.ts`), sessions, the root, the vault, the core. The package
  knows markdown and nothing about where text comes from.
- **The editor asks a host.** Pictures, wikilinks, completion, the hover card
  and following a link are questions put to an `EditorHost` the program passes
  in, through a facet. Each of its parts is optional, and a part that is
  missing takes out what depends on it: with no notes, `[[plan]]` is text, not
  a link that leads nowhere. scheda's host is `src/editor/host.ts`, which calls
  the core exactly as the editor did before (ADR 0004, ADR 0008).
- **Answers are remembered per host.** Two editors with two hosts on one page
  never read each other's cache; the host says when an answer went stale
  (`forgetDocument`, `forgetNotes`).
- **Colours are `--editor-<name>`** custom properties, each falling back to the
  dowel token of the same role, so a program on dowel's theme needs no CSS for
  the editor. scheda keeps its own palette and maps it onto those names once,
  in `styles.css`; a test holds the mapping against the package's list. The
  hover card, which hangs in the body, is styled by the same theme through a
  wrapper carrying the editor's theme classes.
- **CodeMirror's state, view and language are peer dependencies**: the program
  builds the state and the view, and the editor must use the same copies.
- **Inside this repository the package is read from source**, under a
  `scheda-source` export condition that Vite, vitest and TypeScript are told
  about. Nothing is built before the window starts. What is published is built
  with Node's own module resolution, so an import Node would refuse is refused
  by the compiler, and `check:package` packs the tarball and imports it by name
  in a separate Node process.

## Consequences

- The window's startup is unchanged in kind: the package's modules are the same
  modules, bundled into the same first chunk.
- A change to the editor's surface is a change for every program using it.
  The surface is listed in `tools/check-package.mjs` and described, export by
  export and colour by colour, on the docs page, and tests hold both lists
  against the code. Until scheda 1.0 it may change in any minor version; 1.0
  freezes it with the rest.
- The first version reaches npm by hand: a trusted publisher can only be set up
  for a package that exists (CONTRIBUTING.md).
- Focus mode stays a property of the page rather than of one editor, as it was
  in scheda. A program with two independent editors that wants focus in only
  one of them is the moment to make it a state field.

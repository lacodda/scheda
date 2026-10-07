# @lacodda/scheda-editor

> The markdown editor of [scheda](https://github.com/lacodda/scheda), for any program built on CodeMirror 6.

The text stays the file: headings, emphasis, links, tables, tasks and callouts are drawn over the markdown source, never instead of it, and the source comes back on the line you are editing. Reading mode, focus mode, folding, a front matter form, Obsidian-style `[[wikilinks]]` and embedded pictures come with it.

The editor knows markdown and nothing about files. Where a picture lives, which note `[[plan]]` names and what following a link does are asked of a host your program passes in; what the host cannot answer is left out rather than drawn half-working.

## Install

The package is attached to every [scheda release](https://github.com/lacodda/scheda/releases) rather than published to a registry. Install it by URL, with the version you want in both places:

```sh
pnpm add https://github.com/lacodda/scheda/releases/download/vX.Y.Z/lacodda-scheda-editor-X.Y.Z.tgz
pnpm add @codemirror/state @codemirror/view @codemirror/language
```

## Use

```ts
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { schedaEditor } from '@lacodda/scheda-editor'

new EditorView({
  parent: document.querySelector('#editor')!,
  state: EditorState.create({
    doc: '# Notes\n\n- [ ] write the first one',
    extensions: schedaEditor(),
  }),
})
```

The colours are CSS custom properties named `--editor-<name>`; any you leave unset fall back to the [dowel](https://github.com/lacodda/dowel) theme's tokens.

The host interface, the full list of colours and everything else the package exports are described at **[lacodda.github.io/scheda/editor-package](https://lacodda.github.io/scheda/editor-package/)**.

## License

MIT

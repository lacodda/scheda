---
title: The editor as a package
description: scheda's markdown editor for any program built on CodeMirror 6 - what it draws, what it asks of the program around it, and the colours it reads.
---

The editor you type into in scheda is published on its own, as
[`@lacodda/scheda-editor`](https://www.npmjs.com/package/@lacodda/scheda-editor),
for any program built on [CodeMirror 6](https://codemirror.net/). It is the same
code scheda runs, released with it under the same version number.

What comes with it is everything [Markup scheda draws](/scheda/reference/markup/)
and [Writing](/scheda/reference/writing/) describe: the markdown is drawn over its
source and never replaced by it, tables line up, tasks tick, callouts take their
colour, sections fold, and reading mode, focus mode and the front matter form are
all there. What does not come with it is anything about files - that belongs to
the program, and the editor asks the program for it.

## Install

```sh
npm install @lacodda/scheda-editor @codemirror/state @codemirror/view @codemirror/language
```

The three CodeMirror packages are peer dependencies: your program builds the
`EditorState` and the `EditorView` with them, and the editor has to use the very
same copies, or CodeMirror refuses its extensions.

## A first editor

```ts
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { schedaEditor } from '@lacodda/scheda-editor'

const view = new EditorView({
  parent: document.querySelector('#editor')!,
  state: EditorState.create({
    doc: '# Notes\n\n- [ ] write the first one\n\n> [!tip] Callouts work too',
    extensions: schedaEditor(),
  }),
})
```

That is a complete editor. Without a host it asks nothing of anybody: a picture
stays the line of markdown that names it, and a `[[wikilink]]` stays the text it
is, rather than a link that leads nowhere.

## The host

Everything the editor needs from outside the text is one object, passed as
`host`. Each of its three parts is optional, and the editor leaves out whatever
depends on a part you did not give.

```ts
import { documentPath, schedaEditor, type EditorHost } from '@lacodda/scheda-editor'

const host: EditorHost = {
  // Pictures: `![alt](assets/shot.png)` drawn as the picture.
  assets: {
    resolve: async (document, link) => urlForPicture(document, link),
    // Optional: a screenshot pasted into the text becomes a file and a link.
    paste: async (document, extension, bytes) => ({ link: await savePicture(document, extension, bytes) }),
  },
  // Notes: `[[plan]]` drawn as a link, completed while typed, previewed on hover.
  notes: {
    resolve: async (document, targets) => targets.map((target) => findNote(document, target)),
    create: async (document, target) => createNote(document, target),
    suggest: async (document, query) => notesLike(query),
    headings: async (path) => headingsOf(path),
    peek: async (path) => openingOf(path),
  },
  // What clicking a link does.
  follow: {
    open: (path) => openInTab(path),
    goToHeading: (heading) => scrollToHeading(heading),
    confirmCreate: async (target) => confirm(`Create “${target}”?`),
    report: (message) => showError(message),
  },
}

EditorState.create({
  doc,
  extensions: [...schedaEditor({ host }), documentPath.init(() => '/notes/today.md')],
})
```

| Part | What it answers | Without it |
| --- | --- | --- |
| `assets.resolve` | A URL the page can load for a picture link, or `null` to refuse it | Picture lines stay markdown |
| `assets.paste` | Writes pasted picture bytes and returns the link to insert | Pasting does what CodeMirror does |
| `notes.resolve` | Where each of several `[[targets]]` leads: `{ path, target }`, `path: null` for a note that does not exist | Wikilinks stay text; no completion, no hover card, no embeds |
| `notes.create` | Creates the note a link names, returns its path | |
| `notes.suggest` | Notes a half-typed `[[name` could be, best first | |
| `notes.headings` | A note's headings, for `[[note#` | |
| `notes.peek` | A note's name and opening lines, for the hover card and `![[note]]` | |
| `follow` | Opening, scrolling, asking and reporting when a link is clicked | Clicking a link does nothing |

`follow` is read at the moment a link is clicked, not when the editor is made, so
a program whose windows come up after the first frame can give it with a getter.

The **document path** is the name your host knows the document by - a file path
in scheda, any string you like elsewhere. Give it with `documentPath.init(() => path)`
when the state is made, and change it with
`view.dispatch({ effects: setDocumentPath.of(path) })` after a save under a new
name. A document without one is an unsaved buffer: nothing in it is resolved.

### Forgetting

The editor remembers every answer, so a keystroke does not become a round trip.
Your program knows when an answer has gone stale:

- `forgetDocument(host, path)` - the document moved or was saved under a new name,
  so its relative links now start from somewhere else.
- `forgetNotes(host)` - notes appeared, disappeared or changed, so any `[[link]]`
  may lead somewhere else now.

Answers belong to the host that gave them. Two editors with two hosts on one page
never read each other's.

## While it is open

| Export | What it does |
| --- | --- |
| `setBracketClosing(on)` | A transaction spec: `view.dispatch(setBracketClosing(true))`. The starting value is `schedaEditor({ closeBrackets })` |
| `setSpelling(view, on)` | Turns the system spell checker on or off |
| `toggleReading` | `view.dispatch({ effects: toggleReading.of() })` switches reading mode; `state.field(readingMode)` says which it is in |
| `setFocusing(view, on)`, `toggleFocus`, `isFocusing()` | Focus mode: the section being written in full colour, the rest faded. It belongs to the page, not to one editor |
| `outlineOf(state)` | Every `Heading`: `level`, `text`, `from`, `line` |
| `moveSection(state, index, before)` | The transaction that moves a section and everything under it, or `null` when it would go nowhere |
| `blocks()` | Every `Block` the insert palette offers: `id`, `title`, and `build(state)` returning the transaction |
| `countWords(text)`, `bodyWords(doc)`, `readingMinutes(words)`, `WORDS_PER_MINUTE` | Word counts without the front matter, and reading time |

## A note as a page

`renderPage(state, title, resources)` writes the note as one HTML page, for
printing or export. `resourcesOf(state)` lists what the page needs first - picture
links, `![[embedded]]` pictures and diagram sources - and `resources` gives them
back: picture URLs by link, and diagram SVG from `drawDiagram(source, 'default')`.
`relativeFrom(document, target)` turns a resolved path back into a link relative
to the document, which is what `assets.resolve` takes.

## Colours

The editor draws with CSS custom properties named `--editor-<name>`. Any you
leave unset falls back to the [dowel](https://lacodda.github.io/dowel/) token in
the right column, so a program on the lacodda line's theme needs no CSS for the
editor at all. A program with a palette of its own sets each name once - scheda
does, in its stylesheet. The list is also exported as `editorTokens`.

| Colour | Paints | Falls back to |
| --- | --- | --- |
| `--editor-bg` | The page behind the text | `var(--bg)` |
| `--editor-text` | The text | `var(--text)` |
| `--editor-heading` | Headings and strong text | `var(--ink)` |
| `--editor-muted` | Quiet things: markers, labels, the last heading level | `var(--dim)` |
| `--editor-accent` | Links, the caret, list markers, ticked tasks | `var(--accent)` |
| `--editor-border` | Borders of pictures, panels and fields | `var(--line-2)` |
| `--editor-panel` | What embeds, the front matter and the search panel sit on | `var(--raise)` |
| `--editor-active-line` | The line the caret is on | `var(--softer)` |
| `--editor-selection` | Selected text | `var(--accent-soft)` |
| `--editor-match` | Search matches | `var(--warn-soft)` |
| `--editor-match-active` | The current search match | `color-mix(in oklab, var(--warn) 35%, transparent)` |
| `--editor-code` | Inline code | `var(--accent-2)` |
| `--editor-code-bg` | Behind inline code and code blocks | `var(--soft)` |
| `--editor-link-missing` | A link to a note that is not there yet | `var(--dim)` |
| `--editor-quote-rule` | The rule beside a quote | `var(--line-2)` |
| `--editor-quote-text` | A quote's text | `var(--dim)` |
| `--editor-highlight-bg` | Behind `==highlighted==` text | `var(--warn-soft)` |
| `--editor-highlight-text` | Highlighted text | `var(--text)` |
| `--editor-table-border` | A table's rule | `var(--line)` |
| `--editor-table-head-bg` | Behind a table | `var(--softer)` |
| `--editor-callout-note` | `note`, `info`, `todo`, `abstract` callouts | `var(--info)` |
| `--editor-callout-tip` | `tip`, `hint`, `important` callouts | `var(--good)` |
| `--editor-callout-success` | `success`, `check`, `done` callouts | `var(--good)` |
| `--editor-callout-question` | `question`, `help`, `faq` callouts | `var(--warn)` |
| `--editor-callout-warning` | `warning`, `caution`, `attention` callouts | `var(--warn)` |
| `--editor-callout-danger` | `danger`, `error`, `bug`, `failure` callouts | `var(--bad)` |
| `--editor-callout-example` | `example` callouts | `var(--series-7)` |
| `--editor-callout-quote` | `quote`, `cite` callouts | `var(--dim)` |
| `--editor-tok-keyword` | Keywords in code blocks | `var(--syntax-keyword)` |
| `--editor-tok-string` | Strings | `var(--syntax-string)` |
| `--editor-tok-number` | Numbers and literals | `var(--syntax-number)` |
| `--editor-tok-comment` | Comments | `var(--syntax-comment)` |
| `--editor-tok-function` | Function names | `var(--syntax-name)` |
| `--editor-tok-type` | Types and classes | `var(--syntax-type)` |
| `--editor-tok-property` | Properties and attributes | `var(--syntax-meta)` |
| `--editor-tok-punctuation` | Operators and punctuation | `var(--syntax-punctuation)` |

The size of the text is `--editor-font-size`, `15px` when unset. The column,
padding and height of the editor are the program's to set on its own elements.

## Versions

The package is released with scheda, from the same repository and under the same
version number: `@lacodda/scheda-editor@0.13.0` is the editor scheda 0.13.0
shipped. Until scheda 1.0 any minor version may change what is described here;
1.0 freezes it.

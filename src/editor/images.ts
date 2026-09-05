// Pictures embedded in a note, drawn under the line that names them.
//
// The awkward part is timing. Decorations are built synchronously from the
// syntax tree, but turning `assets/diagram.png` into something loadable is a
// round trip to the core — it resolves the root, checks the link stays inside
// it and opens the asset scope (ADR 0004). So a link is looked up once, the
// answer is remembered, and the editor is asked to redraw when it lands. Until
// then the line is just its text, which is what it was a moment ago anyway.
//
// The cache is per document path, because the same relative link means
// different files in different notes.
import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { resolveAsset } from '../core'

/** What a link resolved to: a URL, or nothing because it does not point at a
 *  file inside the root. `undefined` means "not asked yet". */
type Resolved = string | null

/** Where the editor says its document lives. Set by the shell when a tab is
 *  opened or saved under a new name; without it nothing can be resolved,
 *  which is the correct answer for an unsaved buffer. */
export const setDocumentPath = StateEffect.define<string | null>()

export const documentPath = StateField.define<string | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDocumentPath)) return effect.value
    }
    return value
  },
})

/** Announces that some links now have answers. */
const assetsResolved = StateEffect.define<null>()

/** Bumped whenever an answer lands. The decorations facet depends on this
 *  rather than on the effect: a facet is recomputed when a *value* it depends
 *  on changes, and an effect is not a value. */
const assetsGeneration = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(assetsResolved)) return value + 1
    }
    return value
  },
})

/** One cache per document, so a relative link cannot leak between notes. */
const caches = new Map<string, Map<string, Resolved>>()

function cacheFor(path: string): Map<string, Resolved> {
  let cache = caches.get(path)
  if (!cache) {
    cache = new Map()
    caches.set(path, cache)
  }
  return cache
}

/** Forgets what a document's links resolved to — after a save-as, or when a
 *  picture may have changed on disk. */
export function forgetAssets(path: string): void {
  caches.delete(path)
}

/** Forgets every document's answers. For tests: a cache that outlives one of
 *  them makes the next one pass for the wrong reason. */
export function forgetAllAssets(): void {
  caches.clear()
}

/** The picture itself.
 *
 *  `eq` compares the URL and the alt text: without it CodeMirror rebuilds the
 *  element on every redraw, and a rebuilt `<img>` starts its load again, which
 *  makes a note full of pictures flicker on every keystroke.
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super()
  }

  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt
  }

  toDOM() {
    const figure = document.createElement('div')
    figure.className = 'cm-md-image'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    // A picture that cannot be decoded should not leave a broken-image glyph
    // sitting in the text; the line above still says what was meant.
    img.addEventListener('error', () => {
      figure.classList.add('cm-md-image-failed')
    })
    figure.appendChild(img)
    return figure
  }

  ignoreEvent() {
    return true
  }
}

/** Reads the `URL` node inside an `Image`, which is the link as written. */
function linkOf(state: EditorState, from: number, to: number): { link: string; alt: string } | null {
  let link: string | null = null
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'URL' && link === null) {
        link = state.doc.sliceString(node.from, node.to)
      }
    },
  })
  if (link === null) return null
  // `![alt](url)` — the alt text is what sits between the brackets.
  const source = state.doc.sliceString(from, to)
  const alt = /^!\[([^\]]*)\]/.exec(source)?.[1] ?? ''
  return { link, alt }
}

function build(state: EditorState): DecorationSet {
  const path = state.field(documentPath, false) ?? null
  if (path === null) return Decoration.none

  const cache = cacheFor(path)
  const marks: Range<Decoration>[] = []

  // The whole document, not the visible ranges: a block widget has to come from
  // a set provided directly to the facet, and such a set is computed before the
  // viewport exists. Notes hold tens of images, not thousands, so walking the
  // tree costs less than the round trip that follows it.
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Image') return
      const parsed = linkOf(state, node.from, node.to)
      if (!parsed) return

      // Unknown: nothing to draw yet, and the line stays as it is. The plugin
      // below is what turns "unknown" into an answer.
      const known = cache.get(parsed.link)
      if (known === undefined) return

      // Below the line, not in place of it: the source stays visible and
      // editable, which is the rule the whole decoration layer follows.
      //
      // But the *whole* source line hides while the caret is elsewhere. Hiding
      // only the brackets and the URL would leave the alt text sitting above
      // the picture as if it were a caption the author wrote — the same failure
      // as a link whose target stayed visible when its brackets went, and as a
      // callout that rendered `!warning`. Whole construction or none of it.
      const line = state.doc.lineAt(node.to)

      // The line hides only when the caret is elsewhere, exactly like every
      // other marker: step onto it and the markdown is back to be edited.
      const caretHere = state.selection.ranges.some(
        (range) => range.from <= line.to && range.to >= line.from,
      )
      const wholeLine = line.from === node.from && line.to === node.to
      if (caretHere || !wholeLine) return

      // The line is *replaced* by the picture rather than hidden above it.
      //
      // Hiding the text and adding a widget underneath left the emptied line
      // still holding its height — a blank band over every picture. A block
      // replacement takes the line itself, so the picture stands where the
      // markdown was.
      //
      // And it applies whether or not there is a picture to put there: a link
      // the core refused draws nothing, and leaving `escapes` behind — the alt
      // text of `![escapes](../../secret.png)` — would put a word on screen
      // that reads as prose the author wrote.
      if (known === null) {
        marks.push(Decoration.replace({ block: true }).range(line.from, line.to))
        return
      }
      marks.push(
        Decoration.replace({
          widget: new ImageWidget(known, parsed.alt),
          block: true,
        }).range(line.from, line.to),
      )
    },
  })

  marks.sort((a, b) => a.from - b.from)
  return Decoration.set(marks, true)
}

/** Asks the core about links that have no answer yet, then nudges the view. */
async function resolvePending(view: EditorView, path: string, links: string[]): Promise<void> {
  const cache = cacheFor(path)
  // Claim them first: `build` runs on every update, and without this a picture
  // still in flight is asked for again on every keystroke.
  for (const link of links) {
    if (!cache.has(link)) cache.set(link, null)
  }

  for (const link of links) {
    try {
      cache.set(link, await resolveAsset(path, link))
    } catch {
      // A core that cannot answer leaves the link refused. Not worth a dialog:
      // the note reads as it did before pictures existed.
    }
  }
  // Always, not only when something resolved. A refused link changes the
  // drawing too — its line is hidden rather than left showing the alt text —
  // and skipping the redraw when every answer was "no" left exactly that
  // behind, which a screenshot caught after the tests had gone green.
  view.dispatch({ effects: assetsResolved.of(null) })
}

export const markdownImages: Extension = [
  documentPath,
  assetsGeneration,
  // `compute`, not `of(fn)`. A function given to this facet runs after the
  // viewport is measured and may not introduce block widgets; only a set
  // provided directly can affect the vertical layout. CodeMirror says so by
  // throwing "Block decorations may not be specified via plugins" while the
  // view is being constructed, which takes the whole editor down rather than
  // just the pictures.
  EditorView.decorations.compute([documentPath, 'doc', 'selection', assetsGeneration], build),
  // Asking the core is a side effect, and side effects do not belong in a
  // facet's compute — it runs while state is being built, before any view
  // exists. So the walk happens again here, where there *is* a view to nudge
  // when the answers land.
  //
  // The first attempt kept the view in a module-level `let` that the compute
  // read. It was still uninitialised on the first computation, so the first
  // request was dropped silently — and a test asserting "a buffer with no path
  // asks nothing" passed for that reason rather than the intended one.
  ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.ask(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.startState.field(documentPath) !== update.state.field(documentPath)) {
          this.ask(update.view)
        }
      }

      ask(view: EditorView) {
        const path = view.state.field(documentPath, false) ?? null
        if (path === null) return
        const cache = cacheFor(path)
        const pending = linksIn(view.state).filter((link) => !cache.has(link))
        if (pending.length > 0) void resolvePending(view, path, pending)
      }
    },
  ),
]

/** Every image link in the document, in order. */
function linksIn(state: EditorState): string[] {
  const links: string[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Image') return
      const parsed = linkOf(state, node.from, node.to)
      if (parsed) links.push(parsed.link)
    },
  })
  return links
}

// Mermaid diagrams, drawn in reading mode.
//
// A ```mermaid block is text while it is being edited — the source is what the
// person writes, and a picture in its place would be a picture of something
// they cannot reach (ADR 0002). In reading mode the text is locked anyway, and
// the block is replaced by the diagram it describes. `Ctrl+E` back, and it is
// text again: nothing about the file changed.
//
// **The library is loaded when the first diagram is drawn, not before.** It is
// the heaviest thing in the window by a distance, and a notepad that paid for it
// on every launch would break the one promise it makes about starting (ADR
// 0001). The import below is dynamic, so the bundler splits it into chunks of
// its own that nothing asks for until a note with a diagram is read.
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { fullTree } from './parsed'
import { readingMode } from './reading'

/** What a source rendered to, per theme, so redrawing the editor — which
 *  happens on every scroll that brings the block back — does not run the
 *  library again for a diagram it has already drawn. */
const drawn = new Map<string, Promise<string>>()

let library: Promise<typeof import('mermaid').default> | null = null
let initialisedFor: 'dark' | 'default' | null = null
let counter = 0

/** Which of the library's themes matches the window's. */
function themeOf(): 'dark' | 'default' {
  const chosen = document.documentElement.getAttribute('data-theme')
  if (chosen === 'dark') return 'dark'
  if (chosen === 'light') return 'default'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

/** Draws a diagram to SVG markup, loading the library the first time. */
function draw(source: string): Promise<string> {
  const theme = themeOf()
  const key = `${theme}\n${source}`
  const known = drawn.get(key)
  if (known) return known

  library ??= import('mermaid').then((module) => module.default)
  const made = library.then(async (mermaid) => {
    if (initialisedFor !== theme) {
      // `strict` is the library's own default and is set here so nobody has to
      // go and check: a diagram cannot carry script or clickable callbacks into
      // the window, whatever a note downloaded from somewhere says.
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
      initialisedFor = theme
    }
    counter += 1
    const id = `scheda-mermaid-${counter}`
    try {
      const { svg } = await mermaid.render(id, source)
      return svg
    } finally {
      // A diagram that fails to parse leaves the library's scratch element in
      // the page, with an error picture in it, below everything else.
      document.getElementById(`d${id}`)?.remove()
    }
  })
  // A failure is remembered too — the same source fails the same way — but it
  // is kept as the failure, so the widget can say what went wrong.
  drawn.set(key, made)
  return made
}

class Diagram extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  eq(other: Diagram) {
    return other.source === this.source
  }

  get estimatedHeight() {
    return 200
  }

  toDOM() {
    const box = document.createElement('div')
    box.className = 'cm-mermaid'
    box.setAttribute('role', 'img')
    box.setAttribute('aria-label', 'Diagram')
    box.textContent = 'Drawing the diagram…'
    draw(this.source).then(
      (svg) => {
        box.innerHTML = svg
      },
      (error: unknown) => {
        // The source is the person's, and a diagram that will not draw should
        // still show what was written — with the library's reason above it —
        // rather than an empty box or a broken picture.
        box.classList.add('cm-mermaid--failed')
        box.removeAttribute('role')
        box.textContent = ''
        const reason = document.createElement('p')
        reason.className = 'cm-mermaid-reason'
        reason.textContent = `This diagram did not draw: ${messageOf(error)}`
        const code = document.createElement('pre')
        code.textContent = this.source
        box.append(reason, code)
      },
    )
    return box
  }

  ignoreEvent() {
    return true
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0]
  return String(error).split('\n')[0]
}

/** The diagram blocks of a document, as replacements — or none outside reading
 *  mode, where every block is its source. */
function diagramsOf(state: EditorState): DecorationSet {
  if (!state.field(readingMode)) return Decoration.none
  const ranges: Range<Decoration>[] = []
  fullTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const info = node.node.getChild('CodeInfo')
      if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== 'mermaid') {
        return false
      }
      const text = node.node.getChild('CodeText')
      const source = text ? state.sliceDoc(text.from, text.to) : ''
      // Whole lines, fences included: a block replacement has to start and end
      // on line boundaries, and the fences are part of what is being replaced.
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      ranges.push(Decoration.replace({ block: true, widget: new Diagram(source) }).range(from, to))
      return false
    },
  })
  return Decoration.set(ranges)
}

/** Block decorations have to come from a state field: only a set provided
 *  directly to the facet may change the height of lines, and a diagram does. */
export const mermaidDiagrams: Extension = StateField.define<DecorationSet>({
  create: diagramsOf,
  update(value, transaction) {
    const toggled =
      transaction.startState.field(readingMode) !== transaction.state.field(readingMode)
    return toggled || transaction.docChanged ? diagramsOf(transaction.state) : value
  },
  provide: (field) => EditorView.decorations.from(field),
})

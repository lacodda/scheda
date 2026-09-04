// Markup drawn over the source, never instead of it (ADR 0002).
//
// Two things happen here. Headings, emphasis, code and links get a class so CSS
// can style the *rendered* look. Their syntax markers — the hashes, the
// asterisks, the brackets — get hidden, but only on lines the cursor is not on:
// step onto a line and its markers come back, because the text is what you are
// editing and it must be visible to edit it.
import { syntaxTree } from '@codemirror/language'
import { type Range, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** Node names whose whole span gets a class. */
const STYLED: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-emphasis',
  InlineCode: 'cm-md-code',
  Strikethrough: 'cm-md-strike',
  Link: 'cm-md-link',
}

/** Node names that are pure syntax: hidden unless the cursor is on their line.
 *
 *  `URL` belongs here rather than among the styled nodes. Hiding the brackets
 *  but leaving the target visible turns `[the tracker](https://…)` into
 *  `the trackerhttps://…` on screen — worse than showing the markup, because it
 *  reads as text the author did not write. */
const MARKERS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'QuoteMark',
  'URL',
])

const hidden = Decoration.mark({ class: 'cm-md-marker-hidden' })

function build(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = []

  // Lines holding a cursor or a selection edge keep their markers visible.
  const activeLines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    activeLines.add(view.state.doc.lineAt(range.head).number)
    activeLines.add(view.state.doc.lineAt(range.anchor).number)
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const styled = STYLED[node.name]
        if (styled && node.to > node.from) {
          marks.push(Decoration.mark({ class: styled }).range(node.from, node.to))
          return
        }
        if (!MARKERS.has(node.name) || node.to === node.from) return
        const line = view.state.doc.lineAt(node.from).number
        if (activeLines.has(line)) return
        marks.push(hidden.range(node.from, node.to))
      },
    })
  }

  // A DecorationSet has to be sorted by position; the tree walk yields parents
  // before children, which is not the same order.
  marks.sort((a, b) => a.from - b.from || a.to - b.to)
  return Decoration.set(marks, true)
}

export const markdownDecorations: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      // Selection matters as much as content here: moving the cursor onto a
      // line is what brings that line's markers back.
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

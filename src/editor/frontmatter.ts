// Front matter, folded into a header line.
//
// A note that opens with twelve lines of YAML opens with twelve lines the
// reader did not come for. Folded, it is one line saying how many fields are
// there; clicking it unfolds, clicking again folds back.
//
// Folding is a view state and nothing else: the document is untouched, and
// closing the tab forgets it. That is the same rule the marker hiding follows —
// what you see changes, what is in the file does not (ADR 0002).
import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'

/** Toggles the fold. */
export const toggleFrontMatter = StateEffect.define<void>()

/** Whether front matter is folded in this document. Folded by default: the
 *  fields are metadata, and a reader who wants them can ask. */
const folded = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(toggleFrontMatter)) return !value
    }
    return value
  },
})

/** The line shown in place of the fields. */
class FrontMatterHeader extends WidgetType {
  constructor(readonly fields: number) {
    super()
  }

  eq(other: FrontMatterHeader) {
    return other.fields === this.fields
  }

  toDOM(view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-md-frontmatter-header'
    button.textContent =
      this.fields === 1 ? '1 field of front matter' : `${this.fields} fields of front matter`
    button.title = 'Show the front matter'
    button.addEventListener('mousedown', (event) => {
      // Down rather than click: the editor takes the selection on mousedown and
      // would move the caret into the folded range before the click arrives.
      event.preventDefault()
      view.dispatch({ effects: toggleFrontMatter.of() })
    })
    return button
  }

  ignoreEvent() {
    return false
  }
}

/** Counts the `key:` lines between the fences — what the header reports. */
function countFields(text: string): number {
  let count = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '---') continue
    // A nested value (`  - item`) belongs to the field above it.
    if (line.startsWith(' ') || line.startsWith('\t') || trimmed.startsWith('-')) continue
    if (/^[^:]+:/.test(trimmed)) count++
  }
  return count
}

function build(state: EditorState): DecorationSet {
  if (!state.field(folded)) return Decoration.none

  const marks: Range<Decoration>[] = []
  // Front matter is at the top by definition, so only the first node matters
  // and the whole tree need not be walked.
  syntaxTree(state).iterate({
    from: 0,
    to: Math.min(state.doc.length, 4096),
    enter: (node) => {
      if (node.name !== 'FrontMatter') return
      // The cursor inside it means it is being edited, and a fold would hide
      // the line under the caret.
      for (const range of state.selection.ranges) {
        if (range.from <= node.to && range.to >= node.from) return
      }
      const text = state.doc.sliceString(node.from, node.to)
      marks.push(
        Decoration.replace({
          widget: new FrontMatterHeader(countFields(text)),
          block: true,
        }).range(node.from, node.to),
      )
    },
  })
  return Decoration.set(marks, true)
}

export const frontMatterFold: Extension = [
  folded,
  // `compute`, not `of(fn)`. The facet accepts a function, but a function is
  // called after the viewport is measured and therefore may not produce block
  // widgets or anything replacing a line break — which a fold is both of. Only
  // a set provided directly may affect the vertical layout, and `compute`
  // provides one.
  //
  // Front matter is at the top of the document, so it is always in the first
  // viewport and nothing is lost by not tracking visible ranges.
  EditorView.decorations.compute([folded, 'doc', 'selection'], build),
]

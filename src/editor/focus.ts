// Focus mode: the section being written stays in full colour, the rest fades.
//
// A section is what a heading owns: from the heading above the caret to the
// next heading of any level. The innermost one, because that is the piece of
// text being worked on — a `##` with four `###` under it is a chapter, and
// dimming nothing inside a chapter is dimming nothing.
//
// A property of the window, not of the note. Switching tabs in the middle of
// writing should not switch the mode off, so the switch lives here rather than
// in any one tab's editor state, and every state that is swapped into the view
// reads it.
//
// Nothing about the document changes. The faded lines are a class on the line
// and nothing else, and switching the mode off takes the class away (ADR 0002).
import { type EditorState, type Range, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type Command,
} from '@codemirror/view'
import { outlineOf } from './outline'

let focusing = false

/** Says the switch moved, so the view redraws its lines. */
const focusChanged = StateEffect.define<boolean>()

/** Whether focus mode is on in this window. */
export function isFocusing(): boolean {
  return focusing
}

/** Turns focus mode on or off. */
export function setFocusing(view: EditorView, on: boolean): void {
  focusing = on
  view.dispatch({ effects: focusChanged.of(on) })
}

export const toggleFocus: Command = (view) => {
  setFocusing(view, !focusing)
  return true
}

/** The section the caret is in, as a range of the document. The text before
 *  the first heading is a section of its own. */
export function sectionAt(state: EditorState, position: number): { from: number; to: number } {
  const headings = outlineOf(state)
  let from = 0
  let to = state.doc.length
  for (const heading of headings) {
    if (heading.from <= position) {
      from = heading.from
    } else {
      // The line before the next heading is where this section ends.
      to = Math.max(from, heading.from - 1)
      break
    }
  }
  return { from, to }
}

const faded = Decoration.line({ class: 'cm-focus-faded' })

function build(view: EditorView): DecorationSet {
  if (!focusing) return Decoration.none
  const { state } = view
  const section = sectionAt(state, state.selection.main.head)
  const marks: Range<Decoration>[] = []
  // Only the lines on screen: a thousand-line note fades the thirty that can
  // be seen, and scrolling asks again.
  for (const { from, to } of view.visibleRanges) {
    let at = from
    while (at <= to) {
      const line = state.doc.lineAt(at)
      if (line.to < section.from || line.from > section.to) marks.push(faded.range(line.from))
      at = line.to + 1
    }
  }
  return Decoration.set(marks)
}

export const focusMode = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate) {
        const switched = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(focusChanged)),
        )
        if (switched || update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  // A class on the editor too, so the stylesheet can let the active line's
  // band go: a highlighted line inside an already highlighted section is noise.
  EditorView.editorAttributes.of(() => ({ class: focusing ? 'cm-focusing' : '' })),
]

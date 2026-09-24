// Moving a section of a note: a heading, and everything under it, to another
// place among the headings.
//
// A section here is what folding calls one: the heading and every line until
// the next heading of the same level or a higher one, so a `##` moves with its
// `###` children. The heading keeps its level — dropped under a different
// parent, a `###` is still a `###` — because rewriting hashes is changing what
// the author wrote, and a drag is a move, not an edit of the text.
//
// One transaction, so one `Ctrl+Z` puts the note back.
import { type EditorState, type TransactionSpec } from '@codemirror/state'
import { outlineOf } from './outline'

/** Where the section of heading `index` starts and ends. */
export function sectionOf(state: EditorState, index: number): { from: number; to: number } {
  const headings = outlineOf(state)
  const heading = headings[index]
  let to = state.doc.length
  for (let next = index + 1; next < headings.length; next++) {
    if (headings[next].level <= heading.level) {
      to = headings[next].from
      break
    }
  }
  return { from: heading.from, to }
}

/** The edit that moves the section of heading `index` to just before heading
 *  `before`, or to the end of the note when `before` is null.
 *
 *  Null when the move goes nowhere: onto itself, into its own children, or to
 *  the place it already is. */
export function moveSection(
  state: EditorState,
  index: number,
  before: number | null,
): TransactionSpec | null {
  const headings = outlineOf(state)
  if (index < 0 || index >= headings.length) return null
  if (before !== null && (before < 0 || before >= headings.length)) return null

  const section = sectionOf(state, index)
  const target = before === null ? state.doc.length : headings[before].from
  // Inside itself, or where it already stands.
  if (target >= section.from && target <= section.to) return null

  const doc = state.doc
  let text = doc.sliceString(section.from, section.to)
  let removeFrom = section.from
  if (!text.endsWith('\n')) {
    // The last section of a note that does not end in a line break. Moved
    // elsewhere it needs one of its own, and the line break that separated it
    // from what came before goes with it — otherwise the note would end in a
    // blank line it never had.
    text += '\n'
    if (removeFrom > 0 && doc.sliceString(removeFrom - 1, removeFrom) === '\n') removeFrom -= 1
  }

  let insert = text
  const endsBare = doc.length > 0 && doc.sliceString(doc.length - 1) !== '\n'
  if (before === null && endsBare) {
    // Dropped at the end of a note whose last line has no break: the section
    // starts on a line of its own, and the note still ends without one.
    insert = '\n' + text.slice(0, -1)
  }

  // Where the heading lands, in the document after the change.
  const removed = section.to - removeFrom
  const landing =
    (target > section.from ? target - removed : target) + (insert.startsWith('\n') ? 1 : 0)

  return {
    changes: [
      { from: removeFrom, to: section.to },
      { from: target, insert },
    ],
    selection: { anchor: landing },
    scrollIntoView: true,
    userEvent: 'move.section',
  }
}

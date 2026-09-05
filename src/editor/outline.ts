// The headings of a document, and where each one starts.
//
// Read from the syntax tree rather than by matching `#` at the start of a line,
// so a hash inside a code fence is not mistaken for a heading — which is the
// one thing a regular expression gets wrong here, and gets wrong often, since
// shell examples are full of comments.
import { fullTree } from './parsed'
import { type EditorState } from '@codemirror/state'

export interface Heading {
  /** 1 for `#`, 6 for `######`. */
  level: number
  /** The heading's text, without its hashes. */
  text: string
  /** Where the heading line starts, for scrolling to it. */
  from: number
  /** Which line it is on, counted from 1. */
  line: number
}

/** The heading node names the markdown parser produces, by level. */
const HEADING_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  // Setext headings — the ones underlined with `===` or `---` — are headings
  // too, and a note written in that style should not come up with an empty
  // outline.
  SetextHeading1: 1,
  SetextHeading2: 2,
}

/** Every heading in the document, in the order they appear. */
export function outlineOf(state: EditorState): Heading[] {
  const headings: Heading[] = []
  // The whole document, not the part the parser has reached: an outline built
  // from a partial tree lists the headings near the top and drops the rest
  // (see `parsed.ts`).
  const tree = fullTree(state)
  tree.iterate({
    enter: (node) => {
      const level = HEADING_LEVELS[node.name]
      if (!level) return
      const line = state.doc.lineAt(node.from)
      headings.push({
        level,
        text: headingText(state.doc.sliceString(node.from, node.to)),
        from: line.from,
        line: line.number,
      })
    },
  })
  return headings
}

/** Strips the syntax from a heading's source, leaving what it says.
 *
 *  The inline markup inside it is left alone: a heading written as
 *  `## The **hard** part` reads better with its asterisks than with its words
 *  run together, and the outline is a list of what the document says, not a
 *  second rendering of it. */
function headingText(source: string): string {
  const firstLine = source.split('\n')[0] ?? ''
  return firstLine
    // Leading hashes and the space after them.
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    // A closing run of hashes, which is legal and rare.
    .replace(/\s+#+\s*$/, '')
    .trim()
}

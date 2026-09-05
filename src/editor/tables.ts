// Table columns lined up, without rewriting the table.
//
// A markdown table is a table because of where its pipes are, and in a source
// file they are almost never in the same column twice. The usual answer is to
// render a real `<table>`; scheda does not, because then the thing you edit
// stops being the thing you see (ADR 0002), and because it costs 28 times more
// — measured on the owner's own vault: 1.4 ms against 39.5 for the worst file
// in it (decision 2026-09-05).
//
// What happens instead is arithmetic. The editor's font is monospace, so a cell
// four characters short of its column needs four characters of space after it,
// and CSS has a unit for exactly that: `ch` is the width of one character and
// scales with the font size. A zero-width widget with `width: 4ch` moves
// everything after it by four characters, and the pipes land in a column.
//
// The document is untouched. Take the decoration away and the file is what it
// always was.
import { syntaxTree } from '@codemirror/language'
import { fullTree } from './parsed'
import { type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'

/** Space in place of nothing, measured in characters. */
class Spacer extends WidgetType {
  constructor(readonly characters: number) {
    super()
  }

  eq(other: Spacer) {
    return other.characters === this.characters
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-table-pad'
    span.style.width = `${this.characters}ch`
    // Nothing to read, and nothing to select: this is layout, not text.
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  ignoreEvent() {
    return true
  }
}

/** One cell, as the parser reported it. */
interface Cell {
  /** Where the padding goes: just before the pipe that closes the cell. */
  at: number
  /** Characters between this pipe and the last, spacing included.
   *
   *  The span, not the trimmed content. Where a pipe lands is decided by how
   *  many characters precede it, and `| a |` and `|a|` put it in different
   *  places while holding the same cell — measuring the content instead adds
   *  padding to a table that was already lined up, which is what the first
   *  version did to `|---|---|`. */
  span: number
}

/** One row: its cells, in order. */
type Row = Cell[]

/** Reads a table's rows from the tree.
 *
 *  From the tree rather than by splitting on `|`, because a pipe inside inline
 *  code (`` `a|b` ``) is not a column boundary, and a table full of shell
 *  snippets is exactly where that happens. */
function rowsOf(state: EditorState, from: number, to: number): Row[] {
  const rows: Row[] = []
  let current: Row | null = null
  let rowStart = 0
  let currentLine: { from: number; to: number; text: string } | null = null

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'TableHeader' || node.name === 'TableRow') {
        current = []
        // The row's opening pipe, which the first cell's span is measured from.
        rowStart = node.from
        currentLine = null
        rows.push(current)
        return
      }
      // The row of dashes between the header and the body arrives as one
      // `TableDelimiter` covering the whole line, with no cells inside it — so
      // it has to be cut up here, or the one row that draws the table's shape is
      // the one row that does not line up.
      if (node.name === 'TableDelimiter' && isDelimiterRow(state, node.from, node.to)) {
        current = cellsOfDelimiterRow(state, node.from, node.to)
        rows.push(current)
        current = null
        return
      }
      if (node.name !== 'TableCell' || current === null) return
      // The pipe that closes this cell is the next one in the line; the span is
      // the distance from the previous pipe to it, which is exactly what puts
      // it where it is on screen.
      //
      // The line is looked up once per row rather than once per cell: `lineAt`
      // is a search through the document, and a file with 800 rows of table
      // pays for it several thousand times. That alone was the difference
      // between 6.4 ms and 1.5 on the worst file in the owner's vault.
      if (currentLine === null || node.to > currentLine.to) {
        currentLine = state.doc.lineAt(node.from)
      }
      const closing = pipeAfter(currentLine, node.to)
      const previous = current.length > 0 ? current[current.length - 1].at : rowStart
      current.push({ at: closing, span: closing - previous })
    },
  })

  return rows.filter((row) => row.length > 0)
}



/** The position of the first pipe at or after `at`, on the same line.
 *
 *  A cell's own node stops before its trailing space, and the pipe is what
 *  the eye lines up — so the padding has to go against the pipe, not the text. */
function pipeAfter(line: { from: number; to: number; text: string }, at: number): number {
  const text = line.text
  for (let i = at - line.from; i < text.length; i++) {
    if (text[i] === '|') return line.from + i
  }
  return line.to
}

/** Whether a `TableDelimiter` is the whole dashes row rather than a single pipe.
 *
 *  The parser uses one node name for both, and the difference is length: a pipe
 *  is one character, the dashes row is the line. */
function isDelimiterRow(state: EditorState, from: number, to: number): boolean {
  if (to - from <= 1) return false
  return state.doc.lineAt(from).from === from
}

/** The cells of the dashes row, cut on its pipes.
 *
 *  Splitting on the character is safe here in a way it is not for a data row:
 *  a delimiter cell holds only dashes and colons, so there is no inline code to
 *  hide a pipe inside. */
function cellsOfDelimiterRow(state: EditorState, from: number, to: number): Cell[] {
  const text = state.doc.sliceString(from, to)
  const cells: Cell[] = []
  let start: number | null = null
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '|') continue
    if (start !== null) cells.push({ at: from + i, span: i - start })
    start = i
  }
  return cells
}

/** The width each column has to be: its widest cell. */
function widthsOf(rows: Row[]): number[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.span)
    })
  }
  return widths
}

/** How many characters of padding a table needs, and where.
 *
 *  Exported for the tests and for the benchmark: this is the whole computation,
 *  and it is worth being able to run it without a view.
 */
export function paddingFor(state: EditorState, from: number, to: number): Range<Decoration>[] {
  const rows = rowsOf(state, from, to)
  if (rows.length === 0) return []
  const widths = widthsOf(rows)

  const marks: Range<Decoration>[] = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      const needed = (widths[index] ?? 0) - cell.span
      if (needed <= 0) return
      // Just before the pipe that closes the cell. `side: 1` keeps the spacer
      // after any decoration ending at the same position, so a bold run
      // finishing the cell is not pushed outside its own markup.
      marks.push(Decoration.widget({ widget: new Spacer(needed), side: 1 }).range(cell.at))
    })
  }
  return marks
}

function build(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = []
  // A table below the parsed region would be left ragged until something else
  // made the parser catch up (see `parsed.ts`).
  const tree = fullTree(state)
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      marks.push(...paddingFor(state, node.from, node.to))
      // A table has no tables inside it.
      return false
    },
  })
  marks.sort((a, b) => a.from - b.from)
  return Decoration.set(marks, true)
}

export const tableAlignment: Extension = EditorView.decorations.compute(['doc'], build)

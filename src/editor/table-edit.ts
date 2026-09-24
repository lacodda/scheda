// Editing a table from the keyboard: moving between cells, adding a row,
// adding and removing a column.
//
// Every command edits the source and nothing else. There is no model of the
// table kept on the side: a row is read from its line when a key is pressed,
// the edit is the fewest characters that do the job, and the alignment drawn
// over the table (`tables.ts`) lines up whatever the result is. Nothing pads
// cells with spaces to make the source look tidy — that would be rewriting
// every row the author did not touch.
import { syntaxTree } from '@codemirror/language'
import { type ChangeSpec, EditorSelection, type EditorState } from '@codemirror/state'
import { type Command, type KeyBinding } from '@codemirror/view'

/** One cell of a row, in offsets from the start of its line. */
export interface Cell {
  /** Just after the pipe that opens it, or the line start. */
  from: number
  /** The pipe that closes it, or the line end. */
  to: number
  /** Whether `to` is a pipe rather than the end of the line. */
  closed: boolean
}

export interface Row {
  cells: Cell[]
  leading: boolean
  trailing: boolean
}

/** Cuts a table line into cells.
 *
 *  On the pipes that are column boundaries: not one escaped with `\`, and not
 *  one inside a code span — a table of shell commands is full of `a | b`, and
 *  splitting there would move half a command into the next column. */
export function rowOf(line: string): Row {
  const pipes: number[] = []
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char === '`') {
      let run = 1
      while (line[i + run] === '`') run++
      const fence = '`'.repeat(run)
      const close = line.indexOf(fence, i + run)
      // An unclosed run is literal backticks, and the pipes after it count.
      if (close !== -1) {
        i = close + run - 1
        continue
      }
      i += run - 1
      continue
    }
    if (char === '|') pipes.push(i)
  }

  const first = line.length - line.trimStart().length
  const last = line.trimEnd().length - 1
  const leading = pipes.length > 0 && pipes[0] === first
  const trailing = pipes.length > (leading ? 1 : 0) && pipes[pipes.length - 1] === last

  const bounds = [...(leading ? [] : [-1]), ...pipes, ...(trailing ? [] : [line.length])]
  const cells: Cell[] = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    const to = bounds[i + 1]
    cells.push({ from: bounds[i] + 1, to, closed: to < line.length && line[to] === '|' })
  }
  return { cells, leading, trailing }
}

/** The table around a position: its lines, first to last. */
interface Table {
  /** Line numbers, from 1. */
  first: number
  last: number
}

function tableAt(state: EditorState, position: number): Table | null {
  // Both sides of the position: at the very start of a row the node before it
  // is the previous line's, and at the very end the node after it is.
  for (const side of [-1, 1] as const) {
    for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(position, side); node; node = node.parent) {
      if (node.name === 'Table') {
        return {
          first: state.doc.lineAt(node.from).number,
          last: state.doc.lineAt(node.to).number,
        }
      }
    }
  }
  return null
}

/** Where the caret is in a table: which line, which cell. */
interface Place {
  table: Table
  line: number
  column: number
}

function placeOf(state: EditorState): Place | null {
  const selection = state.selection.main
  const table = tableAt(state, selection.head)
  if (!table) return null
  const line = state.doc.lineAt(selection.head)
  const row = rowOf(line.text)
  const offset = selection.head - line.from
  let column = row.cells.findIndex((cell) => offset <= cell.to)
  if (column === -1) column = row.cells.length - 1
  return { table, line: line.number, column: Math.max(column, 0) }
}

/** The row of dashes under the header. */
const isDelimiter = (table: Table, line: number) => line === table.first + 1

/** The selection a cell gets when the caret arrives in it: its text, so typing
 *  replaces it — or, for an empty cell, a caret after the space. */
function cellSelection(state: EditorState, lineNumber: number, column: number): EditorSelection {
  const line = state.doc.line(lineNumber)
  const row = rowOf(line.text)
  const cell = row.cells[Math.min(column, row.cells.length - 1)]
  if (!cell) return EditorSelection.single(line.to)
  const text = line.text.slice(cell.from, cell.to)
  const start = cell.from + (text.length - text.trimStart().length)
  const end = cell.from + text.trimEnd().length
  if (end > start) return EditorSelection.single(line.from + start, line.from + end)
  const caret = Math.min(cell.from + (text.startsWith(' ') ? 1 : 0), cell.to)
  return EditorSelection.single(line.from + caret)
}

/** An empty row shaped like `row`, with `columns` cells. */
function emptyRow(row: Row, columns: number): string {
  const inner = Array.from({ length: columns }, () => '').join(' | ')
  return `${row.leading ? '| ' : ''}${inner}${row.trailing ? ' |' : ''}`
}

function columnsOf(state: EditorState, table: Table): number {
  return rowOf(state.doc.line(table.first).text).cells.length
}

const editable = (state: EditorState) => !state.readOnly

/** Tab: the next cell, then the first cell of the next row, then a new row. */
export const nextCell: Command = (view) => {
  const { state } = view
  const place = placeOf(state)
  if (!place || !editable(state)) return false
  const row = rowOf(state.doc.line(place.line).text)
  if (place.column + 1 < row.cells.length) {
    view.dispatch({ selection: cellSelection(state, place.line, place.column + 1), scrollIntoView: true })
    return true
  }
  let next = place.line + 1
  if (isDelimiter(place.table, next)) next++
  if (next <= place.table.last) {
    view.dispatch({ selection: cellSelection(state, next, 0), scrollIntoView: true })
    return true
  }
  // Past the last cell of the last row, the way a word processor does it: a
  // new row, and the caret in its first cell.
  const last = state.doc.line(place.table.last)
  const insert = '\n' + emptyRow(rowOf(last.text), columnsOf(state, place.table))
  const after = state.update({ changes: { from: last.to, insert } }).state
  view.dispatch({
    changes: { from: last.to, insert },
    selection: cellSelection(after, place.table.last + 1, 0),
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

/** Shift+Tab: the cell before, then the last cell of the row above. */
export const previousCell: Command = (view) => {
  const { state } = view
  const place = placeOf(state)
  if (!place || !editable(state)) return false
  if (place.column > 0) {
    view.dispatch({ selection: cellSelection(state, place.line, place.column - 1), scrollIntoView: true })
    return true
  }
  let previous = place.line - 1
  if (isDelimiter(place.table, previous)) previous--
  // In the first cell of the header there is nowhere to go, and a Shift+Tab
  // that fell through would outdent the line.
  if (previous < place.table.first) return true
  const cells = rowOf(state.doc.line(previous).text).cells.length
  view.dispatch({ selection: cellSelection(state, previous, cells - 1), scrollIntoView: true })
  return true
}

/** Enter: a new row under this one, with the caret in the same column. On an
 *  empty last row it leaves the table instead, the way Enter on an empty list
 *  item ends the list. */
export const newRow: Command = (view) => {
  const { state } = view
  const place = placeOf(state)
  if (!place || !editable(state)) return false
  const line = state.doc.line(place.line)
  const row = rowOf(line.text)

  const blank = row.cells.every((cell) => line.text.slice(cell.from, cell.to).trim() === '')
  if (blank && place.line === place.table.last && place.line > place.table.first + 1) {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: EditorSelection.single(line.from),
      userEvent: 'delete',
    })
    return true
  }

  // Under the header, a new row goes below the dashes, not between them.
  const under = place.line === place.table.first ? place.line + 1 : place.line
  const anchor = state.doc.line(under)
  const insert = '\n' + emptyRow(row, columnsOf(state, place.table))
  const after = state.update({ changes: { from: anchor.to, insert } }).state
  view.dispatch({
    changes: { from: anchor.to, insert },
    selection: cellSelection(after, under + 1, place.column),
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

/** The edit that puts an empty column at boundary `at` of one row: 0 is before
 *  the first cell, `cells.length` after the last. */
function columnInsert(lineFrom: number, text: string, at: number, delimiter: boolean): ChangeSpec {
  const row = rowOf(text)
  const content = delimiter ? ' --- ' : '  '
  const bare = delimiter ? '---' : ''
  if (at < row.cells.length) {
    const cell = row.cells[at]
    if (at === 0 && !row.leading) return { from: lineFrom, insert: `${bare} | ` }
    return { from: lineFrom + cell.from, insert: `${content}|` }
  }
  if (row.trailing) return { from: lineFrom + text.trimEnd().length, insert: `${content}|` }
  return { from: lineFrom + text.trimEnd().length, insert: ` | ${bare}` }
}

function insertColumn(after: boolean): Command {
  return (view) => {
    const { state } = view
    const place = placeOf(state)
    if (!place || !editable(state)) return false
    const at = place.column + (after ? 1 : 0)
    const changes: ChangeSpec[] = []
    for (let number = place.table.first; number <= place.table.last; number++) {
      const line = state.doc.line(number)
      const cells = rowOf(line.text).cells.length
      changes.push(columnInsert(line.from, line.text, Math.min(at, cells), isDelimiter(place.table, number)))
    }
    const next = state.update({ changes }).state
    view.dispatch({
      changes,
      selection: cellSelection(next, place.line, at),
      userEvent: 'input',
    })
    return true
  }
}

/** Ctrl+Alt+→ and Ctrl+Alt+←: a new column after or before the caret's. */
export const insertColumnAfter = insertColumn(true)
export const insertColumnBefore = insertColumn(false)

/** Ctrl+Alt+Backspace: the caret's column goes, from every row. The last
 *  column of a table stays: a table with none is not a table. */
export const deleteColumn: Command = (view) => {
  const { state } = view
  const place = placeOf(state)
  if (!place || !editable(state)) return false
  if (columnsOf(state, place.table) <= 1) return true
  const changes: ChangeSpec[] = []
  for (let number = place.table.first; number <= place.table.last; number++) {
    const line = state.doc.line(number)
    const row = rowOf(line.text)
    const cell = row.cells[place.column]
    if (!cell) continue
    if (cell.closed) {
      let to = cell.to + 1
      // The first cell of a row without a leading pipe: the space after the
      // pipe goes too, so the row does not start with one.
      if (place.column === 0 && !row.leading) {
        while (to < line.text.length && line.text[to] === ' ') to++
      }
      changes.push({ from: line.from + cell.from, to: line.from + to })
    } else {
      // The last cell of a row with no closing pipe: it goes with the pipe
      // before it, and the spaces before that.
      let from = cell.from - 1
      while (from > 0 && line.text[from - 1] === ' ') from--
      changes.push({ from: line.from + from, to: line.from + cell.to })
    }
  }
  const after = state.update({ changes }).state
  const remaining = rowOf(after.doc.line(place.line).text).cells.length
  view.dispatch({
    changes,
    selection: cellSelection(after, place.line, Math.min(place.column, remaining - 1)),
    userEvent: 'delete',
  })
  return true
}

/** The bindings, consulted before the list ones: inside a table, Tab means the
 *  next cell, and a table is never inside a list item. */
export const tableKeymap: KeyBinding[] = [
  { key: 'Tab', run: nextCell },
  { key: 'Shift-Tab', run: previousCell },
  { key: 'Enter', run: newRow },
  { key: 'Mod-Alt-ArrowRight', run: insertColumnAfter },
  { key: 'Mod-Alt-ArrowLeft', run: insertColumnBefore },
  { key: 'Mod-Alt-Backspace', run: deleteColumn },
]

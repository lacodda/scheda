// Putting a block into a note: a callout, a table, a fenced code block, a task.
//
// Each is the markdown a person would have typed, with the caret left where
// they would type next — in the callout's body, in the table's first cell,
// inside the fence. Nothing is inserted that the text does not show (ADR 0002):
// the palette is a shorter way to type, not a second kind of content.
//
// A block starts on a line of its own. On an empty line it takes that line; on
// a line with text it goes after it, with the blank line markdown needs between
// two blocks — a table glued to the paragraph above it is not a table.
//
// With text selected, the blocks that can hold it take it: a fence goes around
// the selected lines, a callout quotes them. A table or a task over a selection
// would have to decide what the selection means, so they go after it instead.
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { codeLanguageNames } from './markdown.js'

export interface Block {
  id: string
  /** What the palette shows. */
  title: string
  build: (state: EditorState) => TransactionSpec
}

/** The callout kinds Obsidian ships under their own names. The aliases
 *  (`summary`, `hint`, `error`...) are left out: they draw the same, and a list
 *  with three names for one thing is a list read three times. */
const CALLOUTS = [
  'note',
  'abstract',
  'info',
  'todo',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
]

/** The text of the block and where in it the caret goes, as an offset. */
interface Piece {
  text: string
  caret: number
}

/** Where a new block goes, and what it needs around it. */
function placement(state: EditorState): { at: number; before: string; after: string } {
  const range = state.selection.main
  const line = state.doc.lineAt(range.to)
  if (line.text.trim() === '' && range.empty) {
    // An empty line is the block's. A blank line above is needed only when
    // the line before this one has text.
    const above = line.number > 1 ? state.doc.line(line.number - 1).text : ''
    const below = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : ''
    return {
      at: line.from,
      before: above.trim() === '' ? '' : '\n',
      after: below.trim() === '' ? '' : '\n',
    }
  }
  const below = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : ''
  return { at: line.to, before: '\n\n', after: below.trim() === '' ? '' : '\n' }
}

/** Replaces an empty line, or goes after the caret's line. */
function put(state: EditorState, piece: Piece): TransactionSpec {
  const { at, before, after } = placement(state)
  const line = state.doc.lineAt(at)
  // Taking an empty line means replacing whatever whitespace is on it.
  const to = line.text.trim() === '' && at === line.from ? line.to : at
  const insert = before + piece.text + after
  return {
    changes: { from: at, to, insert },
    selection: EditorSelection.cursor(at + before.length + piece.caret),
    scrollIntoView: true,
    userEvent: 'input.insert-block',
  }
}

/** The whole lines a selection touches, or null when nothing is selected. */
function selectedLines(state: EditorState): { from: number; to: number; text: string } | null {
  const range = state.selection.main
  if (range.empty) return null
  const first = state.doc.lineAt(range.from)
  // A selection ending at the very start of a line has not taken that line.
  const lastAt = range.to > range.from && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to
  const last = state.doc.lineAt(lastAt)
  return { from: first.from, to: last.to, text: state.sliceDoc(first.from, last.to) }
}

function callout(kind: string): Block {
  return {
    id: `callout.${kind}`,
    title: `Callout: ${kind}`,
    build(state) {
      const head = `> [!${kind}]`
      const lines = selectedLines(state)
      if (lines) {
        const quoted = lines.text
          .split('\n')
          .map((line) => (line === '' ? '>' : `> ${line}`))
          .join('\n')
        const insert = `${head}\n${quoted}`
        return {
          changes: { from: lines.from, to: lines.to, insert },
          selection: EditorSelection.cursor(lines.from + head.length),
          userEvent: 'input.insert-block',
        }
      }
      return put(state, { text: `${head}\n> `, caret: head.length + 3 })
    },
  }
}

function codeBlock(language: string): Block {
  return {
    id: `code.${language || 'plain'}`,
    title: language ? `Code block: ${language}` : 'Code block',
    build(state) {
      const open = '```' + language
      const lines = selectedLines(state)
      if (lines) {
        const insert = `${open}\n${lines.text}\n\`\`\``
        return {
          changes: { from: lines.from, to: lines.to, insert },
          selection: EditorSelection.cursor(lines.from + open.length + 1 + lines.text.length),
          userEvent: 'input.insert-block',
        }
      }
      return put(state, { text: `${open}\n\n\`\`\``, caret: open.length + 1 })
    },
  }
}

function table(columns: number): Block {
  return {
    id: `table.${columns}`,
    title: `Table: ${columns} columns`,
    build(state) {
      const header = `|${' Column |'.repeat(columns)}`
      const rule = `|${' --- |'.repeat(columns)}`
      const row = `|${'  |'.repeat(columns)}`
      const text = `${header}\n${rule}\n${row}`
      // In the first cell of the first row, after its leading space.
      return put(state, { text, caret: header.length + 1 + rule.length + 1 + 2 })
    },
  }
}

const task: Block = {
  id: 'task',
  title: 'Task',
  build(state) {
    const line = state.doc.lineAt(state.selection.main.head)
    // A task on a line that already has text turns that line into one, the way
    // typing `- [ ] ` at its start would.
    if (line.text.trim() !== '' && !/^\s*[-*+] \[[ xX]\] /.test(line.text)) {
      const indent = /^\s*/.exec(line.text)?.[0] ?? ''
      const listed = /^\s*[-*+] /.exec(line.text)
      const from = line.from + (listed ? listed[0].length : indent.length)
      const insert = listed ? '[ ] ' : '- [ ] '
      return {
        changes: { from, insert },
        selection: EditorSelection.cursor(line.to + insert.length),
        userEvent: 'input.insert-block',
      }
    }
    return put(state, { text: '- [ ] ', caret: 6 })
  },
}

const divider: Block = {
  id: 'divider',
  title: 'Divider',
  build: (state) => put(state, { text: '---', caret: 3 }),
}

/** Every block the palette offers, in its order before anything is typed. */
export function blocks(): Block[] {
  return [
    ...CALLOUTS.map(callout),
    table(2),
    table(3),
    codeBlock(''),
    ...codeLanguageNames().map(codeBlock),
    codeBlock('mermaid'),
    task,
    divider,
  ]
}

// Blocks put into a note: what text they add, where the caret lands, and that
// they start on a line of their own.
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blocks } from './insert'

function block(id: string) {
  const found = blocks().find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no block ${id}`)
  return found
}

/** Inserts a block into a document with the caret at `|` (or a selection
 *  between two `|`), and answers the text with the caret put back as `|`. */
function insert(id: string, marked: string): string {
  const first = marked.indexOf('|')
  const second = marked.indexOf('|', first + 1)
  const doc = marked.replace(/\|/g, '')
  const selection =
    second === -1 ? EditorSelection.cursor(first) : EditorSelection.range(first, second - 1)
  const state = EditorState.create({ doc, selection })
  const after = state.update(block(id).build(state)).state
  const at = after.selection.main.head
  return after.doc.sliceString(0, at) + '|' + after.doc.sliceString(at)
}

describe('inserting a block', () => {
  it('takes an empty line, and leaves the caret in the callout’s body', () => {
    expect(insert('callout.warning', 'para\n\n|\n\nnext')).toBe('para\n\n> [!warning]\n> |\n\nnext')
  })

  it('goes after a line with text, with the blank line markdown needs', () => {
    expect(insert('table.2', 'a paragraph|')).toBe(
      'a paragraph\n\n| Column | Column |\n| --- | --- |\n| | |  |',
    )
  })

  it('puts the caret inside a fence', () => {
    expect(insert('code.rust', '|')).toBe('```rust\n|\n```')
  })

  it('fences selected lines rather than going after them', () => {
    expect(insert('code.python', '|print(1)\nprint(2)|\n')).toBe('```python\nprint(1)\nprint(2)|\n```\n')
  })

  it('quotes selected lines into a callout', () => {
    expect(insert('callout.note', 'x\n|one\n\ntwo|')).toBe('x\n> [!note]|\n> one\n>\n> two')
  })

  it('turns a line into a task, keeping a list marker it already had', () => {
    expect(insert('task', 'buy milk|')).toBe('- [ ] buy milk|')
    expect(insert('task', '- buy milk|')).toBe('- [ ] buy milk|')
  })

  it('adds a blank line under a block that lands above text', () => {
    expect(insert('divider', '|\nbelow')).toBe('---|\n\nbelow')
  })

  it('offers every block under a distinct id', () => {
    const ids = blocks().map((candidate) => candidate.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

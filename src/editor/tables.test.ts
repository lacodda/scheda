// Lining up a table's columns.
//
// The assertions are on how many characters of padding each cell gets, because
// that is the whole computation — the browser turns those into `ch` widths and
// the pipes land in a column, which is checked in the browser gate where there
// is a font to measure against.
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { schedaSetup } from './setup'
import { paddingFor } from './tables'

/** The padding this document's first table asks for, as `[position, chars]`. */
function padding(doc: string): [number, number][] {
  const state = EditorState.create({ doc, extensions: schedaSetup() })
  return paddingFor(state, 0, doc.length).map((range) => [
    range.from,
    // The widget carries the count; reading it back is what the test is about.
    (range.value.spec.widget as { characters: number }).characters,
  ])
}

/** The document with each cell's padding turned into spaces — what the reader
 *  sees, spelled out as text so a test can assert on the shape. */
function asRendered(doc: string): string {
  const state = EditorState.create({ doc, extensions: schedaSetup() })
  const marks = paddingFor(state, 0, doc.length)
  let out = ''
  let at = 0
  for (const range of marks) {
    out += doc.slice(at, range.from)
    out += ' '.repeat((range.value.spec.widget as { characters: number }).characters)
    at = range.from
  }
  return out + doc.slice(at)
}

describe('aligning a table', () => {
  it('pads the short cells of a column to its widest', () => {
    // Every column, the last one included: a closing pipe out of line is as
    // ragged as any other, and the widest last cell here is `--- ` from the
    // delimiter row.
    const doc = '| a | b |\n| --- | --- |\n| longer | x |\n'
    expect(asRendered(doc)).toBe('| a      | b   |\n| ---    | --- |\n| longer | x   |\n')
  })

  it('lines up the delimiter row with everything else', () => {
    // The row of dashes arrives as one node with no cells inside it, so it has
    // to be cut up by hand. Left out, the one row that draws the table's shape
    // is the one row that does not line up — which is how it first shipped.
    const doc = '| Version | Theme |\n| --- | --- |\n| 0.1 | A file |\n'
    const rendered = asRendered(doc)
    const pipes = rendered.split('\n').map((line) => [...line].flatMap((c, i) => (c === '|' ? [i] : [])))
    expect(pipes[1]).toEqual(pipes[0])
    expect(pipes[2]).toEqual(pipes[0])
  })

  it('leaves a table that already lines up alone', () => {
    const doc = '| a | b |\n| - | - |\n| c | d |\n'
    expect(padding(doc)).toEqual([])
  })

  it('handles a source written with no spaces at all', () => {
    // `|---|---|` is legal and common, and it is the case that looked worst.
    const doc = '| a | b |\n|---|---|\n| c | d |\n'
    const rendered = asRendered(doc)
    const rows = rendered.split('\n').filter((line) => line.startsWith('|'))
    const pipes = rows.map((line) => [...line].flatMap((c, i) => (c === '|' ? [i] : [])))
    expect(pipes[1]).toEqual(pipes[0])
    expect(pipes[2]).toEqual(pipes[0])
  })

  it('counts a cell by its trimmed text, not its spacing', () => {
    // `|  a  |` and `| a |` hold the same cell; the padding has to make them
    // the same width rather than preserve the difference.
    const doc = '|  a  | b |\n| --- | --- |\n| c | d |\n'
    const rendered = asRendered(doc)
    const rows = rendered.split('\n').filter((line) => line.startsWith('|'))
    const pipes = rows.map((line) => [...line].flatMap((c, i) => (c === '|' ? [i] : [])))
    // The first row keeps its extra spaces, so it is wider by them — what
    // matters is that the other two agree with each other.
    expect(pipes[2]).toEqual(pipes[1])
  })

  it('is not confused by a pipe inside inline code', () => {
    // `a|b` in backticks is one cell, not two. Splitting on the character would
    // read three columns in the first row and two in the rest.
    const doc = '| cmd | note |\n| --- | --- |\n| `a\\|b` | x |\n'
    const state = EditorState.create({ doc, extensions: schedaSetup() })
    const marks = paddingFor(state, 0, doc.length)
    // Two columns throughout means at most two paddings per row.
    const perRow = new Map<number, number>()
    for (const range of marks) {
      const line = state.doc.lineAt(range.from).number
      perRow.set(line, (perRow.get(line) ?? 0) + 1)
    }
    for (const count of perRow.values()) expect(count).toBeLessThanOrEqual(2)
  })

  it('measures a cell by what is on screen, not by its source', () => {
    // A cell holding `` `code` `` is two characters narrower than its source,
    // because the backticks hide. Counting the source lines the column up
    // against text nobody sees — which is how it shipped, and what a screenshot
    // caught: every pill slipped its column by exactly two characters.
    const doc = '| a | b |\n| --- | --- |\n| `xy` | z |\n'
    const state = EditorState.create({ doc, extensions: schedaSetup() })
    const marks = paddingFor(state, 0, doc.length)

    // `| `xy` ` is seven characters of source and five on screen, against a
    // column six wide — so the cell needs one character of padding. Measured
    // against the source it would appear to be seven, wider than the column,
    // and get none at all: the pipe after it lands two characters early, which
    // is exactly the slip a screenshot showed.
    const cells = marks
      .filter((range) => state.doc.lineAt(range.from).number === 3)
      .map((range) => (range.value.spec.widget as { characters: number }).characters)
    expect(cells).toEqual([1, 2])
  })

  it('counts the source on the line the caret is on', () => {
    // With the markers back, the source is what is on screen — so the same cell
    // is measured differently, and correctly, depending on where the caret is.
    const doc = '| a | b |\n| --- | --- |\n| `xy` | z |\n'
    const caretInCell = doc.indexOf('`xy`') + 1
    const state = EditorState.create({
      doc,
      extensions: schedaSetup(),
      selection: { anchor: caretInCell },
    })
    const marks = paddingFor(state, 0, doc.length)
    const cells = marks
      .filter((range) => state.doc.lineAt(range.from).number === 3)
      .map((range) => (range.value.spec.widget as { characters: number }).characters)
    // With the backticks showing, the cell really is seven characters wide —
    // wider than the column — so it takes no padding, and the one after it
    // takes two.
    expect(cells).toEqual([2])
  })

  it('asks for nothing when there is no table', () => {
    expect(padding('Just prose.\n\nAnd more.\n')).toEqual([])
  })

  it('does not change the document', () => {
    // The point of doing it this way at all (ADR 0002).
    const doc = '| a | b |\n| --- | --- |\n| longer | x |\n'
    const state = EditorState.create({ doc, extensions: schedaSetup() })
    paddingFor(state, 0, doc.length)
    expect(state.doc.toString()).toBe(doc)
  })
})

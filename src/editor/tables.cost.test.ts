// What aligning a table costs, on a document as heavy as a real one.
//
// This exists because the alternative — rendering a real `<table>` — was
// rejected on a measurement (39.5 ms against 1.4 for the same file), and a
// decision made on a number deserves a test that keeps the number true.
//
// It keeps it by counting work rather than by timing it. A wall-clock budget
// lived here first and was removed: it passed alone and failed about one run in
// three inside a seventeen-worker suite, which made it a gate reporting machine
// load as a defect. What actually made the number 1.4 ms is one document lookup
// per row instead of one per cell, and that is the same on every machine.
//
// The fixture is synthetic and English, like the rest of the corpus — the
// owner's own vault never appears in the repository. It is built to the shape
// of the worst file in it: one table of 800 rows, four columns, cells of very
// uneven length.
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { schedaSetup } from './setup'
import { paddingFor } from './tables'

/** A table as awkward as the ones that turn up in a notes folder. */
function heavyTable(rows: number): string {
  const lines = ['| id | name | note | count |', '|---|---|---|---|']
  for (let i = 1; i <= rows; i++) {
    // Cell widths vary a lot, which is what makes the column widths matter.
    const note = i % 7 === 0 ? 'a considerably longer note than its neighbours' : 'short'
    lines.push(`| ${i} | item ${i} | ${note} | ${i * 13} |`)
  }
  return lines.join('\n') + '\n'
}

describe('the cost of aligning', () => {
  it('walks an 800-row table without falling over', () => {
    // The size the budget was set against, kept as a case: a change that made
    // alignment quadratic would not return from this at all.
    //
    // What it does *not* do is assert a wall-clock median. That test lived here
    // and had to go: it measured the machine as much as the code, and once the
    // suite grew to seventeen jsdom workers it failed about one run in three
    // while passing every time it ran alone. A gate that reports load as a
    // defect teaches people to re-run gates, which is worse than having none.
    //
    // The guarantee it was reaching for is the lookup count below — the property
    // that made the number what it is, asserted directly and the same on any
    // machine.
    const doc = heavyTable(800)
    const state = EditorState.create({ doc, extensions: schedaSetup() })
    expect(paddingFor(state, 0, doc.length).length).toBeGreaterThan(800)
  })

  it('produces padding for that table rather than quietly doing nothing', () => {
    // Guards the measurement itself: a function that returned an empty list
    // would be very fast and completely useless, and the timing above would
    // happily pass.
    const doc = heavyTable(100)
    const state = EditorState.create({ doc, extensions: schedaSetup() })
    expect(paddingFor(state, 0, doc.length).length).toBeGreaterThan(100)
  })

  it('looks a line up once per row, not once per cell', () => {
    // The property behind the timing, and a steadier thing to assert than the
    // timing itself. `lineAt` is a search through the document; calling it for
    // every cell rather than every row was the difference between 6.4 ms and
    // 1.4 on the owner's worst file — but on a tidy fixture the same mistake
    // costs only 2.3 against 1.3, and a budget narrow enough to catch that
    // would flicker on a busy machine.
    const doc = heavyTable(200)
    const state = EditorState.create({ doc, extensions: schedaSetup() })

    let lookups = 0
    const counted = new Proxy(state.doc, {
      get(target, property, receiver) {
        if (property === 'lineAt') {
          return (position: number) => {
            lookups++
            return target.lineAt(position)
          }
        }
        return Reflect.get(target, property, receiver) as unknown
      },
    })
    const spied = Object.create(state, { doc: { value: counted } }) as EditorState

    paddingFor(spied, 0, doc.length)

    // 202 rows, four cells each. One lookup per row is the shape; a handful
    // more for the delimiter row and the bounds is fine, four per row is not.
    expect(lookups).toBeLessThan(300)
  })
})

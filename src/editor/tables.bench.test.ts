// What aligning a table costs, on a document as heavy as a real one.
//
// This exists because the alternative — rendering a real `<table>` — was
// rejected on a measurement (39.5 ms against 1.4 for the same file), and a
// decision made on a number deserves a test that keeps the number true. The
// budget is deliberately loose: it is there to catch a change of approach, not
// to police tenths of a millisecond on a busy machine.
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
  it('stays in single-digit milliseconds on an 800-row table', () => {
    const doc = heavyTable(800)
    const state = EditorState.create({ doc, extensions: schedaSetup() })

    // The first call also warms the parse; the measurement is of the ones after.
    paddingFor(state, 0, doc.length)

    const runs: number[] = []
    for (let i = 0; i < 15; i++) {
      const start = performance.now()
      paddingFor(state, 0, doc.length)
      runs.push(performance.now() - start)
    }
    runs.sort((a, b) => a - b)
    const median = runs[Math.floor(runs.length / 2)]

    // Measured at 1.4 ms on the owner's worst file. Ten is the budget: a
    // regression that matters — a per-cell document search, a second pass over
    // the tree — costs far more than that, and a busy machine costs far less.
    expect(median).toBeLessThan(10)
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

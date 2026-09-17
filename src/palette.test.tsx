// The one piece of the picker that is this side's own work: turning the core's
// list of matched character indices into a name with those letters in bold.
//
// The matching and the ranking are tested where they live (`quick.rs`). What is
// tested here is the thing a wrong answer would show on screen — letters bolded
// in the wrong place, or a name cut through the middle of a character.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Marked } from './palette'

/** The rendered name, with the bold runs marked by `[` and `]` so a test reads
 *  as the thing somebody would see rather than as a tree of elements. */
function shown(text: string, at: number[]): string {
  return renderToStaticMarkup(<Marked text={text} at={at} />)
    .replace(/<b class="palette-hit">/g, '[')
    .replace(/<\/b>/g, ']')
    .replace(/<\/?span>/g, '')
}

describe('the matched letters', () => {
  it('are bold where the core said they were', () => {
    expect(shown('notes.md', [0, 2, 4])).toBe('[n]o[t]e[s].md')
  })

  it('come out as runs rather than a span per letter', () => {
    // Five elements saying the same thing is five elements to style, and the
    // bold run is the thing the eye is reading.
    expect(shown('notes.md', [0, 1, 2, 3, 4])).toBe('[notes].md')
  })

  it('leave a name with nothing matched alone', () => {
    // What a file matched through its folder gets: no letters of its own were
    // typed, and bolding some anyway would be an explanation that is not true.
    expect(shown('soup.md', [])).toBe('soup.md')
  })

  it('count characters, not bytes', () => {
    // The core matched on characters. An index taken as a position in a UTF-16
    // string would land inside an emoji here and cut it in half.
    expect(shown('🌱 seedling.md', [0, 2])).toBe('[🌱] [s]eedling.md')
  })

  it('handle a match that reaches the last character', () => {
    expect(shown('abc', [2])).toBe('ab[c]')
  })
})

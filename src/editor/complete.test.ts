// Offering a note while a link is being typed.
//
// The part with cases in it is "is the caret inside an unfinished `[[`", and it
// is read from the text rather than from the syntax tree — because an unfinished
// wikilink has produced no node to ask about. That is what these tests hold.
import { describe, expect, it } from 'vitest'
import { openLink } from './complete'

describe('the link being typed', () => {
  it('finds the brackets and what has been typed since', () => {
    const line = 'See [[pl'
    expect(openLink(line, line.length)).toEqual({ inner: 'pl', from: 6 })
  })

  it('finds a bare pair, with nothing typed yet', () => {
    const line = 'See [['
    expect(openLink(line, line.length)).toEqual({ inner: '', from: 6 })
  })

  it('finds nothing in a line with no brackets', () => {
    expect(openLink('just prose', 10)).toBeNull()
  })

  it('does not treat a finished link as one being typed', () => {
    // The caret is past a `]]`, so the link before it is done. Without this a
    // line of prose after a link would look like a link being typed all the way
    // to its end.
    const line = 'See [[plan]] and more'
    expect(openLink(line, line.length)).toBeNull()
  })

  it('finds the second pair when there are two', () => {
    const line = 'See [[plan]] and [[ri'
    expect(openLink(line, line.length)).toEqual({ inner: 'ri', from: 19 })
  })

  it('reads what is before the caret, not the whole line', () => {
    // The caret is inside the brackets and there is text after it — the rest of
    // the link, or the rest of the sentence. Completing against that text would
    // offer notes for words the person has not typed.
    const line = 'See [[pl]] here'
    expect(openLink(line, 8)).toEqual({ inner: 'pl', from: 6 })
  })

  it('keeps the heading and the alias in what was typed', () => {
    // The two sources sort out which half they answer for; this one just reports
    // the text between the brackets.
    const line = 'See [[plan#Ri'
    expect(openLink(line, line.length)).toEqual({ inner: 'plan#Ri', from: 6 })
  })
})

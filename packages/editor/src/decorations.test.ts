// The decoration layer is what makes scheda readable without making it a
// WYSIWYG editor, and the rule that keeps those apart is narrow: a marker is
// hidden only when the cursor is somewhere else. These tests hold that rule.
//
// They assert on which spans carry the collapsing class, never on
// `textContent`: jsdom applies no styles, so hidden text is still in the
// string, and a test reading it would pass no matter what the reader sees.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { schedaEditor } from './setup.js'

/** Builds a real editor over `doc` with the cursor at `cursor`, attached to the
 *  document so the view has a viewport to decorate. */
function view(doc: string, cursor = 0): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: schedaEditor(),
      selection: { anchor: cursor },
    }),
    parent,
  })
}

/** The text of every span the decoration layer has collapsed. */
function collapsed(v: EditorView): string[] {
  return [...v.dom.querySelectorAll('.cm-md-marker-hidden')].map((e) => e.textContent ?? '')
}

/** The text of every span carrying `className`. */
function textsOf(v: EditorView, className: string): string[] {
  return [...v.dom.querySelectorAll(`.${className}`)].map((e) => e.textContent ?? '')
}

/** The text of every line carrying `className`. */
function lineTexts(v: EditorView, className: string): string[] {
  return [...v.dom.querySelectorAll(`.cm-line.${className}`)].map((e) => e.textContent ?? '')
}

const LINK_DOC = 'See [the tracker](https://example.com/x) for tickets.\nelsewhere\n'

describe('markdown decorations', () => {
  it('styles a heading', () => {
    const v = view('# Tuesday\n\nbody\n', 12)
    expect(textsOf(v, 'cm-md-h1').join('')).toContain('Tuesday')
    v.destroy()
  })

  it('styles bold and italic runs', () => {
    const v = view('**bold** and *soft*\n\nelsewhere\n', 22)
    expect(textsOf(v, 'cm-md-strong').join('')).toContain('bold')
    expect(textsOf(v, 'cm-md-emphasis').join('')).toContain('soft')
    v.destroy()
  })

  it('hides the markers on a line the cursor is not on', () => {
    // Cursor on line 3, so line 1's hashes are syntax the reader does not need.
    const v = view('# Tuesday\n\nbody\n', 12)
    expect(collapsed(v)).toContain('#')
    v.destroy()
  })

  it('brings the markers back on the line the cursor is on', () => {
    // Cursor inside the heading: the hashes are text being edited, so they show.
    const v = view('# Tuesday\n\nbody\n', 3)
    expect(collapsed(v)).not.toContain('#')
    v.destroy()
  })

  it('hides a link target on an inactive line, not just the brackets', () => {
    // Hiding the brackets while leaving the URL visible renders
    // `[the tracker](https://example.com/x)` as `the trackerhttps://example.com/x`
    // — text the author never wrote.
    const v = view(LINK_DOC, 56)
    expect(collapsed(v)).toContain('https://example.com/x')
    expect(collapsed(v)).not.toContain('the tracker')
    v.destroy()
  })

  it('shows the whole link source on the line being edited', () => {
    const v = view(LINK_DOC, 5)
    expect(collapsed(v)).toHaveLength(0)
    v.destroy()
  })

  it('hides the space after a quote mark along with the mark', () => {
    // Left behind, the space indents the first row of the line and not the rows
    // it wraps onto.
    const v = view('> a quote\n\nelsewhere\n', 20)
    expect(collapsed(v)).toContain('> ')
    expect(lineTexts(v, 'cm-md-quote-empty')).toEqual([])
    v.destroy()
  })

  it('leaves a space that is no part of a quote mark alone', () => {
    const v = view('>a quote\n\nelsewhere\n', 19)
    expect(collapsed(v)).toContain('>')
    v.destroy()
  })

  it('shows a quote mark and its space on the line being edited', () => {
    const v = view('> a quote\n', 4)
    expect(collapsed(v)).toEqual([])
    v.destroy()
  })

  it('says which lines of a quote hold nothing but the mark', () => {
    const v = view('> one\n>\n> \n> two\n\nelsewhere\n', 25)
    // The lines with a mark alone, spelled both ways: they keep a row, and a
    // line with text does not need telling.
    expect(lineTexts(v, 'cm-md-quote-empty')).toEqual(['>', '> '])
    v.destroy()
  })

  it('never removes a character from the document', () => {
    // The decorations are a view concern; the text is untouched, which is the
    // whole difference between this and a WYSIWYG editor.
    const source = '# Tuesday\n\n**bold** `code` [link](/x)\n'
    const v = view(source, 0)
    expect(v.state.doc.toString()).toBe(source)
    v.destroy()
  })
})

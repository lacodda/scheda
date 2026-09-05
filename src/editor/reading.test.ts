// Reading mode and the front matter fold — the two view states this stage adds.
//
// Both are view states and neither may touch the document: that is the line
// between showing a note differently and rewriting it (ADR 0002), and each
// describe block ends with a test that holds it.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { toggleFrontMatter } from './frontmatter'
import { readingMode, toggleReading } from './reading'
import { schedaSetup } from './setup'

function view(doc: string, cursor = 0): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({ doc, extensions: schedaSetup(), selection: { anchor: cursor } }),
    parent,
  })
}

function textsOf(v: EditorView, className: string): string[] {
  return [...v.dom.querySelectorAll(`.${className}`)].map((e) => e.textContent ?? '')
}

const NOTE = '# Heading\n\nSome **bold** text.\n'
const WITH_FRONT_MATTER = '---\ntitle: A note\ntags: [x]\n---\n\n# Heading\n\ntext\n'

describe('reading mode', () => {
  it('starts off', () => {
    const v = view(NOTE)
    expect(v.state.field(readingMode)).toBe(false)
    v.destroy()
  })

  it('hides the markers on the line the cursor is on', () => {
    // The whole difference: editing shows the markers under the caret, reading
    // shows none at all.
    const v = view(NOTE, 3)
    expect(textsOf(v, 'cm-md-marker-hidden')).not.toContain('#')
    v.dispatch({ effects: toggleReading.of() })
    expect(textsOf(v, 'cm-md-marker-hidden')).toContain('#')
    v.destroy()
  })

  it('refuses edits, including ones that do not come from the keyboard', () => {
    // readOnly rather than a key handler, so a paste or a command cannot get
    // through a mode that only stopped typing.
    const v = view(NOTE)
    v.dispatch({ effects: toggleReading.of() })
    v.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(v.state.doc.toString()).toBe(NOTE)
    v.destroy()
  })

  it('takes edits again once it is off', () => {
    const v = view(NOTE)
    v.dispatch({ effects: toggleReading.of() })
    v.dispatch({ effects: toggleReading.of() })
    v.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(v.state.doc.toString()).toBe('x' + NOTE)
    v.destroy()
  })

  it('marks the editor so the stylesheet can drop the caret', () => {
    const v = view(NOTE)
    expect(v.dom.querySelector('.cm-reading')).toBeNull()
    v.dispatch({ effects: toggleReading.of() })
    expect(v.dom.classList.contains('cm-reading')).toBe(true)
    v.destroy()
  })

  it('does not change the document', () => {
    const v = view(NOTE)
    v.dispatch({ effects: toggleReading.of() })
    expect(v.state.doc.toString()).toBe(NOTE)
    v.destroy()
  })
})

describe('front matter', () => {
  it('folds into a header naming the field count', () => {
    const v = view(WITH_FRONT_MATTER, WITH_FRONT_MATTER.length - 2)
    const header = v.dom.querySelector('.cm-md-frontmatter-header')
    expect(header?.textContent).toBe('2 fields of front matter')
    v.destroy()
  })

  it('unfolds and folds back', () => {
    const v = view(WITH_FRONT_MATTER, WITH_FRONT_MATTER.length - 2)
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).not.toBeNull()
    v.dispatch({ effects: toggleFrontMatter.of() })
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).toBeNull()
    v.dispatch({ effects: toggleFrontMatter.of() })
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).not.toBeNull()
    v.destroy()
  })

  it('folds on open, when the caret is still at the start of the file', () => {
    // The moment the fold is for. A file opens with the caret at 0, which is
    // inside the front matter by any ordinary reading — so treating that as
    // "being edited" meant the fold never happened on open, which a screenshot
    // caught and no test did.
    const v = view(WITH_FRONT_MATTER, 0)
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).not.toBeNull()
    v.destroy()
  })

  it('unfolds itself while the cursor is inside it', () => {
    // A fold over the caret would hide the line being typed into.
    const v = view(WITH_FRONT_MATTER, 6)
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).toBeNull()
    v.destroy()
  })

  it('leaves a `---` in the middle of a note alone', () => {
    // Front matter is only front matter at the very top; elsewhere three dashes
    // are a horizontal rule and must stay one.
    const doc = '# Heading\n\ntext\n\n---\n\nmore\n'
    const v = view(doc, 0)
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).toBeNull()
    expect(textsOf(v, 'cm-md-rule')).toContain('---')
    v.destroy()
  })

  it('ignores an unterminated fence rather than swallowing the note', () => {
    const doc = '---\ntitle: A note\n\n# Heading\n\ntext\n'
    const v = view(doc, doc.length - 2)
    expect(v.dom.querySelector('.cm-md-frontmatter-header')).toBeNull()
    v.destroy()
  })

  it('does not change the document', () => {
    const v = view(WITH_FRONT_MATTER, WITH_FRONT_MATTER.length - 2)
    v.dispatch({ effects: toggleFrontMatter.of() })
    expect(v.state.doc.toString()).toBe(WITH_FRONT_MATTER)
    v.destroy()
  })
})

// Fenced code: which grammar a fence resolves to, and what a block looks like
// when there is no grammar for it.
//
// What is NOT here: whether the tokens actually come out coloured. That needs a
// nested parser to finish asynchronously and a stylesheet to turn tags into
// classes, and jsdom does neither — the first attempt asserted on syntax-tree
// node names, went green on nothing, and would have gone green with the
// highlighting removed entirely. The colouring is checked in `check:layout`,
// against a real browser, where the spans genuinely appear.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { loadCodeLanguage } from './markdown'
import { schedaSetup } from './setup'

function view(doc: string, cursor = 0): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({ doc, extensions: schedaSetup(), selection: { anchor: cursor } }),
    parent,
  })
}

describe('resolving a fence to a grammar', () => {
  it('finds a language by its own name', () => {
    expect(loadCodeLanguage('rust')?.name).toBe('rust')
    expect(loadCodeLanguage('python')?.name).toBe('python')
  })

  it('finds a language by an alias', () => {
    expect(loadCodeLanguage('rs')?.name).toBe('rust')
    expect(loadCodeLanguage('ts')?.name).toBe('typescript')
    expect(loadCodeLanguage('py')?.name).toBe('python')
    expect(loadCodeLanguage('psql')?.name).toBe('sql')
  })

  it('ignores the case of the name', () => {
    expect(loadCodeLanguage('Rust')?.name).toBe('rust')
    expect(loadCodeLanguage('JSON')?.name).toBe('json')
  })

  it('ignores what follows the name on the fence', () => {
    // ```js title="example.js" is common in documentation.
    expect(loadCodeLanguage('rust title="main.rs"')?.name).toBe('rust')
    expect(loadCodeLanguage('  python   {3-5}')?.name).toBe('python')
  })

  it('returns nothing for a language it does not carry', () => {
    // Not an error: the block keeps its background and its monospace, it just
    // is not coloured (decision 2026-09-05).
    expect(loadCodeLanguage('cobol')).toBeNull()
    expect(loadCodeLanguage('brainfuck')).toBeNull()
  })

  it('returns nothing for a bare fence', () => {
    expect(loadCodeLanguage('')).toBeNull()
    expect(loadCodeLanguage('   ')).toBeNull()
  })
})

describe('a fenced block', () => {
  it('marks its lines whatever the language is', () => {
    const v = view('```cobol\nDISPLAY "x".\n```\n\nafter\n', 32)
    expect(v.dom.querySelectorAll('.cm-md-code-line')).toHaveLength(3)
    v.destroy()
  })

  it('marks an indented block too', () => {
    const v = view('paragraph\n\n    indented code\n\nafter\n', 33)
    expect(v.dom.querySelectorAll('.cm-md-code-line').length).toBeGreaterThan(0)
    v.destroy()
  })

  it('leaves the document alone', () => {
    const source = '```rust\nfn main() {}\n```\n'
    const v = view(source, 0)
    expect(v.state.doc.toString()).toBe(source)
    v.destroy()
  })
})

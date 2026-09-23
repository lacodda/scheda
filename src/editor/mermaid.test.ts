// Mermaid blocks: code while editing, a diagram while reading, and the library
// not loaded at all until a diagram is actually drawn.
//
// The library is replaced by a stand-in. What is tested is scheda's share —
// which blocks become diagrams and when, that the text never changes, that a
// block the library refuses still shows its source, and that nothing is loaded
// for a note without a diagram. Whether the library draws a flowchart well is
// the library's business.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toggleReading } from './reading'
import { schedaSetup } from './setup'

const render = vi.hoisted(() => vi.fn())
const initialize = vi.hoisted(() => vi.fn())
const loaded = vi.hoisted(() => ({ count: 0 }))
vi.mock('mermaid', () => {
  loaded.count += 1
  return { default: { render, initialize } }
})

function view(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({ state: EditorState.create({ doc, extensions: schedaSetup() }), parent })
}

/** Lets the dynamic import and the render settle. */
async function settle() {
  for (let round = 0; round < 5; round += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const NOTE = 'before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter\n'

beforeEach(() => {
  render.mockReset()
  render.mockResolvedValue({ svg: '<svg data-drawn="yes"></svg>', diagramType: 'flowchart' })
})

describe('a mermaid block', () => {
  it('stays code while the note is being edited, and loads nothing', async () => {
    const v = view(NOTE)
    await settle()
    expect(v.dom.querySelector('.cm-mermaid')).toBeNull()
    expect(v.dom.textContent).toContain('A --> B')
    expect(loaded.count).toBe(0)
    v.destroy()
  })

  it('becomes the diagram in reading mode, and code again after', async () => {
    const v = view(NOTE)
    v.dispatch({ effects: toggleReading.of() })
    await settle()
    const box = v.dom.querySelector('.cm-mermaid')
    expect(box?.querySelector('svg[data-drawn="yes"]')).not.toBeNull()
    expect(render).toHaveBeenCalledWith(expect.any(String), 'graph TD\n  A --> B')
    // The lines around it are untouched.
    expect(v.dom.textContent).toContain('before')
    expect(v.dom.textContent).toContain('after')

    v.dispatch({ effects: toggleReading.of() })
    expect(v.dom.querySelector('.cm-mermaid')).toBeNull()
    expect(v.state.doc.toString()).toBe(NOTE)
    v.destroy()
  })

  it('leaves other code blocks as code', async () => {
    const v = view('```rust\nfn main() {}\n```\n')
    v.dispatch({ effects: toggleReading.of() })
    await settle()
    expect(v.dom.querySelector('.cm-mermaid')).toBeNull()
    expect(v.dom.textContent).toContain('fn main()')
    v.destroy()
  })

  it('shows the source and the reason when the library refuses it', async () => {
    render.mockRejectedValue(new Error('Parse error on line 1'))
    const v = view('```mermaid\nnot a diagram\n```\n')
    v.dispatch({ effects: toggleReading.of() })
    await settle()
    const box = v.dom.querySelector('.cm-mermaid--failed')
    expect(box?.textContent).toContain('Parse error on line 1')
    expect(box?.querySelector('pre')?.textContent).toBe('not a diagram')
    v.destroy()
  })
})

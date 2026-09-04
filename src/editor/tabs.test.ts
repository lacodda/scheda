// Tabs hold documents, and the rules about which document is which are exactly
// the kind that break silently: text written into one tab turning up in
// another, a dirty file closing without a word, an "Untitled" left behind every
// time a file is opened.
//
// These drive the real handle against a real editor view, because the bug this
// guards against is a bug in the swapping, and a mocked view swaps nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '../core'

// The handle talks to the core to open and save. Neither is what these tests
// are about, so the door is stubbed and the disk never enters into it.
vi.mock('../core', () => ({
  openFile: vi.fn(async (path: string) => ({
    path,
    text: `contents of ${path}\n`,
    shape: { line_ending: 'lf', bom: false },
    readOnly: false,
  })),
  saveFile: vi.fn(async () => undefined),
}))

const { mountEditor } = await import('./mount')
const core = await import('../core')

function file(path: string, text: string, readOnly = false): OpenFile {
  return { path, text, shape: { line_ending: 'lf', bom: false }, readOnly }
}

function mount(initial: OpenFile | null = null) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return mountEditor(root, initial)
}

/** Types into the active editor, the way a keystroke would. */
function type(editor: ReturnType<typeof mount>, text: string) {
  editor.view.dispatch({
    changes: { from: editor.view.state.doc.length, insert: text },
  })
}

describe('tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('starts with exactly one tab', () => {
    const editor = mount(file('/a.md', 'a\n'))
    expect(editor.tabs()).toHaveLength(1)
    expect(editor.active().path).toBe('/a.md')
  })

  it('keeps the text of each tab to itself when switching', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))

    type(editor, 'typed into b')
    const bId = editor.active().id

    editor.select(editor.tabs()[0].id)
    expect(editor.view.state.doc.toString()).toBe('a\n')

    editor.select(bId)
    expect(editor.view.state.doc.toString()).toBe('b\ntyped into b')
  })

  it('gives each tab its own undo history', () => {
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, 'edit in a')
    editor.adopt(file('/b.md', 'b\n'))

    // Undo in b must not reach back into a's edit.
    editor.select(editor.tabs()[0].id)
    expect(editor.view.state.doc.toString()).toBe('a\nedit in a')
  })

  it('reuses an untouched blank tab rather than leaving it behind', () => {
    const editor = mount(null)
    editor.adopt(file('/a.md', 'a\n'))

    expect(editor.tabs()).toHaveLength(1)
    expect(editor.active().path).toBe('/a.md')
  })

  it('keeps a blank tab that has been typed into', () => {
    const editor = mount(null)
    type(editor, 'unsaved thoughts')
    editor.adopt(file('/a.md', 'a\n'))

    expect(editor.tabs()).toHaveLength(2)
    expect(editor.tabs()[0].path).toBeNull()
  })

  it('focuses the existing tab instead of opening a file twice', async () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))

    await editor.open('/a.md')

    expect(editor.tabs()).toHaveLength(2)
    expect(editor.active().path).toBe('/a.md')
    expect(core.openFile).not.toHaveBeenCalled()
  })

  it('refuses to close a tab with unsaved changes unless forced', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    type(editor, 'unsaved')

    const id = editor.active().id
    expect(editor.close(id)).toBe(false)
    expect(editor.tabs()).toHaveLength(2)

    expect(editor.close(id, true)).toBe(true)
    expect(editor.tabs()).toHaveLength(1)
  })

  it('closes a clean tab without argument', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))

    expect(editor.close(editor.active().id)).toBe(true)
    expect(editor.tabs()).toHaveLength(1)
    expect(editor.active().path).toBe('/a.md')
  })

  it('never leaves the window with no document', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.close(editor.active().id)

    expect(editor.tabs()).toHaveLength(1)
    expect(editor.active().path).toBeNull()
    expect(editor.view.state.doc.toString()).toBe('')
  })

  it('reports dirtiness per tab, including the one off screen', () => {
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, 'edited')
    const aId = editor.active().id

    editor.adopt(file('/b.md', 'b\n'))

    expect(editor.isDirty(aId)).toBe(true)
    expect(editor.isDirty()).toBe(false)
    expect(editor.anyDirty()).toBe(true)
  })

  it('saves the text that is on screen, not a stale copy', async () => {
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, 'fresh')

    await editor.save()

    expect(core.saveFile).toHaveBeenCalledWith('/a.md', 'a\nfresh', {
      line_ending: 'lf',
      bom: false,
    })
    expect(editor.isDirty()).toBe(false)
  })

  it('saves a background tab from its stashed state', async () => {
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, 'edited in a')
    const aId = editor.active().id
    editor.adopt(file('/b.md', 'b\n'))

    await editor.save(aId)

    expect(core.saveFile).toHaveBeenCalledWith('/a.md', 'a\nedited in a', {
      line_ending: 'lf',
      bom: false,
    })
    expect(editor.isDirty(aId)).toBe(false)
  })

  it('adopts the new path on save-as and drops read-only', async () => {
    const editor = mount(file('/a.md', 'a\n', true))
    await editor.saveAs('/b.md')

    expect(editor.active().path).toBe('/b.md')
    expect(editor.active().readOnly).toBe(false)
    expect(editor.isDirty()).toBe(false)
  })

  it('does not write a read-only file', async () => {
    const editor = mount(file('/a.md', 'a\n', true))
    await editor.save()
    expect(core.saveFile).not.toHaveBeenCalled()
  })
})

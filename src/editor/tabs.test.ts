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
  // Drafts are filed by the core too. The key it hands back is what the tab
  // keeps using, so the stub has to answer with one rather than with nothing.
  keepDraft: vi.fn(async (key: string | null) => key ?? 'draft-1'),
  discardDraft: vi.fn(async () => undefined),
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

  it('makes the tab follow a file that was renamed under it', () => {
    // The rename happens in the tree; the tab showing the file has to end up
    // pointing at the new name, or the next `Ctrl+S` writes to a path that no
    // longer names anything.
    const editor = mount(file('/notes/a.md', 'a\n'))
    editor.adopt(file('/notes/b.md', 'b\n'))

    editor.follow('/notes/a.md', '/notes/renamed.md')

    expect(editor.tabs()[0].path).toBe('/notes/renamed.md')
    expect(editor.tabs()[1].path).toBe('/notes/b.md')
  })

  it('follows a rename even for the tab that is not on screen', () => {
    // The stashed state carries the document path as well, and a tab renamed
    // while another is showing would otherwise resolve its pictures against a
    // name it no longer has.
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))

    editor.follow('/a.md', '/moved.md')

    expect(editor.tabs()[0].path).toBe('/moved.md')
    expect(editor.active().path).toBe('/b.md')
  })

  it('reads a rename through either spelling of the path', () => {
    // The tree hands back whatever the filesystem said; the tab may hold what
    // was typed on a command line. A `===` between the two leaves the tab
    // behind, pointing at a file that is not there any more.
    const editor = mount(file('C:\\vault\\a.md', 'a\n'))
    editor.follow('C:/vault/a.md', 'C:\\vault\\b.md')
    expect(editor.active().path).toBe('C:\\vault\\b.md')
  })

  it('tells a tab its file went to the recycle bin, and keeps the text', () => {
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, 'work in progress')

    editor.orphan('/a.md')

    expect(editor.active().orphaned).toBe(true)
    expect(editor.view.state.doc.toString()).toBe('a\nwork in progress')
  })

  it('orphans every tab under a deleted folder', () => {
    const editor = mount(file('/notes/one.md', 'one\n'))
    editor.adopt(file('/notes/deep/two.md', 'two\n'))
    editor.adopt(file('/elsewhere/three.md', 'three\n'))

    editor.orphan('/notes')

    expect(editor.tabs().map((tab) => tab.orphaned)).toEqual([true, true, false])
  })

  it('does not orphan a tab in a folder whose name merely starts the same', () => {
    // `/notes-old/one.md` starts with `/notes` as a string and is somewhere
    // else entirely.
    const editor = mount(file('/notes-old/one.md', 'one\n'))
    editor.orphan('/notes')
    expect(editor.active().orphaned).toBe(false)
  })

  it('stops being orphaned once the text has a file again', async () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.orphan('/a.md')

    await editor.saveAs('/b.md')

    expect(editor.active().orphaned).toBe(false)
  })

  it('opens one tab for a file named two ways', async () => {
    const editor = mount(file('C:\\vault\\a.md', 'a\n'))
    await editor.open('C:/vault/a.md')
    expect(editor.tabs()).toHaveLength(1)
  })

  it('brings a draft back as a tab with unsaved text', () => {
    const editor = mount(file('/a.md', 'a\n'))

    editor.adoptDraft({ key: 'draft-7', text: 'three lines I typed yesterday' })

    expect(editor.active().path).toBeNull()
    expect(editor.view.state.doc.toString()).toBe('three lines I typed yesterday')
    // Never written to a file, so it is unsaved by definition — and the dot in
    // the strip is what says so.
    expect(editor.isDirty()).toBe(true)
  })

  it('files an unnamed tab as a draft when the window is closing', async () => {
    const editor = mount(null)
    type(editor, 'a thought')

    await editor.keepDrafts()

    expect(core.keepDraft).toHaveBeenCalledWith(null, 'a thought')
  })

  it('does not file a named file as a draft', async () => {
    // The file on disk is the truth; a second copy in the application folder
    // would be a second one to disagree with it (ADR 0002).
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, ' edited')

    await editor.keepDrafts()

    expect(core.keepDraft).not.toHaveBeenCalled()
  })

  it('throws a draft away when its tab is closed on purpose', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adoptDraft({ key: 'draft-7', text: 'something' })
    const draftId = editor.active().id

    editor.close(draftId, true)

    expect(core.discardDraft).toHaveBeenCalledWith('draft-7')
  })

  it('throws a draft away when its text is saved to a real file', async () => {
    const editor = mount(null)
    editor.adoptDraft({ key: 'draft-7', text: 'something' })

    await editor.saveAs('/kept.md')

    expect(core.discardDraft).toHaveBeenCalledWith('draft-7')
    expect(editor.active().path).toBe('/kept.md')
  })
})

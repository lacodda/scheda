// Two panes over one strip, pinned tabs, a session put back, and autosave.
//
// Driven against real editor views, like the other tab tests: every bug worth
// catching here is a bug in which state is in which view, and a mocked view
// holds no state at all.
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '../core'

/** What the file on disk holds, per path, for autosave's check. */
const disk = new Map<string, string>()

vi.mock('../core', () => ({
  openFile: vi.fn(async (path: string) => ({
    path,
    text: `contents of ${path}\n`,
    shape: { line_ending: 'lf', bom: false },
    readOnly: false,
  })),
  // Written only when the file still holds what the caller expected — the
  // core's rule, played back here so autosave can be refused.
  saveFile: vi.fn(async (path: string, text: string, _shape: unknown, expected: string | null = null) => {
    if (expected !== null && disk.get(path) !== expected) return false
    disk.set(path, text)
    return true
  }),
  keepDraft: vi.fn(async (key: string | null) => key ?? 'draft-1'),
  discardDraft: vi.fn(async () => undefined),
  releaseWaiter: vi.fn(async () => undefined),
}))

const { mountEditor } = await import('./mount')
const core = await import('../core')

function file(path: string, text: string): OpenFile {
  return { path, text, shape: { line_ending: 'lf', bom: false }, readOnly: false }
}

function mount(initial: OpenFile | null = null) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return mountEditor(root, initial)
}

type Editor = ReturnType<typeof mount>

function type(editor: Editor, text: string) {
  editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: text } })
}

const pathsOf = (editor: Editor) => editor.tabs().map((tab) => tab.path)
const shown = (editor: Editor) =>
  editor.panes().map((id) => editor.tabs().find((tab) => tab.id === id)?.path ?? null)

describe('two panes', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('splits beside the tab in front, with the one used before it', () => {
    const editor = mount(file('/plan.md', 'plan\n'))
    editor.adopt(file('/diary.md', 'diary\n'))

    editor.toggleSplit()

    expect(shown(editor)).toEqual(['/diary.md', '/plan.md'])
    // The keyboard stays where it was.
    expect(editor.active().path).toBe('/diary.md')
    expect(document.querySelectorAll('.pane')).toHaveLength(2)
  })

  it('never shows one tab in both panes', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    editor.toggleSplit()
    const aId = editor.tabs()[0].id

    // `a` is in the second pane; selecting it from the first moves the
    // keyboard there instead of putting a second copy on screen.
    editor.focusPane(0)
    editor.select(aId)

    expect(shown(editor)).toEqual(['/b.md', '/a.md'])
    expect(editor.focusedPane()).toBe(1)
  })

  it('keeps each pane typing into its own document', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    editor.toggleSplit()

    type(editor, 'into b')
    editor.focusPane(1)
    type(editor, 'into a')

    const [aTab, bTab] = editor.tabs()
    expect(editor.isDirty(aTab.id)).toBe(true)
    expect(editor.views()[1].state.doc.toString()).toBe('a\ninto a')
    expect(editor.views()[0].state.doc.toString()).toBe('b\ninto b')
    expect(editor.isDirty(bTab.id)).toBe(true)
  })

  it('keeps a tab’s undo history when it moves to the other pane', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    type(editor, 'typed in b')
    const bId = editor.active().id

    editor.showIn(bId, 1)
    expect(editor.focusedPane()).toBe(1)
    expect(editor.view.state.doc.toString()).toBe('b\ntyped in b')

    // Undo reaches the edit made while the tab was in the first pane.
    undo(editor.view)
    expect(editor.view.state.doc.toString()).toBe('b\n')
  })

  it('swaps two tabs when one is dragged onto the other’s pane', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    editor.toggleSplit()
    const bId = editor.tabs()[1].id

    editor.showIn(bId, 1)

    expect(shown(editor)).toEqual(['/a.md', '/b.md'])
  })

  it('closes the split and keeps the pane the keyboard is in', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    editor.toggleSplit()
    editor.focusPane(1)

    editor.toggleSplit()

    expect(shown(editor)).toEqual(['/a.md'])
    expect(document.querySelectorAll('.pane')).toHaveLength(1)
  })

  it('closes a pane whose last tab goes, rather than leaving it empty', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    editor.toggleSplit()
    editor.focusPane(1)

    editor.close(editor.active().id)

    expect(editor.panes()).toHaveLength(1)
    expect(pathsOf(editor)).toEqual(['/b.md'])
  })

  it('splits a single tab by putting a new draft beside it', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.toggleSplit()
    expect(shown(editor)).toEqual(['/a.md', null])
  })
})

describe('pinned tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('stand first, in the order they were pinned', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    editor.adopt(file('/c.md', 'c\n'))
    const [, b, c] = editor.tabs()

    editor.pin(c.id, true)
    editor.pin(b.id, true)

    expect(pathsOf(editor)).toEqual(['/c.md', '/b.md', '/a.md'])
  })

  it('stay among the pinned when dragged past them', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.adopt(file('/b.md', 'b\n'))
    const [a, b] = editor.tabs()
    editor.pin(b.id, true)

    // Dropped after an unpinned tab: it becomes the last pinned one instead of
    // quietly leaving the group.
    editor.move(b.id, null)
    expect(pathsOf(editor)).toEqual(['/b.md', '/a.md'])

    editor.move(a.id, b.id)
    expect(pathsOf(editor)).toEqual(['/b.md', '/a.md'])
  })
})

describe('a session', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('comes back as it was left: order, pins, caret, split', () => {
    const before = mount(file('/a.md', 'first line\nsecond line\n'))
    before.adopt(file('/b.md', 'b\n'))
    before.adopt(file('/c.md', 'c\n'))
    const [a, b] = before.tabs()
    before.pin(b.id, true)
    before.select(a.id)
    before.view.dispatch({ selection: { anchor: 11, head: 17 } })
    before.toggleSplit()

    const session = before.snapshot()
    expect(session.tabs.map((tab) => tab.path)).toEqual(['/b.md', '/a.md', '/c.md'])

    document.body.innerHTML = ''
    const after = mount(file('/a.md', 'first line\nsecond line\n'))
    after.restore(
      session.tabs.map((entry) => ({
        ...entry,
        file: file(entry.path!, entry.path === '/a.md' ? 'first line\nsecond line\n' : 'x\n'),
        draft: null,
      })),
      session,
      false,
    )

    expect(pathsOf(after)).toEqual(['/b.md', '/a.md', '/c.md'])
    expect(after.tabs()[0].pinned).toBe(true)
    expect(after.active().path).toBe('/a.md')
    expect(after.view.state.selection.main.anchor).toBe(11)
    expect(after.view.state.selection.main.head).toBe(17)
    expect(after.panes()).toHaveLength(2)
  })

  it('keeps the file the window was launched with in front', () => {
    const editor = mount(file('/launched.md', 'l\n'))
    editor.restore(
      [
        { file: file('/a.md', 'a\n'), draft: null, pinned: false, anchor: 0, head: 0, top: 0 },
        { file: file('/b.md', 'b\n'), draft: null, pinned: false, anchor: 0, head: 0, top: 0 },
      ],
      { active: 1, beside: null, focused: 0 },
      true,
    )
    expect(pathsOf(editor)).toEqual(['/a.md', '/b.md', '/launched.md'])
    expect(editor.active().path).toBe('/launched.md')
  })

  it('replaces the blank placeholder a bare launch opens with', () => {
    const editor = mount(null)
    editor.restore(
      [
        { file: null, draft: { key: 'k1', text: 'draft text' }, pinned: false, anchor: 0, head: 0, top: 0 },
        { file: file('/a.md', 'a\n'), draft: null, pinned: false, anchor: 0, head: 0, top: 0 },
      ],
      { active: 1, beside: null, focused: 0 },
      false,
    )
    expect(pathsOf(editor)).toEqual([null, '/a.md'])
    expect(editor.tabs()[0].draftKey).toBe('k1')
    expect(editor.active().path).toBe('/a.md')
  })

  it('holds a caret from a file that has since grown shorter inside it', () => {
    const editor = mount(null)
    editor.restore(
      [{ file: file('/a.md', 'short'), draft: null, pinned: false, anchor: 400, head: 900, top: 900 }],
      { active: 0, beside: null, focused: 0 },
      false,
    )
    expect(editor.view.state.selection.main.head).toBe(5)
  })

  it('leaves an empty draft out: there is nothing to bring back', () => {
    const editor = mount(file('/a.md', 'a\n'))
    editor.openBlank()
    expect(editor.snapshot().tabs.map((tab) => tab.path)).toEqual(['/a.md'])
  })
})

describe('autosave', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    disk.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('does nothing while it is off', async () => {
    disk.set('/a.md', 'a\n')
    const editor = mount(file('/a.md', 'a\n'))
    type(editor, 'x')
    await editor.flushAutosave()
    expect(core.saveFile).not.toHaveBeenCalled()
  })

  it('writes a named file after a pause, and only it', async () => {
    vi.useFakeTimers()
    disk.set('/a.md', 'a\n')
    const editor = mount(file('/a.md', 'a\n'))
    editor.configure({ autosave: true })
    editor.openBlank()
    type(editor, 'a draft is not a file')
    editor.select(editor.tabs()[0].id)
    type(editor, 'typed')

    await vi.advanceTimersByTimeAsync(1100)

    expect(core.saveFile).toHaveBeenCalledTimes(1)
    expect(disk.get('/a.md')).toBe('a\ntyped')
    expect(editor.isDirty()).toBe(false)
  })

  it('never writes over a file that changed on disk, and says so', async () => {
    disk.set('/a.md', 'a\n')
    const editor = mount(file('/a.md', 'a\n'))
    editor.configure({ autosave: true })
    const refused: number[] = []
    editor.onAutosaveRefused((id) => refused.push(id))
    type(editor, 'mine')
    // Another program wrote the file in the meantime.
    disk.set('/a.md', 'theirs\n')

    await editor.flushAutosave()

    expect(disk.get('/a.md')).toBe('theirs\n')
    expect(editor.isDirty()).toBe(true)
    expect(refused).toEqual([editor.active().id])
  })

  it('leaves a deleted file deleted', async () => {
    disk.set('/a.md', 'a\n')
    const editor = mount(file('/a.md', 'a\n'))
    editor.configure({ autosave: true })
    type(editor, 'x')
    editor.orphan('/a.md')
    await editor.flushAutosave()
    expect(core.saveFile).not.toHaveBeenCalled()
  })
})

describe('window options', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('give a tab opened after a change the new answer', () => {
    // Bracket closing is an input handler when it is on and nothing when it is
    // off, so counting the handlers tells the two apart without typing.
    const handlers = (editor: Editor) => editor.view.state.facet(EditorView.inputHandler).length
    const editor = mount(file('/a.md', 'a\n'))
    const off = handlers(editor)
    editor.configure({ closeBrackets: true })
    expect(handlers(editor)).toBeGreaterThan(off)

    // A tab that did not exist when the setting changed.
    editor.openBlank()
    expect(handlers(editor)).toBeGreaterThan(off)
  })
})

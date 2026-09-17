// What a tab does when its file is written by somebody else.
//
// This is the half of "Outside" that lives in the tabs: taking new text without
// losing the shape it arrived in, accepting text as saved without writing it,
// and letting go of a process that was blocked on this tab. The half that
// decides *which* of those happens — silence, reload, or the question — is the
// shell's, and the rules it follows are stated in `reconcile` there.
//
// Driven against a real editor view, like the other tab tests: the bug these
// guard against is a bug in swapping state, and a mocked view swaps nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '../core'

/** What `rereadFile` will answer with next. Set by each test, because the whole
 *  point of a re-read is that the file is no longer what the tab is holding. */
let onDisk: OpenFile = {
  path: '/vault/note.md',
  text: 'from disk\n',
  shape: { line_ending: 'lf', bom: false },
  readOnly: false,
}

vi.mock('../core', () => ({
  openFile: vi.fn(async (path: string) => ({
    path,
    text: `contents of ${path}\n`,
    shape: { line_ending: 'lf', bom: false },
    readOnly: false,
  })),
  saveFile: vi.fn(async () => undefined),
  rereadFile: vi.fn(async () => onDisk),
  releaseWaiter: vi.fn(async () => undefined),
  keepDraft: vi.fn(async (key: string | null) => key ?? 'draft-1'),
  discardDraft: vi.fn(async () => undefined),
}))

const { mountEditor } = await import('./mount')
const core = await import('../core')

function file(path: string, text: string, extra: Partial<OpenFile> = {}): OpenFile {
  return { path, text, shape: { line_ending: 'lf', bom: false }, readOnly: false, ...extra }
}

function mount(initial: OpenFile | null = null) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return mountEditor(root, initial)
}

function type(editor: ReturnType<typeof mount>, text: string) {
  editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: text } })
}

describe('a file written from outside', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    onDisk = file('/vault/note.md', 'from disk\n')
  })

  it('reaches the tab that is showing it', async () => {
    const editor = mount(file('/vault/note.md', 'as opened\n'))
    await editor.reload(editor.active().id)
    expect(editor.view.state.doc.toString()).toBe('from disk\n')
  })

  it('leaves the tab clean, not dirty against its old text', async () => {
    // The text on screen is the text on disk now. A dot in the tab strip would
    // say there is something unsaved, and there is not.
    const editor = mount(file('/vault/note.md', 'as opened\n'))
    type(editor, 'mine')
    expect(editor.isDirty()).toBe(true)

    await editor.reload(editor.active().id)
    expect(editor.isDirty()).toBe(false)
  })

  it('brings the shape with it', async () => {
    // The case this exists for: a note rewritten by a sync client comes back
    // with CRLF where it had LF. Saving it in the shape it had *before* would
    // rewrite every line of somebody else's file.
    const editor = mount(file('/vault/note.md', 'as opened\n'))
    onDisk = {
      path: '/vault/note.md',
      text: 'from disk\n',
      shape: { line_ending: 'crlf', bom: true },
      readOnly: false,
    }

    await editor.reload(editor.active().id)
    expect(editor.active().shape).toEqual({ line_ending: 'crlf', bom: true })

    await editor.save()
    expect(core.saveFile).toHaveBeenCalledWith('/vault/note.md', 'from disk\n', {
      line_ending: 'crlf',
      bom: true,
    })
  })

  it('reaches a tab that is not the one on screen', async () => {
    // A vault edited elsewhere changes files behind the tab you are looking at,
    // and a reload that only worked on the active one would leave the others
    // showing text that is no longer anywhere.
    const editor = mount(file('/vault/note.md', 'as opened\n'))
    const background = editor.active().id
    editor.adopt(file('/vault/other.md', 'other\n'))
    expect(editor.active().path).toBe('/vault/other.md')

    await editor.reload(background)
    expect(editor.active().path).toBe('/vault/other.md')
    editor.select(background)
    expect(editor.view.state.doc.toString()).toBe('from disk\n')
  })

  it('un-orphans a tab whose file came back', async () => {
    const editor = mount(file('/vault/note.md', 'as opened\n'))
    editor.orphan('/vault/note.md')
    expect(editor.active().orphaned).toBe(true)

    await editor.reload(editor.active().id)
    expect(editor.active().orphaned).toBe(false)
  })

  it('is not re-read for a tab that has no file', async () => {
    // A draft has nothing on disk to be behind.
    const editor = mount(null)
    await editor.reload(editor.active().id)
    expect(core.rereadFile).not.toHaveBeenCalled()
  })
})

describe('keeping your own version', () => {
  it('stops the tab being dirty without writing anything', () => {
    // The person looked at both versions and kept theirs. Theirs is on screen,
    // and it wins when they save — but the window must stop asking about a
    // change they have already answered.
    const editor = mount(file('/vault/note.md', 'as opened\n'))
    type(editor, 'mine')
    const text = editor.view.state.doc.toString()

    editor.acceptAsSaved(editor.active().id, text)
    expect(editor.isDirty()).toBe(false)
    expect(core.saveFile).not.toHaveBeenCalled()
    expect(editor.view.state.doc.toString()).toBe(text)
  })
})

describe('a tab somebody is waiting on', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('lets the waiter go when it closes', () => {
    const editor = mount(file('/vault/msg.md', 'commit message\n', { awaited: true }))
    expect(editor.active().awaited).toBe(true)

    editor.close(editor.active().id, true)
    expect(core.releaseWaiter).toHaveBeenCalledWith('/vault/msg.md')
  })

  it('lets nobody go when an ordinary tab closes', () => {
    const editor = mount(file('/vault/note.md', 'a note\n'))
    editor.close(editor.active().id, true)
    expect(core.releaseWaiter).not.toHaveBeenCalled()
  })

  it('takes on the promise when the same file is handed over again', () => {
    // Somebody ran `scheda --wait` on a file this window already had open. The
    // tab is the one that has to release them; without this the process stays
    // blocked on a tab that never knew about it.
    const editor = mount(file('/vault/note.md', 'a note\n'))
    editor.adopt(file('/vault/note.md', 'a note\n', { awaited: true }))

    expect(editor.tabs()).toHaveLength(1)
    expect(editor.active().awaited).toBe(true)

    editor.close(editor.active().id, true)
    expect(core.releaseWaiter).toHaveBeenCalledWith('/vault/note.md')
  })
})

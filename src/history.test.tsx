// What the history panel puts on screen for the answers the core gives it.
//
// The reading is tested where it lives (`history.rs`): which commits, which
// lines, what a version said. What is tested here is the window's own work: that
// each kind of answer says the right thing, that an answer is never shown against
// a note it was not read for, and when a past version comes and goes.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Change, History, Revision } from './core'
import type { EditorHandle } from './editor/mount'
import { HistoryPanel } from './history'

const core = vi.hoisted(() => ({
  readHistory: vi.fn(),
  readChange: vi.fn(),
  readRevision: vi.fn(),
}))
vi.mock('./core', () => core)
// The editor as a package is its own subject, and the pane only has to have one.
vi.mock('./editor/host', () => ({ schedaHost: {} }))

function revision(commit: string, overrides: Partial<Revision> = {}): Revision {
  return {
    commit: commit.padEnd(40, '0'),
    subject: `subject of ${commit}`,
    author: 'A Writer',
    seconds: 1790000000,
    path: 'notes/plan.md',
    status: 'modified',
    from: null,
    ...overrides,
  }
}

function history(...revisions: Revision[]): History {
  return { revisions, truncated: false }
}

const CHANGE: Change = {
  added: 1,
  removed: 1,
  text: true,
  cut: false,
  hunks: [
    [
      { kind: 'context', text: 'around' },
      { kind: 'removed', text: 'as it was' },
      { kind: 'added', text: 'as it is' },
    ],
  ],
}

let host: HTMLDivElement
let editorHost: HTMLDivElement
let root: Root
const focused = vi.fn()

function editorShowing(path: string | null): EditorHandle {
  return {
    active: () => ({ id: 1, path }),
    host: editorHost,
    view: { focus: focused },
  } as unknown as EditorHandle
}

beforeEach(() => {
  core.readHistory.mockReset()
  core.readChange.mockReset().mockResolvedValue(CHANGE)
  core.readRevision.mockReset().mockResolvedValue('# As it was\n')
  focused.mockReset()
  host = document.createElement('div')
  editorHost = document.createElement('div')
  document.body.append(host, editorHost)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  editorHost.remove()
})

async function draw(path: string | null = '/vault/notes/plan.md', revisionCount = 0) {
  await act(async () => {
    root.render(<HistoryPanel editor={editorShowing(path)} revision={revisionCount} />)
  })
}

async function click(selector: string, within: ParentNode = document) {
  const element = within.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`nothing matches ${selector}`)
  await act(async () => {
    element.click()
  })
}

const rows = () => [...host.querySelectorAll('.history-item')]
const lines = () => [...host.querySelectorAll('.history-line')].map((line) => line.className)

describe('the history panel', () => {
  it('says a draft has no history, and asks nothing', async () => {
    await draw(null)
    expect(host.textContent).toContain('A draft has no history yet.')
    expect(core.readHistory).not.toHaveBeenCalled()
  })

  it('says when the note is in no repository', async () => {
    core.readHistory.mockResolvedValue(null)
    await draw()
    expect(host.textContent).toContain('This note is not in a git repository.')
  })

  it('says when git has no record of the note', async () => {
    core.readHistory.mockResolvedValue(history())
    await draw()
    expect(host.textContent).toContain('Git has no record of this note yet.')
  })

  it('shows what the core said when the repository could not be read', async () => {
    core.readHistory.mockRejectedValue({ message: 'the repository is damaged' })
    await draw()
    expect(host.textContent).toContain('the repository is damaged')
  })

  it('says it is reading while it is', async () => {
    core.readHistory.mockReturnValue(new Promise(() => {}))
    await draw()
    expect(host.textContent).toContain('Reading the history…')
  })

  it('lists the commits with who, when and which', async () => {
    core.readHistory.mockResolvedValue(
      history(
        revision('aaaaaaa1'),
        revision('bbbbbbb2', { status: 'renamed', from: 'plan.md' }),
        revision('ccccccc3', { status: 'added', subject: '' }),
      ),
    )
    await draw()
    expect(rows()).toHaveLength(3)
    expect(rows()[0].textContent).toContain('subject of aaaaaaa1')
    const meta = rows()[0].querySelector('.history-meta')?.textContent
    expect(meta).toContain('A Writer')
    expect(meta).toContain('aaaaaaa')
    expect(meta).not.toContain('aaaaaaa1')
    expect(rows()[1].textContent).toContain('Moved from plan.md')
    expect(rows()[2].textContent).toContain('Added')
    expect(rows()[2].textContent).toContain('(no message)')
  })

  it('says when the list stops short of the beginning', async () => {
    core.readHistory.mockResolvedValue({ revisions: [revision('a')], truncated: true })
    await draw()
    expect(host.querySelector('.history-count')?.textContent).toBe('1+')
    expect(host.textContent).toContain('Older changes are not listed.')
  })

  it('never shows an answer against a note it was not read for', async () => {
    core.readHistory.mockResolvedValueOnce(history(revision('a')))
    await draw('/vault/a.md')
    expect(rows()).toHaveLength(1)

    core.readHistory.mockReturnValue(new Promise(() => {}))
    await draw('/vault/b.md')
    expect(rows()).toHaveLength(0)
    expect(host.textContent).toContain('Reading the history…')
  })

  it('keeps a late answer about the last note off the screen', async () => {
    let answerAboutA: (value: History) => void = () => {}
    core.readHistory.mockReturnValueOnce(
      new Promise<History>((resolve) => {
        answerAboutA = resolve
      }),
    )
    await draw('/vault/a.md')
    core.readHistory.mockResolvedValueOnce(history())
    await draw('/vault/b.md')
    await act(async () => {
      answerAboutA(history(revision('a')))
    })
    expect(rows()).toHaveLength(0)
    expect(host.textContent).toContain('Git has no record of this note yet.')
  })

  it('reads the list again when the vault is written to and when the window comes back', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw('/vault/a.md', 0)
    expect(core.readHistory).toHaveBeenCalledTimes(1)

    await draw('/vault/a.md', 1)
    expect(core.readHistory).toHaveBeenCalledTimes(2)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(core.readHistory).toHaveBeenCalledTimes(3)
  })

  it('keeps the list on screen while it is read again', async () => {
    core.readHistory.mockResolvedValueOnce(history(revision('a')))
    await draw('/vault/a.md', 0)
    core.readHistory.mockReturnValue(new Promise(() => {}))
    await draw('/vault/a.md', 1)
    expect(rows()).toHaveLength(1)
  })

  it('reads a change when its row is opened, by the path the note had then', async () => {
    const row = revision('a', { path: 'old/plan.md' })
    core.readHistory.mockResolvedValue(history(row))
    await draw()
    expect(core.readChange).not.toHaveBeenCalled()

    await click('.history-item')
    expect(core.readChange).toHaveBeenCalledWith('/vault/notes/plan.md', row.commit, 'old/plan.md')
    expect(host.querySelector('.history-counts')?.textContent).toBe('+1 −1')
    expect(lines()).toEqual([
      'history-line history-line--context',
      'history-line history-line--removed',
      'history-line history-line--added',
    ])
    expect(host.querySelector('.history-item')?.getAttribute('aria-expanded')).toBe('true')

    await click('.history-item')
    expect(lines()).toEqual([])
  })

  it('says what kind of nothing a change has to show', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw()

    core.readChange.mockResolvedValue({ ...CHANGE, text: false, hunks: [] })
    await click('.history-item')
    expect(host.textContent).toContain('This version is not text')
    await click('.history-item')

    core.readChange.mockResolvedValue({ ...CHANGE, hunks: [] })
    await click('.history-item')
    expect(host.textContent).toContain('No lines changed.')
    await click('.history-item')

    core.readChange.mockResolvedValue({ ...CHANGE, cut: true })
    await click('.history-item')
    expect(host.textContent).toContain('too long to list')
    await click('.history-item')

    core.readChange.mockRejectedValue({ message: 'the commit is gone' })
    await click('.history-item')
    expect(host.textContent).toContain('the commit is gone')
  })

  it('offers no version of a deletion, which has no text', async () => {
    core.readHistory.mockResolvedValue(history(revision('a', { status: 'deleted' })))
    await draw()
    await click('.history-item')
    expect(host.querySelector('.history-show')).toBeNull()
  })

  it('shows a version in a pane beside the note, in reading mode', async () => {
    const row = revision('abcdefgh', { path: 'old/plan.md' })
    core.readHistory.mockResolvedValue(history(row))
    await draw()
    await click('.history-item')
    await click('.history-show')

    expect(core.readRevision).toHaveBeenCalledWith('/vault/notes/plan.md', row.commit, 'old/plan.md')
    const pane = editorHost.querySelector('.past')
    expect(pane).not.toBeNull()
    expect(pane?.textContent).toContain('plan.md at abcdefg')
    expect(pane?.querySelector('.cm-content')?.textContent).toContain('As it was')
    expect(pane?.querySelector('.cm-reading')).not.toBeNull()
    expect(host.querySelector('.history-row--showing')).not.toBeNull()
  })

  it('follows the rows with the pane open, except to a deletion', async () => {
    const first = revision('a')
    const second = revision('b')
    const gone = revision('c', { status: 'deleted' })
    core.readHistory.mockResolvedValue(history(first, second, gone))
    await draw()
    await click('.history-item')
    await click('.history-show')
    core.readRevision.mockClear()

    core.readRevision.mockResolvedValue('# Earlier\n')
    await click('.history-row:nth-child(2) .history-item')
    expect(core.readRevision).toHaveBeenCalledWith('/vault/notes/plan.md', second.commit, second.path)
    expect(editorHost.querySelector('.past .cm-content')?.textContent).toContain('Earlier')

    core.readRevision.mockClear()
    await click('.history-row:nth-child(3) .history-item')
    expect(core.readRevision).not.toHaveBeenCalled()
    expect(editorHost.querySelector('.past .cm-content')?.textContent).toContain('Earlier')
  })

  it('does not open the pane by opening a row', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw()
    await click('.history-item')
    expect(core.readRevision).not.toHaveBeenCalled()
    expect(editorHost.querySelector('.past')).toBeNull()
  })

  it('takes the last version asked for, whichever answer comes back first', async () => {
    const first = revision('a')
    const second = revision('b')
    core.readHistory.mockResolvedValue(history(first, second))
    let late: (text: string) => void = () => {}
    core.readRevision.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        late = resolve
      }),
    )
    await draw()
    await click('.history-item')
    await click('.history-show')

    core.readRevision.mockResolvedValueOnce('# Second\n')
    await click('.history-row:nth-child(2) .history-item')
    await click('.history-row:nth-child(2) .history-show')
    await act(async () => {
      late('# First\n')
    })
    expect(editorHost.querySelector('.past .cm-content')?.textContent).toContain('Second')
  })

  it('says in words why a version cannot be shown', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    core.readRevision.mockRejectedValue({ message: 'this version is not UTF-8' })
    await draw()
    await click('.history-item')
    await click('.history-show')
    expect(host.textContent).toContain('this version is not UTF-8')
    expect(editorHost.querySelector('.past')).toBeNull()
  })

  it('closes the pane by its button, and hands the keyboard back to the note', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw()
    await click('.history-item')
    await click('.history-show')

    await click('.past-close', editorHost)
    expect(editorHost.querySelector('.past')).toBeNull()
    expect(focused).toHaveBeenCalled()
  })

  it('closes the pane by Escape from inside it, and no further', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw()
    await click('.history-item')
    await click('.history-show')

    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    const content = editorHost.querySelector('.past .cm-content')
    await act(async () => {
      content?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    document.removeEventListener('keydown', outside)
    expect(editorHost.querySelector('.past')).toBeNull()
    expect(outside).not.toHaveBeenCalled()
  })

  it('takes the pane away when another note comes to the front', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw('/vault/a.md')
    await click('.history-item')
    await click('.history-show')
    expect(editorHost.querySelector('.past')).not.toBeNull()

    await draw('/vault/b.md')
    expect(editorHost.querySelector('.past')).toBeNull()
    expect(lines()).toEqual([])
  })

  it('takes the pane away with the panel', async () => {
    core.readHistory.mockResolvedValue(history(revision('a')))
    await draw()
    await click('.history-item')
    await click('.history-show')
    await act(async () => {
      root.render(null)
    })
    expect(editorHost.querySelector('.past')).toBeNull()
  })
})

// What the search panel puts on screen for the answers the core gives it, and
// what it sends back when the person approves a replacement.
//
// The searching and the writing are tested where they live (`search.rs`,
// `replace.rs`). What is tested here is the window's share: reading the filter
// box, marking the matches, never showing an answer to another question, and —
// the part that writes to people's files — sending back only the changes that
// are still ticked, and none in a note open with unsaved edits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseFilter, SearchPanel } from './search'
import type { EditorHandle } from './editor/mount'
import type { ReplacePlan, SearchFound } from './core'

const searchVault = vi.hoisted(() => vi.fn())
const planReplace = vi.hoisted(() => vi.fn())
const applyReplace = vi.hoisted(() => vi.fn())
const undoReplace = vi.hoisted(() => vi.fn())
vi.mock('./core', () => ({ searchVault, planReplace, applyReplace, undoReplace }))

interface FakeTab {
  id: number
  path: string | null
  dirty?: boolean
}

function editorWith(tabs: FakeTab[]): EditorHandle {
  return {
    active: () => tabs[0],
    tabs: () => tabs,
    isDirty: (id?: number) => tabs.find((tab) => tab.id === id)?.dirty === true,
  } as unknown as EditorHandle
}

const found: SearchFound = {
  files: [
    {
      path: '/vault/plan.md',
      relative: 'plan.md',
      hits: [{ line: 3, column: 4, length: 4, text: 'the plan and the plan', ranges: [[4, 8], [17, 21]] }],
      matches: 2,
    },
  ],
  matches: 2,
  notes: 10,
  truncated: false,
}

const plan: ReplacePlan = {
  files: [
    {
      path: '/vault/a.md',
      relative: 'a.md',
      hash: 'h1',
      changes: [
        { line: 1, from: 0, to: 3, left: '', right: ' one', found: 'old', replacement: 'new' },
        { line: 2, from: 8, to: 11, left: 'and ', right: '', found: 'old', replacement: 'new' },
      ],
    },
    {
      path: '/vault/open.md',
      relative: 'open.md',
      hash: 'h2',
      changes: [{ line: 1, from: 0, to: 3, left: '', right: '', found: 'old', replacement: 'new' }],
    },
  ],
  changes: 3,
  truncated: false,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  for (const mock of [searchVault, planReplace, applyReplace, undoReplace]) mock.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function draw(
  tabs: FakeTab[] = [{ id: 1, path: '/vault/note.md' }],
  { revision = 0, replaceAsked = false, onOpen = vi.fn(), onReplaced = vi.fn() } = {},
) {
  await act(async () => {
    root.render(
      <SearchPanel
        editor={editorWith(tabs)}
        visible
        revision={revision}
        focusAsked={0}
        replaceAsked={replaceAsked}
        onOpen={onOpen}
        onReplaced={onReplaced}
      />,
    )
  })
}

/** Types into a box the way React hears it: through the native setter, then
 *  an input event. */
async function type(label: string, value: string) {
  const box = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Lets the typing pause pass and the core's answer arrive. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(500)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.trim().startsWith(text),
  )
  if (!button) throw new Error(`no button saying “${text}”`)
  act(() => button.click())
}

describe('the filter box', () => {
  it('reads a tag, a field with a value, and a field alone', () => {
    expect(parseFilter('#projects')).toEqual({ tag: 'projects', field: null, value: null })
    expect(parseFilter('status:draft')).toEqual({ tag: null, field: 'status', value: 'draft' })
    expect(parseFilter('#a status:')).toEqual({ tag: 'a', field: 'status', value: null })
  })

  it('leaves a plain word alone rather than guessing at it', () => {
    expect(parseFilter('draft')).toEqual({ tag: null, field: null, value: null })
  })
})

describe('the results', () => {
  it('asks nothing until there is something to ask', async () => {
    await draw()
    await settle()
    expect(searchVault).not.toHaveBeenCalled()
  })

  it('marks every match in a line and opens the note where it was found', async () => {
    searchVault.mockResolvedValue(found)
    const onOpen = vi.fn()
    await draw(undefined, { onOpen })
    await type('Search the vault', 'plan')
    await settle()

    expect(searchVault).toHaveBeenCalledWith(
      '/vault/note.md',
      expect.objectContaining({ text: 'plan', caseSensitive: false, wholeWord: false, regex: false }),
    )
    const marks = [...host.querySelectorAll('mark')].map((mark) => mark.textContent)
    expect(marks).toEqual(['plan', 'plan'])
    expect(host.textContent).toContain('2 in 1 note')
    // The count beside the note is matches, not lines: one line, two matches.
    expect(host.querySelector('.search-file .search-count')?.textContent).toBe('2')

    const hit = host.querySelector('.search-hit') as HTMLButtonElement
    act(() => hit.click())
    expect(onOpen).toHaveBeenCalledWith('/vault/plan.md', 3, 4, 4)
  })

  it('sends the filter to the core as filters, not as text', async () => {
    searchVault.mockResolvedValue({ ...found, matches: 0 })
    await draw()
    await type('Only notes with a tag or a field', '#projects status:draft')
    await settle()
    expect(searchVault).toHaveBeenCalledWith(
      '/vault/note.md',
      expect.objectContaining({ text: '', tag: 'projects', field: 'status', value: 'draft' }),
    )
  })

  it('does not show an answer to what was typed before', async () => {
    // The first search answers late, after the second was typed. Its answer
    // is for a question nobody is asking any more.
    let answerFirst: (value: SearchFound) => void = () => {}
    searchVault.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
    searchVault.mockImplementationOnce(() => new Promise(() => {}))
    await draw()
    await type('Search the vault', 'pla')
    await settle()
    await type('Search the vault', 'plan')
    await settle()
    await act(async () => answerFirst(found))
    expect(host.querySelectorAll('mark')).toHaveLength(0)
    expect(host.textContent).toContain('Searching…')
  })

  it('says what the core refused', async () => {
    searchVault.mockRejectedValue({ message: 'that is not a pattern this search understands' })
    await draw()
    await type('Search the vault', '(')
    await settle()
    expect(host.textContent).toContain('that is not a pattern')
  })
})

describe('replacing', () => {
  async function previewed(tabs?: FakeTab[], onReplaced = vi.fn()) {
    searchVault.mockResolvedValue(found)
    planReplace.mockResolvedValue(plan)
    applyReplace.mockResolvedValue({ paths: ['/vault/a.md'], changes: 1, skipped: [] })
    await draw(tabs, { replaceAsked: true, onReplaced })
    await type('Search the vault', 'old')
    await type('Replace with', 'new')
    click('Preview')
    await settle()
  }

  it('shows each change as what was and what will be, all ticked', async () => {
    await previewed()
    expect([...host.querySelectorAll('del')].map((node) => node.textContent)).toEqual([
      'old',
      'old',
      'old',
    ])
    expect(host.textContent).toContain('3 of 3 in 2 notes')
    expect(applyReplace).not.toHaveBeenCalled()
  })

  it('sends back only the ticked changes', async () => {
    const onReplaced = vi.fn()
    await previewed(undefined, onReplaced)
    const boxes = [...host.querySelectorAll('.search-hit--plan input')] as HTMLInputElement[]
    act(() => boxes[0].click())
    expect(host.textContent).toContain('2 of 3')

    click('Replace 2')
    await settle()
    const sent = applyReplace.mock.calls[0][0] as ReplacePlan
    expect(sent.files.map((file) => [file.relative, file.changes.map((change) => change.line)])).toEqual([
      ['a.md', [2]],
      ['open.md', [1]],
    ])
    expect(onReplaced).toHaveBeenCalled()
    expect(host.textContent).toContain('Replaced 1 in 1 note')
  })

  it('unticking a note unticks every change in it', async () => {
    await previewed()
    const note = host.querySelector('.search-file--plan input') as HTMLInputElement
    act(() => note.click())
    expect(host.textContent).toContain('1 of 3')
  })

  it('leaves out a note open with unsaved changes, and says so', async () => {
    await previewed([
      { id: 1, path: '/vault/note.md' },
      { id: 2, path: '/vault/open.md', dirty: true },
    ])
    click('Replace 3')
    await settle()
    const sent = applyReplace.mock.calls[0][0] as ReplacePlan
    expect(sent.files.map((file) => file.relative)).toEqual(['a.md'])
    expect(host.textContent).toContain('1 open with unsaved changes and were left alone')
  })

  it('hides a preview made for other words', async () => {
    await previewed()
    await type('Replace with', 'newer')
    expect(host.querySelectorAll('del')).toHaveLength(0)
  })
})

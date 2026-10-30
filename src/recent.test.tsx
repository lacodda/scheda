// What an empty window shows: the recent list, and with a folder open, the
// folder's own empty window.
//
// Rendered with `react-dom/client` and `act`, like the other panels' tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RecentFiles } from './recent'
import type { Folder } from './core'

const loadSettings = vi.hoisted(() => vi.fn())
vi.mock('./core', () => ({ loadSettings }))

const RECENT = ['C:\\notes\\plan.md', 'C:\\work\\todo.md', 'C:\\notes\\deep\\diary.md']

let host: HTMLDivElement
let area: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  area = document.createElement('div')
  document.body.append(host, area)
  root = createRoot(host)
  loadSettings.mockReset()
  loadSettings.mockResolvedValue({ recent: RECENT, keys: {} })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  area.remove()
})

async function show(folder: Folder | null, visible = true) {
  await act(async () => {
    root.render(<RecentFiles visible={visible} folder={folder} container={area} onOpen={() => {}} />)
  })
}

const names = () => [...area.querySelectorAll('.recent-name')].map((name) => name.textContent)

describe('an empty window', () => {
  it('lists every recent file, over the editor rather than the window', async () => {
    await show(null)
    expect(names()).toEqual(['plan.md', 'todo.md', 'diary.md'])
    // Drawn into the editor's area, so a tree beside it is never under it.
    expect(host.querySelector('.recent')).toBeNull()
    expect(area.querySelector('.recent-folder')).toBeNull()
  })

  it('says nothing when there is nothing recent', async () => {
    loadSettings.mockResolvedValue({ recent: [], keys: {} })
    await show(null)
    expect(area.querySelector('.recent')).toBeNull()
  })
})

describe("a folder's empty window", () => {
  const folder: Folder = { root: 'C:\\notes', name: 'notes' }

  it('names the folder and lists only what was opened in it', async () => {
    await show(folder)
    expect(area.querySelector('.recent-folder')?.textContent).toBe('notes')
    expect(area.querySelector('.recent-folder')?.getAttribute('title')).toBe('C:\\notes')
    expect(names()).toEqual(['plan.md', 'diary.md'])
  })

  it('says how to find a note in it, by the key going to a file has', async () => {
    await show(folder)
    expect(area.querySelector('.recent-hint')?.textContent).toMatch(/P to find a note in it$/)
  })

  it('still names the folder when nothing in it was opened yet', async () => {
    await show({ root: 'C:\\empty', name: 'empty' })
    expect(area.querySelector('.recent-folder')?.textContent).toBe('empty')
    expect(names()).toEqual([])
    expect(area.querySelector('.recent-title')).toBeNull()
  })

  it('is gone the moment there is something in front', async () => {
    await show(folder, false)
    expect(area.querySelector('.recent')).toBeNull()
  })
})

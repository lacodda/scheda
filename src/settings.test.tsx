// What the settings screen says about the file it keeps the settings in.
//
// The formats are held in the core (`stored.rs`); what is the window's own work
// is telling a person that a newer scheda's file is being left alone — so that
// a change which will not outlive the window is not a surprise the next day.
//
// Rendered with `react-dom/client` and `act`, as the other screens' tests are.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Settings, SettingsStatus } from './core'

const core = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
  settingsStatus: vi.fn(),
  quickNoteStatus: vi.fn(),
  chooseQuickNoteFile: vi.fn(),
  showQuickNote: vi.fn(),
}))
vi.mock('./core', () => core)

const SETTINGS: Settings = {
  theme: 'system',
  fontSize: 15,
  columnWidth: 46,
  recent: [],
  closeBrackets: false,
  spellcheck: false,
  autosave: false,
  keys: {},
  quickNoteFile: null,
  quickNoteKey: 'Win+Shift+N',
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  core.loadSettings.mockResolvedValue(SETTINGS)
  core.quickNoteStatus.mockResolvedValue({ key: 'Win+Shift+N', registered: true, error: null })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.resetModules()
})

async function open(status: SettingsStatus) {
  core.settingsStatus.mockResolvedValue(status)
  const { SettingsScreen } = await import('./settings')
  await act(async () => {
    root.render(<SettingsScreen onClose={() => {}} />)
  })
}

describe('the settings file', () => {
  it('is named at the foot of the screen', async () => {
    await open({ path: '/config/scheda/settings.json', newer: null })
    expect(host.querySelector('.settings-file')?.textContent).toBe('Kept in /config/scheda/settings.json')
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('says when a newer scheda wrote it, and that changes are not saved', async () => {
    await open({ path: '/config/scheda/settings.json', newer: 2 })
    const notice = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(notice).toContain('newer version of scheda (format 2)')
    expect(notice).toContain('not saved')
  })
})

// The keys and the commands they run.
//
// What a wrong answer here looks like on screen: a shortcut that stops working
// the moment somebody switches to a Cyrillic layout, AltGr typing a letter and
// firing a command instead, a rebound key still running the old command, a key
// the person gave a command kept by the editor instead, or an editor command
// stealing a key from a search field.
import { act, createElement, type ReactElement, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import table from '../src-tauri/tests/keys-1-to-2.json'
import { applyKeys, boundElsewhere, clash, COMMANDS, keymapOf, keysFor, RENAMED, showKeys, useCommand } from './commands'
import { isShortcut, isSystemKey, showSystemKey, systemKeyOf } from './system-key'
import { useCommandList, type ListedCommand } from './ui/commands'
import { keysOf, normalizeKeys } from './ui/shortcut'
import { match, rank } from './fuzzy'
import { stampOf } from './quick/stamp'

function key(init: KeyboardEventInit & { altGraph?: boolean }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.altGraph) {
    Object.defineProperty(event, 'getModifierState', { value: (name: string) => name === 'AltGraph' })
  }
  return event
}

describe('the system-wide key', () => {
  it('is written with its modifiers in one order, the Windows key first', () => {
    expect(systemKeyOf(key({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true }))).toBe('Win+Shift+N')
    expect(systemKeyOf(key({ key: 'P', code: 'KeyP', shiftKey: true, ctrlKey: true, altKey: true }))).toBe(
      'Ctrl+Alt+Shift+P',
    )
  })

  it('is the physical key on a layout that does not type Latin', () => {
    expect(systemKeyOf(key({ key: 'т', code: 'KeyN', metaKey: true, shiftKey: true }))).toBe('Win+Shift+N')
  })

  it('is nothing while only a modifier is down, or when AltGr is typing', () => {
    expect(systemKeyOf(key({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull()
    expect(systemKeyOf(key({ key: 'ń', code: 'KeyN', ctrlKey: true, altKey: true, altGraph: true }))).toBeNull()
  })

  it('must hold more than Shift when the key types', () => {
    expect(isShortcut('A')).toBe(false)
    expect(isShortcut('Shift+A')).toBe(false)
    expect(isShortcut('Win+A')).toBe(true)
    expect(isShortcut('F5')).toBe(true)
  })

  it('has one spelling, and what is recorded is always in it', () => {
    expect(isSystemKey('Win+Shift+N')).toBe(true)
    expect(isSystemKey('Shift+Win+N')).toBe(false)
    expect(isSystemKey('Ctrl+p')).toBe(false)
    const recorded = systemKeyOf(key({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true, ctrlKey: true, altKey: true }))
    expect(recorded !== null && isSystemKey(recorded)).toBe(true)
    expect(showSystemKey('Win+Alt+Right')).toBe('Win+Alt+→')
  })
})

// Every command id that ever shipped. The settings keep rebound keys under
// these ids, and the settings file is frozen (ADR 0016): an id that goes away
// takes somebody's key with it. A renamed command keeps its old id in RENAMED;
// a new command adds its id here, which freezes it too.
const SHIPPED = [
  'palette.commands', 'file.goTo', 'insert.block', 'file.new', 'file.open', 'file.save', 'file.saveAs',
  'file.print', 'file.export', 'file.obsidian', 'tab.close', 'tab.closeOthers', 'tab.closeAll', 'tab.reopen',
  'tab.pin', 'tab.next', 'tab.previous', 'pane.split', 'pane.first', 'pane.second', 'view.reading', 'view.focus',
  'panel.tree', 'panel.outline', 'panel.network', 'panel.tags', 'search.vault', 'search.replace', 'fold.section',
  'unfold.section', 'fold.all', 'unfold.all', 'quick.note', 'settings.open', 'theme.system', 'theme.light',
  'theme.dark', 'autosave.toggle',
]

describe('the ids of the commands', () => {
  it('keep every id that shipped, or say what it became', () => {
    const ids = new Set(COMMANDS.map((command) => command.id))
    for (const id of SHIPPED) {
      expect(ids.has(id) || ids.has(RENAMED[id]), `${id} is gone without a line in RENAMED`).toBe(true)
    }
  })

  it('are all on the list of shipped ids', () => {
    for (const command of COMMANDS) {
      expect(SHIPPED, `${command.id} is new: add it to SHIPPED`).toContain(command.id)
    }
  })

  it('carry a key kept under an old id to the new one', () => {
    expect(keymapOf({ 'file.keep': ['Mod+K'] }, { 'file.keep': 'file.save' })).toEqual({ 'file.save': ['Mod+K'] })
    // The command's own id is the later change, and wins.
    expect(
      keymapOf({ 'file.keep': ['Mod+K'], 'file.save': ['Mod+J'] }, { 'file.keep': 'file.save' }),
    ).toEqual({ 'file.save': ['Mod+J'] })
  })
})

describe('the default keys', () => {
  it('are written in the line notation, one spelling each', () => {
    for (const command of COMMANDS) {
      for (const keys of command.keys) {
        // `Ctrl+Tab` is the one written with Ctrl, on purpose: it is Cmd+Tab
        // only off a Mac, where the two are one key.
        const spelled = keys.startsWith('Ctrl+') ? keys.replace('Ctrl+', 'Mod+') : keys
        expect(normalizeKeys(keys, false), `${command.id}: ${keys}`).toBe(spelled)
      }
    }
  })

  it('are on no two commands, on either platform', () => {
    const all = COMMANDS.flatMap((command) => command.keys.map((keys) => ({ id: command.id, keys })))
    for (const [index, one] of all.entries()) {
      for (const other of all.slice(index + 1)) {
        expect(clash(one.keys, other.keys), `${one.id} and ${other.id}`).toBe(false)
      }
    }
  })
})

// The settings step from format 1 to 2 (`src-tauri/src/settings.rs`) rewrites
// every key a person rebound. It is right only if the string it writes is the
// one dowel reads from the very key that format 1 recorded - on this layout or
// on a Russian one. The same table drives the Rust test of the step.
describe('a key rebound before 0.17', () => {
  it.each(table.map((row) => [row.format1, row.format2, row] as const))(
    '%s is %s, and pressing it still gives that',
    (_, format2, row) => {
      expect(keysOf(key(row.event), false)).toBe(format2)
      expect(normalizeKeys(format2, false)).toBe(format2)
    },
  )
})

describe('keys as text', () => {
  it('are each key under the name the line gives it', () => {
    expect(showKeys('Mod+Shift+P', false)).toBe('Ctrl+Shift+P')
    expect(showKeys('Mod+Shift+P', true)).toBe('⌘⇧P')
    expect(showKeys('Mod+Alt+ArrowRight', false)).toBe('Ctrl+Alt+→')
    expect(showKeys('G D', false)).toBe('G › D')
  })

  it('say Space and Tab in words off a Mac, where a keyboard does', () => {
    expect(showKeys('Mod+Shift+Space', false)).toBe('Ctrl+Shift+Space')
    expect(showKeys('Ctrl+Tab', false)).toBe('Ctrl+Tab')
    expect(showKeys('Mod+Shift+Space', true)).toBe('⌘⇧␣')
  })

  it('are shown as written when they do not parse, rather than throwing', () => {
    expect(showKeys('Hyper+K', false)).toBe('Hyper+K')
  })
})

describe('two keys on one command', () => {
  it('are the same keystroke however they are spelt', () => {
    expect(clash('Ctrl+Tab', 'Mod+Tab')).toBe(true)
    expect(clash('Mod+S', 'Mod+Shift+S')).toBe(false)
    // A sequence begun by the other's key can never finish.
    expect(clash('G', 'G D')).toBe(true)
    expect(clash('Hyper+K', 'Mod+K')).toBe(false)
  })

  it('name the command keys would be taken from', () => {
    expect(boundElsewhere('Mod+S', 'file.new', {}).map((command) => command.id)).toEqual(['file.save'])
    expect(boundElsewhere('Mod+S', 'file.save', {})).toEqual([])
    expect(boundElsewhere('Mod+S', 'file.new', { 'file.save': ['F2'] })).toEqual([])
    expect(keysFor('file.save', { 'file.save': ['F2'] })).toEqual(['F2'])
  })
})

const roots: Root[] = []

/** Renders into a root of its own, as the other screens' tests do. */
function render(element: ReactElement): void {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(element))
}

function cleanup(): void {
  for (const root of roots.splice(0)) act(() => root.unmount())
}

/** Declares commands the way the shell does, and lists them back. */
function Window({
  ran,
  notes,
  listed,
}: {
  ran: string[]
  notes: RefObject<Element | null>
  listed?: (list: ListedCommand[]) => void
}) {
  useCommand('file.save', () => void ran.push('file.save'))
  useCommand('file.goTo', () => void ran.push('file.goTo'))
  useCommand('file.export', () => void ran.push('file.export'))
  useCommand('palette.commands', () => void ran.push('palette.commands'))
  useCommand('view.reading', () => void ran.push('view.reading'), { notes })
  useCommand('pane.second', () => void ran.push('pane.second'), { enabled: false })
  const list = useCommandList()
  listed?.(list)
  return null
}

describe('the commands', () => {
  afterEach(() => {
    cleanup()
    applyKeys({})
    document.body.innerHTML = ''
  })

  /** The window: the panes the notes live in, a note in them that claims
   *  `Ctrl+D` the way CodeMirror's keymap claims a key it binds, and a search
   *  box beside them. */
  function mount(listed?: (list: ListedCommand[]) => void) {
    const host = document.createElement('div')
    const note = document.createElement('div')
    note.contentEditable = 'true'
    host.append(note)
    const field = document.createElement('input')
    document.body.append(host, field)
    const editorAnswered: string[] = []
    note.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || !event.ctrlKey || event.code !== 'KeyD') return
      editorAnswered.push('Ctrl+D')
      event.preventDefault()
    })
    const ran: string[] = []
    render(createElement(Window, { ran, notes: { current: host }, listed }))
    return { note, field, ran, editorAnswered }
  }

  function press(target: Element, init: KeyboardEventInit & { altGraph?: boolean }): KeyboardEvent {
    const event = key(init)
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  it('run from their key, and the key goes no further', () => {
    const { ran } = mount()
    const event = press(document.body, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(ran).toEqual(['file.save'])
    expect(event.defaultPrevented).toBe(true)
  })

  it('answer on a Russian layout, where the key types another letter', () => {
    const { ran, note } = mount()
    press(note, { key: 'з', code: 'KeyP', ctrlKey: true })
    press(note, { key: 'ы', code: 'KeyS', ctrlKey: true })
    expect(ran).toEqual(['file.goTo', 'file.save'])
  })

  it('leave AltGr to type its letter', () => {
    // Polish ś is AltGr+S, which Windows delivers as Ctrl+Alt+S - the key of
    // "Save as a web page".
    const { ran, note } = mount()
    const event = press(note, { key: 'ś', code: 'KeyS', ctrlKey: true, altKey: true, altGraph: true })
    expect(ran).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    press(note, { key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
    expect(ran).toEqual(['file.export'])
  })

  it('answer to a rebound key and not to the old one', () => {
    const { ran } = mount()
    act(() => applyKeys({ 'file.save': ['Mod+Alt+W'] }))
    press(document.body, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(ran).toEqual([])
    press(document.body, { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true })
    expect(ran).toEqual(['file.save'])
  })

  it('answer to a key kept under the id a command had before it was renamed', () => {
    const { ran } = mount()
    act(() => applyKeys({ 'file.keep': ['Mod+K'] }, { 'file.keep': 'file.save' }))
    press(document.body, { key: 'k', code: 'KeyK', ctrlKey: true })
    expect(ran).toEqual(['file.save'])
  })

  it('take a key the person gave them from the editor that binds it', () => {
    const { ran, note, editorAnswered } = mount()
    act(() => applyKeys({ 'file.save': ['Mod+D'] }))
    press(note, { key: 'd', code: 'KeyD', ctrlKey: true })
    expect(ran).toEqual(['file.save'])
    expect(editorAnswered, 'the editor answered the key as well').toEqual([])
  })

  it('answer in the note and in a field, wherever the person is', () => {
    const { ran, note, field } = mount()
    press(note, { key: 's', code: 'KeyS', ctrlKey: true })
    press(field, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(ran).toEqual(['file.save', 'file.save'])
  })

  it('keep a note command in the note, out of a field beside it', () => {
    const { ran, note, field } = mount()
    const outside = press(field, { key: 'e', code: 'KeyE', ctrlKey: true })
    expect(ran).toEqual([])
    expect(outside.defaultPrevented).toBe(false)
    press(note, { key: 'e', code: 'KeyE', ctrlKey: true })
    expect(ran).toEqual(['view.reading'])
  })

  it('leave a key alone while the command cannot run', () => {
    const { ran } = mount()
    const event = press(document.body, { key: '2', code: 'Digit2', ctrlKey: true })
    expect(ran).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('are offered by the palette, a note command too, the palette itself not', () => {
    let list: ListedCommand[] = []
    mount((now) => {
      list = now
    })
    const offered = list.filter((command) => command.run !== undefined).map((command) => command.id)
    expect(offered).toContain('view.reading')
    expect(offered).toContain('file.save')
    expect(offered).not.toContain('palette.commands')
    expect(offered).not.toContain('pane.second')
    // Listed all the same, with their keys, under scheda's titles.
    expect(list.find((command) => command.id === 'palette.commands')?.keys).toEqual(['Mod+Shift+P'])
    expect(list.find((command) => command.id === 'view.reading')?.label).toBe('View: Reading mode')
  })

  it('refuse a note command declared without the notes, and a window command with them', () => {
    function Wrong({ id, notes }: { id: string; notes?: RefObject<Element | null> }) {
      useCommand(id, () => {}, { notes })
      return null
    }
    const quiet = console.error
    const thrown: unknown[] = []
    console.error = () => {}
    const onError = (event: ErrorEvent) => {
      thrown.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    try {
      for (const element of [
        createElement(Wrong, { id: 'view.reading' }),
        createElement(Wrong, { id: 'file.save', notes: { current: null } }),
      ]) {
        try {
          render(element)
        } catch (error) {
          thrown.push(error)
        }
      }
    } finally {
      console.error = quiet
      window.removeEventListener('error', onError)
    }
    const messages = thrown.map((error) => String((error as Error)?.message ?? error))
    expect(messages.some((message) => /view\.reading is a command of the note/.test(message))).toBe(true)
    expect(messages.some((message) => /file\.save is not a command of the note/.test(message))).toBe(true)
  })
})

describe('matching a short list', () => {
  it('finds letters in order, and prefers the starts of words', () => {
    const found = match('gf', 'Go to file')
    expect(found?.at).toEqual([0, 6])
  })

  it('does not miss a match by reaching for a word start', () => {
    // `a` starts a word only at `Ab`, and after it there is no `n`.
    expect(match('an', 'xan Ab')?.at).toEqual([1, 2])
  })

  it('ranks the closer match first and keeps the order for nothing typed', () => {
    const titles = ['Panel: Tags', 'Tab: Close', 'Theme: Dark']
    expect(rank(titles, 'tc', (title) => title).map((row) => row.item)[0]).toBe('Tab: Close')
    expect(rank(titles, '', (title) => title).map((row) => row.item)).toEqual(titles)
    expect(rank(titles, 'zz', (title) => title)).toEqual([])
  })
})

describe('a quick note’s stamp', () => {
  it('is local time to the minute, sortable as text', () => {
    expect(stampOf(new Date(2026, 8, 3, 7, 5, 59))).toBe('2026-09-03 07:05')
  })
})

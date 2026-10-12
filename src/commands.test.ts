// The keys and the commands they run.
//
// What a wrong answer here looks like on screen: a shortcut that stops working
// the moment somebody switches to a Cyrillic layout, AltGr typing a letter and
// firing a command instead, a rebound key still running the old command, or an
// editor command stealing a key from a search field.
import { afterEach, describe, expect, it } from 'vitest'
import { boundElsewhere, commandFor, handle, installKeys, keysFor, run, setOverrides, COMMANDS, RENAMED } from './commands'
import { chordOf, isChord, isShortcut, showChord } from './keys'
import { match, rank } from './fuzzy'
import { stampOf } from './quick/stamp'

function key(init: KeyboardEventInit & { altGraph?: boolean }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.altGraph) {
    Object.defineProperty(event, 'getModifierState', { value: (name: string) => name === 'AltGraph' })
  }
  return event
}

describe('a chord', () => {
  it('is written with its modifiers in one order', () => {
    expect(chordOf(key({ key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P')
    expect(chordOf(key({ key: 'P', code: 'KeyP', shiftKey: true, ctrlKey: true, altKey: true }))).toBe(
      'Ctrl+Alt+Shift+P',
    )
  })

  it('is the physical key on a layout that does not type Latin', () => {
    // Ctrl+P on a Russian layout arrives as `з`.
    expect(chordOf(key({ key: 'з', code: 'KeyP', ctrlKey: true }))).toBe('Ctrl+P')
  })

  it('is the letter typed on a Latin layout that moves the keys', () => {
    // A French keyboard's Z is where a US keyboard has W.
    expect(chordOf(key({ key: 'z', code: 'KeyW', ctrlKey: true }))).toBe('Ctrl+Z')
  })

  it('names punctuation by the key, not what Shift made of it', () => {
    expect(chordOf(key({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+[')
    expect(chordOf(key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+1')
    expect(chordOf(key({ key: ',', code: 'Comma', ctrlKey: true }))).toBe('Ctrl+,')
  })

  it('is nothing while only a modifier is down, or when AltGr is typing', () => {
    expect(chordOf(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull()
    expect(chordOf(key({ key: 'ń', code: 'KeyN', ctrlKey: true, altKey: true, altGraph: true }))).toBeNull()
  })

  it('takes the Windows key only where a system-wide key is being recorded', () => {
    const event = key({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true })
    expect(chordOf(event, true)).toBe('Win+Shift+N')
    // In the window, Cmd on a Mac is Ctrl.
    expect(chordOf(event)).toBe('Ctrl+Shift+N')
  })

  it('must hold more than Shift to be a shortcut when the key types', () => {
    expect(isShortcut('A')).toBe(false)
    expect(isShortcut('Shift+A')).toBe(false)
    expect(isShortcut('Ctrl+A')).toBe(true)
    expect(isShortcut('F5')).toBe(true)
    expect(isShortcut('Shift+Space')).toBe(false)
  })

  it('shows arrows as arrows', () => {
    expect(showChord('Ctrl+Alt+Right')).toBe('Ctrl+Alt+→')
  })

  it('has one spelling, and what is recorded is always in it', () => {
    expect(isChord('Win+Shift+N')).toBe(true)
    expect(isChord('Ctrl+Alt+Shift+P')).toBe(true)
    expect(isChord('Ctrl+\\')).toBe(true)
    expect(isChord('F12')).toBe(true)
    // The same chords spelt another way, and things that are not chords.
    expect(isChord('Shift+Win+N')).toBe(false)
    expect(isChord('Shift+Ctrl+P')).toBe(false)
    expect(isChord('Ctrl+p')).toBe(false)
    expect(isChord('Ctrl+Shift')).toBe(false)
    expect(isChord('Ctrl+F25')).toBe(false)
    const recorded = [
      key({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true, ctrlKey: true, altKey: true }),
      key({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }),
      key({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }),
      key({ key: 'F5', code: 'F5' }),
    ]
    for (const event of recorded) {
      for (const withWin of [false, true]) {
        const chord = chordOf(event, withWin)
        expect(chord !== null && isChord(chord), String(chord)).toBe(true)
      }
    }
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
  afterEach(() => setOverrides({}))

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

  it('write their default keys in the one notation', () => {
    for (const command of COMMANDS) {
      for (const chord of command.keys) expect(isChord(chord), `${command.id}: ${chord}`).toBe(true)
    }
  })

  it('carry a key kept under an old id to the new one', () => {
    setOverrides({ 'file.keep': ['Ctrl+K'] }, { 'file.keep': 'file.save' })
    expect(keysFor('file.save')).toEqual(['Ctrl+K'])
    // The command's own id is the later change, and wins.
    setOverrides({ 'file.keep': ['Ctrl+K'], 'file.save': ['Ctrl+J'] }, { 'file.keep': 'file.save' })
    expect(keysFor('file.save')).toEqual(['Ctrl+J'])
  })
})

describe('the commands', () => {
  const detach: (() => void)[] = []
  let stop: (() => void) | null = null

  afterEach(() => {
    for (const off of detach.splice(0)) off()
    stop?.()
    stop = null
    setOverrides({})
    document.body.innerHTML = ''
  })

  it('have one id each, and no default key twice', () => {
    const ids = COMMANDS.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = COMMANDS.flatMap((command) => command.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('run from their key, and the key goes no further', () => {
    let saved = 0
    detach.push(handle('file.save', () => void (saved += 1)))
    stop = installKeys()

    const event = key({ key: 's', code: 'KeyS', ctrlKey: true })
    window.dispatchEvent(event)

    expect(saved).toBe(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('answer to a rebound key and not to the old one', () => {
    let saved = 0
    detach.push(handle('file.save', () => void (saved += 1)))
    stop = installKeys()
    setOverrides({ 'file.save': ['Ctrl+Alt+W'] })

    window.dispatchEvent(key({ key: 's', code: 'KeyS', ctrlKey: true }))
    expect(saved).toBe(0)
    window.dispatchEvent(key({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true }))
    expect(saved).toBe(1)
    expect(keysFor('file.save')).toEqual(['Ctrl+Alt+W'])
    expect(commandFor('Ctrl+S')).toBeUndefined()
  })

  it('leave a key with nothing attached to the editor', () => {
    stop = installKeys()
    const event = key({ key: 's', code: 'KeyS', ctrlKey: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('keep editor commands out of fields', () => {
    let toggled = 0
    detach.push(handle('view.reading', () => void (toggled += 1)))
    stop = installKeys()
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()

    const event = key({ key: 'e', code: 'KeyE', ctrlKey: true })
    field.dispatchEvent(event)

    expect(toggled).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  it('let a key through when the command declines it', () => {
    detach.push(handle('pane.second', () => false))
    stop = installKeys()
    const event = key({ key: '2', code: 'Digit2', ctrlKey: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(run('pane.second')).toBe(false)
  })

  it('name the command a chord would be taken from', () => {
    expect(boundElsewhere('Ctrl+S', 'file.new').map((command) => command.id)).toEqual(['file.save'])
    expect(boundElsewhere('Ctrl+S', 'file.save')).toEqual([])
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

// Keys as data: one notation for every shortcut the window knows about.
//
// A shortcut is stored, compared and shown as a string — `Ctrl+Shift+P` — so
// that the settings file, the command palette, the settings screen and the key
// handler all speak about the same thing in the same words. Modifiers come in
// one fixed order, which is what makes two spellings of one chord impossible.
//
// The letter is the one the keyboard types when it types Latin, and the key's
// place on the keyboard when it does not. `Ctrl+P` on a Russian layout arrives
// with `event.key` set to `з`; matching on that would make every shortcut in
// the window stop working the moment somebody switches language to write a
// sentence. The physical key is the answer there. On a Latin layout the
// letter wins, so a French keyboard's `Ctrl+Z` is still the key marked Z.

/** Keys named by what they are rather than what they type. */
const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  Backquote: '`',
}

/** The keys that are only ever held, never pressed on their own. */
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'])

/** What a keyboard event is as a chord, or null when it is not one: a
 *  modifier on its own, or `AltGr` typing a character.
 *
 *  `withWin` lets the Windows key through as a modifier. The window's own
 *  shortcuts never use it — the system keeps nearly every `Win` chord for
 *  itself — but a system-wide key is exactly where it belongs. */
export function chordOf(event: KeyboardEvent, withWin = false): string | null {
  if (MODIFIERS.has(event.key)) return null
  // AltGr arrives as Ctrl+Alt on Windows, and on a Polish or German keyboard
  // AltGr with a letter types a character. That is typing, not a shortcut.
  if (event.getModifierState?.('AltGraph')) return null

  const key = mainKey(event)
  if (key === null) return null

  const parts: string[] = []
  // Cmd on a Mac is the same finger and the same meaning as Ctrl elsewhere.
  if (event.ctrlKey || (event.metaKey && !withWin)) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (withWin && event.metaKey) parts.push('Win')
  parts.push(key)
  return parts.join('+')
}

function mainKey(event: KeyboardEvent): string | null {
  const code = event.code ?? ''
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase()
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (code in NAMED) return NAMED[code]
  // Without a code — a synthetic event, or a key the platform does not name —
  // the key itself, when it is one this notation knows.
  if (/^[0-9]$/.test(event.key)) return event.key
  const named = Object.entries(NAMED).find(([name]) => name === event.key)
  if (named) return named[1]
  if (Object.values(NAMED).includes(event.key)) return event.key
  return null
}

/** Whether a chord could be a shortcut at all. A bare letter is typing, and so
 *  is a letter with only Shift; a function key or `Escape` on its own is fine. */
export function isShortcut(chord: string): boolean {
  const parts = chord.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)
  const typing = key.length === 1 || key === 'Space' || key === 'Enter' || key === 'Tab' || key === 'Backspace'
  if (!typing) return true
  return modifiers.some((modifier) => modifier !== 'Shift')
}

const SHOWN: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' }

/** A chord as a person reads it: arrows as arrows, the rest as written. */
export function showChord(chord: string): string {
  return chord
    .split('+')
    .map((part) => SHOWN[part] ?? part)
    .join('+')
}

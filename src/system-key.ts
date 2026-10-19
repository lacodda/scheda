// The one key scheda asks the system for: the quick note, from any program.
//
// The window's own keys are the line's notation (`src/ui/shortcut.tsx`, ADR
// 0018). This one is not a key of the window - the core registers it with the
// system's hook, which reads it - so it keeps the spelling that hook knows:
// `Win`, `Ctrl`, `Alt`, `Shift`, in that one order, the order Windows itself
// writes them in, then the key. The Windows key is exactly what a system-wide
// key wants and what the line's notation refuses: inside a window nearly every
// `Win` chord is the system's.
//
// The spelling is part of the settings file, and frozen with it (ADR 0016).
//
// The letter is the one the keyboard types when it types Latin, and the key's
// place on the keyboard when it does not, as everywhere in the line.

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

/** What a keyboard event is as a system-wide key, or null when it is not one:
 *  a modifier on its own, or `AltGr` typing a character. */
export function systemKeyOf(event: KeyboardEvent): string | null {
  if (MODIFIERS.has(event.key)) return null
  // AltGr arrives as Ctrl+Alt on Windows, and on a Polish or German keyboard
  // AltGr with a letter types a character. That is typing, not a shortcut.
  if (event.getModifierState?.('AltGraph')) return null

  const key = mainKey(event)
  if (key === null) return null

  const parts: string[] = []
  if (event.metaKey) parts.push('Win')
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
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

const KEYS = new Set(Object.values(NAMED))

/** Whether text is a key in this spelling: the modifiers it holds in their
 *  one order, then one key by the name `systemKeyOf` gives it. `Shift+Win+N`
 *  is not one - it is `Win+Shift+N` spelt a second way. */
export function isSystemKey(text: string): boolean {
  const parts = /^(Win\+)?(Ctrl\+)?(Alt\+)?(Shift\+)?(.+)$/.exec(text)
  if (!parts) return false
  const key = parts[5]
  return /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || KEYS.has(key)
}

/** Whether a key could be a system-wide shortcut at all. A bare letter is
 *  typing, and so is a letter with only Shift - taken from every program at
 *  once; a function key on its own is fine. */
export function isShortcut(key: string): boolean {
  const parts = key.split('+')
  const main = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)
  const typing = main.length === 1 || main === 'Space' || main === 'Enter' || main === 'Tab' || main === 'Backspace'
  if (!typing) return true
  return modifiers.some((modifier) => modifier !== 'Shift')
}

const SHOWN: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' }

/** The key as a person reads it: arrows as arrows, the rest as written. */
export function showSystemKey(key: string): string {
  return key
    .split('+')
    .map((part) => SHOWN[part] ?? part)
    .join('+')
}

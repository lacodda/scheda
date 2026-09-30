// Every command the window has, in one list, and the one handler that turns a
// key into one of them.
//
// Before this, each panel listened to the keyboard for its own key. That was
// fine while nobody could change a key and nothing needed to list them; with a
// command palette that shows every command beside its key, and a settings
// screen that rebinds them, eleven listeners each holding a hard-coded letter
// would be eleven places for the palette to be wrong. So the list is data, the
// keys are data, and whoever owns a command attaches what it does.
//
// Keys are matched before the editor sees them (capture phase), so a key taken
// back from the editor — `Ctrl+E` is "end of line" in CodeMirror's defaults —
// is ours without fighting its keymap. Only chords that are bound here are
// touched; everything else goes on to the editor unchanged.
import { chordOf } from './keys'

/** Where a command applies. An editor command runs only while the keyboard is
 *  in a note: reading mode means nothing to the search box. */
export type Scope = 'window' | 'editor'

export interface CommandSpec {
  id: string
  /** What the palette shows, starting with what it is about. */
  title: string
  /** The keys it has before anybody changes them. */
  keys: string[]
  scope?: Scope
}

/** A command's work. Returning false declines the key, and it goes on to
 *  whatever would have had it — the fold keys decline where there is nothing
 *  to fold. */
export type Handler = () => boolean | void

// The order is the palette's order before anything is typed, so the things
// reached for most come first.
export const COMMANDS: readonly CommandSpec[] = [
  { id: 'palette.commands', title: 'Show all commands', keys: ['Ctrl+Shift+P'] },
  { id: 'file.goTo', title: 'Go to file', keys: ['Ctrl+P'] },
  { id: 'insert.block', title: 'Insert block', keys: ['Ctrl+Shift+Space'], scope: 'editor' },
  { id: 'file.new', title: 'File: New draft', keys: ['Ctrl+N'] },
  { id: 'file.open', title: 'File: Open', keys: ['Ctrl+O'] },
  { id: 'file.save', title: 'File: Save', keys: ['Ctrl+S'] },
  { id: 'file.saveAs', title: 'File: Save as', keys: ['Ctrl+Shift+S'] },
  { id: 'file.print', title: 'File: Print', keys: ['Ctrl+Alt+P'] },
  { id: 'file.export', title: 'File: Save as a web page', keys: ['Ctrl+Alt+S'] },
  { id: 'file.obsidian', title: 'File: Open in Obsidian', keys: [] },
  { id: 'tab.close', title: 'Tab: Close', keys: ['Ctrl+W'] },
  { id: 'tab.closeOthers', title: 'Tab: Close others', keys: [] },
  { id: 'tab.closeAll', title: 'Tab: Close all', keys: [] },
  { id: 'tab.reopen', title: 'Tab: Reopen closed', keys: [] },
  { id: 'tab.pin', title: 'Tab: Pin or unpin', keys: [] },
  { id: 'tab.next', title: 'Tab: Next', keys: ['Ctrl+Tab'] },
  { id: 'tab.previous', title: 'Tab: Previous', keys: ['Ctrl+Shift+Tab'] },
  { id: 'pane.split', title: 'Split: Open beside, or close the split', keys: ['Ctrl+\\'] },
  { id: 'pane.first', title: 'Split: Go to the first pane', keys: ['Ctrl+1'] },
  { id: 'pane.second', title: 'Split: Go to the second pane', keys: ['Ctrl+2'] },
  { id: 'view.reading', title: 'View: Reading mode', keys: ['Ctrl+E'], scope: 'editor' },
  { id: 'view.focus', title: 'View: Focus mode', keys: ['Ctrl+Shift+D'], scope: 'editor' },
  { id: 'panel.tree', title: 'Panel: Files', keys: ['Ctrl+Shift+E'] },
  { id: 'panel.outline', title: 'Panel: Outline', keys: ['Ctrl+Shift+O'] },
  { id: 'panel.network', title: 'Panel: What links here', keys: ['Ctrl+Shift+B'] },
  { id: 'panel.tags', title: 'Panel: Tags', keys: ['Ctrl+Shift+T'] },
  { id: 'search.vault', title: 'Search: In the vault', keys: ['Ctrl+Shift+F'] },
  { id: 'search.replace', title: 'Search: Replace in the vault', keys: ['Ctrl+Shift+H'] },
  { id: 'fold.section', title: 'Fold: This section', keys: ['Ctrl+Shift+['], scope: 'editor' },
  { id: 'unfold.section', title: 'Fold: Unfold this section', keys: ['Ctrl+Shift+]'], scope: 'editor' },
  { id: 'fold.all', title: 'Fold: Every section', keys: ['Ctrl+Alt+['], scope: 'editor' },
  { id: 'unfold.all', title: 'Fold: Unfold everything', keys: ['Ctrl+Alt+]'], scope: 'editor' },
  { id: 'quick.note', title: 'Quick note', keys: [] },
  { id: 'settings.open', title: 'Settings', keys: ['Ctrl+,'] },
  { id: 'theme.system', title: 'Theme: Follow the system', keys: [] },
  { id: 'theme.light', title: 'Theme: Light', keys: [] },
  { id: 'theme.dark', title: 'Theme: Dark', keys: [] },
  { id: 'autosave.toggle', title: 'Autosave: On or off', keys: [] },
]

const BY_ID = new Map(COMMANDS.map((command) => [command.id, command]))

const handlers = new Map<string, Handler>()
let overrides: Record<string, string[]> = {}
let revision = 0
const listeners = new Set<() => void>()

function changed() {
  revision += 1
  for (const listener of listeners) listener()
}

/** Attaches what a command does. Returns the detach, for an effect cleanup. */
export function handle(id: string, handler: Handler): () => void {
  if (!BY_ID.has(id)) throw new Error(`no command called ${id}`)
  handlers.set(id, handler)
  changed()
  return () => {
    if (handlers.get(id) === handler) {
      handlers.delete(id)
      changed()
    }
  }
}

/** Runs a command. False when nothing is attached to it, or it declined. */
export function run(id: string): boolean {
  const handler = handlers.get(id)
  if (!handler) return false
  return handler() !== false
}

/** The commands something is attached to — the ones the palette can offer. */
export function available(): CommandSpec[] {
  return COMMANDS.filter((command) => handlers.has(command.id))
}

/** Takes the person's changes to the keys, as the settings hold them. */
export function setOverrides(keys: Record<string, string[]>): void {
  overrides = { ...keys }
  changed()
}

/** The keys a command answers to now. */
export function keysFor(id: string): string[] {
  return overrides[id] ?? BY_ID.get(id)?.keys ?? []
}

/** The command a chord runs, if any. The first in the list wins a chord bound
 *  twice, and the settings screen says so before it can happen by accident. */
export function commandFor(chord: string): CommandSpec | undefined {
  return COMMANDS.find((command) => keysFor(command.id).includes(chord))
}

/** The other commands already on a chord, for the settings screen to warn
 *  about before a second binding silently loses. */
export function boundElsewhere(chord: string, except: string): CommandSpec[] {
  return COMMANDS.filter((command) => command.id !== except && keysFor(command.id).includes(chord))
}

/** Something to re-render on: attaching, detaching and rebinding all move it. */
export const registry = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  revision: () => revision,
}

/** Whether the keyboard is in a note rather than in a panel or a field. */
function inEditor(): boolean {
  const focused = document.activeElement
  return focused instanceof Element && focused.closest('.cm-editor') !== null
}

/** Listens for bound keys on the window. Returns the stop. */
export function installKeys(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // A key the window is recording for a rebind is not a command.
    if (event.defaultPrevented || recording) return
    const chord = chordOf(event)
    if (chord === null) return
    const command = commandFor(chord)
    if (!command || !handlers.has(command.id)) return
    if (command.scope === 'editor' && !inEditor()) return
    if (!run(command.id)) return
    event.preventDefault()
    event.stopPropagation()
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

let recording = false

/** Holds the command keys off while the settings screen listens for a new
 *  chord: the chord being recorded is often one that is already bound. */
export function setRecording(on: boolean): void {
  recording = on
}

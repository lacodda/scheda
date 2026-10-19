// Every command the window has, in one catalogue, and how each is declared to
// the line's list of commands.
//
// The list itself is dowel's (`src/ui/commands.tsx`, copied from its registry
// and held equal to it by `src/ui/registry.test.ts`): it answers the keyboard,
// lists what the palette offers, resolves two commands on one key, and reads a
// letter by its place on a layout that does not type Latin. What stays here is
// what only scheda knows (ADR 0018):
//
//  - **the catalogue** - every id, its title and its default keys, whether or
//    not its owner is mounted, because the ids are part of the settings format
//    (ADR 0016) and the settings screen rebinds a command that is not on
//    screen right now;
//  - **how scheda declares them** - every command fires inside the note as
//    well as outside it, and takes its key before CodeMirror's keymap does, so
//    a key the person gave a command wins over the editor (ADR 0013);
//  - **the old ids**, so a rebound key follows a renamed command.
import type { RefObject } from 'react'
import { setKeymap, useCommand as declare } from './ui/commands'
import { isApplePlatform, keyLabel, normalizeKeys, parseKeys, sameStroke, strokeParts } from './ui/shortcut'

/** Where a command's key is answered. An editor command answers only while
 *  the keyboard is in a note - reading mode means nothing to the search box -
 *  and still runs from the palette, on the note in front. */
export type Scope = 'window' | 'editor'

export interface CommandSpec {
  id: string
  /** What the palette shows, starting with what it is about. */
  title: string
  /** The keys it has before anybody changes them, in the line's notation. */
  keys: string[]
  scope?: Scope
  /** False for the one command the palette would only reopen. */
  offered?: boolean
}

// The order is the palette's order before anything is typed, so the things
// reached for most come first.
//
// `Mod` is Ctrl here and Cmd on a Mac. Tab switching is the one exception and
// says `Ctrl`: on a Mac Cmd+Tab belongs to the system, and Ctrl+Tab is what
// switches tabs there - off a Mac the two are the same key.
export const COMMANDS: readonly CommandSpec[] = [
  { id: 'palette.commands', title: 'Show all commands', keys: ['Mod+Shift+P'], offered: false },
  { id: 'file.goTo', title: 'Go to file', keys: ['Mod+P'] },
  { id: 'insert.block', title: 'Insert block', keys: ['Mod+Shift+Space'], scope: 'editor' },
  { id: 'file.new', title: 'File: New draft', keys: ['Mod+N'] },
  { id: 'file.open', title: 'File: Open', keys: ['Mod+O'] },
  { id: 'file.save', title: 'File: Save', keys: ['Mod+S'] },
  { id: 'file.saveAs', title: 'File: Save as', keys: ['Mod+Shift+S'] },
  { id: 'file.print', title: 'File: Print', keys: ['Mod+Alt+P'] },
  { id: 'file.export', title: 'File: Save as a web page', keys: ['Mod+Alt+S'] },
  { id: 'file.obsidian', title: 'File: Open in Obsidian', keys: [] },
  { id: 'tab.close', title: 'Tab: Close', keys: ['Mod+W'] },
  { id: 'tab.closeOthers', title: 'Tab: Close others', keys: [] },
  { id: 'tab.closeAll', title: 'Tab: Close all', keys: [] },
  { id: 'tab.reopen', title: 'Tab: Reopen closed', keys: [] },
  { id: 'tab.pin', title: 'Tab: Pin or unpin', keys: [] },
  { id: 'tab.next', title: 'Tab: Next', keys: ['Ctrl+Tab'] },
  { id: 'tab.previous', title: 'Tab: Previous', keys: ['Ctrl+Shift+Tab'] },
  { id: 'pane.split', title: 'Split: Open beside, or close the split', keys: ['Mod+\\'] },
  { id: 'pane.first', title: 'Split: Go to the first pane', keys: ['Mod+1'] },
  { id: 'pane.second', title: 'Split: Go to the second pane', keys: ['Mod+2'] },
  { id: 'view.reading', title: 'View: Reading mode', keys: ['Mod+E'], scope: 'editor' },
  { id: 'view.focus', title: 'View: Focus mode', keys: ['Mod+Shift+D'], scope: 'editor' },
  { id: 'panel.tree', title: 'Panel: Files', keys: ['Mod+Shift+E'] },
  { id: 'panel.outline', title: 'Panel: Outline', keys: ['Mod+Shift+O'] },
  { id: 'panel.network', title: 'Panel: What links here', keys: ['Mod+Shift+B'] },
  { id: 'panel.tags', title: 'Panel: Tags', keys: ['Mod+Shift+T'] },
  { id: 'search.vault', title: 'Search: In the vault', keys: ['Mod+Shift+F'] },
  { id: 'search.replace', title: 'Search: Replace in the vault', keys: ['Mod+Shift+H'] },
  { id: 'fold.section', title: 'Fold: This section', keys: ['Mod+{'], scope: 'editor' },
  { id: 'unfold.section', title: 'Fold: Unfold this section', keys: ['Mod+}'], scope: 'editor' },
  { id: 'fold.all', title: 'Fold: Every section', keys: ['Mod+Alt+['], scope: 'editor' },
  { id: 'unfold.all', title: 'Fold: Unfold everything', keys: ['Mod+Alt+]'], scope: 'editor' },
  { id: 'quick.note', title: 'Quick note', keys: [] },
  { id: 'settings.open', title: 'Settings', keys: ['Mod+,'] },
  { id: 'theme.system', title: 'Theme: Follow the system', keys: [] },
  { id: 'theme.light', title: 'Theme: Light', keys: [] },
  { id: 'theme.dark', title: 'Theme: Dark', keys: [] },
  { id: 'autosave.toggle', title: 'Autosave: On or off', keys: [] },
]

/** Ids a command was known by before it was renamed, and the id it has now.
 *
 *  The settings keep a rebound key under the id the command had when it was
 *  rebound, and ids are frozen with the settings file (ADR 0016): a command
 *  renamed without a line here would quietly drop the keys somebody chose for
 *  it. Empty until a command is renamed. */
export const RENAMED: Readonly<Record<string, string>> = {}

const BY_ID = new Map(COMMANDS.map((command) => [command.id, command]))

/** Where the order of the catalogue puts a command: the palette's order. */
export const ORDER = new Map(COMMANDS.map((command, index) => [command.id, index]))

/** Declares a command for as long as the calling component is mounted. An
 *  editor command says where the notes are, so its key is answered only
 *  there. */
export function useCommand(
  id: string,
  run: () => void,
  options: { notes?: RefObject<Element | null>; enabled?: boolean } = {},
): void {
  const spec = BY_ID.get(id)
  if (!spec) throw new Error(`no command called ${id}`)
  if ((spec.scope === 'editor') !== (options.notes !== undefined)) {
    throw new Error(`${id} is ${spec.scope === 'editor' ? '' : 'not '}a command of the note`)
  }
  declare({
    id,
    label: spec.title,
    keys: spec.keys,
    run,
    enabled: options.enabled,
    // Inside the note as well: the note is a field someone is typing in, and
    // every key of scheda's holds Ctrl or Alt or is a function key.
    whileTyping: true,
    // Before CodeMirror's keymap, which would otherwise keep any key it binds
    // - `Ctrl+D`, `Ctrl+/` - from a command the person moved onto it.
    capture: true,
    within: options.notes,
    offered: spec.offered ?? true,
  })
}

/** The person's changes to the keys, as the settings hold them, by the ids
 *  the commands have now. A key kept under an old id goes to the command that
 *  id became, unless the command's own id has keys too - that one is the
 *  later change. */
export function keymapOf(
  keys: Record<string, string[]>,
  renamed: Readonly<Record<string, string>> = RENAMED,
): Record<string, string[]> {
  const keymap: Record<string, string[]> = {}
  for (const [id, chords] of Object.entries(keys)) {
    const now = renamed[id] ?? id
    if (now !== id && now in keys) continue
    keymap[now] = chords
  }
  return keymap
}

/** Hands the person's keys to the list, under the ids the commands have now. */
export function applyKeys(
  keys: Record<string, string[]>,
  renamed: Readonly<Record<string, string>> = RENAMED,
): void {
  setKeymap(keymapOf(keys, renamed))
}

/** The keys a command answers to with these changes. */
export function keysFor(id: string, keymap: Record<string, string[]>): string[] {
  return keymap[id] ?? BY_ID.get(id)?.keys ?? []
}

/** Whether two shortcuts cannot both work: the same keys, or one the start of
 *  the other's sequence. Compared as keystrokes, so `Ctrl+Tab` and `Mod+Tab`
 *  are one key where they are. A shortcut that does not parse clashes with
 *  nothing - the list skips it too. */
export function clash(a: string, b: string): boolean {
  try {
    if (normalizeKeys(a) === normalizeKeys(b)) return true
    const [shorter, longer] = [parseKeys(a), parseKeys(b)].sort((x, y) => x.length - y.length)
    return shorter.every((stroke, index) => sameStroke(stroke, longer[index]!))
  } catch {
    return false
  }
}

/** The other commands already on keys, for the settings screen to take them
 *  from before a second binding silently loses. */
export function boundElsewhere(keys: string, except: string, keymap: Record<string, string[]>): CommandSpec[] {
  return COMMANDS.filter(
    (command) => command.id !== except && keysFor(command.id, keymap).some((other) => clash(keys, other)),
  )
}

/** Keys a keyboard off a Mac labels with a word, which a line of text says
 *  better than the symbol drawn on a cap: `␣` in a sentence reads as `_`. */
const SAID: Record<string, string> = { Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace' }

/** Keys as a person reads them, as text: each key under the name dowel's caps
 *  give it - `Ctrl+Shift+P` here, `⌘⇧P` on a Mac, run together the way a Mac
 *  prints its own - except the few a keyboard labels with a word, and the
 *  steps of a sequence parted by `›`, the mark the caps put between them.
 *  Keys that do not parse are shown as written: a settings file edited by
 *  hand is still shown, rather than taking the settings screen down with it. */
export function showKeys(keys: string, apple: boolean = isApplePlatform()): string {
  try {
    return parseKeys(keys, apple)
      .map((stroke) =>
        strokeParts(stroke)
          .map((key) => (apple ? undefined : SAID[key]) ?? keyLabel(key, apple))
          .join(apple ? '' : '+'),
      )
      .join(' › ')
  } catch {
    return keys
  }
}

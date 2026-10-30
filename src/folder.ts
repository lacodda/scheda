// The folder the window has open, as the window holds it.
//
// The folder itself is the core's: it keeps it with the session and asks it
// whenever a root is in question (`session.rs`), so the tree, going to a file,
// the search and the tags fall back to it without being told. What the window
// keeps here is the last answer, for the parts of it that show the folder or
// depend on it - the empty window, the commands, and every panel whose answer
// is about the vault in front and goes stale when the folder changes. They are
// separate React roots, so the one fact they share lives outside React, read
// with `useSyncExternalStore` like the settings.
import { useSyncExternalStore } from 'react'
import type { Folder } from './core'

let current: Folder | null = null
/** Bumped each time a folder is opened rather than merely restored: the tree
 *  shows itself for an opened folder, and not again for every re-render. */
let opened = 0
const listeners = new Set<() => void>()

function publish() {
  for (const listener of listeners) listener()
}

export const folder = {
  current: (): Folder | null => current,

  /** How many times a folder has been put in front of the person. */
  opened: (): number => opened,

  /** The window has this folder open. `reveal` when it was just opened, or
   *  came back as what was in front - the tree comes out to show it. */
  set(next: Folder | null, reveal: boolean) {
    current = next
    if (reveal && next !== null) opened += 1
    publish()
  },

  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** The folder the window has open, re-rendering when it changes. */
export function useFolder(): Folder | null {
  return useSyncExternalStore(folder.subscribe, folder.current)
}

/** The number of times a folder was opened, for the tree to show itself on. */
export function useFolderOpened(): number {
  return useSyncExternalStore(folder.subscribe, folder.opened)
}

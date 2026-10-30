// What an empty window has to say for itself.
//
// A blank tab with nothing in it is a fair thing for a notepad to show, but it
// is also the one moment when the list of files you were last in is worth
// more than empty space. So the recent list lives here, over the empty editor,
// and disappears the moment there is a character to read.
//
// With a folder open, the empty window is the folder's: its name, the notes
// opened in it lately, and how to find the others. The tree beside it is the
// rest of the folder.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadSettings, type Folder } from './core'
import { keymapOf, keysFor, showKeys } from './commands'
import { basename, dirname, isInside } from './paths'
import { settings as settingsStore } from './settings-store'

/** The keys a command answers to now, as text: the person may have moved it. */
function keysOf(id: string): string | null {
  const keys = keysFor(id, keymapOf(settingsStore.current()?.keys ?? {}))
  return keys.length > 0 ? showKeys(keys[0]) : null
}

export function RecentFiles({
  visible,
  folder,
  container,
  onOpen,
}: {
  visible: boolean
  /** The folder the window has open, whose empty window this is. */
  folder: Folder | null
  /** The editor's area. The list is drawn over it rather than over the whole
   *  window, so a tree open beside it is never under it. */
  container: HTMLElement
  onOpen: (path: string) => void
}) {
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (!visible) return
    let current = true
    void loadSettings()
      .then((settings) => {
        if (current) setRecent(settings.recent)
      })
      .catch(() => {
        // No settings, no list. An empty window is still a working window.
      })
    return () => {
      current = false
    }
  }, [visible])

  if (!visible) return null
  // In a folder, what was opened in it: the rest of the list is about other
  // work, and the folder is what was asked for.
  const shown = folder === null ? recent : recent.filter((path) => isInside(folder.root, path))
  // Without a folder there is nothing to say but the list, and an empty list
  // says nothing; a folder always has its name and the way to its notes.
  if (folder === null && shown.length === 0) return null

  const find = keysOf('file.goTo')
  const open = keysOf('file.open')

  return createPortal(
    <div className="recent">
      {folder !== null && (
        <h1 className="recent-folder" title={folder.root}>
          {folder.name}
        </h1>
      )}
      {shown.length > 0 && (
        <>
          <h2 className="recent-title">Recent</h2>
          <ul className="recent-list">
            {shown.map((path) => (
              <li key={path}>
                <button type="button" className="recent-item" onClick={() => onOpen(path)}>
                  <span className="recent-name">{basename(path)}</span>
                  <span className="recent-path">{dirname(path)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="recent-hint">
        {folder !== null && find !== null ? (
          <>
            <kbd>{find}</kbd> to find a note in it
          </>
        ) : (
          open !== null && (
            <>
              <kbd>{open}</kbd> to open something else
            </>
          )
        )}
      </p>
    </div>,
    container,
  )
}

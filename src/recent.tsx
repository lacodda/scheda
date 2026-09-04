// What an empty window has to say for itself.
//
// A blank tab with nothing in it is a fair thing for a notepad to show, but it
// is also the one moment when the list of files you were last in is worth
// more than empty space. So the recent list lives here, over the empty editor,
// and disappears the moment there is a character to read.
import { useEffect, useState } from 'react'
import { loadSettings } from './core'

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

function parent(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? '' : path.slice(0, cut)
}

export function RecentFiles({
  visible,
  onOpen,
}: {
  visible: boolean
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

  if (!visible || recent.length === 0) return null

  return (
    <div className="recent">
      <h2 className="recent-title">Recent</h2>
      <ul className="recent-list">
        {recent.map((path) => (
          <li key={path}>
            <button type="button" className="recent-item" onClick={() => onOpen(path)}>
              <span className="recent-name">{basename(path)}</span>
              <span className="recent-path">{parent(path)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="recent-hint">
        <kbd>Ctrl</kbd>+<kbd>O</kbd> to open something else
      </p>
    </div>
  )
}

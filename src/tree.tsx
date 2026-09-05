// The file tree of a vault.
//
// Appears only when the open document is inside one — a note on the Desktop
// gets no tree of the Desktop (decision 2026-09-05). Hidden behind a key like
// the outline, for the same reason: a notepad that opens with two sidebars is
// not a notepad.
//
// Which folders are open is view state and lives here. It is not written to the
// vault, and it is not written anywhere else yet either: a tab closed and
// reopened starts with the folders shut, which is a small cost against the
// alternative of a settings file that grows a key per folder.
import { useCallback, useEffect, useState } from 'react'
import { readTree, type TreeEntry, type Vault } from './core'

/** Reads the tree for whichever document is open, and again when it changes. */
function useVault(
  documentPath: string | null,
  active: boolean,
  onReveal: (paths: string[]) => void,
): Vault | null {
  const [vault, setVault] = useState<Vault | null>(null)

  useEffect(() => {
    let current = true
    if (!active || documentPath === null) {
      // Cleared asynchronously like every other answer here: setting state
      // straight from an effect body starts a second render before the first
      // has painted, which is what the linter objects to and it is right.
      queueMicrotask(() => {
        if (current) setVault(null)
      })
      return () => {
        current = false
      }
    }
    void readTree(documentPath)
      .then((found) => {
        if (!current) return
        setVault(found)
        // The branch holding the document opens with the tree, in the same
        // update. As a separate effect this was a second render for every tree
        // — and the linter says so, correctly.
        if (found) {
          const ancestors = ancestorsOf(found.entries, documentPath)
          if (ancestors && ancestors.length > 0) onReveal(ancestors)
        }
      })
      .catch(() => {
        // An unreadable folder leaves the panel empty rather than the window
        // broken. The document is still open and still editable.
        if (current) setVault(null)
      })
    return () => {
      current = false
    }
  }, [documentPath, active, onReveal])

  return vault
}

/** Paths compare by their parts, not by their punctuation.
 *
 *  A path written with forward slashes and the same path written with
 *  backslashes name one file, and both spellings reach here: the tree
 *  carries whatever the filesystem returned, while the document path can
 *  arrive from a command line typed by hand. A plain `startsWith` between
 *  the two answers false, and the branch holding the open file quietly
 *  never opens - which is exactly what the first version of this did.
 */
export function samePath(a: string, b: string): boolean {
  return normalise(a) === normalise(b)
}

function normalise(path: string): string {
  // Case is folded as well: Windows treats `Notes` and `notes` as one folder,
  // and a tree that disagrees with the filesystem is worse than no tree.
  return path
    .split(/[\\/]+/)
    .join('/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function isInside(folder: string, file: string): boolean {
  const parent = normalise(folder)
  return normalise(file).startsWith(parent + '/')
}

/** The folders between the vault root and a file, so the tree can be opened
 *  down to it. Null when the file is not in this tree at all. */
export function ancestorsOf(entries: TreeEntry[], target: string): string[] | null {
  for (const entry of entries) {
    if (samePath(entry.path, target)) return []
    if (!entry.children) continue
    // Only the branch that could hold the file is walked at all.
    if (!isInside(entry.path, target)) continue
    const deeper = ancestorsOf(entry.children, target)
    if (deeper !== null) return [entry.path, ...deeper]
  }
  return null
}

export function FileTree({
  documentPath,
  visible,
  onOpen,
}: {
  documentPath: string | null
  visible: boolean
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const reveal = useCallback((paths: string[]) => {
    setOpen((was) => {
      if (paths.every((path) => was.has(path))) return was
      const next = new Set(was)
      for (const path of paths) next.add(path)
      return next
    })
  }, [])

  const vault = useVault(documentPath, visible, reveal)

  const toggle = useCallback((path: string) => {
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  if (!visible) return null

  return (
    <aside className="tree" aria-label="Files">
      {vault === null ? (
        <p className="tree-empty">
          {documentPath === null ? 'No file open' : 'This file is not in a vault'}
        </p>
      ) : (
        <>
          <p className="tree-root" title={vault.root}>
            {vault.name}
          </p>
          <Branch
            entries={vault.entries}
            depth={0}
            open={open}
            onToggle={toggle}
            onOpen={onOpen}
            current={documentPath}
          />
        </>
      )}
    </aside>
  )
}

function Branch({
  entries,
  depth,
  open,
  onToggle,
  onOpen,
  current,
}: {
  entries: TreeEntry[]
  depth: number
  open: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  current: string | null
}) {
  return (
    <ul className="tree-list">
      {entries.map((entry) => {
        const isFolder = entry.children !== undefined
        const isOpen = open.has(entry.path)
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={
                'tree-item' +
                (isFolder ? ' tree-folder' : ' tree-file') +
                (current !== null && samePath(entry.path, current) ? ' tree-current' : '')
              }
              // The indent is inline because it is data, not style: a rule per
              // depth would cap the tree at however many rules were written.
              style={{ paddingLeft: `${0.9 + depth * 0.8}rem` }}
              onClick={() => (isFolder ? onToggle(entry.path) : onOpen(entry.path))}
              title={entry.name}
            >
              <span className="tree-mark" aria-hidden="true">
                {isFolder ? (isOpen ? '▾' : '▸') : ''}
              </span>
              {entry.name}
            </button>
            {isFolder && isOpen && entry.children && entry.children.length > 0 && (
              <Branch
                entries={entry.children}
                depth={depth + 1}
                open={open}
                onToggle={onToggle}
                onOpen={onOpen}
                current={current}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

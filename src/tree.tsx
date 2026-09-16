// The file tree of a vault, and the things you can do to the files in it.
//
// Appears only when the open document is inside one — a note on the Desktop
// gets no tree of the Desktop (decision 2026-09-05). Hidden behind a key like
// the outline, for the same reason: a notepad that opens with two sidebars is
// not a notepad.
//
// Making, renaming and deleting are all performed by the core; this file only
// asks. What it does own is the one thing a filesystem has no opinion about:
// where the new file goes when nothing in particular is selected, and how the
// tree gets back in step afterwards — by re-reading, rather than by patching
// its own copy and hoping the two agree.
//
// Which folders are open is view state and lives here. It is not written to the
// vault, and it is not written anywhere else yet either: a tab closed and
// reopened starts with the folders shut, which is a small cost against the
// alternative of a settings file that grows a key per folder.
import { useCallback, useEffect, useRef, useState } from 'react'
import { basename, dirname, isInside, samePath } from './paths'
import {
  createFile,
  createFolder,
  deleteEntry,
  readTree,
  renameEntry,
  type TreeEntry,
  type Vault,
} from './core'

/** What the tree is waiting for a name for. `path` is the folder a new entry
 *  goes in, or the entry being renamed. */
type Pending =
  | { kind: 'new-file'; parent: string }
  | { kind: 'new-folder'; parent: string }
  | { kind: 'rename'; path: string; name: string }

/** Where a right click landed, and what the menu is about. */
interface MenuAt {
  x: number
  y: number
  entry: TreeEntry | null
}

/** Reads the tree for whichever document is open, and again when it changes. */
function useVault(
  documentPath: string | null,
  active: boolean,
  onReveal: (paths: string[]) => void,
  generation: number,
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
    // `generation` is not read in the body: it is bumped after every file
    // operation so the tree is read again from disk. Patching the copy held
    // here instead would make it a second opinion about what the vault
    // contains, and the second opinion is the one that goes wrong.
  }, [documentPath, active, onReveal, generation])

  return vault
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

/** The folder a new file belongs in, given what was right-clicked.
 *
 *  A right click on a folder means "in here". A right click on a *file* means
 *  "beside this one" — not inside it, which is not a place — and that is the
 *  case worth stating: the obvious implementation passes the clicked path
 *  along and asks the core to create `note.md/new.md`. A click on nothing at
 *  all means the root.
 */
export function folderFor(entry: TreeEntry | null, root: string): string {
  if (entry === null) return root
  if (entry.children !== undefined) return entry.path
  return dirname(entry.path) || root
}

/** The name to offer when a rename begins: everything before the extension, so
 *  typing replaces the name and keeps the `.md` that makes it a note.
 *
 *  A dotfile is all name: `.gitignore` has no extension to keep, and offering
 *  `` with `gitignore` as the suffix would be a rename that starts by deleting
 *  the file's whole name. */
export function editableName(name: string): { stem: string; suffix: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, suffix: '' }
  return { stem: name.slice(0, dot), suffix: name.slice(dot) }
}

export function FileTree({
  documentPath,
  visible,
  onOpen,
  onRenamed,
  onDeleted,
  onFailure,
}: {
  documentPath: string | null
  visible: boolean
  onOpen: (path: string) => void
  /** A file moved: the tab showing it follows. */
  onRenamed: (from: string, to: string) => void
  /** A file went to the recycle bin: the tab showing it has to know. */
  onDeleted: (path: string) => void
  /** A refusal from the filesystem, in the words the core put it in. */
  onFailure: (message: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [generation, setGeneration] = useState(0)
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const reveal = useCallback((paths: string[]) => {
    setOpen((was) => {
      if (paths.every((path) => was.has(path))) return was
      const next = new Set(was)
      for (const path of paths) next.add(path)
      return next
    })
  }, [])

  const vault = useVault(documentPath, visible, reveal, generation)

  const toggle = useCallback((path: string) => {
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  /** Re-reads the tree from disk. Every operation ends here rather than
   *  editing the copy on screen: one truth about what the vault contains. */
  const refresh = useCallback(() => setGeneration((n) => n + 1), [])

  /** Runs an operation and turns a refusal into a message. The core writes
   *  those messages — "“notes.md” already exists", "“note.md” is open in
   *  another program" — so the dialog says something the person can act on. */
  const attempt = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action()
      } catch (error) {
        onFailure(messageOf(error))
      } finally {
        refresh()
      }
    },
    [onFailure, refresh],
  )

  const submit = useCallback(
    (name: string) => {
      const request = pending
      setPending(null)
      if (!request || name.trim() === '') return

      void attempt(async () => {
        if (request.kind === 'new-file') {
          const path = await createFile(request.parent, name)
          reveal([request.parent])
          onOpen(path)
        } else if (request.kind === 'new-folder') {
          await createFolder(request.parent, name)
          reveal([request.parent])
        } else {
          const moved = await renameEntry(request.path, name)
          onRenamed(moved.from, moved.to)
        }
      })
    },
    [pending, attempt, reveal, onOpen, onRenamed],
  )

  const remove = useCallback(
    (entry: TreeEntry) => {
      void attempt(async () => {
        await deleteEntry(entry.path)
        onDeleted(entry.path)
      })
    },
    [attempt, onDeleted],
  )

  // A click anywhere else, or Escape, puts the menu away. On the window rather
  // than on a backdrop element: a backdrop would swallow the click that closes
  // it, so choosing a different row would take two.
  useEffect(() => {
    if (menu === null) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!visible) return null

  return (
    <aside
      className="tree"
      aria-label="Files"
      onContextMenu={(event) => {
        // The panel's own background: the menu is about the root.
        if (vault === null) return
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY, entry: null })
      }}
    >
      {vault === null ? (
        <p className="tree-empty">
          {documentPath === null ? 'No file open' : 'This file is not in a vault'}
        </p>
      ) : (
        <>
          <p className="tree-root" title={vault.root}>
            {vault.name}
          </p>
          {pending !== null && pending.kind !== 'rename' && samePath(pending.parent, vault.root) && (
            <NameInput
              kind={pending.kind}
              depth={0}
              initial=""
              onSubmit={submit}
              onCancel={() => setPending(null)}
            />
          )}
          <Branch
            entries={vault.entries}
            depth={0}
            open={open}
            onToggle={toggle}
            onOpen={onOpen}
            current={documentPath}
            pending={pending}
            onSubmit={submit}
            onCancel={() => setPending(null)}
            onMenu={(entry, x, y) => setMenu({ x, y, entry })}
          />
        </>
      )}
      {menu !== null && vault !== null && (
        <Menu
          at={menu}
          root={vault.root}
          onPick={(action) => {
            const entry = menu.entry
            setMenu(null)
            if (action === 'delete') {
              if (entry) remove(entry)
              return
            }
            if (action === 'rename') {
              if (entry) setPending({ kind: 'rename', path: entry.path, name: entry.name })
              return
            }
            setPending({ kind: action, parent: folderFor(entry, vault.root) })
            if (entry?.children !== undefined) reveal([entry.path])
          }}
        />
      )}
    </aside>
  )
}

/** The message a core refusal carries, or something honest when it carries
 *  none. The core's errors arrive as `{ message }`, not as an `Error`. */
function messageOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return error instanceof Error ? error.message : String(error)
}

type MenuAction = 'new-file' | 'new-folder' | 'rename' | 'delete'

function Menu({
  at,
  root,
  onPick,
}: {
  at: MenuAt
  root: string
  onPick: (action: MenuAction) => void
}) {
  const entry = at.entry
  const where = entry === null ? basename(root) : entry.name

  return (
    <div
      className="tree-menu"
      role="menu"
      style={{ left: at.x, top: at.y }}
      // The menu's own clicks must not reach the window listener that closes
      // it before the button's own handler has run.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="tree-menu-where" title={entry?.path ?? root}>
        {where}
      </p>
      <button type="button" role="menuitem" onClick={() => onPick('new-file')}>
        New note
      </button>
      <button type="button" role="menuitem" onClick={() => onPick('new-folder')}>
        New folder
      </button>
      {entry !== null && (
        <>
          <hr />
          <button type="button" role="menuitem" onClick={() => onPick('rename')}>
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-menu-danger"
            onClick={() => onPick('delete')}
          >
            Move to recycle bin
          </button>
        </>
      )}
    </div>
  )
}

/** The row that is a text field: a new name being typed, in place, at the depth
 *  the entry will appear at.
 *
 *  In the tree rather than in a dialog because the answer is a file name and
 *  the question is "what do you want to call it" — a modal for that is a box to
 *  dismiss on the way to typing six characters. */
function NameInput({
  kind,
  depth,
  initial,
  onSubmit,
  onCancel,
}: {
  kind: Pending['kind']
  depth: number
  initial: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const field = ref.current
    if (!field) return
    field.focus()
    // The name without its extension is selected, so typing replaces the name
    // and keeps the `.md`. Renaming `note.md` should not start by making the
    // file stop being a note.
    const { stem } = editableName(field.value)
    field.setSelectionRange(0, stem.length)
  }, [])

  return (
    <div className="tree-naming" style={{ paddingLeft: `${0.9 + depth * 0.8}rem` }}>
      <span className="tree-mark" aria-hidden="true">
        {kind === 'new-folder' ? '▸' : ''}
      </span>
      <input
        ref={ref}
        className="tree-name-input"
        defaultValue={initial}
        aria-label={kind === 'rename' ? 'New name' : 'Name'}
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSubmit(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        // Clicking away is a cancel, not a commit: a half-typed name committed
        // by looking elsewhere is a file nobody meant to make.
        onBlur={onCancel}
      />
    </div>
  )
}

function Branch({
  entries,
  depth,
  open,
  onToggle,
  onOpen,
  current,
  pending,
  onSubmit,
  onCancel,
  onMenu,
}: {
  entries: TreeEntry[]
  depth: number
  open: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  current: string | null
  pending: Pending | null
  onSubmit: (name: string) => void
  onCancel: () => void
  onMenu: (entry: TreeEntry, x: number, y: number) => void
}) {
  return (
    <ul className="tree-list">
      {entries.map((entry) => {
        const isFolder = entry.children !== undefined
        const isOpen = open.has(entry.path)
        const renaming =
          pending?.kind === 'rename' && samePath(pending.path, entry.path) ? pending : null
        const naming =
          pending !== null && pending.kind !== 'rename' && samePath(pending.parent, entry.path)
            ? pending
            : null

        return (
          <li key={entry.path}>
            {renaming ? (
              <NameInput
                kind="rename"
                depth={depth}
                initial={renaming.name}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            ) : (
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
                onContextMenu={(event) => {
                  event.preventDefault()
                  // Not the panel's menu as well: the row is the more specific
                  // answer to what was clicked.
                  event.stopPropagation()
                  onMenu(entry, event.clientX, event.clientY)
                }}
                title={entry.name}
              >
                <span className="tree-mark" aria-hidden="true">
                  {isFolder ? (isOpen ? '▾' : '▸') : ''}
                </span>
                {entry.name}
              </button>
            )}
            {/* A new entry is typed inside the folder it will appear in, at the
                depth it will have — so the row you are typing is where the file
                is about to be. */}
            {naming && (
              <NameInput
                kind={naming.kind}
                depth={depth + 1}
                initial=""
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            )}
            {isFolder && isOpen && entry.children && entry.children.length > 0 && (
              <Branch
                entries={entry.children}
                depth={depth + 1}
                open={open}
                onToggle={onToggle}
                onOpen={onOpen}
                current={current}
                pending={pending}
                onSubmit={onSubmit}
                onCancel={onCancel}
                onMenu={onMenu}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

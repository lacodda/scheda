// The network panel: what points at this note, and what this note points at in
// vain.
//
// Hidden until asked for (`Ctrl+Shift+B`), like the outline and the tree. A
// notepad that opens with three sidebars is not a notepad, and a note with no
// backlinks — which most notes are — earns the panel nothing (decision
// 2026-09-05).
//
// Both lists come from one call, because both are answered by reading the
// vault's notes and asking twice would read every file twice. The reading is the
// core's; what is here is when to ask and how to show it.
import { useEffect, useState } from 'react'
import { readNetwork, type Network as Links, type Reference, type Unresolved } from './core'
import type { EditorHandle } from './editor/mount'

/** One empty answer, shared. A fresh object each render would be a new value to
 *  every hook that watches it. */
const EMPTY: Links = { backlinks: [], unresolved: [] }

/** What came back, and what it was an answer to. */
interface Answer {
  for: string
  /** The vault revision it was read at. A write to the vault makes it stale
   *  even though the note is the same one. */
  at: number
  links: Links
}

/** Reads the network for the open note, and again whenever the vault changes.
 *
 *  Not on every keystroke: the answer is about the files on disk, and the note
 *  being typed in has not reached them yet. It is re-read when the panel opens,
 *  when the tab changes, and when the document is saved or the vault is written
 *  to from outside — which is what `revision` counts.
 */
function useNetwork(
  editor: EditorHandle,
  path: string | null,
  active: boolean,
  revision: number,
): { links: Links; loading: boolean } {
  // Keyed by what it is an answer *to*, so a stale answer is never shown. The
  // alternative — clearing the state when the question changes — is a setState
  // in an effect body, which React rightly objects to: the empty panel is not a
  // thing to store, it is what "no answer for this note yet" looks like.
  const [answer, setAnswer] = useState<Answer | null>(null)

  // An answer belongs to one note and one revision of the vault. Holding what
  // it is an answer *to* is what lets both "which links" and "have they
  // arrived" be read off it, rather than kept as a second piece of state that
  // has to be cleared in step with the first — the clearing is what React
  // objects to, and rightly: an empty panel is not a thing to store, it is what
  // "nothing has come back for this note yet" looks like.
  const fresh = answer !== null && answer.for === path && answer.at === revision
  const links = fresh ? answer.links : EMPTY
  const loading = active && path !== null && !fresh

  useEffect(() => {
    if (!active || path === null) return
    let current = true
    void readNetwork(path)
      .then((found) => {
        if (current) setAnswer({ for: path, at: revision, links: found })
      })
      .catch(() => {
        // A vault that cannot be read leaves the panel empty rather than
        // showing a dialog: nothing here is something the person can act on,
        // and the note itself is open either way.
        if (current) setAnswer({ for: path, at: revision, links: EMPTY })
      })
    return () => {
      current = false
    }
  }, [editor, path, active, revision])

  return { links, loading }
}

export function NetworkPanel({
  editor,
  visible,
  revision,
  onOpen,
  onCreate,
}: {
  editor: EditorHandle
  visible: boolean
  /** Bumped by the shell when the vault changed, so the panel re-reads. */
  revision: number
  onOpen: (path: string, line: number) => void
  onCreate: (target: string) => void
}) {
  const path = editor.active().path
  const { links, loading } = useNetwork(editor, path, visible, revision)

  if (!visible) return null

  const nothing =
    !loading && links.backlinks.length === 0 && links.unresolved.length === 0

  return (
    <aside className="network" aria-label="Links">
      <h2 className="network-heading">
        Linked here
        {links.backlinks.length > 0 && (
          <span className="network-count">{links.backlinks.length}</span>
        )}
      </h2>
      {links.backlinks.length === 0 ? (
        <p className="network-empty">
          {loading ? 'Reading the vault…' : path === null ? 'Not in a vault' : 'Nothing links here'}
        </p>
      ) : (
        <ol className="network-list">
          {links.backlinks.map((row) => (
            <Backlink key={`${row.path}-${row.line}-${row.target}`} row={row} onOpen={onOpen} />
          ))}
        </ol>
      )}

      {/* The holes in this note: links to notes that have not been written yet.
          A vault accumulates these on purpose — writing `[[the thing]]` before
          the thing exists is how notes get planned — so the list is a to-do,
          not a list of errors, and each row offers to make the note. */}
      {links.unresolved.length > 0 && (
        <>
          <h2 className="network-heading">
            Not written yet
            <span className="network-count">{links.unresolved.length}</span>
          </h2>
          <ol className="network-list">
            {links.unresolved.map((row) => (
              <Missing key={row.target} row={row} onCreate={onCreate} />
            ))}
          </ol>
        </>
      )}

      {nothing && path !== null && (
        <p className="network-note">
          Links in other notes appear here once they point at this one.
        </p>
      )}
    </aside>
  )
}

function Backlink({ row, onOpen }: { row: Reference; onOpen: (path: string, line: number) => void }) {
  return (
    <li>
      <button
        type="button"
        className="network-item"
        onClick={() => onOpen(row.path, row.line)}
        title={`${row.relative}:${row.line}`}
      >
        <span className="network-where">{row.relative}</span>
        <span className="network-context">{row.context}</span>
      </button>
    </li>
  )
}

function Missing({ row, onCreate }: { row: Unresolved; onCreate: (target: string) => void }) {
  return (
    <li>
      <button
        type="button"
        className="network-item network-missing"
        onClick={() => onCreate(row.target)}
        title={`Create “${row.target}”`}
      >
        <span className="network-where">{row.target}</span>
        <span className="network-context">{row.context}</span>
      </button>
    </li>
  )
}

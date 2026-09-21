// The tags panel: every tag in the vault, and the notes carrying each.
//
// Hidden until asked for (`Ctrl+Shift+T`), like the outline, the tree and the
// network. A notepad that opens with four sidebars is not a notepad.
//
// A tag list is the one panel here that is about the *vault* rather than about
// the open note, and that changes what it is for. The network answers "what
// points at this note"; this answers "what is in here at all", which is the
// question a person asks when they have forgotten what they filed and under
// what. So it does not empty when the note has no tags — it stays the vault's
// list, with the open note's own tags marked in it. A panel that went blank on
// a note with no tags would be useless in exactly the moment it is opened.
//
// The reading is the core's (`tags.rs`); what is here is when to ask and how to
// show it.
import { useEffect, useMemo, useState } from 'react'
import { readTags, type Tag } from './core'
import type { EditorHandle } from './editor/mount'

/** One empty answer, shared. A fresh array each render would be a new value to
 *  every hook that watches it. */
const EMPTY: Tag[] = []

/** What came back, and what it was an answer to. */
interface Answer {
  for: string
  /** The vault revision it was read at. A write to the vault makes it stale
   *  even though the note is the same one. */
  at: number
  tags: Tag[]
}

/** Reads the vault's tags, and again whenever the vault changes.
 *
 *  Not on every keystroke: the answer is about the files on disk, and the note
 *  being typed in has not reached them yet. Re-read when the panel opens, when
 *  the tab changes and when the vault is written to — which is what `revision`
 *  counts. The same shape as `useNetwork`, deliberately: two panels that ask the
 *  same kind of question at different moments would be two ways to be stale. */
function useTags(
  path: string | null,
  active: boolean,
  revision: number,
): { tags: Tag[]; loading: boolean } {
  // Keyed by what it is an answer *to*, so a stale answer is never shown. The
  // alternative — clearing the state when the question changes — is a setState
  // in an effect body, which React rightly objects to.
  const [answer, setAnswer] = useState<Answer | null>(null)

  const fresh = answer !== null && answer.for === path && answer.at === revision
  const tags = fresh ? answer.tags : EMPTY
  const loading = active && path !== null && !fresh

  useEffect(() => {
    if (!active || path === null) return
    let current = true
    void readTags(path)
      .then((found) => {
        if (current) setAnswer({ for: path, at: revision, tags: found })
      })
      .catch(() => {
        // A vault that cannot be read leaves the panel empty rather than
        // showing a dialog: nothing here is something the person can act on,
        // and the note itself is open either way.
        if (current) setAnswer({ for: path, at: revision, tags: EMPTY })
      })
    return () => {
      current = false
    }
  }, [path, active, revision])

  return { tags, loading }
}

export function TagsPanel({
  editor,
  visible,
  revision,
  onOpen,
}: {
  editor: EditorHandle
  visible: boolean
  /** Bumped by the shell when the vault changed, so the panel re-reads. */
  revision: number
  onOpen: (path: string, line: number) => void
}) {
  const path = editor.active().path
  const { tags, loading } = useTags(path, visible, revision)
  const [filter, setFilter] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  // Which tags the open note carries, so they can be marked in the vault's
  // list. Read off the answer rather than asked for separately: the places are
  // already here, and a second call would read every note twice to learn
  // something the first call knows.
  const mine = useMemo(() => {
    if (path === null) return new Set<string>()
    const lower = path.toLowerCase()
    return new Set(
      tags
        .filter((tag) => tag.places.some((place) => place.path.toLowerCase() === lower))
        .map((tag) => tag.name),
    )
  }, [tags, path])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (needle === '') return tags
    return tags.filter((tag) => tag.name.toLowerCase().includes(needle))
  }, [tags, filter])

  if (!visible) return null

  return (
    <aside className="tags" aria-label="Tags">
      <h2 className="tags-heading">
        Tags
        {tags.length > 0 && <span className="tags-count">{tags.length}</span>}
      </h2>

      {tags.length > 0 && (
        <input
          type="search"
          className="tags-filter"
          placeholder="Filter tags"
          aria-label="Filter tags"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}

      {shown.length === 0 ? (
        <p className="tags-empty">
          {loading
            ? 'Reading the vault…'
            : path === null
              ? 'Not in a vault'
              : tags.length === 0
                ? 'No tags in this vault'
                : 'No tag matches'}
        </p>
      ) : (
        <ol className="tags-list">
          {shown.map((tag) => (
            <TagRow
              key={tag.name}
              tag={tag}
              here={mine.has(tag.name)}
              open={opened === tag.name}
              onToggle={() => setOpened((was) => (was === tag.name ? null : tag.name))}
              onOpen={onOpen}
            />
          ))}
        </ol>
      )}
    </aside>
  )
}

function TagRow({
  tag,
  here,
  open,
  onToggle,
  onOpen,
}: {
  tag: Tag
  /** Whether the open note carries this tag. */
  here: boolean
  open: boolean
  onToggle: () => void
  onOpen: (path: string, line: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        className={`tags-item${here ? ' tags-item--here' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
        title={here ? `${tag.name} — carried by this note` : tag.name}
      >
        <span className="tags-name">#{tag.name}</span>
        {/* The count is notes, not mentions: a note that writes the same tag in
            five paragraphs is one note about it, and a panel that said five
            would be answering a question nobody asked. */}
        <span className="tags-notes">{tag.notes}</span>
      </button>
      {open && (
        <ol className="tags-places">
          {tag.places.map((place) => (
            <li key={`${place.path}-${place.line ?? 'front'}`}>
              <button
                type="button"
                className="tags-place"
                // A front-matter tag has no line of its own; opening the note at
                // its top is the honest answer rather than guessing a line.
                onClick={() => onOpen(place.path, place.line ?? 1)}
                title={place.line === null ? place.relative : `${place.relative}:${place.line}`}
              >
                <span className="tags-where">{place.relative}</span>
                {place.context !== '' && <span className="tags-context">{place.context}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

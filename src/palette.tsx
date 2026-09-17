// Going to a file by typing part of its name.
//
// The list and the ranking are the core's (`quick.rs`); this file is the panel
// and the keys. That split is the same one the tree makes, and for the same
// reason: the vault's contents are not something the window keeps a second
// opinion about.
//
// The panel is deliberately small. A palette that also runs commands, opens
// settings and searches text is a different feature wearing this one's shortcut
// — and the product this belongs to is a notepad.
import { useCallback, useEffect, useRef, useState } from 'react'
import { findFiles, type FileHit } from './core'

/** How long typing pauses before the vault is searched again.
 *
 *  A search per keystroke is a round trip per character, and on a vault of a
 *  few thousand notes the answer to `pl` is thrown away before it is drawn. Low
 *  enough that the list keeps up with typing, high enough that a word typed at
 *  speed is one search rather than six. */
const SETTLE_MS = 60

/** The picker, mounted only while it is open.
 *
 *  A wrapper rather than a `visible` prop threaded through the panel, because
 *  unmounting is what makes "opens empty" true by construction: the alternative
 *  is an effect that clears the query on the way in, which is a render caused by
 *  a render, and the linter objects to it correctly. */
export function Palette({
  documentPath,
  visible,
  onPick,
  onClose,
}: {
  /** The document whose vault is searched. The picker is about the vault you
   *  are in, not about every vault you have ever opened. */
  documentPath: string | null
  visible: boolean
  onPick: (path: string) => void
  onClose: () => void
}) {
  if (!visible) return null
  return <Panel documentPath={documentPath} onPick={onPick} onClose={onClose} />
}

function Panel({
  documentPath,
  onPick,
  onClose,
}: {
  documentPath: string | null
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<FileHit[]>([])
  const [at, setAt] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  // The field takes the keyboard as the panel appears. Touching the DOM is what
  // an effect is for, unlike setting state in one.
  useEffect(() => {
    field.current?.focus()
  }, [])

  useEffect(() => {
    if (documentPath === null) return
    let current = true
    const timer = setTimeout(() => {
      void findFiles(documentPath, query)
        .then((found) => {
          if (!current) return
          setHits(found)
          // Back to the top on every new query: the cursor belongs to the list
          // in front of you, and keeping its index across a search leaves it
          // pointing at whatever happens to be in that row now.
          setAt(0)
        })
        .catch(() => {
          if (current) setHits([])
        })
    }, SETTLE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [documentPath, query])

  // The highlighted row is kept in view. Without this, holding the down arrow
  // walks the cursor off the bottom of a scrolling panel and the list stops
  // appearing to move at all.
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const choose = useCallback(
    (hit: FileHit | undefined) => {
      if (!hit) return
      onPick(hit.path)
      onClose()
    },
    [onPick, onClose],
  )

  return (
    <div
      className="palette-backdrop"
      // A click outside is a way out, the way it is for the tree's menu.
      onPointerDown={onClose}
    >
      <div
        className="palette"
        role="dialog"
        aria-label="Go to file"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          ref={field}
          className="palette-field"
          value={query}
          placeholder="Go to file"
          aria-label="Go to file"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setAt((was) => Math.min(was + 1, hits.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setAt((was) => Math.max(was - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(hits[at])
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        {hits.length === 0 ? (
          <p className="palette-empty">
            {documentPath === null
              ? 'No file open'
              : query === ''
                ? 'This file is not in a vault'
                : 'Nothing matches'}
          </p>
        ) : (
          <ul className="palette-list" ref={list} role="listbox">
            {hits.map((hit, index) => (
              <li key={hit.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === at}
                  className={'palette-row' + (index === at ? ' palette-row--at' : '')}
                  // The row under the pointer becomes the row Enter would take,
                  // so the mouse and the keyboard never disagree about which
                  // file is about to open.
                  onPointerEnter={() => setAt(index)}
                  onClick={() => choose(hit)}
                >
                  <span className="palette-name">
                    <Marked text={hit.name} at={hit.matched} />
                  </span>
                  {hit.folder !== '' && <span className="palette-folder">{hit.folder}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** A name with the matched letters in bold.
 *
 *  Without this a fuzzy list is a list of files with no account of why any of
 *  them is in it — and the account is the thing that lets someone type one more
 *  letter instead of reading every row. */
export function Marked({ text, at }: { text: string; at: number[] }) {
  if (at.length === 0) return <>{text}</>

  // By character rather than by index into the string: a name with an emoji or
  // a composed letter in it would otherwise be cut through the middle of one,
  // and the core counted characters when it matched.
  const letters = Array.from(text)
  const wanted = new Set(at)
  const parts: { text: string; hit: boolean }[] = []
  for (let index = 0; index < letters.length; index += 1) {
    const hit = wanted.has(index)
    const last = parts[parts.length - 1]
    // Runs, not one span per letter: `notes` matched on all five would
    // otherwise be five elements saying the same thing.
    if (last && last.hit === hit) last.text += letters[index]
    else parts.push({ text: letters[index], hit })
  }

  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <b key={index} className="palette-hit">
            {part.text}
          </b>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

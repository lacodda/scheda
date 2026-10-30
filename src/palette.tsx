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
import { findFiles, loadSettings, type FileHit } from './core'
import { useFolder } from './folder'
import { match } from './fuzzy'
import { basename, samePath } from './paths'

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
  /** The document whose vault is searched - or the window's folder, when it
   *  is in none or there is none. The picker is about the vault you are in,
   *  not about every vault you have ever opened. */
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
  const [found, setFound] = useState<FileHit[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [at, setAt] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  // The field takes the keyboard as the panel appears. Touching the DOM is what
  // an effect is for, unlike setting state in one.
  useEffect(() => {
    field.current?.focus()
  }, [])

  // The files opened lately, from every vault and from none. Read once as the
  // panel opens: the list does not change while somebody is choosing from it.
  useEffect(() => {
    let current = true
    void loadSettings()
      .then((settings) => {
        if (current) setRecent(settings.recent)
      })
      .catch(() => {
        // No list is an ordinary answer; the vault's files are still here.
      })
    return () => {
      current = false
    }
  }, [])

  // Not read below: the core answers from the folder it holds. Here so a
  // folder opened while the panel is up is searched again.
  const folder = useFolder()?.root ?? null

  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      void findFiles(documentPath, query)
        .then((answer) => {
          if (!current) return
          setFound(answer)
          // Back to the top on every new query: the cursor belongs to the list
          // in front of you, and keeping its index across a search leaves it
          // pointing at whatever happens to be in that row now.
          setAt(0)
        })
        .catch(() => {
          if (current) setFound([])
        })
    }, SETTLE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [documentPath, folder, query])

  const hits = withRecent(found, recent, query, documentPath)

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
            {query !== ''
              ? 'Nothing matches'
              : folder !== null
                ? 'Nothing in this folder yet'
                : documentPath === null
                  ? 'No file or folder open'
                  : 'This file is not in a vault'}
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
                  onPointerMove={(event) => {
                    if (movedOver(event)) setAt(index)
                  }}
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

/** The vault's answer with the recent files worked in.
 *
 *  Before anything is typed, the recent files lead: "the one I was just in" is
 *  the commonest reason to open this panel, and it is a question about the
 *  person's week rather than about the vault. Once letters are typed the
 *  vault's ranking leads, and recent files from outside the vault follow when
 *  they match — a note on the Desktop is still one keystroke away. */
export function withRecent(
  vault: FileHit[],
  recent: string[],
  query: string,
  documentPath: string | null,
): FileHit[] {
  const inVault = (path: string) => vault.some((hit) => samePath(hit.path, path))
  const candidates = recent.filter((path) => documentPath === null || !samePath(path, documentPath))
  const rows: FileHit[] = []
  for (const path of candidates) {
    const name = basename(path)
    const found = match(query, name)
    if (!found) continue
    if (query !== '' && inVault(path)) continue
    rows.push({ path, name, folder: path.slice(0, Math.max(path.length - name.length - 1, 0)), matched: found.at })
  }
  if (query === '') {
    return [...rows, ...vault.filter((hit) => !rows.some((row) => samePath(row.path, hit.path)))]
  }
  return [...vault, ...rows]
}

/** Whether the pointer really moved over a row, rather than the row arriving
 *  under a pointer that stayed where it was.
 *
 *  A list opened under a resting mouse gets a hover event for whichever row
 *  lands beneath it, and taking that as a choice sends Enter to that row
 *  instead of the first one — found live, when typing `pin` and pressing Enter
 *  ran a command three rows down. Only movement counts as pointing. */
export function movedOver(event: { movementX: number; movementY: number }): boolean {
  return event.movementX !== 0 || event.movementY !== 0
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

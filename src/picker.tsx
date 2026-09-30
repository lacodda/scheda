// A list over the text that is filtered by typing: the command palette and the
// block palette are both this, with different rows.
//
// Going to a file looks the same and is a separate component, because its list
// is the core's and arrives a keystroke later; these lists are the window's own
// and are matched here as they are typed (`fuzzy.ts`). The panel, the keys and
// the look are shared, so the three read as one kind of thing.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { rank } from './fuzzy'
import { Marked, movedOver } from './palette'

export interface PickerProps<T> {
  items: readonly T[]
  /** The text an item is matched and shown by. */
  text: (item: T) => string
  /** A stable key for an item. */
  id: (item: T) => string
  /** What goes at the right of a row: a command's key, a block's hint. */
  detail?: (item: T) => ReactNode
  label: string
  placeholder: string
  empty: string
  onPick: (item: T) => void
  onClose: () => void
}

export function Picker<T>({ items, text, id, detail, label, placeholder, empty, onPick, onClose }: PickerProps<T>) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const rows = useMemo(() => rank(items, query, text), [items, query, text])
  // Held in range as the list shrinks under the typing, rather than reset by
  // an effect: the first row is the one Enter takes after every keystroke.
  const at = Math.min(chosen, Math.max(rows.length - 1, 0))

  useEffect(() => {
    field.current?.focus()
  }, [])

  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const choose = (index: number) => {
    const row = rows[index]
    if (!row) return
    // Closed first, so whatever the item does — focusing the editor, opening
    // another panel — happens in a window that no longer has this one on top.
    onClose()
    onPick(row.item)
  }

  return (
    <div className="palette-backdrop" onPointerDown={onClose}>
      <div className="palette" role="dialog" aria-label={label} onPointerDown={(event) => event.stopPropagation()}>
        <input
          ref={field}
          className="palette-field"
          value={query}
          placeholder={placeholder}
          aria-label={label}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setChosen(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setChosen(Math.min(at + 1, rows.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setChosen(Math.max(at - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(at)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        {rows.length === 0 ? (
          <p className="palette-empty">{empty}</p>
        ) : (
          <ul className="palette-list" ref={list} role="listbox">
            {rows.map((row, index) => (
              <li key={id(row.item)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === at}
                  className={'palette-row' + (index === at ? ' palette-row--at' : '')}
                  onPointerMove={(event) => {
                    if (movedOver(event)) setChosen(index)
                  }}
                  onClick={() => choose(index)}
                >
                  <span className="palette-name">
                    <Marked text={text(row.item)} at={row.at} />
                  </span>
                  {detail && <span className="palette-folder">{detail(row.item)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

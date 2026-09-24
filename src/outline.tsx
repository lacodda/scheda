// The outline panel: the document's headings, a way to jump to one, and a way
// to move a section by dragging its heading.
//
// Hidden until asked for (`Ctrl+Shift+O`). A notepad that opens with a sidebar
// is not a notepad, and most files that get opened here have three headings or
// none — the panel earns its width on the long ones and nowhere else
// (decision 2026-09-05).
import { type DragEvent, useEffect, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { outlineOf, type Heading } from './editor/outline'
import { moveSection } from './editor/sections'
import type { EditorHandle } from './editor/mount'

/** Re-reads the outline whenever the document changes.
 *
 *  On every change rather than on a timer: the list is short, the parse is
 *  already done for the decorations, and a heading that appears half a second
 *  after it was typed reads as a bug.
 */
function useOutline(editor: EditorHandle, active: boolean): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([])

  useEffect(() => {
    if (!active) return
    const read = () => setHeadings(outlineOf(editor.view.state))
    read()
    return editor.subscribe(read)
  }, [editor, active])

  return headings
}

/** Where a dragged section would land: before a heading, or at the end. */
type Drop = number | 'end'

export function Outline({ editor, visible }: { editor: EditorHandle; visible: boolean }) {
  const headings = useOutline(editor, visible)
  const [dragged, setDragged] = useState<number | null>(null)
  const [over, setOver] = useState<Drop | null>(null)

  if (!visible) return null

  const locked = editor.view.state.readOnly

  const drop = (target: Drop) => {
    if (dragged === null) return
    const spec = moveSection(editor.view.state, dragged, target === 'end' ? null : target)
    setDragged(null)
    setOver(null)
    if (!spec) return
    editor.view.dispatch(spec)
    editor.view.focus()
  }

  // The drop target's handlers, shared by a heading's row and the strip below
  // the last one. `dragover` has to be cancelled for a drop to be allowed.
  const target = (at: Drop) => ({
    onDragOver: (event: DragEvent) => {
      if (dragged === null) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (over !== at) setOver(at)
    },
    onDragLeave: () => {
      if (over === at) setOver(null)
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      drop(at)
    },
  })

  return (
    <aside className="outline" aria-label="Outline">
      {headings.length === 0 ? (
        <p className="outline-empty">No headings</p>
      ) : (
        <ol className="outline-list">
          {headings.map((heading, index) => (
            <li
              key={`${heading.line}-${heading.from}`}
              className={over === index ? 'outline-drop' : undefined}
              {...target(index)}
            >
              <button
                type="button"
                className={`outline-item outline-level-${heading.level}${
                  dragged === index ? ' outline-item--dragged' : ''
                }`}
                draggable={!locked}
                onDragStart={(event) => {
                  // The data is only there because some engines refuse to start
                  // a drag that carries none; the section is found by index.
                  event.dataTransfer.setData('text/plain', heading.text)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragged(index)
                }}
                onDragEnd={() => {
                  setDragged(null)
                  setOver(null)
                }}
                onClick={() => jumpTo(editor.view, heading.from)}
                title={locked ? heading.text : `${heading.text} — drag to move the section`}
              >
                {heading.text || '(untitled)'}
              </button>
            </li>
          ))}
          {dragged !== null && (
            <li
              className={`outline-drop-end${over === 'end' ? ' outline-drop' : ''}`}
              aria-hidden="true"
              {...target('end')}
            />
          )}
        </ol>
      )}
    </aside>
  )
}

/** Puts the caret on a heading and brings it into view.
 *
 *  The caret moves as well as the scroll: jumping to a section and then typing
 *  should put the words there, not back where the caret was left. */
function jumpTo(view: EditorView, position: number): void {
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 24 }),
  })
  view.focus()
}

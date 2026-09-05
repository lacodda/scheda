// The outline panel: the document's headings, and a way to jump to one.
//
// Hidden until asked for (`Ctrl+Shift+O`). A notepad that opens with a sidebar
// is not a notepad, and most files that get opened here have three headings or
// none — the panel earns its width on the long ones and nowhere else
// (decision 2026-09-05).
import { useEffect, useState } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { outlineOf, type Heading } from './editor/outline'
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

export function Outline({ editor, visible }: { editor: EditorHandle; visible: boolean }) {
  const headings = useOutline(editor, visible)

  if (!visible) return null

  return (
    <aside className="outline" aria-label="Outline">
      {headings.length === 0 ? (
        <p className="outline-empty">No headings</p>
      ) : (
        <ol className="outline-list">
          {headings.map((heading) => (
            <li key={`${heading.line}-${heading.from}`}>
              <button
                type="button"
                className={`outline-item outline-level-${heading.level}`}
                onClick={() => jumpTo(editor.view, heading.from)}
                title={heading.text}
              >
                {heading.text || '(untitled)'}
              </button>
            </li>
          ))}
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

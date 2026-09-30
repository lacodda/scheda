// The tab strip: every open document, in the title bar.
//
// A tab is clicked to show it, middle-clicked to close it, dragged along the
// strip to reorder it, and dragged down onto the text to put it in a pane —
// onto the right half of the window to open it beside the one in front. Its
// menu pins it, splits it off, and closes it or the others.
//
// Dragging is done with pointer events rather than the browser's drag and
// drop: the window takes files dropped on it from the system, and on Windows
// that switches the webview's own drag and drop off.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorHandle, Tab } from './editor/mount'
import { basename } from './paths'

export function tabLabel(tab: Tab): string {
  return tab.path ? basename(tab.path) : 'Untitled'
}

/** How far the pointer moves before a press on a tab becomes a drag. */
const THRESHOLD = 5

/** Where a dragged tab would land. */
type Drop = { kind: 'strip'; before: number | null } | { kind: 'pane'; pane: number } | null

export interface TabActions {
  close: (id: number) => void
  closeMany: (ids: number[]) => void
}

export function TabStrip({ editor, actions }: { editor: EditorHandle; actions: TabActions }) {
  useSyncExternalStore(editor.subscribe, editor.revision)
  const tabs = editor.tabs()
  const panes = editor.panes()
  const activeId = editor.active().id
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const strip = useRef<HTMLDivElement>(null)

  // What the drop onto the text would do is drawn on the text itself: the
  // editor's host is not this component's, so it is a class on it.
  useEffect(() => {
    const host = document.querySelector('.editor-host')
    if (!host) return
    host.classList.toggle('editor-host--drop-first', drop?.kind === 'pane' && drop.pane === 0)
    host.classList.toggle('editor-host--drop-second', drop?.kind === 'pane' && drop.pane === 1)
  }, [drop])

  function dropAt(x: number, y: number): Drop {
    const under = document.elementFromPoint(x, y)
    if (!under) return null
    const tabElement = under.closest<HTMLElement>('[data-tab]')
    if (tabElement && strip.current?.contains(tabElement)) {
      const id = Number(tabElement.dataset.tab)
      const box = tabElement.getBoundingClientRect()
      if (x < box.left + box.width / 2) return { kind: 'strip', before: id }
      const index = tabs.findIndex((tab) => tab.id === id)
      return { kind: 'strip', before: tabs[index + 1]?.id ?? null }
    }
    if (strip.current?.contains(under)) return { kind: 'strip', before: null }
    const host = under.closest<HTMLElement>('.editor-host')
    if (host) {
      const box = host.getBoundingClientRect()
      const right = x > box.left + box.width / 2
      // One pane: only the right half means anything — "open beside". Two:
      // each half is its pane.
      if (panes.length === 1) return right ? { kind: 'pane', pane: 1 } : null
      return { kind: 'pane', pane: right ? 1 : 0 }
    }
    return null
  }

  function startDrag(event: React.PointerEvent, tab: Tab) {
    if (event.button !== 0) return
    const start = { x: event.clientX, y: event.clientY }
    let moved = false
    let target: Drop = null

    const onMove = (move: PointerEvent) => {
      if (!moved && Math.abs(move.clientX - start.x) < THRESHOLD && Math.abs(move.clientY - start.y) < THRESHOLD) return
      moved = true
      setDragging(tab.id)
      target = dropAt(move.clientX, move.clientY)
      setDrop(target)
    }
    const stop = (finished: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      setDragging(null)
      setDrop(null)
      if (!finished) return
      if (!moved) {
        editor.select(tab.id)
      } else if (target?.kind === 'strip') {
        editor.move(tab.id, target.before)
      } else if (target?.kind === 'pane') {
        editor.showIn(tab.id, target.pane)
      }
    }
    const onUp = () => stop(true)
    const onCancel = () => stop(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  // Every document gets a tab, including the only one. The strip used to hide
  // itself for a single file, back when it was a second band under the system
  // title bar; now it *is* the title bar, and an empty one would just be a
  // window that has forgotten what it is showing.
  return (
    <div className={'tabs' + (dragging !== null ? ' tabs--dragging' : '')} role="tablist" ref={strip}>
      {tabs.map((tab) => {
        const beside = panes.length > 1 && panes.includes(tab.id) && tab.id !== activeId
        const classes = ['tab']
        if (tab.id === activeId) classes.push('tab--active')
        if (beside) classes.push('tab--beside')
        if (tab.pinned) classes.push('tab--pinned')
        if (tab.id === dragging) classes.push('tab--dragged')
        if (drop?.kind === 'strip' && drop.before === tab.id && dragging !== tab.id) classes.push('tab--drop-before')
        return (
          <div
            key={tab.id}
            data-tab={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={classes.join(' ')}
            onPointerDown={(event) => startDrag(event, tab)}
            onAuxClick={(event) => {
              // Middle click closes, the way every tabbed thing does.
              if (event.button === 1) {
                event.preventDefault()
                actions.close(tab.id)
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ id: tab.id, x: event.clientX, y: event.clientY })
            }}
            title={(tab.path ?? 'Untitled') + (tab.pinned ? ' — pinned' : '')}
          >
            {tab.pinned && (
              <svg className="tab-pin" viewBox="0 0 16 16" aria-label="Pinned" role="img">
                <path d="M6 2h4l-.5 4 2.5 2.5v1H4v-1L6.5 6z M8 9.5V14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            )}
            <span className="tab-name">{tabLabel(tab)}</span>
            {editor.isDirty(tab.id) && <span className="tab-dirty">•</span>}
            {/* A pinned tab keeps its place by not offering to close: the menu
                and Ctrl+W still do, but a stray click on the strip does not. */}
            {tabs.length > 1 && !tab.pinned && (
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${tabLabel(tab)}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.close(tab.id)
                }}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      {drop?.kind === 'strip' && drop.before === null && <div className="tab-drop-end" />}
      {menu && <TabMenu editor={editor} actions={actions} {...menu} onDone={() => setMenu(null)} />}
    </div>
  )
}

function TabMenu({
  editor,
  actions,
  id,
  x,
  y,
  onDone,
}: {
  editor: EditorHandle
  actions: TabActions
  id: number
  x: number
  y: number
  onDone: () => void
}) {
  const tab = editor.tabs().find((candidate) => candidate.id === id)

  useEffect(() => {
    const close = () => onDone()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDone])

  if (!tab) return null
  const panes = editor.panes()
  const shownIn = panes.indexOf(id)
  const others = editor.tabs().filter((candidate) => candidate.id !== id && !candidate.pinned)
  const all = editor.tabs().filter((candidate) => !candidate.pinned)

  const item = (label: string, act: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onDone()
        act()
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="tree-menu"
      role="menu"
      style={{ left: Math.min(x, window.innerWidth - 190), top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {item(tab.pinned ? 'Unpin' : 'Pin', () => editor.pin(id, !tab.pinned))}
      {panes.length === 1
        ? item('Open beside', () => editor.showIn(id, 1))
        : item(shownIn === 1 ? 'Move to the first pane' : 'Move to the second pane', () =>
            editor.showIn(id, shownIn === 1 ? 0 : 1),
          )}
      <hr />
      {item('Close', () => actions.close(id))}
      {item('Close others', () => actions.closeMany(others.map((other) => other.id)), others.length === 0)}
      {item('Close all', () => actions.closeMany(all.map((other) => other.id)), all.length === 0)}
    </div>
  )
}

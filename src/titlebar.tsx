// The window's own title bar: the tabs live in it, so no horizontal band is
// spent on them twice.
//
// With `decorations: false` the system draws nothing, which means everything it
// used to do is ours: dragging the window, double-click to maximise, the
// buttons, and the edges you grab to resize. Each of those is small; the reason
// they are here rather than left to the system is that a separate tab strip
// under a system title bar costs about 60px of a laptop screen for nothing.
import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** The mark, inline.
 *
 *  Inline rather than an `<img>`: a file that small is inlined as a data URI by
 *  the bundler, and the content security policy allows images only from `self`
 *  — the mark came up as a broken-image icon. Inline markup is part of the
 *  document and needs no permission at all.
 *
 *  The gradient id is namespaced because ids in SVG are document-global, and a
 *  second `#pair` anywhere in the window would silently repaint this one. */
export function Mark() {
  return (
    <svg
      className="titlebar-mark"
      width="18"
      height="18"
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="scheda-mark-pair"
          gradientUnits="userSpaceOnUse"
          x1="11"
          y1="5"
          x2="89"
          y2="95"
        >
          <stop offset="0" stopColor="#D9704A" />
          <stop offset="1" stopColor="#2FAF8C" />
        </linearGradient>
      </defs>
      <polygon
        points="50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5"
        fill="url(#scheda-mark-pair)"
        stroke="url(#scheda-mark-pair)"
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <text
        x="50"
        y="66"
        textAnchor="middle"
        fontFamily='"Cascadia Code","JetBrains Mono",Consolas,ui-monospace,monospace'
        fontWeight="800"
        fontSize="46"
        fill="#F7F8F4"
      >
        sc
      </text>
    </svg>
  )
}

/** The window controls, in the order Windows puts them. */
export function WindowButtons({ onClose }: { onClose: () => void }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const window = getCurrentWindow()
    const read = () => {
      void window.isMaximized().then(setMaximized)
    }
    read()
    // The window can be maximised without our buttons — a drag to the top edge,
    // the keyboard, a snap layout — so the icon follows the window rather than
    // our own last click.
    const unlisten = window.onResized(read)
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [])

  return (
    <div className="window-buttons">
      <button
        type="button"
        className="window-button"
        aria-label="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className="window-button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-button window-button--close"
        aria-label="Close"
        onClick={onClose}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
    </div>
  )
}

/** Makes an element behave like a title bar: drag to move, double-click to
 *  maximise. Both are what the system used to do for free.
 *
 *  Two handlers rather than one. A `pointerdown` cannot recognise a double
 *  click: its `detail` counts clicks of the *mouse* event sequence, and the
 *  second press still arrives as 1 — reading it there fired `startDragging`
 *  three times over a double click and toggled nothing. So the press starts a
 *  drag, and `dblclick`, which the browser is the one qualified to detect,
 *  maximises. */
export function useTitleBarGestures() {
  const shouldHandle = (target: EventTarget | null) =>
    // A click that landed on a tab or a button has already been handled.
    !(target as HTMLElement | null)?.closest('button, [role="tab"]')

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || !shouldHandle(event.target)) return

    // Dragging starts on the first movement, not on the press.
    //
    // `startDragging` hands the window over to the system — which is what makes
    // snap layouts and drag-to-edge keep working — but from that moment the
    // webview stops seeing the mouse. Calling it on `pointerdown` therefore ate
    // the second click of every double click, and maximising never happened.
    const start = { x: event.clientX, y: event.clientY }
    const THRESHOLD = 4

    const onMove = (move: PointerEvent) => {
      if (Math.abs(move.clientX - start.x) < THRESHOLD && Math.abs(move.clientY - start.y) < THRESHOLD) {
        return
      }
      stop()
      void getCurrentWindow().startDragging()
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }, [])

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0 || !shouldHandle(event.target)) return
    void getCurrentWindow().toggleMaximize()
  }, [])

  return { onPointerDown, onDoubleClick }
}

/** The eight edges and corners a frameless window still has to offer. */
const RESIZE_HANDLES = [
  'North',
  'South',
  'East',
  'West',
  'NorthEast',
  'NorthWest',
  'SouthEast',
  'SouthWest',
] as const

/** Invisible strips along the window's edges.
 *
 *  A frameless window has no border to grab, so these put one back. They sit
 *  outside the flow, above everything, and are only a few pixels wide — enough
 *  to hit, not enough to steal a click meant for the text. */
export function ResizeEdges() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const window = getCurrentWindow()
    const read = () => {
      void window.isMaximized().then(setMaximized)
    }
    read()
    const unlisten = window.onResized(read)
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [])

  // A maximised window has no edges to drag, and leaving the strips in place
  // means the top few pixels of the tab strip stop taking clicks.
  if (maximized) return null

  return (
    <>
      {RESIZE_HANDLES.map((direction) => (
        <div
          key={direction}
          className={`resize-edge resize-edge--${direction.toLowerCase()}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            void getCurrentWindow().startResizeDragging(direction)
          }}
        />
      ))}
    </>
  )
}

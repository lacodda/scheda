// The window's own title bar: the tabs live in it, so no horizontal band is
// spent on them twice.
//
// With `decorations: false` the system draws nothing, which means everything it
// used to do is ours: dragging the window, double-click to maximise, the
// buttons, and the edges you grab to resize. Each of those is small; the reason
// they are here rather than left to the system is that a separate tab strip
// under a system title bar costs about 60px of a laptop screen for nothing.
//
// This is dowel's `window-frame` primitive, kept as scheda's own code rather
// than copied from the registry. The registry version is written in Tailwind
// classes, and scheda has no Tailwind and wants none: the product's first rule
// is that nothing runs before the text is on screen, and a stylesheet plus a
// build step in front of the first frame is exactly what that rule refuses (the
// same call `src/editor/peek.ts` records about `PreviewCard`). What is shared
// with dowel is what "one window chrome across the line" actually means:
//
//  - the geometry, as numbers taken from dowel's tokens rather than invented
//    here — a bar 40px tall, a button 46px wide, a 5px edge and a 10px corner.
//    `tests/chrome.test.ts` reads them back out of dowel's `theme.css`, because
//    a number copied by hand is a number that drifts (kilna's copy of the
//    primitive already has, holding `w-[46px]` against the registry's token);
//  - the behaviour, down to the defects it remembers: the drag starts on the
//    first movement and not on the press, the resize strips leave when the
//    window is maximised, the icon follows the window rather than our last
//    click;
//  - the guard against there being no window at all.
import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** The Tauri window, or null where there is none to drive.
 *
 *  scheda's chrome is rendered outside Tauri more often than inside it: the
 *  layout gate loads the built page in a plain browser, and so does every
 *  preview page in `tools/`. `getCurrentWindow` reads the window's label off
 *  the bridge, so the bridge's absence is the test — and without this the first
 *  click on a button in that browser throws instead of doing nothing. */
function currentWindow() {
  return '__TAURI_INTERNALS__' in window ? getCurrentWindow() : null
}

/** The mark, inline.
 *
 *  Inline rather than an `<img>`: a file that small is inlined as a data URI by
 *  the bundler, and the content security policy allows images only from `self`
 *  — the mark came up as a broken-image icon. Inline markup is part of the
 *  document and needs no permission at all.
 *
 *  The gradient id is namespaced because ids in SVG are document-global, and a
 *  second `#pair` anywhere in the window would silently repaint this one. */
export function Mark({ className = 'titlebar-mark', size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
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

/** Whether the window is maximised, kept current as the window changes.
 *
 *  The window can be maximised without our buttons — a drag to the top edge,
 *  the keyboard, a snap layout — so the answer follows the window rather than
 *  our own last click. */
export function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const target = currentWindow()
    if (!target) return
    const read = () => {
      target.isMaximized().then(setMaximized).catch(() => undefined)
    }
    read()
    const unlisten = target.onResized(read)
    return () => {
      unlisten.then((stop) => stop()).catch(() => undefined)
    }
  }, [])

  return maximized
}

/** The window controls, in the order Windows puts them.
 *
 *  `onClose` rather than closing the window here: scheda's unsaved-work guard
 *  listens for the window's close *request*, so the button asks for the same
 *  thing the system's own close does and the two cannot drift into behaving
 *  differently. dowel's primitive closes directly because kilna has no such
 *  guard; this is the one place the two are allowed to differ, and the reason
 *  is written down rather than left to be rediscovered. */
export function WindowButtons({ onClose }: { onClose: () => void }) {
  const maximized = useMaximized()

  return (
    <div className="window-buttons">
      <button
        type="button"
        className="window-button"
        aria-label="Minimize"
        onClick={() => void currentWindow()?.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        className="window-button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void currentWindow()?.toggleMaximize()}
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

/** A press that landed on something interactive has already been handled.
 *
 *  The list is dowel's rather than scheda's older `button, [role="tab"]`: a
 *  press inside a dialog or a menu that happens to overlap the bar would
 *  otherwise start dragging the window out from under it. */
const shouldHandle = (target: EventTarget | null) =>
  !(target as HTMLElement | null)?.closest(
    'button, a, input, textarea, [role="menu"], [role="menuitem"], [role="tab"], [role="dialog"]',
  )

/** How far the pointer moves before a press becomes a drag, in pixels. */
const THRESHOLD = 4

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
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || !shouldHandle(event.target)) return

    // Dragging starts on the first movement, not on the press.
    //
    // `startDragging` hands the window over to the system — which is what makes
    // snap layouts and drag-to-edge keep working — but from that moment the
    // webview stops seeing the mouse. Calling it on `pointerdown` therefore ate
    // the second click of every double click, and maximising never happened.
    const start = { x: event.clientX, y: event.clientY }

    const onMove = (move: PointerEvent) => {
      if (Math.abs(move.clientX - start.x) < THRESHOLD && Math.abs(move.clientY - start.y) < THRESHOLD) {
        return
      }
      stop()
      void currentWindow()?.startDragging()
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
    void currentWindow()?.toggleMaximize()
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
 *  A frameless window has no border to grab, so these put one back: a few
 *  pixels along each edge, above everything, invisible. The widths are the
 *  line's, in `--resize-edge` and `--resize-corner`, and the stylesheet is
 *  where they are written down. */
export function ResizeEdges() {
  const maximized = useMaximized()

  // A maximised window has no edges to drag, and leaving the strips in place
  // means the top few pixels of the tab strip stop taking clicks.
  if (maximized) return null

  return (
    <>
      {RESIZE_HANDLES.map((direction) => (
        <div
          key={direction}
          aria-hidden="true"
          data-resize-edge={direction}
          className={`resize-edge resize-edge--${direction.toLowerCase()}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            void currentWindow()?.startResizeDragging(direction)
          }}
        />
      ))}
    </>
  )
}

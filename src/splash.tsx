// What the window shows while there is nothing to show.
//
// Every desktop product of the line answers a blank window the same way: the
// mark, the name, the promise, the version and a bar that sweeps. scheda's
// answer is the same picture and the opposite timing, and the difference is the
// product itself.
//
// A splash exists because a window that stays blank for a second reads as a
// crash. scheda's whole promise is that it is never blank for a second: the
// core has the file before the window exists, `main.tsx` puts it into an editor
// before React is loaded, and the shell mounts after the first character is on
// screen (ADR 0001). A full-window splash over that text would cover the one
// thing the ordering exists to deliver — the product would be hiding its own
// best feature behind a picture of itself.
//
// So the rule the owner set on 20.09 is narrower than the line's: the splash is
// for a cold start with *nothing to open*. Two things follow, and both are
// tested rather than trusted:
//
//  - it never appears when a file opens. Not "appears briefly", not "appears
//    and is replaced" — a flash of a logo over a note that was already readable
//    is worse than no splash at all;
//  - it appears late, after DELAY_MS. Opening a vault is usually faster than
//    the eye, and a splash that flashes for 80ms is a flicker, not a comfort.
//    Work that finishes inside the delay never shows one.
//
// The geometry is dowel's `splash`, in the line's proportions — the mark at
// 56px, the name at 26px, a 160px track — but written in scheda's own CSS for
// the reason given in `src/titlebar.tsx`: the primitive is Tailwind, and
// nothing that needs a stylesheet before the first frame belongs in this
// product. There is no static half in `index.html` either, and that is the
// same decision seen from the other side: the static half exists to fill the
// gap before the bundle arrives, and filling that gap with anything but the
// text is what scheda refuses.
import { useEffect, useState } from 'react'
import { Mark } from './titlebar'

/** How long a piece of work may take before it is worth saying anything.
 *
 *  Below this the splash is a flicker: it appears and leaves before the eye
 *  resolves it, which is more startling than a window that simply took a
 *  moment. Above it a blank window starts to read as a broken one. */
export const DELAY_MS = 250

export interface SplashProps {
  /** What the application is doing right now. */
  status?: string
  /** The version, as the manifest states it; the `v` is added here. */
  version?: string
}

/** The picture, with nothing about when it is shown.
 *
 *  Separated from the timing so the two can be checked apart: what it says is a
 *  matter of rendering it, when it appears is a matter of the clock. */
export function Splash({ status, version }: SplashProps) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <Mark className="splash-mark" size={56} />
      <div className="splash-name">scheda</div>
      <div className="splash-tagline">A notepad that knows markdown.</div>
      {version ? <div className="splash-version">v{version}</div> : null}
      <div className="splash-track">
        <div className="splash-sweep" />
      </div>
      {status ? <p className="splash-status">{status}</p> : null}
    </div>
  )
}

/** Whether the splash should be on screen: true only once `busy` has been true
 *  continuously for `DELAY_MS`.
 *
 *  The delay is measured from the moment the work starts, not from mount, and
 *  it is cancelled rather than merely ignored when the work finishes first —
 *  a timer left to fire would raise the splash *after* the window was ready,
 *  which is the flicker this exists to prevent, arriving late.
 *
 *  Once raised it stays until the work is done. A splash that came up, was
 *  taken down and came up again would read as the window failing twice. */
export function useSlowStart(busy: boolean): boolean {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setSlow(true), DELAY_MS)
    return () => clearTimeout(timer)
  }, [busy])

  // `busy &&` rather than clearing the flag when the work ends. Setting state
  // in the effect body starts a second render before the first has painted —
  // the linter says so and it is right, and in this component of all of them a
  // wasted render is the thing being measured. It also makes the answer
  // impossible to get wrong: whatever the timer did, a window that is no longer
  // busy shows nothing.
  return busy && slow
}

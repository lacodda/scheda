// When the window is allowed to show a picture of itself instead of a note.
//
// The splash is the one piece of the line's common chrome scheda had to argue
// with, and the argument is the product: a window that paints the file before
// React exists must not then cover it. So the rules checked here are not "does
// it render" — they are the two refusals:
//
//  - a launch with a file never produces a splash, however slow anything else
//    turns out to be;
//  - a fast start never produces one either, because a logo that appears for
//    eighty milliseconds is a flicker rather than a reassurance.
//
// Both are promises that something will NOT appear, and those rot quietly:
// nothing on screen looks identical whether the rule holds or the component
// broke. So the file also proves the opposite case — the slow bare launch that
// SHOULD show one — and that is what keeps it from passing as a lie.
//
// Rendered with `react-dom/client` and `act` rather than a testing library, for
// the reason `network.test.tsx` gives: the project has React, jsdom and vitest
// already, and the DOM answers these queries itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DELAY_MS, Splash, useSlowStart } from './splash'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

/** A window opening, told only whether it is still busy. */
function Opening({ busy }: { busy: boolean }) {
  const shown = useSlowStart(busy)
  return shown ? <Splash status="Opening" version="0.9.0" /> : null
}

function show(element: React.ReactNode) {
  act(() => root.render(element))
}

/** Lets `ms` of fake time pass, with React allowed to react to it. */
function afterMs(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

const splash = () => host.querySelector('.splash')

describe('the opening screen', () => {
  it('stays away while the work is quick', () => {
    show(<Opening busy />)

    afterMs(DELAY_MS - 1)
    expect(splash()).toBeNull()

    // The work finishes just before the delay would have fired.
    show(<Opening busy={false} />)
    // Well past the moment the timer was set for. A timer merely ignored rather
    // than cancelled raises the splash here — after the window is already
    // usable, which is the flicker arriving late.
    afterMs(DELAY_MS * 4)
    expect(splash()).toBeNull()
  })

  it('appears once the work outlasts the delay', () => {
    show(<Opening busy />)

    afterMs(DELAY_MS - 1)
    expect(splash()).toBeNull()

    afterMs(1)
    expect(splash()).not.toBeNull()
  })

  it('leaves when the work is done', () => {
    show(<Opening busy />)
    afterMs(DELAY_MS)
    expect(splash()).not.toBeNull()

    show(<Opening busy={false} />)
    expect(splash()).toBeNull()
  })

  it('never appears when the window opened with a file', () => {
    // A launch with a file is `busy` false from the start: `main.tsx` knows
    // whether anything was handed over before React is loaded, and on that path
    // `mountShell` never creates the host element at all.
    show(<Opening busy={false} />)
    afterMs(DELAY_MS * 10)
    expect(splash()).toBeNull()
  })

  it('drops the timer when the work finishes before it fires', () => {
    // `busy && slow` already makes a late timer harmless on screen, so the
    // previous test cannot see this one: the splash stays away either way. What
    // is left to get wrong is the timer itself — one per start of work, left
    // running against an unmounted component. Counted rather than watched,
    // because a leak has no appearance.
    show(<Opening busy />)
    expect(vi.getTimerCount()).toBe(1)

    show(<Opening busy={false} />)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('says what it is and which version it is', () => {
    show(<Splash status="Opening" version="0.9.0" />)

    const shown = splash()!
    expect(shown.textContent).toContain('scheda')
    expect(shown.textContent).toContain('v0.9.0')
    expect(shown.textContent).toContain('Opening')
    // Announced rather than merely drawn: the window is telling somebody who
    // cannot see it that it has not hung.
    expect(shown.getAttribute('role')).toBe('status')
    expect(shown.getAttribute('aria-live')).toBe('polite')
  })
})

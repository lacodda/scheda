// The window's chrome agrees with the line about its own size.
//
// scheda draws its title bar itself rather than copying dowel's `window-frame`
// primitive, and the reason is written at the top of `src/titlebar.tsx`: the
// primitive is Tailwind, and nothing that needs a stylesheet in front of the
// first frame belongs in this product. What is shared instead is the geometry —
// the bar's height, the button's width, the grab strips — because a window's
// chrome is the part of a product meant to look like the operating system and
// not like the product.
//
// Shared numbers copied by hand are shared numbers until someone changes one.
// That is not a worry, it is a thing that has already happened: kilna's copy of
// the very same primitive holds `w-[46px]` and `EDGE = 5` where the registry
// now holds `var(--spacing-window-button)` and `var(--spacing-resize-edge)`, so
// the tokens that exist to stop two products disagreeing are being disagreed
// with inside one component. Copying the file did not prevent it; only reading
// the source does.
//
// So this reads dowel's own `theme.css` out of `node_modules` and scheda's
// `styles.css` off disk, and fails when a number in one is not the number in
// the other. `dowel-ui` is a devDependency for exactly this: scheda ships none
// of its code, it only has to keep agreeing with it.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

const dowelTheme = readFileSync(require.resolve('dowel-ui/theme.css'), 'utf8')
const schedaStyles = readFileSync(join(here, 'styles.css'), 'utf8')

/** Reads a custom property's value out of a stylesheet.
 *
 *  Deliberately not a CSS parser: a declaration is what is being checked, and a
 *  parser would happily resolve `var()` chains and report agreement between a
 *  number and a reference to it. The point here is that both files state the
 *  same literal. */
function declared(css: string, name: string): string | null {
  const match = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(css)
  return match ? match[1].trim() : null
}

/** Each measurement of the window's chrome: what dowel calls it, what scheda
 *  calls it, and what it is for. */
const CHROME = [
  ['spacing-titlebar', 'titlebar-height', 'the height of the bar'],
  ['spacing-window-button', 'window-button-width', 'the width of a window button'],
  ['spacing-resize-edge', 'resize-edge', 'the width of a grab strip'],
  ['spacing-resize-corner', 'resize-corner', 'the size of a grab corner'],
] as const

describe("the window's chrome", () => {
  // If this fails, the guard below is measuring nothing: a token that has been
  // renamed in dowel reads as null on both sides, and null equals null.
  it.each(CHROME)('dowel states %s', (dowelToken) => {
    expect(declared(dowelTheme, dowelToken)).toMatch(/^\d+px$/)
  })

  it.each(CHROME)('scheda agrees with dowel about %s (%s)', (dowelToken, schedaToken) => {
    expect(declared(schedaStyles, schedaToken)).toBe(declared(dowelTheme, dowelToken))
  })

  // The stylesheet is where the numbers live; a rule that went back to writing
  // one out by hand would keep the tokens above passing while the window drew
  // something else. These are the four rules that carry the chrome's geometry.
  it.each([
    ['.titlebar', 'height', 'titlebar-height'],
    ['.window-button', 'width', 'window-button-width'],
  ])('%s takes its %s from --%s', (selector, property, token) => {
    const rule = new RegExp(`\\${selector} \\{[^}]*\\}`).exec(schedaStyles)?.[0] ?? ''
    expect(rule).toContain(`${property}: var(--${token})`)
  })

  it('the grab strips are sized by the tokens and not by numbers', () => {
    const strips = schedaStyles.slice(schedaStyles.indexOf('.resize-edge {'))
    const geometry = strips.slice(0, strips.indexOf('.tab-name'))
    // Every length in the strips' own block is a token. A bare `4px` here is
    // how the edges and the corner drifted apart in the first place.
    expect(geometry).not.toMatch(/(?:width|height|top|bottom|left|right):\s*\d+px/)
  })
})

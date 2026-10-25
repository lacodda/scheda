// Every colour scheda draws a glyph in is readable on what it is drawn on.
//
// The window's secondary text — the status line, a tab at rest, a panel's
// headings, the hints under a setting — is 11 to 12px, and it was drawn in a
// grey that measured 3.4:1 on the panels in the light theme, where text that
// size needs 4.5. Nothing failed, because nothing measured: the grey looked
// deliberate, the way a quiet colour does to the person who chose it. The
// accent did the same as text in the light theme (3.2:1), and so did a code
// comment, a missing link and the cross on a tab, through an opacity.
//
// So the palette is measured here, from `styles.css` itself, in both themes:
//
//   - every colour any rule writes text in clears 4.5:1 (WCAG 1.4.3) on every
//     ground text is laid on — the page, the panels, the line the caret is on,
//     a code block, a table, a callout's tint;
//   - a colour and a fill set by one rule clear it against each other;
//   - what lies under the pointer, `--hover`, stands off every ground it is
//     laid on by dowel's own step, and every ink the window writes reads on it;
//   - `--faint` is the one exception, and it is not text: it draws marks that
//     are not read — a tab's cross, a table's delimiter row, a disabled
//     control — and clears the 3:1 that WCAG 1.4.11 asks of those. Which rules
//     may use it is a list below, each with its reason;
//   - an opacity on anything is a colour nobody measured, so each one is listed
//     with its reason too, and a new one fails until it says why.
//
// `tools/check-layout.mjs` measures the rendered page as well, which is what
// sees inheritance and the cascade. This file is what makes a bad value fail
// before anything is built.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(here, path), 'utf8')

const styles = read('styles.css')
const SHEETS = {
  'styles.css': styles,
  'quick/quick.css': read('quick/quick.css'),
  'scrollbar.css': read('scrollbar.css'),
}
const editorTheme = read('../packages/editor/src/theme.ts')
const editorHighlight = read('../packages/editor/src/highlight.ts')

const TEXT = 4.5
const MARK = 3

// ------------------------------------------------------------- colour --

type Rgb = [number, number, number]

function rgbOf(hex: string): Rgb {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `colour` laid over `ground` at `share` — what `color-mix(in srgb, colour
 *  N%, transparent)` paints on an opaque ground. */
function tint(colour: Rgb, share: number, ground: Rgb): Rgb {
  return colour.map((c, i) => c * share + ground[i] * (1 - share)) as Rgb
}

// ------------------------------------------------------------ palette --

/** The body of the first rule whose selector is exactly this. */
function block(selector: string): string {
  const at = styles.indexOf(`${selector} {`)
  expect(at, `styles.css no longer has \`${selector} {\``).toBeGreaterThan(-1)
  const open = styles.indexOf('{', at)
  return styles.slice(open + 1, styles.indexOf('}', open))
}

/** The colours a block states, by token name. */
function colours(body: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)) {
    found.set(name, value.toLowerCase())
  }
  return found
}

const light = colours(block(':root'))
const dark = colours(block(':root[data-theme="dark"]'))
const darkBySystem = colours(block(':root:not([data-theme="light"])'))
const THEMES = [
  ['light', light],
  ['dark', dark],
] as const

// ---------------------------------------------------------------- rules --

/** One rule of a stylesheet, or one style object of the editor's theme, with
 *  the three things measured here: what it writes text in, what it fills, and
 *  how opaque it is. Values are palette token names where they are tokens. */
interface Rule {
  where: string
  selector: string
  color?: string
  fill?: string
  opacity?: string
}

/** A value as a token name, or the literal it is. */
function tokenOf(value: string): string {
  const v = /^var\(--([a-z0-9-]+)\)$/.exec(value.trim())
  return v ? v[1] : value.trim()
}

function sheetRules(file: string, css: string): Rule[] {
  const rules: Rule[] = []
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, selector, body] of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const color = /(?<![-a-z])color\s*:\s*([^;]+)/.exec(body)?.[1]
    const fill = /(?<![-a-z])background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]
    const opacity = /(?<![-a-z])opacity\s*:\s*([^;]+)/.exec(body)?.[1]
    if (color === undefined && fill === undefined && opacity === undefined) continue
    rules.push({
      where: file,
      selector: selector.trim().replace(/\s+/g, ' '),
      color: color === undefined ? undefined : tokenOf(color),
      fill: fill === undefined ? undefined : tokenOf(fill),
      opacity: opacity?.trim(),
    })
  }
  return rules
}

/** The window token each editor colour is mapped onto, read from the mapping
 *  in `styles.css` (`src/editor/colours.test.ts` holds that it is complete). */
const editorMapping = new Map(
  [...styles.matchAll(/--editor-([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)].map(([, role, own]) => [role, own]),
)

function editorRules(file: string, source: string): Rule[] {
  // A role is `token('name')`; inside a template literal it is
  // `${token('name')}`. Both become the window token it is mapped onto, so a
  // rule reads the same here as it does in a stylesheet.
  const flat = source.replace(/\$\{token\('([a-z0-9-]+)'\)\}/g, "@$1").replace(/token\('([a-z0-9-]+)'\)/g, "'@$1'")
  const value = (raw: string | undefined) => {
    if (raw === undefined) return undefined
    const role = /^'@([a-z0-9-]+)'$/.exec(raw.trim())
    if (role) return editorMapping.get(role[1]) ?? `unmapped editor colour ${role[1]}`
    return raw.trim().replace(/^'|'$/g, '')
  }
  // A theme's style object is `'selector': { … }`; a highlight style's entry
  // is `{ tag: …, color: … }`, named here by its tag.
  const objects = [
    ...[...flat.matchAll(/'([^'\n]+)':\s*\{([^{}]*)\}/g)].map(([, selector, body]) => [selector, body]),
    ...[...flat.matchAll(/\{\s*tag:\s*(\[[^\]]*\]|[^,[\]]+)([^{}]*)\}/g)].map(([, tag, body]) => [
      `tag ${tag.trim()}`,
      body,
    ]),
  ]
  const rules: Rule[] = []
  for (const [selector, body] of objects) {
    const color = /(?<![A-Za-z])color:\s*('[^']*')/.exec(body)?.[1]
    const fill = /backgroundColor:\s*('[^']*'|`[^`]*`)|(?<![A-Za-z])background:\s*('[^']*')/.exec(body)
    const opacity = /opacity:\s*'([^']*)'/.exec(body)?.[1]
    if (color === undefined && fill === null && opacity === undefined) continue
    rules.push({
      where: file,
      selector,
      color: value(color),
      fill: fill === null ? undefined : value(fill[1] ?? fill[2]),
      opacity,
    })
  }
  return rules
}

const RULES: Rule[] = [
  ...Object.entries(SHEETS).flatMap(([file, css]) => sheetRules(file, css)),
  ...editorRules('editor theme.ts', editorTheme),
  ...editorRules('editor highlight.ts', editorHighlight),
]

/** Values that are not a colour of their own: the glyph takes its parent's,
 *  or is not drawn at all (a rule's dashes under the line drawn through them). */
const NOT_A_COLOUR = new Set(['inherit', 'currentColor', 'transparent', 'none'])

const isToken = (value: string) => light.has(value)
const isLiteral = (value: string) => /^#[0-9a-f]{3,6}$/i.test(value)

/** What text is laid on. The panels and the status line are `--status-bg`,
 *  embeds and the front matter `--status-bg` through the editor's `panel`. */
const GROUNDS = ['bg', 'status-bg', 'active-line', 'code-bg', 'table-head-bg']

/** How much of its colour a callout lays behind its text, read from the
 *  editor's theme so that thickening the tint is measured too. */
const calloutShare = (() => {
  const match = /color-mix\(in srgb, \$\{token\(`callout-\$\{colour\}`\)\} (\d+)%, transparent\)/.exec(editorTheme)
  return match ? Number(match[1]) / 100 : null
})()

/** Every ground of a theme, by name, including each callout's tint. */
function groundsOf(palette: Map<string, string>): [string, Rgb][] {
  const page = rgbOf(palette.get('bg')!)
  return [
    ...GROUNDS.map((name) => [name, rgbOf(palette.get(name)!)] as [string, Rgb]),
    ...[...palette.keys()]
      .filter((name) => name.startsWith('callout-'))
      .map((name) => [`${name} tint`, tint(rgbOf(palette.get(name)!), calloutShare!, page)] as [string, Rgb]),
  ]
}

/** Every token any rule writes text in. */
const textTokens = [...new Set(RULES.flatMap((rule) => (rule.color && isToken(rule.color) ? [rule.color] : [])))]

/** `--on-<fill>` is what is written on that fill and nowhere else: it is
 *  measured against its fill rather than against the grounds, and a rule that
 *  writes in it has to be the rule that lays the fill. */
const partnerOf = (name: string) => /^on-(.+)$/.exec(name)?.[1]

/** Rules that may draw in `--faint`, and why each draws a mark and not text.
 *  A rule using it that is not here fails: a colour below the text floor is
 *  only allowed where nothing is read. */
const FAINT: Record<string, string> = {
  '.tab-close': "a tab's cross at rest: a control, named for a reader by its label",
  '.tree-menu button:disabled': 'a disabled control',
  '.tree-menu button:disabled:hover': 'a disabled control, under the pointer',
  '.settings-button:disabled, .settings-stepper button:disabled': 'a disabled control',
  '.search-action:disabled': 'a disabled control',
  '.cm-md-table-delimiter': "a table's pipes: the columns already show the structure they mark",
  '.cm-md-rule': "a rule's dashes while the caret is on them: the line is drawn beside them",
}

/** Opacities, and why each is allowed to fade what it fades. */
const OPACITY: Record<string, string> = {
  '.pane--focused::before': 'a line along the focused pane, not a glyph',
  '.titlebar-mark': "the product's mark, a picture",
  '.outline-item--dragged': 'the ghost of a section being dragged, for the length of the drag',
  '.tab--dragged': 'the ghost of a tab being dragged, for the length of the drag',
  '.cm-line.cm-focus-faded': "focus mode: fading what is not being written is the mode's purpose",
}

/** What a pointer can rest over: the page, the panels and the caret's line.
 *  The light theme's panels and caret line are one colour, which is how a
 *  hover laid in the caret line's colour came to change nothing on a panel. */
const HOVER_GROUNDS = ['bg', 'status-bg', 'active-line']

/** How far `--hover` stands off each of them: dowel's `--soft` on its own
 *  ground measures 1.10:1 in its light theme and 1.11:1 in its dark one. */
const STEP = 1.1

/** Hover rules that lay something other than `--hover`, and why. */
const HOVER: Record<string, string> = {
  '.window-button--close:hover': "the system's own red for closing a window",
  '.tree-menu button:disabled:hover': 'a disabled control answers no pointer',
  '*::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:active': "a scrollbar thumb's darker step, not a row",
}

/** Every token the window's own sheet writes text in: what can stand in a row
 *  or on a button under the pointer. The editor's inks are drawn in a note,
 *  where nothing is hovered. */
const windowInks = [
  ...new Set(
    RULES.flatMap((rule) =>
      rule.where === 'styles.css' && rule.color && isToken(rule.color) && rule.color !== 'faint' && !partnerOf(rule.color)
        ? [rule.color]
        : [],
    ),
  ),
]

// --------------------------------------------------------------- tests --

describe('the palette', () => {
  it('states the dark theme the same way twice', () => {
    // Once for the user's choice and once for the system's: the cascade needs
    // both, and two copies that drift give a dark window two palettes.
    expect(Object.fromEntries(darkBySystem)).toEqual(Object.fromEntries(dark))
  })

  it('gives every colour a value in both themes', () => {
    // A token the dark block forgot keeps its light value in the dark window.
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort())
  })

  it('has the grounds and the marks this file measures', () => {
    for (const name of [...GROUNDS, 'hover', 'muted', 'faint', 'text', 'on-accent']) {
      expect(light.has(name), `--${name}`).toBe(true)
    }
    expect(calloutShare, "the callout tint's share in the editor theme").not.toBeNull()
  })
})

describe('the rules', () => {
  // The scanner first: a reader of text that stopped matching would find
  // fewer rules and pass every check below on what it still saw.
  it('are all seen', () => {
    const seen = (where: string, selector: string) => RULES.find((r) => r.where === where && r.selector === selector)
    expect(seen('styles.css', '.status')).toMatchObject({ color: 'muted', fill: 'status-bg' })
    expect(seen('styles.css', '.rename-unreadable')).toMatchObject({ color: 'muted', fill: 'was-bg' })
    expect(seen('quick/quick.css', '.quick')).toMatchObject({ color: 'text', fill: 'bg' })
    expect(seen('editor theme.ts', '.cm-md-h6')).toMatchObject({ color: 'muted' })
    expect(seen('editor theme.ts', '.cm-md-highlight')).toMatchObject({
      color: 'highlight-text',
      fill: 'highlight-bg',
    })
    expect(seen('editor theme.ts', '.cm-line.cm-focus-faded')).toMatchObject({ opacity: '0.3' })
    expect(seen('styles.css', '.tree-item:hover')).toMatchObject({ color: 'accent', fill: 'hover' })
    expect(windowInks).toEqual(expect.arrayContaining(['muted', 'text', 'accent', 'link-missing']))
    expect(RULES.filter((r) => r.where === 'editor highlight.ts').map((r) => r.color)).toContain('tok-comment')
    expect(textTokens.length).toBeGreaterThan(15)
  })

  it('write text only in the palette', () => {
    // A literal is allowed only with the fill it sits on in the same rule,
    // where the pair is measured below; anywhere else it is a colour measured
    // against nothing.
    const stray = RULES.filter(
      (rule) =>
        rule.color !== undefined &&
        !NOT_A_COLOUR.has(rule.color) &&
        !isToken(rule.color) &&
        !(isLiteral(rule.color) && rule.fill !== undefined),
    ).map((rule) => `${rule.where} ${rule.selector}: ${rule.color}`)
    expect(stray).toEqual([])
  })

  it('use --faint only for marks, each with its reason', () => {
    const uses = RULES.filter((rule) => rule.color === 'faint').map((rule) => rule.selector)
    expect(uses.filter((selector) => !(selector in FAINT))).toEqual([])
    // And the other way: a reason left behind for a rule that no longer uses
    // the colour reads as an exception that still exists.
    expect(Object.keys(FAINT).filter((selector) => !uses.includes(selector))).toEqual([])
  })

  it("write a fill's partner only on that fill", () => {
    const misplaced = RULES.filter((rule) => rule.color && partnerOf(rule.color) && rule.fill !== partnerOf(rule.color))
    expect(misplaced.map((rule) => `${rule.where} ${rule.selector}: ${rule.color} on ${rule.fill}`)).toEqual([])
  })

  it('lay --hover under the pointer, or say why not', () => {
    const hovers = RULES.filter((rule) => rule.selector.includes(':hover') && rule.fill !== undefined)
    const other = hovers.filter((rule) => rule.fill !== 'hover').map((rule) => rule.selector)
    expect(other.filter((selector) => !(selector in HOVER))).toEqual([])
    expect(Object.keys(HOVER).filter((selector) => !other.includes(selector))).toEqual([])
    // The scanner saw the rules this is about, not an empty list.
    expect(hovers.length).toBeGreaterThan(10)
  })

  it('fade nothing without a reason', () => {
    const faded = RULES.filter((rule) => rule.opacity !== undefined && Number(rule.opacity) < 1)
    expect(faded.map((rule) => rule.selector).filter((selector) => !(selector in OPACITY))).toEqual([])
    const all = RULES.filter((rule) => rule.opacity !== undefined).map((rule) => rule.selector)
    expect(Object.keys(OPACITY).filter((selector) => !all.includes(selector))).toEqual([])
  })
})

describe.each(THEMES)('the %s theme', (_theme, palette) => {
  const grounds = groundsOf(palette)
  const colour = (value: string) => rgbOf(isToken(value) ? palette.get(value)! : value)

  it.each(textTokens.filter((name) => name !== 'faint' && !partnerOf(name)))('--%s is readable on every ground', (name) => {
    const below = grounds
      .map(([ground, rgb]) => [ground, contrast(colour(name), rgb)] as const)
      .filter(([, ratio]) => ratio < TEXT)
      .map(([ground, ratio]) => `${ground} ${ratio.toFixed(2)}:1`)
    expect(below).toEqual([])
  })

  it('--faint clears the floor for marks on every ground, and stays below --muted', () => {
    for (const [ground, rgb] of grounds) {
      const faint = contrast(colour('faint'), rgb)
      expect(faint, `--faint on ${ground}`).toBeGreaterThanOrEqual(MARK)
      // A second level of quiet that is as loud as the first is not one.
      expect(faint, `--faint against --muted on ${ground}`).toBeLessThan(contrast(colour('muted'), rgb) - 1)
    }
  })

  it('--hover stands off everything a pointer rests over', () => {
    for (const ground of HOVER_GROUNDS) {
      expect(contrast(colour('hover'), colour(ground)), `--hover against --${ground}`).toBeGreaterThanOrEqual(STEP)
    }
  })

  it.each(windowInks)('--%s is readable under the pointer', (name) => {
    expect(contrast(colour(name), colour('hover'))).toBeGreaterThanOrEqual(TEXT)
  })

  it.each([...palette.keys()].filter((name) => partnerOf(name)))('--%s is readable on its fill', (name) => {
    expect(contrast(colour(name), colour(partnerOf(name)!))).toBeGreaterThanOrEqual(TEXT)
  })

  it('pairs every colour with the fill a rule sets under it', () => {
    const below = RULES.filter(
      (rule) =>
        rule.color !== undefined &&
        rule.fill !== undefined &&
        !NOT_A_COLOUR.has(rule.color) &&
        (isToken(rule.fill) || isLiteral(rule.fill)),
    )
      .map((rule) => {
        const floor = rule.color === 'faint' || rule.selector.includes(':disabled') ? MARK : TEXT
        return { rule, floor, ratio: contrast(colour(rule.color!), colour(rule.fill!)) }
      })
      .filter(({ ratio, floor }) => ratio < floor)
      .map(({ rule, ratio }) => `${rule.where} ${rule.selector}: ${ratio.toFixed(2)}:1`)
    expect(below).toEqual([])
  })

  it('keeps the text readable under a selection and a search match', () => {
    // These are laid under whatever text is there, so no rule pairs them. The
    // body text is held; a quieter colour under a transient highlight is not —
    // the run was read before the highlight came and is read after it goes.
    for (const fill of ['selection', 'match', 'match-active']) {
      for (const ink of ['text', 'heading']) {
        expect(contrast(colour(ink), colour(fill)), `--${ink} on --${fill}`).toBeGreaterThanOrEqual(TEXT)
      }
    }
  })
})

// Every glyph on the page, measured against what it is actually drawn on.
//
// `src/contrast.test.ts` holds the palette: each colour scheda draws text with
// clears 4.5:1 against each ground it can stand on. That is arithmetic over
// tokens, and arithmetic over tokens cannot see the cascade — an inherited
// colour, a background three ancestors up, an opacity on a parent that turns a
// readable colour into an unreadable one. This reads what the browser computed.
//
// The function runs inside the page, so it closes over nothing: Playwright
// sends its source across, and so can a DevTools session on the real window.

/** Measures every visible run of text and returns those below their floor.
 *
 *  The floor is 4.5:1 for text (WCAG 1.4.3, at every size — the window's text
 *  is 11 to 15px, and none of it is large enough for the 3:1 that large text
 *  gets). It is 3:1 for two things that are not read as text: a glyph drawn in
 *  `--faint`, which the stylesheet keeps for marks such as a tab's cross and a
 *  table's delimiter row, and a disabled control (WCAG 1.4.11). */
export function auditGlyphs() {
  const TEXT = 4.5
  const MARK = 3

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  // Any colour the browser can compute — rgb(), color(srgb …), oklab(), a
  // color-mix — by letting the canvas draw it. Translucent colours come back
  // with their alpha, which is what compositing needs.
  const parse = (value) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r / 255, g / 255, b / 255, a / 255]
  }
  const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]
  const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  const ratio = (x, y) => {
    const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  const hex = (rgb) => '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
  const same = (x, y) => x.every((c, i) => Math.abs(c - y[i]) < 2 / 255)

  const faintValue = getComputedStyle(document.documentElement).getPropertyValue('--faint').trim()
  const faint = faintValue ? parse(faintValue).slice(0, 3) : null

  const describe = (element) => {
    const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join('')
    return `${element.tagName.toLowerCase()}${classes}`
  }

  const below = []
  let measured = 0
  const seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue
    const element = node.parentElement
    if (!element || seen.has(element)) continue
    seen.add(element)

    const range = document.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue
    const style = getComputedStyle(element)
    if (style.visibility !== 'visible') continue

    // The ground: backgrounds up the ancestors to the first opaque one,
    // composited from the bottom. The opacity of every ancestor fades the
    // glyph, which is the case the palette's arithmetic cannot see.
    let opacity = 1
    const layers = []
    let disabled = false
    for (let at = element; at; at = at.parentElement) {
      const computed = getComputedStyle(at)
      opacity *= Number(computed.opacity)
      if (at.matches(':disabled')) disabled = true
      const fill = parse(computed.backgroundColor)
      if (fill[3] > 0) layers.push(fill)
      if (fill[3] >= 1) break
    }
    let ground = [1, 1, 1]
    for (const layer of layers.reverse()) ground = over(layer, ground)

    const colour = parse(style.color)
    // Not drawn at all: a rule's dashes keep their place under the line drawn
    // through them, in a transparent colour.
    if (colour[3] === 0) continue
    const ink = over([colour[0], colour[1], colour[2], colour[3] * opacity], ground)
    const mark = disabled || (faint !== null && colour[3] === 1 && same(colour.slice(0, 3), faint))
    const floor = mark ? MARK : TEXT
    const measuredRatio = ratio(ink, ground)
    measured += 1
    if (measuredRatio + 1e-9 < floor) {
      below.push({
        where: describe(element),
        text: node.textContent.trim().slice(0, 32),
        size: style.fontSize,
        ratio: Math.round(measuredRatio * 100) / 100,
        floor,
        ink: hex(ink),
        ground: hex(ground),
      })
    }
  }
  return { measured, below }
}

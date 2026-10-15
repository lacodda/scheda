# 0017 - Every colour a glyph is drawn in is measured

Accepted, 2026-10-15.

## Context

Most of the window's secondary text is 11 or 12px: the status line, a tab at
rest, a panel's headings, the hints under a setting. It was drawn in `--muted`,
which measured 3.4:1 on the panels in the light theme and 4.2:1 in the dark,
where text that size needs 4.5:1 (WCAG 1.4.3). Nothing failed, because nothing
measured. A count of the rendered page found the same defect under other names:
the accent as text in the light theme (3.2:1), white on the dark theme's light
accent (2.6:1), a missing link (2.6:1), comments and punctuation in a code
block (2.7:1), and a tab's cross faded by an opacity to 1.6:1.

dowel, whose palette the line shares, has two quiet colours, `dim` and `faint`.
The question was whether scheda needs a second one.

## Decision

**Text has one quiet colour, held to 4.5:1; a second, quieter one exists only
for marks that are not read.**

- `--muted` is the quietest text colour. At 11 to 12px the AA floor is already
  the quietest readable value: a step below it is either unreadable or the same
  colour.
- `--faint` draws marks: a tab's cross at rest, a table's pipes, a rule's
  dashes, a disabled control. It is held to the 3:1 WCAG 1.4.11 asks of a
  control, and to staying audibly quieter than `--muted`. Which rules may use it
  is a list, each entry with its reason.
- **No glyph is faded with an opacity.** An opacity is a colour nobody chose
  and nobody measured; the four that were on glyphs (0.45 to 0.7) are now
  `--faint`. The opacities left - a dragged item's ghost, focus mode, a line,
  the mark - are a list with reasons.
- A fill has a partner for what is written on it: `--on-accent`, white in the
  light theme and the dark ground in the dark one.
- The light accent is the brand's terracotta at OKLCH lightness 0.5, as dowel
  renders every product's accent in its light theme. The mark keeps the brand
  colour.
- Values were moved by lightness alone, keeping hue and chroma, to 4.6:1 on the
  hardest ground, which is a code block.

Two checks hold it, because each sees what the other cannot:

- `src/contrast.test.ts` reads `styles.css`, `quick.css` and the editor's theme
  as text. Every colour a rule writes text in clears 4.5:1 on every ground text
  is laid on - the page, the panels, the caret's line, a code block, a table, a
  callout's tint - in both themes; every colour and fill set by one rule clear
  it against each other; `--faint`, partners and opacities appear only where
  their lists allow. The two copies of the dark palette must be equal.
- `tools/check-layout.mjs` measures every visible run of text in the built page
  against its composited background, opacities included, on four screens and
  three theme paths (light, dark by choice, dark by the system). It measures a
  probe of its own first, so an audit that stopped seeing would fail.

## Consequences

- A new colour, a new opacity or a new use of `--faint` fails until it is
  measured or explained.
- Text under a selection or a search match is held only for the body colours:
  the highlight is transient, and the run is read before and after it.
- The rendered audit covers the screens the layout gate can open with its stub.
  A screen it does not open is held by the palette test alone.

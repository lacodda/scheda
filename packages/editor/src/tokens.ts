// The colours the editor is drawn with.
//
// Every colour is a CSS custom property named `--editor-<name>`, which the
// program around the editor sets. One it leaves unset falls back to the dowel
// token of the same role, so a program on the lacodda line's theme gets an
// editor that matches it without a line of CSS — and a program with a palette
// of its own, like scheda, maps its colours onto these names once.
//
// The names say what a colour is for in a note, not what it looks like: `code`
// is inline code, `panel` is what an embed or the front matter form sits on.

/** Each name and the dowel token it falls back to. */
const FALLBACKS = {
  bg: 'var(--bg)',
  text: 'var(--text)',
  heading: 'var(--ink)',
  muted: 'var(--dim)',
  accent: 'var(--accent)',
  border: 'var(--line-2)',
  panel: 'var(--raise)',
  'active-line': 'var(--softer)',
  selection: 'var(--accent-soft)',
  match: 'var(--warn-soft)',
  'match-active': 'color-mix(in oklab, var(--warn) 35%, transparent)',
  code: 'var(--accent-2)',
  'code-bg': 'var(--soft)',
  'link-missing': 'var(--dim)',
  'quote-rule': 'var(--line-2)',
  'quote-text': 'var(--dim)',
  'highlight-bg': 'var(--warn-soft)',
  'highlight-text': 'var(--text)',
  'table-border': 'var(--line)',
  'table-head-bg': 'var(--softer)',
  // Callouts. Their job is to say "this one is a warning" at a glance, so they
  // take the line's status hues, which do not follow the product's accent.
  'callout-note': 'var(--info)',
  'callout-tip': 'var(--good)',
  'callout-success': 'var(--good)',
  'callout-question': 'var(--warn)',
  'callout-warning': 'var(--warn)',
  'callout-danger': 'var(--bad)',
  'callout-example': 'var(--series-7)',
  'callout-quote': 'var(--dim)',
  // Tokens inside a code block.
  'tok-keyword': 'var(--syntax-keyword)',
  'tok-string': 'var(--syntax-string)',
  'tok-number': 'var(--syntax-number)',
  'tok-comment': 'var(--syntax-comment)',
  'tok-function': 'var(--syntax-name)',
  'tok-type': 'var(--syntax-type)',
  'tok-property': 'var(--syntax-meta)',
  'tok-punctuation': 'var(--syntax-punctuation)',
} as const

export type Token = keyof typeof FALLBACKS

/** Every colour the editor reads, in the order the documentation lists them. */
export const TOKENS = Object.keys(FALLBACKS) as Token[]

/** The CSS value of a colour: the program's, or dowel's when it set none. */
export function token(name: Token): string {
  return `var(--editor-${name}, ${FALLBACKS[name]})`
}

/** The dowel token a colour falls back to. */
export function fallbackOf(name: Token): string {
  return FALLBACKS[name]
}

/** The size of the text, which the program usually takes from its settings. */
export const FONT_SIZE = 'var(--editor-font-size, 15px)'

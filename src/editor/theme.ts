// The editor's own look. Kept as a CodeMirror theme rather than a stylesheet so
// the decoration classes and their styling stay in one place.
import { EditorView } from '@codemirror/view'


/** The kinds Obsidian ships, mapped onto the eight colours the palette
 *  defines. Several names mean the same thing — `tip` and `hint`, `danger` and
 *  `error` — and Obsidian treats them as aliases, so scheda does too. */
const CALLOUT_COLOURS: Record<string, string> = {
  note: 'note',
  abstract: 'note',
  summary: 'note',
  tldr: 'note',
  info: 'note',
  todo: 'note',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
}

/** One rule per callout kind: the quote rule in the kind's colour, and the
 *  kind's colour again, very faintly, behind the block. */
function calloutColours(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  for (const [kind, colour] of Object.entries(CALLOUT_COLOURS)) {
    rules[`.cm-md-callout-${kind}`] = {
      borderLeftColor: `var(--callout-${colour})`,
      color: 'var(--text)',
      fontStyle: 'normal',
      // `color-mix` keeps the tint honest in both themes: it is the kind's own
      // colour, thinned into whatever the background happens to be.
      backgroundColor: `color-mix(in srgb, var(--callout-${colour}) 8%, transparent)`,
    }
  }
  return rules
}

export const schedaTheme = EditorView.theme({
  '&': {
    // The size comes from the settings, through a variable the stylesheet sets;
    // stating it here would quietly win over whatever the user chose.
    fontSize: 'var(--editor-font-size)',
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--bg)',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
    lineHeight: '1.7',
    padding: '1.5rem 0',
  },
  // The reading column is set on the content's own width, not with a max-width
  // and auto margins: CodeMirror measures line wrapping against the content
  // element, so constraining it that way leaves the text hugging one edge and
  // wrapping against the wrong width. Padding the scroller keeps the layout
  // CodeMirror expects and still centres the column.
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '0',
  },
  '.cm-line': {
    padding: '0 1rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)',
  },

  // Markup drawn over the source. Sizes stay close to the body text: this is a
  // notepad that shows structure, not a preview pane.
  '.cm-md-h1': { fontSize: '1.55em', fontWeight: '700', color: 'var(--heading)' },
  '.cm-md-h2': { fontSize: '1.35em', fontWeight: '700', color: 'var(--heading)' },
  '.cm-md-h3': { fontSize: '1.2em', fontWeight: '600', color: 'var(--heading)' },
  '.cm-md-h4': { fontSize: '1.1em', fontWeight: '600', color: 'var(--heading)' },
  '.cm-md-h5': { fontWeight: '600', color: 'var(--heading)' },
  '.cm-md-h6': { fontWeight: '600', color: 'var(--muted)' },
  '.cm-md-strong': { fontWeight: '700', color: 'var(--heading)' },
  '.cm-md-emphasis': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', color: 'var(--muted)' },
  '.cm-md-code': {
    fontSize: '0.92em',
    padding: '0.1em 0.35em',
    borderRadius: '4px',
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code)',
  },
  '.cm-md-link': { color: 'var(--accent)' },

  '.cm-md-highlight': {
    backgroundColor: 'var(--highlight-bg)',
    color: 'var(--highlight-text)',
    borderRadius: '3px',
    padding: '0.05em 0.15em',
  },

  // Syntax markers on an inactive line. Collapsed to nothing rather than made
  // transparent: leaving the width behind is the tell of a fake WYSIWYG.
  '.cm-md-marker-hidden': { display: 'none' },

  // ------------------------------------------------------------- blocks --

  // Lists. The indent is hanging: a wrapped item lines up under its own text
  // rather than sliding back under the bullet, which is the difference between
  // a list that reads as a list and one that reads as ragged paragraphs.
  //
  // `text-indent` is negative by exactly the padding, so the first line starts
  // where the bullet is and every wrapped line starts one indent in. This costs
  // no measurement and survives any font size.
  '.cm-md-list-line': {
    paddingLeft: '2.6rem',
    textIndent: '-1.6rem',
  },
  '.cm-md-list-mark': { color: 'var(--accent)' },

  // Checkboxes. Sized in `em` so they follow the reading size.
  '.cm-md-task': {
    appearance: 'none',
    width: '0.95em',
    height: '0.95em',
    margin: '0 0.35em 0 0',
    verticalAlign: '-0.1em',
    border: '1.5px solid var(--muted)',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    boxSizing: 'border-box',
    position: 'relative',
  },
  '.cm-md-task:checked': {
    borderColor: 'var(--accent)',
    backgroundColor: 'var(--accent)',
  },
  // The tick, drawn rather than loaded: an inline SVG in a data URI is blocked
  // by the content policy, which is how the window's own mark went missing
  // once already.
  //
  // Two crossed gradients were the first attempt and they made a roof, not a
  // tick — visible only in a screenshot of the running app. A clipped box is
  // unambiguous: the polygon *is* the tick's outline.
  '.cm-md-task:checked::after': {
    content: '""',
    display: 'block',
    width: '100%',
    height: '100%',
    backgroundColor: 'var(--bg)',
    clipPath:
      'polygon(20% 52%, 32% 40%, 42% 52%, 68% 22%, 80% 34%, 42% 78%)',
  },

  // Quotes. The rule is drawn with a border on the line, so it runs unbroken
  // down a wrapped paragraph.
  '.cm-md-quote-line': {
    paddingLeft: '1.6rem',
    borderLeft: '3px solid var(--quote-rule)',
    marginLeft: '1rem',
    color: 'var(--quote-text)',
    fontStyle: 'italic',
  },

  // Callouts. A quote that named its kind: the rule takes the kind's colour and
  // the whole block gets a tint of it, so it reads as a panel without a border
  // box that would fight the text column.
  '.cm-md-callout-head': { fontWeight: '600' },
  ...calloutColours(),

  // Tables. The cells are not laid out in a grid — that would be a rendering,
  // and the source is the truth — but the delimiters are dimmed so the columns
  // read as columns.
  '.cm-md-table-line': {
    backgroundColor: 'var(--table-head-bg)',
    borderLeft: '3px solid var(--table-border)',
    paddingLeft: '0.7rem',
    marginLeft: '1rem',
  },
  '.cm-md-table-delimiter': { color: 'var(--muted)', opacity: '0.7' },

  // Fenced and indented code, as a block. The inline `.cm-md-code` above is a
  // different thing and keeps its pill.
  '.cm-md-code-line': {
    backgroundColor: 'var(--code-bg)',
    paddingLeft: '1.7rem',
    marginLeft: '1rem',
  },

  // ------------------------------------------------------------ pictures --

  // Drawn under the line that names it, never in place of it: the source stays
  // there to be edited (ADR 0002).
  '.cm-md-image': {
    padding: '0.4rem 1rem 0.6rem',
  },
  '.cm-md-image img': {
    display: 'block',
    maxWidth: '100%',
    // A tall picture must not push the text off screen; the reader can open the
    // file itself for the full thing.
    maxHeight: '60vh',
    borderRadius: '6px',
    border: '1px solid var(--border)',
  },
  // A picture that failed to decode leaves nothing behind. The line above still
  // says what was meant, which beats a broken-image glyph sitting in the prose.
  '.cm-md-image-failed': { display: 'none' },

  // -------------------------------------------------------- front matter --

  '.cm-md-frontmatter-header': {
    display: 'block',
    width: 'calc(100% - 2rem)',
    margin: '0 1rem 0.4rem',
    padding: '0.35rem 0.7rem',
    textAlign: 'left',
    font: 'inherit',
    fontSize: '0.85em',
    color: 'var(--muted)',
    background: 'var(--status-bg)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  '.cm-md-frontmatter-header:hover': {
    color: 'var(--accent)',
    borderColor: 'var(--accent)',
  },

  // ---------------------------------------------------------- reading mode --

  // No caret, no active line: nothing that says "your cursor is here", because
  // in reading mode it is not anywhere that matters.
  // `!important` because the base theme draws the caret through
  // `.cm-focused .cm-cursor`, which outranks a class on the editor. The gate
  // caught this: the class was applied and the caret stayed on screen anyway.
  '&.cm-reading .cm-cursor, &.cm-reading .cm-dropCursor': { display: 'none !important' },
  '&.cm-reading .cm-activeLine': { backgroundColor: 'transparent' },

  // A horizontal rule. The three dashes stay in the text — they are the
  // document — but they are dimmed and the line is drawn under them.
  '.cm-md-rule': { color: 'var(--muted)', opacity: '0.5' },
  '.cm-md-rule-line': {
    borderBottom: '1px solid var(--border)',
  },

  // Search. CodeMirror's panel is plain HTML controls, which look like nothing
  // else in the window until they are told otherwise.
  //
  // Every selector here is prefixed with `&`, which compiles to the theme's own
  // class: the base theme styles panels as `&light .cm-panels`, and a bare
  // `.cm-panels` loses to it on specificity — which is why the panel came up
  // grey with black text on a dark window.
  '& .cm-panels': {
    backgroundColor: 'var(--status-bg)',
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
  },
  '& .cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '& .cm-panel.cm-search': {
    // Browser-drawn controls (the checkboxes especially) take their colours
    // from color-scheme, not from ours, and stay white on a dark panel without
    // it. `inherit` follows the root, which is what the theme setting drives.
    colorScheme: 'inherit',
    padding: '0.5rem 0.75rem',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '12px',
  },
  '& .cm-panel.cm-search input, & .cm-panel.cm-search button, & .cm-panel.cm-search label': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  '& .cm-panel.cm-search input:not([type=checkbox])': {
    padding: '0.25rem 0.4rem',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
  },
  '& .cm-panel.cm-search input:not([type=checkbox]):focus': {
    outline: 'none',
    borderColor: 'var(--accent)',
  },
  '& .cm-panel.cm-search button:not([name=close])': {
    padding: '0.25rem 0.6rem',
    marginLeft: '0.3rem',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    backgroundColor: 'var(--bg)',
    backgroundImage: 'none',
    color: 'var(--text)',
  },
  '& .cm-panel.cm-search button:not([name=close]):hover': {
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
  },
  '& .cm-panel.cm-search label': { color: 'var(--muted)' },
  '& .cm-panel.cm-search [name=close]': {
    color: 'var(--muted)',
    fontSize: '16px',
    padding: '0 0.3rem',
  },
  '& .cm-panel.cm-search [name=close]:hover': { color: 'var(--accent)' },

  // Matches. The current one has to stand apart from the rest, or "next match"
  // moves something the eye cannot follow.
  '& .cm-searchMatch': { backgroundColor: 'var(--match)' },
  '& .cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--match-active)',
    outline: '1px solid var(--accent)',
  },
  '& .cm-selectionMatch': { backgroundColor: 'var(--match)' },
})

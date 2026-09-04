// The editor's own look. Kept as a CodeMirror theme rather than a stylesheet so
// the decoration classes and their styling stay in one place.
import { EditorView } from '@codemirror/view'

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

  // Syntax markers on an inactive line. Collapsed to nothing rather than made
  // transparent: leaving the width behind is the tell of a fake WYSIWYG.
  '.cm-md-marker-hidden': { display: 'none' },

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

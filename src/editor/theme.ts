// The editor's own look. Kept as a CodeMirror theme rather than a stylesheet so
// the decoration classes and their styling stay in one place.
import { EditorView } from '@codemirror/view'

export const schedaTheme = EditorView.theme({
  '&': {
    fontSize: '15px',
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
})

// The editor's extension list, assembled by hand.
//
// `basic-setup` is not used: it pulls in autocompletion, lint gutters and a
// fold service the notepad has no use for, and every one of them is code parsed
// before the first character reaches the screen. What is here was added one
// piece at a time, each because something needed it.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view'
import { markdownDecorations } from './decorations'
import { schedaHighlightStyle } from './highlight'
import { schedaMarkdown } from './markdown'
import { schedaTheme } from './theme'

export function schedaSetup(): Extension[] {
  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    schedaMarkdown(),
    // Without this the grammars parse and nothing shows: tags are assigned and
    // no class ever reaches the DOM.
    syntaxHighlighting(schedaHighlightStyle),
    markdownDecorations,
    // The panel sits at the top: at the bottom it would cover the status bar,
    // and the line being searched for is more often near the start.
    search({ top: true }),
    highlightSelectionMatches(),
    schedaTheme,
    // Search bindings first: `Ctrl+F` and `Escape` have defaults in the base
    // keymap that would otherwise win.
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
  ]
}

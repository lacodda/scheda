// The editor's extension list, assembled by hand.
//
// `basic-setup` is not used: it pulls in autocompletion, lint gutters, search
// panels and a fold service the notepad has no use for at v0.1, and every one
// of them is code parsed before the first character reaches the screen.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view'
import { markdownDecorations } from './decorations'
import { schedaTheme } from './theme'

export function schedaSetup(): Extension[] {
  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    markdown(),
    markdownDecorations,
    schedaTheme,
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ]
}

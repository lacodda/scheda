// Reading mode: the same document with the markers gone and the text locked.
//
// Not a preview pane and not a second rendering of the file. It is the editor
// it always was, with two things changed: every syntax marker hides regardless
// of where the caret is, and typing does nothing. Everything else — the
// decorations, the pictures, the folded front matter — is what it was a moment
// ago, because it is the same view.
//
// That is the cheap way and also the honest one: there is no second renderer
// that could disagree with the first about what a document looks like.
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** Switches reading mode on or off. */
export const toggleReading = StateEffect.define<void>()

/** Whether this document is being read rather than edited. Held in editor state
 *  like everything else, so one tab in reading mode leaves the others alone. */
export const readingMode = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(toggleReading)) return !value
    }
    return value
  },
})

export const reading: Extension = [
  readingMode,
  // Three layers, because none of them alone is enough.
  //
  // `readOnly` is a *convention*: commands and extensions consult it and
  // disable themselves. It is what makes the built-in editing commands behave,
  // and it does nothing at all to a transaction dispatched directly — which a
  // test caught by dispatching one and watching the document change.
  EditorState.readOnly.compute([readingMode], (state) => state.field(readingMode)),
  // `editable` is the DOM: a contenteditable that is not editable takes no
  // typing, no paste, no drop.
  EditorView.editable.compute([readingMode], (state) => !state.field(readingMode)),
  // And the filter is the actual guarantee: whatever the source, a transaction
  // that changes the document is refused while reading. Selection still moves,
  // so the text can be selected and copied.
  EditorState.transactionFilter.of((transaction) =>
    transaction.docChanged && transaction.startState.field(readingMode) ? [] : transaction,
  ),
  // A class on the editor, so the stylesheet can drop the caret and the active
  // line without either needing to know the mode exists.
  EditorView.editorAttributes.compute([readingMode], (state) => ({
    class: state.field(readingMode) ? 'cm-reading' : '',
  })),
]

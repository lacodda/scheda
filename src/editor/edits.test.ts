// The edits the editor makes on your behalf.
//
// These drive the key bindings rather than the commands behind them: a command
// that works and a binding that never fires look identical from the outside,
// and it is the binding a person presses. `runKey` walks the keymap the way
// CodeMirror does, so a binding shadowed by a base one fails here.
import { insertBracket } from '@codemirror/autocomplete'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { schedaSetup } from './setup'

function view(doc: string, cursor: number, options?: { closeBrackets?: boolean }): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: schedaSetup(options),
      selection: EditorSelection.cursor(cursor),
    }),
    parent,
  })
}

/** Types text the way a person does, so the document reaches its state the
 *  same way it would in the app. It matters: `insertNewlineContinueMarkup`
 *  ends a list when an item that HAD content is emptied, and a fixture posed as
 *  a finished file skips that history. */
function type(v: EditorView, text: string): void {
  v.dispatch(v.state.replaceSelection(text))
}

/** Sends a key through the editor's real keymap. */
function press(v: EditorView, key: string, shift = false): void {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  v.contentDOM.dispatchEvent(event)
}

describe('Enter continues the markup', () => {
  it('continues a bullet list', () => {
    const doc = '- first\n'
    const v = view(doc, 7)
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- first\n- \n')
    v.destroy()
  })

  it('continues a numbered list, counting up', () => {
    const v = view('1. first\n', 8)
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('1. first\n2. \n')
    v.destroy()
  })

  it('continues a task as an unticked one', () => {
    // A finished item followed by another finished item would be a lie about
    // work nobody did.
    const v = view('- [x] done\n', 10)
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- [x] done\n- [ ] \n')
    v.destroy()
  })

  it('ends the list on an empty item', () => {
    // Enter twice gets you out, which is what the fingers expect.
    //
    // Typed rather than posed. With a trailing newline already in the document
    // the empty item is not the last line, and the command treats it as an item
    // that has something after it — correctly. Writing the fixture as a
    // finished file tested a situation that never arises while typing.
    const v = view('- first', 7)
    press(v, 'Enter')
    type(v, 'second')
    expect(v.state.doc.toString()).toBe('- first\n- second')
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- first\n- second\n- ')
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- first\n- second\n')
    v.destroy()
  })

  it('continues a quote', () => {
    const v = view('> quoted\n', 8)
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('> quoted\n> \n')
    v.destroy()
  })

  it('leaves ordinary prose alone', () => {
    const v = view('Just a paragraph.\n', 17)
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('Just a paragraph.\n\n')
    v.destroy()
  })
})

describe('Tab changes the level of a list item', () => {
  it('indents inside a list', () => {
    const v = view('- first\n- second\n', 16)
    press(v, 'Tab')
    expect(v.state.doc.toString()).toBe('- first\n  - second\n')
    v.destroy()
  })

  it('outdents with Shift', () => {
    const v = view('- first\n  - second\n', 18)
    press(v, 'Tab', true)
    expect(v.state.doc.toString()).toBe('- first\n- second\n')
    v.destroy()
  })

  it('leaves prose to the default binding', () => {
    // Outside a list Tab is not ours; whatever the base keymap does with it,
    // it must not be "indent this list item".
    const doc = 'Just a paragraph.\n'
    const v = view(doc, 17)
    press(v, 'Tab')
    expect(v.state.doc.toString()).not.toContain('  Just')
    v.destroy()
  })
})

describe('Backspace on an empty item', () => {
  it('takes the marker off in two steps, not the character before it', () => {
    // The documented behaviour, and a sensible one: the first Backspace turns
    // the marker into the spaces it occupied, so the line stays aligned and a
    // paragraph can be written under the item; a second one removes those too.
    // What it must never do is delete the last character of the line above.
    const v = view('- first', 7)
    press(v, 'Enter')
    type(v, 'second')
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- first\n- second\n- ')
    press(v, 'Backspace')
    expect(v.state.doc.toString()).toBe('- first\n- second\n  ')
    press(v, 'Backspace')
    expect(v.state.doc.toString()).toBe('- first\n- second\n')
    v.destroy()
  })

  it('deletes normally in the middle of a word', () => {
    const v = view('- first\n', 7)
    press(v, 'Backspace')
    expect(v.state.doc.toString()).toBe('- firs\n')
    v.destroy()
  })
})

describe('closing brackets', () => {
  // What separates the two settings is whether the input handler is installed
  // at all, so that is what these ask. `insertBracket` is not the question: it
  // builds a transaction from the language's bracket configuration and answers
  // the same either way — a first attempt asserted on it and passed with the
  // setting forced permanently on.
  const inputHandlers = (v: EditorView) => v.state.facet(EditorView.inputHandler).length

  it('installs no input handler by default, because prose is not code', () => {
    // The apostrophe in "don't" is not an opening quote. A notepad that inserts
    // characters nobody typed is worse than one that leaves them alone.
    const plain = view('', 0)
    const closing = view('', 0, { closeBrackets: true })
    expect(inputHandlers(plain)).toBeLessThan(inputHandlers(closing))
    plain.destroy()
    closing.destroy()
  })

  it('inserts the pair when the setting asks for it', () => {
    // Driving the extension's own entry point: jsdom performs no text insertion
    // of its own, so dispatching an input event would prove nothing either way.
    const v = view('', 0, { closeBrackets: true })
    const transaction = insertBracket(v.state, '(')
    expect(transaction).not.toBeNull()
    if (transaction) v.dispatch(transaction)
    expect(v.state.doc.toString()).toBe('()')
    v.destroy()
  })
})

describe('the document', () => {
  it('is only ever changed by an edit the user asked for', () => {
    // Opening a document must not rewrite it, whatever the smart edits could
    // have done to it (ADR 0002).
    const source = '- a list\n\n1. numbered\n\n> quoted\n\nprose\n'
    const v = view(source, 0)
    expect(v.state.doc.toString()).toBe(source)
    v.destroy()
  })
})

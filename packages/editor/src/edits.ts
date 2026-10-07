// The edits a markdown editor should make for you, and the ones it should not.
//
// Three of them, and each earns its place by removing typing that is purely
// mechanical: continuing a list on Enter, changing an item's level with Tab,
// and undoing the marker when Backspace lands on an empty item. All three act
// on markdown the author already wrote — they never guess at a structure that
// is not there.
//
// Closing brackets is the fourth and is off unless asked for. In prose the
// guess is wrong more often than right: the apostrophe in "don't" is not an
// opening quote, and a notepad that inserts characters nobody typed is worse
// than one that leaves them alone.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import {
  Compartment,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state'
import { keymap, type Command, type KeyBinding } from '@codemirror/view'

/** Whether every selection sits inside a list item.
 *
 *  Tab means two different things in a markdown document — indent this list
 *  item, or insert a tab character — and the difference is where the caret is.
 *  Asking the syntax tree is how that question gets a real answer rather than a
 *  regular expression's opinion. */
function inList(state: EditorState): boolean {
  return state.selection.ranges.every((range) => {
    let found = false
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (node.name === 'ListItem' || node.name === 'BulletList' || node.name === 'OrderedList') {
          found = true
        }
      },
    })
    if (found) return true
    // `iterate` over an empty range at the very start of a line can miss the
    // list it is inside, so the line's own text is the fallback question.
    const line = state.doc.lineAt(range.head)
    return /^\s*([-*+]|\d+[.)])\s/.test(line.text)
  })
}

/** Tab: deeper inside a list, an ordinary tab everywhere else. */
const indentListItem: Command = (view) => {
  if (!inList(view.state)) return false
  return indentMore(view)
}

/** Shift+Tab: shallower inside a list. Outside one it does nothing, which is
 *  better than removing indentation the author put there on purpose. */
const outdentListItem: Command = (view) => {
  if (!inList(view.state)) return false
  return indentLess(view)
}

/** The bindings, in the order they are consulted. */
export const smartEditKeymap: KeyBinding[] = [
  // Enter continues the list, the quote or the blockquote the caret is in, and
  // ends it when the item is empty — pressing Enter twice gets you out, which
  // is what every markdown editor does and what the fingers expect.
  { key: 'Enter', run: insertNewlineContinueMarkup },
  // Backspace on an empty item removes the marker rather than the character
  // before it, so an unwanted bullet goes away with one key.
  { key: 'Backspace', run: deleteMarkupBackward },
  { key: 'Tab', run: indentListItem },
  { key: 'Shift-Tab', run: outdentListItem },
]

/** Bracket closing lives in a compartment so the setting can be changed without
 *  rebuilding the editor: the document, the undo history and the cursor all
 *  survive a change of mind.
 *
 *  `closeBracketsKeymap` comes with it, because it is what makes typing the
 *  closing bracket over one that was inserted for you move past it instead of
 *  doubling it. Without the keymap the feature is actively annoying. */
const bracketCompartment = new Compartment()

function bracketExtensions(enabled: boolean): Extension {
  return enabled ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []
}

/** The extension, configured for the setting as it stands at startup. */
export function bracketClosing(enabled: boolean): Extension {
  return bracketCompartment.of(bracketExtensions(enabled))
}

/** A transaction spec that turns bracket closing on or off in a live editor. */
export function setBracketClosing(enabled: boolean): TransactionSpec {
  return { effects: bracketCompartment.reconfigure(bracketExtensions(enabled)) }
}

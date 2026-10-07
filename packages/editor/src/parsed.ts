// Getting a tree that covers the whole document, not just the part the parser
// has got round to.
//
// `syntaxTree` returns what is finished. On a short note that is everything; on
// a long one it is the first screenful, and a caller that walks it sees a
// document that stops partway. That is not a hypothetical: the outline listed
// the first heading and dropped the rest, and a list three items long was
// decorated one item deep — both about one test run in six, and both the same
// thing in the app, where it would have looked like markup filling in as you
// scrolled.
//
// `ensureSyntaxTree` parses up to a position, with a time budget. The budget is
// what keeps this honest: a document too large to finish in time hands back the
// partial tree rather than freezing the window, and the caller draws what it
// can. A frame late is a bug; a frame missing is a worse one.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type EditorState } from '@codemirror/state'

/** How long to let the parser run before taking what is there.
 *
 *  Generous enough that any real note finishes, short enough that a pathological
 *  one does not hold the frame. */
const BUDGET_MS = 200

/** A tree covering the whole document, if it can be had in time.
 *
 *  The return type comes from `syntaxTree` rather than from a `Tree` import:
 *  `@lezer/common` is a transitive dependency, and naming it here would mean
 *  declaring it just to write a type that is already available. */
export function fullTree(state: EditorState): ReturnType<typeof syntaxTree> {
  return ensureSyntaxTree(state, state.doc.length, BUDGET_MS) ?? syntaxTree(state)
}

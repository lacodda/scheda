// Words and reading time, counted the way a writer means them.
//
// A word is a run of non-whitespace with a letter or a digit in it. Runs of
// nothing but punctuation are not words: a `#` before a heading, the `-` of a
// list item and a dash between clauses are markup and typography, and a count
// that included them would put a note of lists a hundred words over the limit
// it is being written to. `**bold**` is one word, as it is on the page.
//
// The front matter is not counted. It is the note's metadata, not its text, and
// a novel of 1200 words does not become 1230 by carrying a title and tags.
import type { Text } from '@codemirror/state'
import { frontMatterEnd } from './fields'

/** Words a minute, for the reading time. The common figure for silent reading
 *  of prose; a note of 1200 words reads in six minutes by it. */
export const WORDS_PER_MINUTE = 200

const WORDLIKE = /[\p{L}\p{N}]/u

/** Words in a piece of text. */
export function countWords(text: string): number {
  let count = 0
  for (const run of text.split(/\s+/)) {
    if (run !== '' && WORDLIKE.test(run)) count++
  }
  return count
}

/** Words in a document's body, remembered per document.
 *
 *  The status bar asks on every caret move, and a caret move leaves the
 *  document the same object — so a long note is counted once per edit rather
 *  than once per arrow key. */
const counted = new WeakMap<Text, number>()

export function bodyWords(doc: Text): number {
  const known = counted.get(doc)
  if (known !== undefined) return known
  const text = doc.toString()
  const words = countWords(text.slice(frontMatterEnd(text)))
  counted.set(doc, words)
  return words
}

/** Minutes to read so many words, rounded up: a note of 30 words still takes a
 *  minute to read, and "0 min" says the note is empty when it is not. */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.ceil(words / WORDS_PER_MINUTE)
}

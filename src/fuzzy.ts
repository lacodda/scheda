// Matching a few letters against a short list the window already holds: the
// commands, the blocks, the recent files.
//
// The same rule as going to a file (`quick.rs`): the letters in order, anywhere
// in the text, scored so that letters starting words and letters close together
// come first. The vault's files are matched in the core because the list is the
// core's; these lists are the window's own and a few dozen long, so a round
// trip per keystroke to match them elsewhere would be the slow half of the work.

export interface Match {
  score: number
  /** Which characters matched, as indices into the text's characters. */
  at: number[]
}

/** Whether a character starts a word: after a space, a separator or a case
 *  change, or at the very start. */
function startsWord(letters: string[], index: number): boolean {
  if (index === 0) return true
  const before = letters[index - 1]
  if (/[\s:/\\._-]/.test(before)) return true
  const here = letters[index]
  return before === before.toLowerCase() && here !== here.toLowerCase()
}

/** Scores `query` against `text`, or null when the letters are not all there in
 *  order. An empty query matches everything equally, keeping the list's order. */
export function match(query: string, text: string): Match | null {
  const wanted = Array.from(query.trim().toLowerCase()).filter((letter) => letter !== ' ')
  if (wanted.length === 0) return { score: 0, at: [] }
  const letters = Array.from(text)
  // Reaching for word starts can jump past the only place a later letter
  // fits; the plain first-fit walk is the fallback that never misses a match.
  return walk(wanted, letters, true) ?? walk(wanted, letters, false)
}

function walk(wanted: string[], letters: string[], preferStarts: boolean): Match | null {
  const lower = letters.map((letter) => letter.toLowerCase())

  const at: number[] = []
  let score = 0
  let from = 0
  for (const letter of wanted) {
    // A letter that starts a word is preferred over the first occurrence: `gf`
    // is "Go to File", not "Go to" and the f in "of".
    let found = -1
    for (let index = from; index < lower.length; index += 1) {
      if (lower[index] !== letter) continue
      if (found === -1) found = index
      if (!preferStarts || startsWord(letters, index)) {
        found = index
        break
      }
    }
    if (found === -1) return null
    const previous = at[at.length - 1]
    score += startsWord(letters, found) ? 8 : 1
    if (previous !== undefined && found === previous + 1) score += 5
    at.push(found)
    from = found + 1
  }
  // Shorter texts first among equals: the command that is only what was typed.
  score -= letters.length / 100
  return { score, at }
}

/** Filters and orders a list by a query, best first; the list's own order for
 *  an empty one. */
export function rank<T>(items: readonly T[], query: string, text: (item: T) => string): { item: T; at: number[] }[] {
  const scored: { item: T; at: number[]; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const found = match(query, text(item))
    if (found) scored.push({ item, at: found.at, score: found.score, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.map(({ item, at }) => ({ item, at }))
}

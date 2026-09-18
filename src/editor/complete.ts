// Offering a note while a `[[link]]` is being typed, and a heading after the `#`.
//
// `@codemirror/autocomplete` is already here for bracket closing, so the panel,
// the keys and the filtering are not written again — only the source that answers
// "what could this be". Two sources, because the two questions are different: a
// name is matched against the vault by the core's own scorer, and a heading is
// matched against one file's headings.
//
// The ranking is deliberately not done here. It is `quick`'s, the same scorer
// `Ctrl+P` uses, because it is the same question — which file did you mean by
// these letters — and a second answer to it in the window would drift from the
// first.
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { type Extension } from '@codemirror/state'
import { documentPath } from './images'
import { completeWikilink, readHeadings, resolveWikilinks } from '../core'
import { resolvedTarget } from './wikilinks'

/** How far back a `[[` may be for this to be the link being typed.
 *
 *  A ceiling rather than a scan to the start of the line: a line of prose holding
 *  an earlier, finished link must not make every word after it look like a link
 *  being typed. A file name is not two hundred characters long. */
const REACH = 200

/** The unfinished wikilink the caret is inside, if it is inside one.
 *
 *  Read from the text rather than the tree on purpose: `[[pl` has no closing
 *  brackets, so the parser has produced no `Wikilink` node to ask about — the
 *  construction being completed is by definition the one that is not there yet.
 *
 *  Exported for its own test: the cases — no brackets, a closed link before the
 *  caret, a `]]` between the brackets and the caret — are the whole behaviour.
 */
export function openLink(
  line: string,
  offset: number,
): { inner: string; from: number } | null {
  const before = line.slice(Math.max(0, offset - REACH), offset)
  const open = before.lastIndexOf('[[')
  if (open === -1) return null

  const inner = before.slice(open + 2)
  // A `]]` after the brackets means that link is finished and the caret is past
  // it, not inside it.
  if (inner.includes(']]')) return null
  // A newline would mean the `[[` is on an earlier line; a wikilink does not span
  // lines, so neither does the thing being completed.
  if (inner.includes('\n')) return null

  return { inner, from: offset - inner.length }
}

/** Completes the name half of a wikilink: everything before a `#` or a `|`. */
async function completeName(context: CompletionContext): Promise<CompletionResult | null> {
  const document = context.state.field(documentPath, false) ?? null
  if (document === null) return null

  const line = context.state.doc.lineAt(context.pos)
  const open = openLink(line.text, context.pos - line.from)
  if (open === null) return null

  // Past a `|` the text is the alias — the words a reader sees — and there is
  // nothing in the vault to complete it against. Past a `#` the heading source
  // below answers instead.
  if (open.inner.includes('|') || open.inner.includes('#')) return null
  // Not on the bare `[[` unless it was asked for explicitly: a panel that opens
  // the instant the second bracket is typed covers the text while somebody is
  // still deciding whether they are writing a link at all.
  if (open.inner === '' && !context.explicit) return null

  let hits
  try {
    hits = await completeWikilink(document, open.inner)
  } catch {
    return null
  }

  return {
    from: open.from + line.from,
    // Refiltered by the core on every keystroke rather than by the panel, so the
    // ranking stays `quick`'s: the panel's own filter would reorder the list by a
    // different opinion of what matches.
    validFor: undefined,
    options: hits.map(
      (hit): Completion => ({
        label: hit.target,
        // The folders as the detail, dim beside the name — the same two-part row
        // the picker draws, because it is the same list.
        detail: hit.folder === '' ? undefined : hit.folder,
        type: 'text',
        // Ranked by the core; `boost` is what stops the panel from sorting the
        // list alphabetically on top of that. Descending, so the first stays
        // first.
        boost: 99 - hits.indexOf(hit),
      }),
    ),
  }
}

/** Completes a heading after the `#` in `[[note#`. */
async function completeHeading(context: CompletionContext): Promise<CompletionResult | null> {
  const document = context.state.field(documentPath, false) ?? null
  if (document === null) return null

  const line = context.state.doc.lineAt(context.pos)
  const open = openLink(line.text, context.pos - line.from)
  if (open === null) return null

  const hash = open.inner.indexOf('#')
  if (hash === -1) return null
  // A `|` before the `#` makes the rest an alias, not a heading.
  const bar = open.inner.indexOf('|')
  if (bar !== -1 && bar < hash) return null

  const name = open.inner.slice(0, hash).trim()

  // `[[#` — the headings of the note being written in, which is the case that
  // needs no vault and no resolution at all.
  let path: string | null
  if (name === '') {
    path = document
  } else {
    path = resolvedTarget(document, name) ?? null
    if (resolvedTarget(document, name) === undefined) {
      try {
        path = (await resolveWikilinks(document, [name]))[0]?.path ?? null
      } catch {
        return null
      }
    }
  }
  // A heading in a note that does not exist yet is not something to offer.
  if (path === null) return null

  let headings: string[]
  try {
    headings = await readHeadings(path)
  } catch {
    return null
  }
  if (headings.length === 0) return null

  return {
    from: open.from + line.from + hash + 1,
    options: headings.map(
      (heading): Completion => ({
        label: heading,
        type: 'property',
      }),
    ),
    // Filtered by the panel here, unlike the name source: these are one note's
    // headings, a handful of them, and the panel's own matching is the right
    // amount of machinery for a list that short.
    validFor: /^[^\]|#]*$/,
  }
}

export const wikilinkCompletion: Extension = autocompletion({
  override: [completeName, completeHeading],
  // No completion from the document's own words. In prose every word would be a
  // candidate, and a notepad that offers to finish sentences is not what this is.
  activateOnTyping: true,
  // The panel closes on Escape and takes Enter only when something is selected,
  // which is the default. What is not the default is selecting the first row:
  // without it Enter inserts a newline while the panel is open, and the list is
  // ranked well enough that the first row is usually the answer.
  defaultKeymap: true,
  selectOnOpen: true,
  // A short list: the core already ranked and truncated it, and a panel taller
  // than the text it is over covers the note being written.
  maxRenderedOptions: 12,
  icons: false,
})

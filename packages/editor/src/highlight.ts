// Colours for the tokens inside a fenced code block.
//
// Without a highlight style the grammars parse and nothing shows: the tree is
// built, the tags are assigned, and no class ever reaches the DOM. That is
// exactly what happened when the fences were first wired up — the languages
// resolved, the code stayed grey, and the missing piece was this file.
//
// The palette is the program's own, in variables (`tokens.ts`), so it follows
// the theme rather than pinning a second set of colours that only look right in
// one of them.
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { token } from './tokens.js'

export const schedaHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: token('tok-keyword') },
  { tag: [tags.string, tags.special(tags.string)], color: token('tok-string') },
  { tag: [tags.number, tags.bool, tags.null], color: token('tok-number') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: token('tok-comment'), fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: token('tok-function') },
  { tag: [tags.typeName, tags.className, tags.namespace], color: token('tok-type') },
  { tag: [tags.propertyName, tags.attributeName], color: token('tok-property') },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: token('tok-punctuation') },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: token('text') },
  { tag: tags.invalid, color: token('callout-danger') },
])

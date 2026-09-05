// Colours for the tokens inside a fenced code block.
//
// Without a highlight style the grammars parse and nothing shows: the tree is
// built, the tags are assigned, and no class ever reaches the DOM. That is
// exactly what happened when the fences were first wired up — the languages
// resolved, the code stayed grey, and the missing piece was this file.
//
// The palette is the product's own, in variables, so it follows the theme
// rather than pinning a second set of colours that only look right in one of
// them.
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const schedaHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: 'var(--tok-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--tok-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--tok-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--tok-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--tok-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--tok-property)' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--tok-punctuation)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--text)' },
  { tag: tags.invalid, color: 'var(--callout-danger)' },
])

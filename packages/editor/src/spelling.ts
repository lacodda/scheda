// Spell checking, by the system's own checker.
//
// WebView2 underlines misspelt words with Windows' spell checker when the text
// is marked `spellcheck`. CodeMirror marks it off, and off is the default here
// too: a note full of code, paths and names is a note full of red lines, and a
// notepad should not greet its first file that way. The setting turns it on.
//
// The language is the note's own. The element says `lang="ru"` over a note
// written mostly in Cyrillic and `lang="en"` otherwise, so the checker — and a
// screen reader — knows which words it is looking at without being told per
// file. Counted over the start of the note: a paragraph in the other language
// further down does not change what the note is written in.
//
// A property of the window, like focus mode: the setting is read once and every
// tab's state follows it.
import { type Text, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

let checking = false

const spellingChanged = StateEffect.define<boolean>()

/** Turns the checker on or off in the view, now. */
export function setSpelling(view: EditorView, on: boolean): void {
  checking = on
  view.dispatch({ effects: spellingChanged.of(on) })
}

/** How much of a note decides its language. */
const SAMPLE = 20_000

const languages = new WeakMap<Text, 'ru' | 'en'>()

/** The language a note is written in, as far as the two the line writes in go. */
export function languageOf(doc: Text): 'ru' | 'en' {
  const known = languages.get(doc)
  if (known) return known
  const sample = doc.sliceString(0, SAMPLE)
  let cyrillic = 0
  let latin = 0
  for (const char of sample) {
    if (char >= 'Ѐ' && char <= 'ӿ') cyrillic++
    else if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')) latin++
  }
  const language = cyrillic > latin ? 'ru' : 'en'
  languages.set(doc, language)
  return language
}

export const spelling = EditorView.contentAttributes.of((view) => ({
  spellcheck: checking ? 'true' : 'false',
  lang: languageOf(view.state.doc),
}))

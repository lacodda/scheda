// Every file of the round-trip corpus, through everything the editor does to
// a note without being asked: the decorations, the outline, the word count,
// the front matter form, focus mode, the table reader and the page renderer.
//
// The core's gate says the bytes survive a save. This one says the window
// survives the file: nothing throws on a lone CR or a pipe inside code, and no
// view state — a fold, a form, a mode — changes a single character. The corpus
// only grows; a file that breaks something here is a file that stays.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { readFrontMatter, writeField } from './fields'
import { sectionAt, setFocusing } from './focus'
import { showFrontMatter } from './frontmatter'
import { renderPage } from './html'
import { outlineOf } from './outline'
import { toggleReading } from './reading'
import { schedaSetup } from './setup'
import { rowOf } from './table-edit'
import { bodyWords } from './words'

const CORPUS = join(__dirname, '../../src-tauri/tests/corpus')

/** The text the core hands the window: BOM off, and — as the editor itself
 *  splits lines — every break a line break. */
function textOf(bytes: Buffer): string {
  const text = bytes.toString('utf8')
  return text.replace(/^\uFEFF/, '')
}

const files = readdirSync(CORPUS).filter((name) => name.endsWith('.md'))

describe('the corpus in the editor', () => {
  it('has the evil files in it', () => {
    for (const name of [
      'nested-lists.md',
      'table-pipes-in-code.md',
      'unicode-links.md',
      'mixed-endings-evil.md',
      'front-matter-evil.md',
    ]) {
      expect(files).toContain(name)
    }
  })

  for (const name of files) {
    it(`${name}: every view state leaves the text alone`, () => {
      const text = textOf(readFileSync(join(CORPUS, name)))
      const parent = document.createElement('div')
      document.body.appendChild(parent)
      const view = new EditorView({
        state: EditorState.create({ doc: text, extensions: schedaSetup() }),
        parent,
      })
      const original = view.state.doc.toString()

      try {
        outlineOf(view.state)
        bodyWords(view.state.doc)
        sectionAt(view.state, view.state.doc.length)
        for (let line = 1; line <= view.state.doc.lines; line++) rowOf(view.state.doc.line(line).text)

        setFocusing(view, true)
        for (const mode of ['form', 'source', 'folded'] as const) {
          view.dispatch({ effects: showFrontMatter.of(mode) })
        }
        view.dispatch({ effects: toggleReading.of() })
        view.dispatch({ effects: showFrontMatter.of('form') })
        view.dispatch({ effects: toggleReading.of() })
        setFocusing(view, false)
        expect(view.state.doc.toString()).toBe(original)

        // The form writes each field back as it found it.
        const front = readFrontMatter(original)
        for (const field of front?.fields ?? []) {
          if (field.value.kind === 'complex') continue
          const written = writeField(field.raw, field.value, field.written)
          expect(written, `${name}: ${field.key}`).toBe(original.slice(field.from, field.to))
        }

        const page = renderPage(view.state, name, { images: new Map(), diagrams: new Map() })
        expect(page).toMatch(/^<!doctype html>/)
        expect(page).not.toMatch(/<script/i)
      } finally {
        view.destroy()
      }
    })
  }
})

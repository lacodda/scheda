// The writing stage: the front matter form, focus mode, words, table keys and
// moving sections. Each block drives the real editor setup, so a binding that
// another binding shadows fails here rather than in the window.
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { isFocusing, sectionAt, setFocusing } from './focus'
import { showFrontMatter, toggleFrontMatter } from './frontmatter'
import { toggleReading } from './reading'
import { moveSection } from './sections'
import { schedaSetup } from './setup'
import { languageOf, setSpelling } from './spelling'
import {
  deleteColumn,
  insertColumnAfter,
  insertColumnBefore,
  newRow,
  nextCell,
  previousCell,
  rowOf,
} from './table-edit'
import { bodyWords, countWords, readingMinutes } from './words'

const views: EditorView[] = []

function view(doc: string, anchor = 0, head = anchor): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const made = new EditorView({
    state: EditorState.create({ doc, extensions: schedaSetup(), selection: { anchor, head } }),
    parent,
  })
  views.push(made)
  return made
}

afterEach(() => {
  for (const made of views.splice(0)) {
    if (isFocusing()) setFocusing(made, false)
    made.destroy()
  }
})

/** Presses a key the way the keyboard does: through the editor's keymap. */
function press(v: EditorView, key: string, modifiers: Partial<KeyboardEventInit> = {}): boolean {
  return runScopeHandlers(v, new KeyboardEvent('keydown', { key, ...modifiers }), 'editor')
}

describe('words', () => {
  it('counts words, not markup', () => {
    expect(countWords('# Title\n\n- one **two** — three\n- 4\n')).toBe(5)
    expect(countWords('   ')).toBe(0)
    expect(countWords('слово и word')).toBe(3)
  })

  it('leaves the front matter out of the note’s count', () => {
    const state = EditorState.create({ doc: '---\ntitle: Many words in here\n---\nFour words of body.\n' })
    expect(bodyWords(state.doc)).toBe(4)
  })

  it('rounds the reading time up, and says nothing for an empty note', () => {
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(1)).toBe(1)
    expect(readingMinutes(1200)).toBe(6)
    expect(readingMinutes(1201)).toBe(7)
  })
})

const WITH_FRONT_MATTER = '---\ntitle: A note\ndraft: true\ntags: [a, b]\n---\n\n# Heading\n\ntext\n'

describe('the front matter form', () => {
  const opened = (v: EditorView) => {
    v.dispatch({ effects: toggleFrontMatter.of() })
    return v.dom.querySelector('.cm-fm-form')
  }

  it('opens from the header with a row per field', () => {
    const v = view(WITH_FRONT_MATTER)
    const form = opened(v)
    expect(form).not.toBeNull()
    expect([...form!.querySelectorAll('.cm-fm-key')].map((key) => key.textContent)).toEqual([
      'title',
      'draft',
      'tags',
    ])
    expect(form!.querySelector('input[type=checkbox]')).not.toBeNull()
    expect([...form!.querySelectorAll('.cm-fm-pill')].map((pill) => pill.firstChild?.textContent)).toEqual(['a', 'b'])
  })

  it('writes a changed value into the text and only that', () => {
    const v = view(WITH_FRONT_MATTER)
    const box = opened(v)!.querySelector<HTMLInputElement>('input[type=checkbox]')!
    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(v.state.doc.toString()).toBe(WITH_FRONT_MATTER.replace('draft: true', 'draft: false'))
  })

  it('writes a typed title, quoted when it has to be', () => {
    const v = view(WITH_FRONT_MATTER)
    const input = opened(v)!.querySelector<HTMLInputElement>('.cm-fm-row--text input')!
    input.value = 'Part 2: the rain'
    input.dispatchEvent(new Event('change'))
    expect(v.state.doc.toString()).toContain('title: "Part 2: the rain"\n')
  })

  it('removes a list item and adds a field', () => {
    const v = view(WITH_FRONT_MATTER)
    opened(v)!.querySelector<HTMLButtonElement>('.cm-fm-pill-remove')!.click()
    expect(v.state.doc.toString()).toContain('tags: [b]\n')
    const add = v.dom.querySelector<HTMLInputElement>('.cm-fm-add')!
    add.value = 'status'
    add.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(v.state.doc.toString()).toContain('tags: [b]\nstatus:\n---\n')
  })

  it('is locked in reading mode', () => {
    const v = view(WITH_FRONT_MATTER)
    v.dispatch({ effects: [toggleReading.of(), showFrontMatter.of('form')] })
    expect(v.dom.querySelector<HTMLInputElement>('.cm-fm-form input[type=checkbox]')!.disabled).toBe(true)
    expect(v.dom.querySelector('.cm-fm-add')).toBeNull()
  })

  it('shows the text on request, with the way back', () => {
    const v = view(WITH_FRONT_MATTER)
    v.dispatch({ effects: showFrontMatter.of('source') })
    expect(v.dom.querySelector('.cm-fm-form')).toBeNull()
    expect(v.dom.querySelector('.cm-fm-back')).not.toBeNull()
  })

  it('keeps a key order and fields it cannot edit', () => {
    const doc = '---\nb: 1\nnested:\n  x: y\na: 2\n---\n'
    const v = view(doc)
    const form = opened(v)!
    expect(form.querySelector('.cm-fm-row--complex')).not.toBeNull()
    const input = form.querySelector<HTMLInputElement>('.cm-fm-row--number input')!
    input.value = '5'
    input.dispatchEvent(new Event('change'))
    expect(v.state.doc.toString()).toBe('---\nb: 5\nnested:\n  x: y\na: 2\n---\n')
  })
})

const SECTIONS = '# One\n\nfirst\n\n## One.a\n\ninner\n\n# Two\n\nsecond\n'

describe('focus mode', () => {
  it('finds the innermost section around the caret', () => {
    const state = EditorState.create({ doc: SECTIONS, extensions: schedaSetup() })
    const inner = SECTIONS.indexOf('inner')
    const section = sectionAt(state, inner)
    expect(state.sliceDoc(section.from, section.to)).toBe('## One.a\n\ninner\n')
  })

  it('fades every line outside it, and stops when switched off', () => {
    const v = view(SECTIONS, SECTIONS.indexOf('second'))
    press(v, 'D', { ctrlKey: true, shiftKey: true, keyCode: 68 })
    expect(isFocusing()).toBe(true)
    const faded = [...v.dom.querySelectorAll('.cm-focus-faded')].map((line) => line.textContent)
    expect(faded).toContain('first')
    expect(faded).not.toContain('second')
    press(v, 'D', { ctrlKey: true, shiftKey: true, keyCode: 68 })
    expect(v.dom.querySelectorAll('.cm-focus-faded')).toHaveLength(0)
  })

  it('does not change the document', () => {
    const v = view(SECTIONS)
    setFocusing(v, true)
    expect(v.state.doc.toString()).toBe(SECTIONS)
  })
})

describe('spelling', () => {
  it('is off until the setting turns it on', () => {
    const v = view('text')
    expect(v.contentDOM.getAttribute('spellcheck')).toBe('false')
    setSpelling(v, true)
    expect(v.contentDOM.getAttribute('spellcheck')).toBe('true')
    setSpelling(v, false)
    expect(v.contentDOM.getAttribute('spellcheck')).toBe('false')
  })

  it('names the note’s language', () => {
    expect(languageOf(EditorState.create({ doc: 'Привет, это заметка with a word' }).doc)).toBe('ru')
    expect(languageOf(EditorState.create({ doc: 'A note with одно слово' }).doc)).toBe('en')
    expect(view('Просто текст').contentDOM.getAttribute('lang')).toBe('ru')
  })
})

describe('table rows', () => {
  it('cuts on the pipes that are boundaries', () => {
    const row = rowOf('| `a|b` | c \\| d | e |')
    expect(row.cells).toHaveLength(3)
    expect(row.leading && row.trailing).toBe(true)
    const bare = rowOf('a | b')
    expect(bare.cells.map((cell) => 'a | b'.slice(cell.from, cell.to))).toEqual(['a ', ' b'])
    expect(bare.leading || bare.trailing).toBe(false)
  })
})

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'

describe('table keys', () => {
  const selected = (v: EditorView) => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)

  it('Tab walks the cells, skipping the dashes, and adds a row at the end', () => {
    const v = view(TABLE, 2)
    expect(press(v, 'Tab')).toBe(true)
    expect(selected(v)).toBe('b')
    press(v, 'Tab')
    expect(selected(v)).toBe('1')
    press(v, 'Tab')
    expect(selected(v)).toBe('2')
    press(v, 'Tab')
    expect(v.state.doc.toString()).toBe(TABLE + '|  |  |\n')
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(4)
  })

  it('Shift+Tab walks back and stops at the first cell', () => {
    const v = view(TABLE, TABLE.indexOf('1'))
    press(v, 'Tab', { shiftKey: true })
    expect(selected(v)).toBe('b')
    const w = view(TABLE, 2)
    expect(previousCell(w)).toBe(true)
    expect(w.state.doc.toString()).toBe(TABLE)
  })

  it('Enter adds a row under the caret, and leaves the table from an empty one', () => {
    const v = view(TABLE, TABLE.indexOf('2'))
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe(TABLE.replace('| 1 | 2 |', '| 1 | 2 |\n|  |  |'))
    press(v, 'Enter')
    expect(v.state.doc.toString()).toBe(TABLE + '\n')
  })

  it('Enter on the header adds the row below the dashes', () => {
    const v = view(TABLE, 2)
    expect(newRow(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n')
  })

  it('adds and removes columns in every row', () => {
    const v = view(TABLE, 2)
    insertColumnAfter(v)
    expect(v.state.doc.toString()).toBe('| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |\n')
    deleteColumn(v)
    expect(v.state.doc.toString()).toBe(TABLE)
    const w = view(TABLE, 2)
    insertColumnBefore(w)
    expect(w.state.doc.toString()).toBe('|  | a | b |\n| --- | --- | --- |\n|  | 1 | 2 |\n')
  })

  it('adds a column after the last one', () => {
    const v = view(TABLE, TABLE.indexOf('b'))
    insertColumnAfter(v)
    expect(v.state.doc.toString()).toBe('| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |\n')
  })

  it('works on a table without outer pipes', () => {
    const bare = 'a | b\n--- | ---\n1 | 2\n'
    const v = view(bare, 0)
    insertColumnAfter(v)
    expect(v.state.doc.toString()).toBe('a |  | b\n--- | --- | ---\n1 |  | 2\n')
    const w = view(bare, bare.indexOf('b'))
    deleteColumn(w)
    expect(w.state.doc.toString()).toBe('a\n---\n1\n')
  })

  it('leaves Tab to the list outside a table', () => {
    const v = view('- item\n', 3)
    expect(nextCell(v)).toBe(false)
    press(v, 'Tab')
    expect(v.state.doc.toString()).not.toBe('- item\n')
  })

  it('does nothing in reading mode', () => {
    const v = view(TABLE, 2)
    v.dispatch({ effects: toggleReading.of() })
    expect(nextCell(v)).toBe(false)
    expect(v.state.doc.toString()).toBe(TABLE)
  })
})

describe('moving a section', () => {
  const state = (doc: string) => EditorState.create({ doc, extensions: schedaSetup() })
  const moved = (doc: string, index: number, before: number | null) => {
    const start = state(doc)
    const spec = moveSection(start, index, before)
    return spec ? start.update(spec) : null
  }

  it('takes the children along and keeps the level', () => {
    const after = moved(SECTIONS, 0, null)!
    expect(after.state.doc.toString()).toBe('# Two\n\nsecond\n# One\n\nfirst\n\n## One.a\n\ninner\n\n')
    // The caret lands on the moved heading.
    expect(after.state.doc.lineAt(after.state.selection.main.head).text).toBe('# One')
  })

  it('moves a child under another parent without rewriting its hashes', () => {
    const after = moved(SECTIONS, 1, 0)!
    expect(after.state.doc.toString()).toBe('## One.a\n\ninner\n\n# One\n\nfirst\n\n# Two\n\nsecond\n')
    const down = moved(SECTIONS, 1, null)!
    expect(down.state.doc.toString()).toBe('# One\n\nfirst\n\n# Two\n\nsecond\n## One.a\n\ninner\n\n')
  })

  it('keeps a note that ends without a line break ending without one', () => {
    const doc = '# A\n\na\n# B\n\nb'
    const up = moved(doc, 1, 0)!
    expect(up.state.doc.toString()).toBe('# B\n\nb\n# A\n\na')
    const down = moved(doc, 0, null)!
    expect(down.state.doc.toString()).toBe('# B\n\nb\n# A\n\na')
  })

  it('refuses a move into itself or onto its own place', () => {
    expect(moved(SECTIONS, 0, 1)).toBeNull()
    expect(moved(SECTIONS, 0, 0)).toBeNull()
    expect(moved(SECTIONS, 2, null)).toBeNull()
    // Just before the next section is where a section already ends.
    expect(moved(SECTIONS, 1, 2)).toBeNull()
    // Just before the next section is where a section already ends.
    expect(moved(SECTIONS, 1, 2)).toBeNull()
  })

  it('is one step of undo', () => {
    const v = view(SECTIONS)
    v.dispatch(moveSection(v.state, 0, null)!)
    press(v, 'z', { ctrlKey: true })
    expect(v.state.doc.toString()).toBe(SECTIONS)
  })

  it('keeps the text before the first heading where it is', () => {
    const doc = 'intro\n\n# A\n\na\n\n# B\n\nb\n'
    expect(moved(doc, 1, 0)!.state.doc.toString()).toBe('intro\n\n# B\n\nb\n# A\n\na\n\n')
  })
})

describe('selection', () => {
  it('is left alone by the table keys outside a table', () => {
    const v = view('plain text', 0, 5)
    press(v, 'ArrowRight', { ctrlKey: true, altKey: true })
    press(v, 'Backspace', { ctrlKey: true, altKey: true })
    expect(v.state.doc.toString()).toBe('plain text')
  })
})

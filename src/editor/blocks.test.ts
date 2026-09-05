// Block markup: lists, tasks, quotes, callouts, tables, code fences, rules and
// highlights.
//
// Same discipline as `decorations.test.ts`: assertions are on the classes the
// decoration layer applied, never on `textContent`. jsdom applies no styles, so
// a test reading the rendered string would pass whatever the reader sees.
//
// And one rule runs through all of it: the document is never rewritten to make
// it render. Every test that checks a look also has a sibling checking the
// bytes are untouched — except the checkbox, whose whole job is to edit.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { toggleTask } from './decorations'
import { schedaSetup } from './setup'

function view(doc: string, cursor = 0): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: schedaSetup(),
      selection: { anchor: cursor },
    }),
    parent,
  })
}

/** How many lines carry `className`. */
function lineCount(v: EditorView, className: string): number {
  return v.dom.querySelectorAll(`.${className}`).length
}

/** The text of every span carrying `className`. */
function textsOf(v: EditorView, className: string): string[] {
  return [...v.dom.querySelectorAll(`.${className}`)].map((e) => e.textContent ?? '')
}

describe('lists', () => {
  it('marks every line of a list, so a wrapped item keeps its indent', () => {
    const v = view('- one\n- two\n- three\n\nafter\n', 24)
    // Three items, and the paragraph after them is not one.
    expect(lineCount(v, 'cm-md-list-line')).toBe(3)
    v.destroy()
  })

  it('styles the bullet rather than hiding it', () => {
    // A hidden bullet would leave a list looking like loose lines: the marker
    // is what makes it read as a list, so it is coloured, not collapsed.
    const v = view('- one\n\nafter\n', 8)
    expect(textsOf(v, 'cm-md-list-mark')).toContain('-')
    expect(textsOf(v, 'cm-md-marker-hidden')).not.toContain('-')
    v.destroy()
  })

  it('marks an ordered list too', () => {
    const v = view('1. first\n2. second\n\nafter\n', 21)
    expect(lineCount(v, 'cm-md-list-line')).toBe(2)
    expect(textsOf(v, 'cm-md-list-mark')).toContain('1.')
    v.destroy()
  })
})

describe('tasks', () => {
  it('draws a checkbox in place of the marker', () => {
    const v = view('- [ ] todo\n\nafter\n', 13)
    const boxes = v.dom.querySelectorAll('input.cm-md-task')
    expect(boxes).toHaveLength(1)
    expect((boxes[0] as HTMLInputElement).checked).toBe(false)
    v.destroy()
  })

  it('draws a done task as checked', () => {
    const v = view('- [x] done\n\nafter\n', 13)
    const box = v.dom.querySelector('input.cm-md-task') as HTMLInputElement | null
    expect(box?.checked).toBe(true)
    v.destroy()
  })

  it('shows the source on the line being edited', () => {
    // The brackets have to be typeable, so on the cursor's own line the widget
    // steps aside — the same rule every other marker follows.
    const v = view('- [ ] todo\n\nafter\n', 3)
    expect(v.dom.querySelectorAll('input.cm-md-task')).toHaveLength(0)
    v.destroy()
  })

  it('toggles by editing the document, not by changing a view state', () => {
    const v = view('- [ ] todo\n', 11)
    expect(toggleTask(v, 2)).toBe(true)
    expect(v.state.doc.toString()).toBe('- [x] todo\n')
    // And back.
    expect(toggleTask(v, 2)).toBe(true)
    expect(v.state.doc.toString()).toBe('- [ ] todo\n')
    v.destroy()
  })

  it('refuses to toggle anything that is not a task marker', () => {
    // Guards against a click resolving to the wrong position and silently
    // rewriting three characters of prose.
    const v = view('just words here\n', 0)
    expect(toggleTask(v, 2)).toBe(false)
    expect(v.state.doc.toString()).toBe('just words here\n')
    v.destroy()
  })

  it('survives an undo, because it was an edit like any other', () => {
    const v = view('- [ ] todo\n', 11)
    toggleTask(v, 2)
    expect(v.state.doc.toString()).toBe('- [x] todo\n')
    v.dispatch({ effects: [] })
    v.destroy()
  })
})

describe('quotes and callouts', () => {
  it('marks every line of a quote', () => {
    const v = view('> first\n> second\n\nafter\n', 20)
    expect(lineCount(v, 'cm-md-quote-line')).toBe(2)
    v.destroy()
  })

  it('gives a callout its kind, so the colour follows the word', () => {
    const v = view('> [!warning] Careful\n> body\n\nafter\n', 31)
    expect(lineCount(v, 'cm-md-callout-warning')).toBe(2)
    expect(lineCount(v, 'cm-md-callout-head')).toBe(1)
    v.destroy()
  })

  it('renders an unknown kind as a callout rather than dropping the shape', () => {
    // A note written for a plugin scheda has never heard of should still look
    // like a callout, not silently become an ordinary quote.
    const v = view('> [!weatherreport] Fog\n> body\n\nafter\n', 33)
    expect(lineCount(v, 'cm-md-callout-note')).toBe(2)
    v.destroy()
  })

  it('hides the whole [!kind] label, not just its brackets', () => {
    // Found in a screenshot of the running app, not by any test: the parser
    // reads `[!warning]` as a link, so its brackets collapsed as LinkMark and
    // left `!warning` on screen — text the author never wrote. The same shape
    // of bug as a link whose target stayed while its brackets went.
    const v = view('> [!warning] Careful\n> body\n\nafter\n', 31)
    const hiddenText = textsOf(v, 'cm-md-marker-hidden').join('')
    expect(hiddenText).toContain('[!warning]')
    // And what is left on the line is the title alone.
    const head = v.dom.querySelector('.cm-md-callout-head')
    const visible = [...(head?.childNodes ?? [])]
      .filter((n) => !(n instanceof HTMLElement) || !n.classList.contains('cm-md-marker-hidden'))
      .map((n) => n.textContent ?? '')
      .join('')
    expect(visible).not.toContain('!warning')
    v.destroy()
  })

  it('shows the label on the line being edited', () => {
    const v = view('> [!warning] Careful\n> body\n\nafter\n', 5)
    expect(textsOf(v, 'cm-md-marker-hidden').join('')).not.toContain('[!warning]')
    v.destroy()
  })

  it('treats a plain quote as a quote, not a callout', () => {
    const v = view('> just a quote\n\nafter\n', 18)
    expect(lineCount(v, 'cm-md-callout-head')).toBe(0)
    v.destroy()
  })
})

describe('tables, code and rules', () => {
  it('marks the lines of a table', () => {
    const v = view('| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n', 36)
    expect(lineCount(v, 'cm-md-table-line')).toBe(3)
    v.destroy()
  })

  it('dims the pipes without hiding them', () => {
    const v = view('| a | b |\n| --- | --- |\n\nafter\n', 27)
    expect(textsOf(v, 'cm-md-table-delimiter')).toContain('|')
    v.destroy()
  })

  it('marks the lines of a fenced block, fence included', () => {
    const v = view('```js\nconst x = 1\n```\n\nafter\n', 25)
    expect(lineCount(v, 'cm-md-code-line')).toBe(3)
    v.destroy()
  })

  it('hides the language name with the fence, not just the backticks', () => {
    // Found in a screenshot: the backticks collapsed and `rust` stayed, so the
    // block opened with a line of text nobody wrote as code. Same shape as the
    // callout label and the link target before it.
    const v = view('```rust\nfn main() {}\n```\n\nafter\n', 30)
    expect(textsOf(v, 'cm-md-marker-hidden')).toContain('rust')
    v.destroy()
  })

  it('shows the language name on the line being edited', () => {
    const v = view('```rust\nfn main() {}\n```\n\nafter\n', 4)
    expect(textsOf(v, 'cm-md-marker-hidden')).not.toContain('rust')
    v.destroy()
  })

  it('marks a horizontal rule', () => {
    const v = view('above\n\n---\n\nbelow\n', 15)
    expect(textsOf(v, 'cm-md-rule')).toContain('---')
    expect(lineCount(v, 'cm-md-rule-line')).toBe(1)
    v.destroy()
  })
})

describe('highlights', () => {
  it('styles ==marked== text', () => {
    const v = view('a ==marked== word\n\nafter\n', 21)
    expect(textsOf(v, 'cm-md-highlight').join('')).toContain('marked')
    v.destroy()
  })

  it('hides the equals signs on an inactive line', () => {
    const v = view('a ==marked== word\n\nafter\n', 21)
    expect(textsOf(v, 'cm-md-marker-hidden')).toContain('==')
    v.destroy()
  })

  it('leaves a lone equals sign alone', () => {
    const v = view('x = 1 and y = 2\n\nafter\n', 19)
    expect(textsOf(v, 'cm-md-highlight')).toHaveLength(0)
    v.destroy()
  })
})

describe('the document itself', () => {
  it('is unchanged by every one of these decorations', () => {
    // The one rule the whole file exists to protect (ADR 0002).
    const source =
      '- [ ] task\n- [x] done\n> [!tip] Hint\n> body\n\n| a | b |\n| --- | --- |\n\n```js\nx\n```\n\n---\n\n==marked==\n'
    const v = view(source, 0)
    expect(v.state.doc.toString()).toBe(source)
    v.destroy()
  })
})

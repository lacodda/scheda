// Front matter: folded into a header line, opened as a form, or shown as text.
//
// A note that opens with twelve lines of YAML opens with twelve lines the
// reader did not come for. Folded, it is one line saying how many fields are
// there. Clicking it opens a form — a row per field, with a control that fits
// the value: a checkbox for `true`, a date picker for `2026-09-24`, pills for a
// list — and the form writes the YAML, so a field cannot come back with a
// missing quote or a list that swallowed its neighbour. "Edit as YAML" shows the
// text itself, for whatever the form does not know how to hold.
//
// What the form writes is the field it changed and nothing else: the key order,
// the comments and every other field stay byte for byte (`fields.ts`). Folding
// and opening are view states — the document changes only when a value does
// (ADR 0002).
import { syntaxTree } from '@codemirror/language'
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import {
  type Field,
  type FieldValue,
  readFrontMatter,
  valueFromTyping,
  writeField,
  writeKey,
} from './fields'

type Mode = 'folded' | 'form' | 'source'

/** Folded to open, or back. From the text view, it folds. */
export const toggleFrontMatter = StateEffect.define<void>()

/** Straight to one of the three. */
export const showFrontMatter = StateEffect.define<Mode>()

/** How the front matter is shown in this document. Folded by default: the
 *  fields are metadata, and a reader who wants them can ask. */
export const frontMatterMode = StateField.define<Mode>({
  create: () => 'folded',
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(toggleFrontMatter)) value = value === 'folded' ? 'form' : 'folded'
      if (effect.is(showFrontMatter)) value = effect.value
    }
    return value
  },
})

/** The line shown in place of the fields. */
class FrontMatterHeader extends WidgetType {
  constructor(readonly fields: number) {
    super()
  }

  eq(other: FrontMatterHeader) {
    return other.fields === this.fields
  }

  toDOM(view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-md-frontmatter-header'
    button.textContent =
      this.fields === 1 ? '1 field of front matter' : `${this.fields} fields of front matter`
    button.title = 'Show the front matter'
    button.addEventListener('mousedown', (event) => {
      // Down rather than click: the editor takes the selection on mousedown and
      // would move the caret into the folded range before the click arrives.
      event.preventDefault()
      view.dispatch({ effects: toggleFrontMatter.of() })
    })
    return button
  }

  ignoreEvent() {
    return false
  }
}

/** The key a new field was just added under, so the form that is drawn next
 *  puts the caret in its value. */
let focusAfterAdd: string | null = null

/** Replaces field `index` — found again in the live document, because the form
 *  on screen may be older than the text — with `value`. */
function writeValue(view: EditorView, index: number, raw: string, value: FieldValue): void {
  const field = readFrontMatter(view.state.doc.toString())?.fields[index]
  if (!field || field.raw !== raw) return
  const insert = writeField(raw, value, field.written)
  if (view.state.sliceDoc(field.from, field.to) === insert) return
  view.dispatch({ changes: { from: field.from, to: field.to, insert }, userEvent: 'input.frontmatter' })
}

function removeField(view: EditorView, index: number, raw: string): void {
  const field = readFrontMatter(view.state.doc.toString())?.fields[index]
  if (!field || field.raw !== raw) return
  // To the end of its last line, trailing spaces and the line break with it;
  // the closing fence guarantees there is a break.
  const end = view.state.doc.lineAt(field.to).to + 1
  view.dispatch({ changes: { from: field.from, to: end }, userEvent: 'delete.frontmatter' })
}

function addField(view: EditorView, key: string): void {
  const read = readFrontMatter(view.state.doc.toString())
  if (!read || key.trim() === '') return
  const raw = writeKey(key)
  focusAfterAdd = raw
  view.dispatch({ changes: { from: read.closing, insert: `${raw}:\n` }, userEvent: 'input.frontmatter' })
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  made.className = className
  if (text !== undefined) made.textContent = text
  return made
}

/** The control a value is edited with. */
function control(view: EditorView, field: Field, index: number, locked: boolean): HTMLElement {
  const { value, raw } = field
  const write = (next: FieldValue) => writeValue(view, index, raw, next)

  switch (value.kind) {
    case 'boolean': {
      const box = element('input', 'cm-fm-check')
      box.type = 'checkbox'
      box.checked = value.value
      box.disabled = locked
      box.setAttribute('aria-label', field.key)
      box.addEventListener('change', () => write({ kind: 'boolean', value: box.checked }))
      return box
    }
    case 'date': {
      const input = element('input', 'cm-fm-input')
      input.type = 'date'
      input.value = value.value
      input.disabled = locked
      input.setAttribute('aria-label', field.key)
      input.addEventListener('change', () =>
        write(input.value === '' ? { kind: 'empty' } : { kind: 'date', value: input.value }),
      )
      return input
    }
    case 'list':
      return pills(view, field, index, locked)
    case 'complex': {
      // Shown, not edited: a structure the form would flatten if it tried.
      const code = element('code', 'cm-fm-complex', view.state.sliceDoc(field.from, field.to).split('\n').slice(1).join(' ').trim() || '…')
      code.title = 'Edit as YAML to change this field'
      return code
    }
    case 'text':
    case 'number':
    case 'empty': {
      const input = element('input', 'cm-fm-input')
      input.type = 'text'
      input.value = value.kind === 'empty' ? '' : value.value
      input.disabled = locked
      input.spellcheck = false
      input.setAttribute('aria-label', field.key)
      if (value.kind === 'number') input.inputMode = 'decimal'
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur()
      })
      input.addEventListener('change', () => {
        // Text stays text, in the quotes it had. A number or an empty field
        // takes the type of what was typed, the way YAML itself reads it.
        write(
          value.kind === 'text'
            ? input.value === ''
              ? { kind: 'empty' }
              : { kind: 'text', value: input.value, quote: value.quote }
            : valueFromTyping(input.value),
        )
      })
      if (focusAfterAdd === raw) {
        focusAfterAdd = null
        queueMicrotask(() => input.focus())
      }
      return input
    }
  }
}

/** A list, as pills: each with a way to remove it, and a box to add one. */
function pills(view: EditorView, field: Field, index: number, locked: boolean): HTMLElement {
  if (field.value.kind !== 'list') throw new Error('not a list')
  const list = field.value
  const box = element('div', 'cm-fm-pills')
  list.items.forEach((item, at) => {
    const pill = element('span', 'cm-fm-pill', item)
    if (!locked) {
      const remove = element('button', 'cm-fm-pill-remove', '×')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${item}`)
      remove.addEventListener('click', () =>
        writeValue(view, index, field.raw, { ...list, items: list.items.filter((_, i) => i !== at) }),
      )
      pill.append(remove)
    }
    box.append(pill)
  })
  if (!locked) {
    const add = element('input', 'cm-fm-pill-add')
    add.type = 'text'
    add.placeholder = 'add'
    add.spellcheck = false
    add.setAttribute('aria-label', `Add to ${field.key}`)
    add.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || add.value.trim() === '') return
      event.preventDefault()
      writeValue(view, index, field.raw, { ...list, items: [...list.items, add.value.trim()] })
    })
    if (focusAfterAdd === field.raw) {
      focusAfterAdd = null
      queueMicrotask(() => add.focus())
    }
    box.append(add)
  }
  return box
}

/** The fields as a form. */
class FrontMatterForm extends WidgetType {
  constructor(
    readonly fields: Field[],
    readonly locked: boolean,
  ) {
    super()
  }

  eq(other: FrontMatterForm) {
    return (
      other.locked === this.locked &&
      JSON.stringify(other.fields.map((f) => [f.raw, f.value])) ===
        JSON.stringify(this.fields.map((f) => [f.raw, f.value]))
    )
  }

  get estimatedHeight() {
    return 40 + this.fields.length * 30
  }

  toDOM(view: EditorView) {
    const form = element('div', 'cm-fm-form')
    form.setAttribute('role', 'group')
    form.setAttribute('aria-label', 'Front matter')

    const bar = element('div', 'cm-fm-bar')
    const fold = element('button', 'cm-fm-fold', 'Front matter')
    fold.type = 'button'
    fold.title = 'Fold the front matter'
    fold.addEventListener('click', () => view.dispatch({ effects: showFrontMatter.of('folded') }))
    const source = element('button', 'cm-fm-source', 'Edit as YAML')
    source.type = 'button'
    source.addEventListener('click', () => view.dispatch({ effects: showFrontMatter.of('source') }))
    bar.append(fold, source)
    form.append(bar)

    this.fields.forEach((field, index) => {
      const row = element('div', `cm-fm-row cm-fm-row--${field.value.kind}`)
      row.append(element('span', 'cm-fm-key', field.key), control(view, field, index, this.locked))
      if (!this.locked) {
        const remove = element('button', 'cm-fm-remove', '×')
        remove.type = 'button'
        remove.title = `Remove ${field.key}`
        remove.setAttribute('aria-label', `Remove ${field.key}`)
        remove.addEventListener('click', () => removeField(view, index, field.raw))
        row.append(remove)
      }
      form.append(row)
    })

    if (!this.locked) {
      const add = element('input', 'cm-fm-add')
      add.type = 'text'
      add.placeholder = 'Add a field'
      add.spellcheck = false
      add.setAttribute('aria-label', 'Add a field')
      add.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        addField(view, add.value)
      })
      form.append(add)
    }
    return form
  }

  // Everything inside the form is the form's: typing into a field must not
  // reach the editor's keymap, and a click must not move the caret.
  ignoreEvent() {
    return true
  }
}

/** The way back from the text to the form, at the end of the opening fence. */
class BackToForm extends WidgetType {
  eq() {
    return true
  }

  toDOM(view: EditorView) {
    const button = element('button', 'cm-fm-back', 'form')
    button.type = 'button'
    button.title = 'Edit the front matter as a form'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      // Out of the fields as well: a caret inside them keeps them as text.
      const end = frontMatterNode(view.state)?.to ?? 0
      view.dispatch({
        effects: showFrontMatter.of('form'),
        selection: { anchor: Math.min(end + 1, view.state.doc.length) },
      })
    })
    return button
  }

  ignoreEvent() {
    return true
  }
}

function frontMatterNode(state: EditorState): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null
  // Front matter is at the top by definition, so only the first node matters
  // and the whole tree need not be walked.
  syntaxTree(state).iterate({
    from: 0,
    to: Math.min(state.doc.length, 4096),
    enter: (node) => {
      if (found) return false
      if (node.name === 'FrontMatter') found = { from: node.from, to: node.to }
    },
  })
  // A long front matter runs past the first stretch of the tree the walk
  // looked at, and the node is still the first one.
  if (!found && state.doc.length > 4096) {
    const first = syntaxTree(state).topNode.firstChild
    if (first?.name === 'FrontMatter') found = { from: first.from, to: first.to }
  }
  return found
}

function build(state: EditorState): DecorationSet {
  const node = frontMatterNode(state)
  if (!node) return Decoration.none
  const mode = state.field(frontMatterMode)

  // A cursor inside it means it is being edited as text, and anything drawn
  // over it would hide the line under the caret.
  //
  // "Inside" has to exclude the very start of the document, though: a file
  // opens with the caret at position 0, which is inside the front matter by
  // any ordinary reading — so the fold would never happen on open, which is
  // the one moment it is for. A caret at 0 that nobody has moved is not
  // editing anything.
  const editing = state.selection.ranges.some(
    (range) => !(range.from === 0 && range.to === 0) && range.from <= node.to && range.to >= node.from,
  )

  const marks: Range<Decoration>[] = []
  if (mode === 'source' || editing) {
    const firstLine = state.doc.lineAt(node.from)
    if (!state.readOnly) {
      marks.push(Decoration.widget({ widget: new BackToForm(), side: 1 }).range(firstLine.to))
    }
    return Decoration.set(marks)
  }

  const text = state.doc.toString()
  const read = readFrontMatter(text)
  if (mode === 'folded' || !read) {
    marks.push(
      Decoration.replace({
        widget: new FrontMatterHeader(read?.fields.length ?? 0),
        block: true,
      }).range(node.from, node.to),
    )
  } else {
    marks.push(
      Decoration.replace({
        widget: new FrontMatterForm(read.fields, state.readOnly),
        block: true,
      }).range(node.from, node.to),
    )
  }
  return Decoration.set(marks, true)
}

export const frontMatterFold: Extension = [
  frontMatterMode,
  // `compute`, not `of(fn)`. The facet accepts a function, but a function is
  // called after the viewport is measured and therefore may not produce block
  // widgets or anything replacing a line break — which a fold is both of. Only
  // a set provided directly may affect the vertical layout, and `compute`
  // provides one.
  //
  // Front matter is at the top of the document, so it is always in the first
  // viewport and nothing is lost by not tracking visible ranges.
  // Reading mode locks the form, and says so through the read-only facet.
  EditorView.decorations.compute([frontMatterMode, 'doc', 'selection', EditorState.readOnly], build),
]

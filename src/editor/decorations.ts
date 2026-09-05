// Markup drawn over the source, never instead of it (ADR 0002).
//
// Three things happen here.
//
// Inline runs — headings, emphasis, code, links, highlights — get a class so
// CSS can style the *rendered* look. Their syntax markers (the hashes, the
// asterisks, the brackets) get hidden, but only on lines the cursor is not on:
// step onto a line and its markers come back, because the text is what you are
// editing and it must be visible to edit it.
//
// Blocks — list items, quotes, callouts, tables, code fences — get a class on
// the *line*, which is what lets a wrapped list item keep its hanging indent
// and a quote carry a rule down its left edge. A span cannot do either.
//
// And a task's `[ ]` is replaced by a real checkbox widget. Clicking it edits
// the document — `[ ]` becomes `[x]` — rather than toggling any view state:
// the text stays the truth, and undo puts it back.
import { syntaxTree } from '@codemirror/language'
import { type Range, type Extension, type EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'

/** Node names whose whole span gets a class. */
const STYLED: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-emphasis',
  InlineCode: 'cm-md-code',
  Strikethrough: 'cm-md-strike',
  Highlight: 'cm-md-highlight',
  Link: 'cm-md-link',
}

/** Node names that are pure syntax: hidden unless the cursor is on their line.
 *
 *  `URL` belongs here rather than among the styled nodes. Hiding the brackets
 *  but leaving the target visible turns `[the tracker](https://…)` into
 *  `the trackerhttps://…` on screen — worse than showing the markup, because it
 *  reads as text the author did not write.
 *
 *  `ListMark` is deliberately absent. A bullet is not noise to be hidden: it is
 *  what makes a list look like a list, so it is styled instead. */
const MARKERS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'HighlightMark',
  'LinkMark',
  'QuoteMark',
  'URL',
])

/** Node names that put a class on every line they cover. */
const BLOCK_LINES: Record<string, string> = {
  Blockquote: 'cm-md-quote-line',
  Table: 'cm-md-table-line',
  FencedCode: 'cm-md-code-line',
  CodeBlock: 'cm-md-code-line',
}

const hidden = Decoration.mark({ class: 'cm-md-marker-hidden' })
const listMark = Decoration.mark({ class: 'cm-md-list-mark' })
const horizontalRule = Decoration.mark({ class: 'cm-md-rule' })
const tableDelimiter = Decoration.mark({ class: 'cm-md-table-delimiter' })

/** The callout kinds Obsidian ships, each with its own colour. Anything else
 *  written as `> [!whatever]` still renders as a callout, in the default
 *  colour: a note should not lose its shape because scheda has not heard of
 *  that kind. */
const CALLOUT_KINDS = new Set([
  'note',
  'abstract',
  'summary',
  'tldr',
  'info',
  'todo',
  'tip',
  'hint',
  'important',
  'success',
  'check',
  'done',
  'question',
  'help',
  'faq',
  'warning',
  'caution',
  'attention',
  'failure',
  'fail',
  'missing',
  'danger',
  'error',
  'bug',
  'example',
  'quote',
  'cite',
])

/** `> [!note] Optional title` — the first line of an Obsidian callout. */
const CALLOUT_HEAD = /^\s*>\s*\[!([A-Za-z]+)\]([+-]?)/

/** A checkbox drawn in place of `[ ]` or `[x]`.
 *
 *  `eq` matters: without it CodeMirror replaces the widget's DOM on every
 *  redraw, which loses a click that is halfway through. */
class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  eq(other: TaskBox) {
    return other.checked === this.checked
  }

  toDOM() {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    // The document is edited by the click handler below, not by the browser
    // toggling its own state: if the edit fails, the box must not look changed.
    box.addEventListener('mousedown', (event) => event.preventDefault())
    return box
  }

  ignoreEvent() {
    return false
  }
}

/** Toggles the `[ ]`/`[x]` at `pos` in the document. */
export function toggleTask(view: EditorView, pos: number): boolean {
  const marker = view.state.doc.sliceString(pos, pos + 3)
  if (!/^\[[ xX]\]$/.test(marker)) return false
  view.dispatch({
    changes: { from: pos, to: pos + 3, insert: marker[1] === ' ' ? '[x]' : '[ ]' },
  })
  return true
}

/** The lines a node covers, as line numbers. */
function linesOf(state: EditorState, from: number, to: number): number[] {
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  const numbers = []
  for (let n = first; n <= last; n++) numbers.push(n)
  return numbers
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const marks: Range<Decoration>[] = []
  const lineClasses = new Map<number, Set<string>>()

  const addLineClass = (line: number, cls: string) => {
    const classes = lineClasses.get(line)
    if (classes) classes.add(cls)
    else lineClasses.set(line, new Set([cls]))
  }

  // Lines holding a cursor or a selection edge keep their markers visible.
  const activeLines = new Set<number>()
  for (const range of state.selection.ranges) {
    activeLines.add(state.doc.lineAt(range.head).number)
    activeLines.add(state.doc.lineAt(range.anchor).number)
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.to === node.from) return

        const block = BLOCK_LINES[node.name]
        if (block) {
          for (const line of linesOf(state, node.from, node.to)) addLineClass(line, block)
          // A quote may be a callout; the first line says which.
          if (node.name === 'Blockquote') markCallout(state, node.from, node.to, addLineClass)
          return
        }

        if (node.name === 'ListItem') {
          for (const line of linesOf(state, node.from, node.to)) addLineClass(line, 'cm-md-list-line')
          return
        }

        if (node.name === 'ListMark') {
          marks.push(listMark.range(node.from, node.to))
          return
        }

        if (node.name === 'HorizontalRule') {
          marks.push(horizontalRule.range(node.from, node.to))
          addLineClass(state.doc.lineAt(node.from).number, 'cm-md-rule-line')
          return
        }

        if (node.name === 'TableDelimiter') {
          marks.push(tableDelimiter.range(node.from, node.to))
          return
        }

        if (node.name === 'TaskMarker') {
          const checked = state.doc.sliceString(node.from, node.to).toLowerCase() === '[x]'
          // On the line being edited the source shows, the way every other
          // marker does — otherwise the brackets cannot be typed into.
          if (activeLines.has(state.doc.lineAt(node.from).number)) return
          marks.push(
            Decoration.replace({ widget: new TaskBox(checked) }).range(node.from, node.to),
          )
          return
        }

        const styled = STYLED[node.name]
        if (styled) {
          marks.push(Decoration.mark({ class: styled }).range(node.from, node.to))
          return
        }

        if (!MARKERS.has(node.name)) return
        if (activeLines.has(state.doc.lineAt(node.from).number)) return
        marks.push(hidden.range(node.from, node.to))
      },
    })
  }

  // Line decorations start at the line's first position, and CodeMirror wants
  // them before any span starting there.
  for (const [line, classes] of lineClasses) {
    const at = state.doc.line(line).from
    for (const cls of classes) marks.push(Decoration.line({ class: cls }).range(at))
  }

  // A DecorationSet has to be sorted by position; the tree walk yields parents
  // before children, and the line decorations were added last of all.
  marks.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  return Decoration.set(marks, true)
}

/** Adds the callout classes to a blockquote that opens with `> [!kind]`. */
function markCallout(
  state: EditorState,
  from: number,
  to: number,
  addLineClass: (line: number, cls: string) => void,
) {
  const firstLine = state.doc.lineAt(from)
  const match = CALLOUT_HEAD.exec(firstLine.text)
  if (!match) return

  const kind = match[1].toLowerCase()
  const cls = CALLOUT_KINDS.has(kind) ? `cm-md-callout-${kind}` : 'cm-md-callout-note'
  for (const line of linesOf(state, from, to)) addLineClass(line, cls)
  addLineClass(firstLine.number, 'cm-md-callout')
  addLineClass(firstLine.number, 'cm-md-callout-head')
}

export const markdownDecorations: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = build(view)
      }

      update(update: ViewUpdate) {
        // Selection matters as much as content here: moving the cursor onto a
        // line is what brings that line's markers back.
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = build(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  // Clicking a checkbox edits the document. Registered as a DOM handler rather
  // than inside the widget so the position is resolved against the live state.
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null
      if (!target?.classList.contains('cm-md-task')) return false
      const pos = view.posAtDOM(target)
      return toggleTask(view, pos)
    },
  }),
]

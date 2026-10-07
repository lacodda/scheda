// The editor's extension list, assembled by hand.
//
// `basic-setup` is not used: it pulls in autocompletion, lint gutters and a
// fold service the notepad has no use for, and every one of them is code parsed
// before the first character reaches the screen. What is here was added one
// piece at a time, each because something needed it.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { codeFolding, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view'
import { wikilinkCompletion } from './complete.js'
import { markdownDecorations } from './decorations.js'
import { bracketClosing, smartEditKeymap } from './edits.js'
import { focusMode } from './focus.js'
import { frontMatterFold } from './frontmatter.js'
import { schedaHighlightStyle } from './highlight.js'
import { documentPath, editorHost, type EditorHost } from './host.js'
import { markdownImages } from './images.js'
import { imagePaste } from './paste.js'
import { linkPeek } from './peek.js'
import { mermaidDiagrams } from './mermaid.js'
import { reading } from './reading.js'
import { schedaMarkdown } from './markdown.js'
import { spelling } from './spelling.js'
import { tableKeymap } from './table-edit.js'
import { tableAlignment } from './tables.js'
import { schedaTheme } from './theme.js'
import { wikilinkDecorations } from './wikilinks.js'

export interface SchedaEditorOptions {
  /** What the editor may ask of the program around it. Without one it draws
   *  markdown and asks nothing: pictures stay their links and `[[links]]` stay
   *  their text. */
  host?: EditorHost
  /** Whether typing an opening bracket or quote types its partner too. Changed
   *  later with `setBracketClosing`. */
  closeBrackets?: boolean
}

/** Everything the editor is, as one extension list for an `EditorState`. */
export function schedaEditor(options: SchedaEditorOptions = {}): Extension[] {
  const host = options.host ?? {}
  return [
    editorHost.of(host),
    // Always present, path or not: every part that asks the host reads it, and
    // a document without one is the ordinary case of a buffer never saved.
    documentPath,
    // Off unless the settings say otherwise, and in a compartment so the answer
    // can change without rebuilding the editor.
    bracketClosing(options.closeBrackets ?? false),
    // Folding a section. No gutter: an arrow column would take a strip beside
    // every line for a thing used now and then, and this is a notepad. The
    // ranges come from the markdown parser, which already knows a heading owns
    // everything under it until the next one of its level (decision
    // 2026-09-05).
    codeFolding({
      placeholderText: '⋯',
    }),
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    schedaMarkdown(),
    // Without this the grammars parse and nothing shows: tags are assigned and
    // no class ever reaches the DOM.
    syntaxHighlighting(schedaHighlightStyle),
    markdownDecorations,
    // Links between notes, only when there are notes behind them: without a
    // vault `[[plan]]` is the text it is, and drawing it as a link would be a
    // link that leads nowhere.
    host.notes
      ? [
          // After the markdown decorations: both draw over the same text, and a
          // wikilink is one construction rather than markers to hide, so it
          // replaces its own span outright.
          wikilinkDecorations,
          // The card that appears on a hovered link. A view plugin with no
          // decorations of its own, so its place in the list is about nothing
          // but reading order.
          linkPeek,
          // Offering a note while `[[` is being typed. After the decorations,
          // before the keymap: the panel takes Enter and the arrows only while
          // it is open, and `autocompletion` puts its own high-precedence
          // keymap in for that.
          wikilinkCompletion,
        ]
      : [],
    tableAlignment,
    // Pictures, only when something can turn a link into a URL. Without that
    // the line stays the markdown it is.
    host.assets ? markdownImages : [],
    // A screenshot pasted into a note becomes a file and a link in the text.
    // Before the keymap: this is a DOM event handler, and the two do not
    // compete.
    host.assets?.paste ? imagePaste : [],
    frontMatterFold,
    reading,
    // After reading mode, whose state it reads: a diagram replaces its block
    // only while the note is being read.
    mermaidDiagrams,
    // The section being written in full colour and the rest faded, when the
    // window is in focus mode. Line classes only, so its place in the list is
    // about reading order.
    focusMode,
    // The system spell checker, off unless the settings turn it on, and the
    // note's language for it either way.
    spelling,
    // The panel sits at the top: at the bottom it would cover the status bar,
    // and the line being searched for is more often near the start.
    search({ top: true }),
    highlightSelectionMatches(),
    schedaTheme,
    // Search bindings first: `Ctrl+F` and `Escape` have defaults in the base
    // keymap that would otherwise win.
    // Reading mode, focus mode and folding are commands of the window rather
    // than keys of the editor: they are in the command palette and their keys
    // can be changed, so they live in `src/commands.ts` with the rest. What is
    // left here is typing — the keys whose meaning depends on where in the
    // text the caret is.
    keymap.of([
      // Markdown's own edits first. Not because the base bindings would win —
      // a mutation moving these after the defaults changed nothing, since the
      // base commands decline and the queue reaches ours anyway — but because
      // reading the list in the order it is consulted is how the next person
      // works out which binding handles a key.
      // Inside a table, Tab and Enter move between cells and add rows; the
      // commands decline everywhere else and the list bindings get the key.
      ...tableKeymap,
      ...smartEditKeymap,
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
  ]
}

// The editor's extension list, assembled by hand.
//
// `basic-setup` is not used: it pulls in autocompletion, lint gutters and a
// fold service the notepad has no use for, and every one of them is code parsed
// before the first character reaches the screen. What is here was added one
// piece at a time, each because something needed it.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { codeFolding, foldAll, foldCode, syntaxHighlighting, unfoldAll, unfoldCode } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view'
import { wikilinkCompletion } from './complete'
import { markdownDecorations } from './decorations'
import { bracketClosing, smartEditKeymap } from './edits'
import { frontMatterFold } from './frontmatter'
import { schedaHighlightStyle } from './highlight'
import { markdownImages } from './images'
import { imagePaste } from './paste'
import { linkPeek } from './peek'
import { reading, toggleReading } from './reading'
import { schedaMarkdown } from './markdown'
import { tableAlignment } from './tables'
import { schedaTheme } from './theme'
import { wikilinkDecorations } from './wikilinks'

export function schedaSetup(options: { closeBrackets?: boolean } = {}): Extension[] {
  return [
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
    // After the markdown decorations: both draw over the same text, and a
    // wikilink is one construction rather than markers to hide, so it replaces
    // its own span outright.
    wikilinkDecorations,
    // The card that appears on a hovered link. A view plugin with no decorations
    // of its own, so its place in the list is about nothing but reading order.
    linkPeek,
    // Offering a note while `[[` is being typed. After the decorations, before
    // the keymap: the panel takes Enter and the arrows only while it is open, and
    // `autocompletion` puts its own high-precedence keymap in for that.
    wikilinkCompletion,
    tableAlignment,
    markdownImages,
    // A screenshot pasted into a note becomes a file in the vault's attachment
    // folder and a link in the text. Before the keymap: this is a DOM event
    // handler, and the two do not compete.
    imagePaste,
    frontMatterFold,
    reading,
    // The panel sits at the top: at the bottom it would cover the status bar,
    // and the line being searched for is more often near the start.
    search({ top: true }),
    highlightSelectionMatches(),
    schedaTheme,
    // Search bindings first: `Ctrl+F` and `Escape` have defaults in the base
    // keymap that would otherwise win.
    keymap.of([
      // Reading mode. Before the defaults: `Ctrl+E` is "move to line end" in
      // the base keymap, and Obsidian's binding is the one a reader expects.
      // Folding, on the keys editors have used for it since long before this
      // one. `Ctrl+Shift+[` and `]` are what CodeMirror's own fold keymap uses;
      // the alternates are what a hand reaches for.
      { key: 'Mod-Shift-[', run: foldCode },
      { key: 'Mod-Shift-]', run: unfoldCode },
      { key: 'Mod-Alt-[', run: foldAll },
      { key: 'Mod-Alt-]', run: unfoldAll },
      // Markdown's own edits first. Not because the base bindings would win —
      // a mutation moving these after the defaults changed nothing, since the
      // base commands decline and the queue reaches ours anyway — but because
      // reading the list in the order it is consulted is how the next person
      // works out which binding handles a key.
      ...smartEditKeymap,
      {
        key: 'Mod-e',
        run: (view) => {
          view.dispatch({ effects: toggleReading.of() })
          return true
        },
      },
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
  ]
}

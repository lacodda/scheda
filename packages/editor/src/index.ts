// scheda's markdown editor, for CodeMirror 6.
//
// One call gives an `EditorState` everything the editor is: the markdown
// dialect, the decorations drawn over the source, tables, tasks, callouts,
// folding, reading mode, focus mode and the front matter form. What needs the
// world outside the text — pictures, links between notes, following a link —
// is asked of a host the program passes in.
//
// Everything exported here is the package's surface; the rest of the files are
// how it is built and may change between any two versions.

export { schedaEditor, type SchedaEditorOptions } from './setup.js'

export {
  documentPath,
  setDocumentPath,
  type AssetHost,
  type EditorHost,
  type FollowLink,
  type LinkTarget,
  type NoteHost,
  type NotePeek,
  type NoteSuggestion,
  type PastedPicture,
} from './host.js'
export { forgetDocument, forgetNotes } from './forget.js'

// The colours the editor reads, as `--editor-<name>` custom properties.
export { TOKENS as editorTokens, type Token as EditorToken } from './tokens.js'

// Settings that change while the editor is open.
export { setBracketClosing } from './edits.js'
export { setSpelling } from './spelling.js'

// Modes of the view.
export { readingMode, toggleReading } from './reading.js'
export { isFocusing, setFocusing, toggleFocus } from './focus.js'

// The document's structure.
export { outlineOf, type Heading } from './outline.js'
export { moveSection } from './sections.js'
export { blocks, type Block } from './insert.js'
export { WORDS_PER_MINUTE, bodyWords, countWords, readingMinutes } from './words.js'

// A note as a page of its own, for printing and export.
export { renderPage, resourcesOf, type Resources } from './html.js'
export { draw as drawDiagram } from './mermaid.js'
export { relativeFrom } from './wikilinks.js'

// The markdown dialect scheda reads.
//
// `markdownLanguage` is the GitHub-flavoured base: task lists, tables and
// strikethrough come with it, so GFM is not listed again here — a mutation test
// caught the duplicate by removing it and changing nothing.
//
// What is added is Obsidian's `==highlight==`, which is in no standard, and the
// grammars for fenced code below.
//
// Nothing in this file changes the document. A dialect is what the parser
// *recognises*; the bytes on disk are the same either way (ADR 0002).
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageDescription } from '@codemirror/language'
import { type Extension } from '@codemirror/state'
import { type MarkdownConfig } from '@lezer/markdown'

/** The pair the parser matches an opening `==` against; one shared object,
 *  because the closing delimiter is found by identity, not by shape. */
const HighlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' }

/** `==highlighted==`, the way Obsidian writes it.
 *
 *  Written as a delimiter rather than a regular expression so it nests and
 *  closes the way every other inline mark does: `==a **b** c==` keeps the bold
 *  inside it, and an unclosed `==` stays plain text instead of highlighting the
 *  rest of the note. */
const Highlight: MarkdownConfig = {
  // No `style` here: the look comes from the decoration layer's own classes,
  // which is where every other markup class lives.
  defineNodes: [{ name: 'Highlight' }, { name: 'HighlightMark' }],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        // `=` twice, and only twice: `=== a heading underline` is not this.
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61) return -1
        return cx.addDelimiter(HighlightDelimiter, pos, pos + 2, true, true)
      },
      after: 'Emphasis',
    },
  ],
}


/** YAML front matter: a `---` fence at the very top of the file.
 *
 *  Without this the parser reads the opening `---` as a horizontal rule and the
 *  fields under it as a setext heading, so a note with front matter opens with
 *  a line and a giant bold `title:` — markup the author did not write.
 *
 *  A block parser rather than a delimiter, because it is only front matter at
 *  the very start of the document: `---` in the middle of a note stays the
 *  horizontal rule it is.
 */
const FrontMatter: MarkdownConfig = {
  defineNodes: [
    { name: 'FrontMatter', block: true },
    { name: 'FrontMatterMark' },
  ],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        // Only at the top, and only for a bare `---`.
        if (cx.lineStart !== 0 || line.text.trim() !== '---') return false

        const start = cx.lineStart
        const marks = [cx.elt('FrontMatterMark', start, start + 3)]
        while (cx.nextLine()) {
          if (line.text.trim() === '---') {
            const end = cx.lineStart + line.text.length
            marks.push(cx.elt('FrontMatterMark', cx.lineStart, cx.lineStart + 3))
            cx.addElement(cx.elt('FrontMatter', start, end, marks))
            cx.nextLine()
            return true
          }
        }
        // Unterminated: not front matter, so give the lines back rather than
        // swallowing the whole note.
        return false
      },
    },
  ],
}

/** The language support for a markdown document, dialect and all. */
export function schedaMarkdown(): Extension {
  return markdown({
    base: markdownLanguage,
    extensions: [Highlight, FrontMatter],
    // Fenced code is highlighted by `codeLanguages`, resolved lazily so no
    // grammar is parsed before it is on screen (ADR 0001).
    codeLanguages: loadCodeLanguage,
  })
}

/** Grammars for fenced blocks, by the name written after the backticks.
 *
 *  A handful rather than everything: these are the languages that turn up in
 *  notes. An unknown language is not an error — the block still gets its
 *  background and its monospace, it just is not coloured (decision 2026-09-05).
 *
 *  Each is a `LanguageDescription` whose `load` is a dynamic import, so Rust,
 *  Python, SQL and JSON are fetched only when a block asks for one, after the
 *  text is on screen (ADR 0001).
 *
 *  HTML, CSS and JavaScript are the exception, and not by choice:
 *  `@codemirror/lang-markdown` imports `lang-html` outright — it highlights
 *  embedded HTML — and `lang-html` imports the other two. They are in the
 *  bundle whether or not they are listed here, which the build says out loud
 *  as INEFFECTIVE_DYNAMIC_IMPORT. Listing them costs nothing extra and dropping
 *  them would save nothing.
 */
const CODE_LANGUAGES = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'mjs', 'cjs', 'node', 'jsx'],
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: 'rust',
    alias: ['rs'],
    load: async () => (await import('@codemirror/lang-rust')).rust(),
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py', 'python3'],
    load: async () => (await import('@codemirror/lang-python')).python(),
  }),
  LanguageDescription.of({
    name: 'json',
    alias: ['json5', 'jsonc'],
    load: async () => (await import('@codemirror/lang-json')).json(),
  }),
  LanguageDescription.of({
    name: 'css',
    load: async () => (await import('@codemirror/lang-css')).css(),
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm'],
    load: async () => (await import('@codemirror/lang-html')).html(),
  }),
  LanguageDescription.of({
    name: 'sql',
    alias: ['postgres', 'postgresql', 'psql', 'mysql', 'sqlite'],
    load: async () => (await import('@codemirror/lang-sql')).sql(),
  }),
]

/** Resolves the word after the backticks to a grammar, or null for "leave it as
 *  plain text". A fence can carry more than a name — ```js title="x" is common
 *  — so only the first word is looked up. */
export function loadCodeLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!name) return null
  return LanguageDescription.matchLanguageName(CODE_LANGUAGES, name, true)
}

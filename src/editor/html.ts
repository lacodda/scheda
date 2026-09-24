// A note as an HTML page: for printing it, and for writing it out as one file.
//
// Rendered from the same syntax tree the editor draws from, so the page and the
// window agree about what is a heading, what is code and where a table's cells
// are — there is no second markdown parser that could read the note
// differently. What the page shows is what reading mode shows: the markers
// gone, the front matter left out, a diagram drawn as its picture.
//
// Everything written into the page is escaped. HTML typed into a note appears
// as the text it is rather than running: a page made from a note downloaded
// from somewhere must not carry that somewhere's script along with it.
import { type EditorState } from '@codemirror/state'
import { fullTree } from './parsed'
import { languageOf as noteLanguage } from './spelling'

/** A node of the tree, named through the tree's own type: `@lezer/common` is a
 *  transitive dependency, and importing it by name would mean pinning it. */
type SyntaxNode = ReturnType<ReturnType<typeof fullTree>['resolveInner']>

/** What the page needs from outside the text: pictures and diagrams, already
 *  turned into something a page can hold. */
export interface Resources {
  /** A picture's `src`, by the link as written — or absent to show its text. */
  images: Map<string, string>
  /** A diagram's SVG, by its source — or absent to show the code. */
  diagrams: Map<string, string>
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Only links a page can follow safely: the web, mail, and in-page anchors. */
function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (/^(https?:|mailto:|#)/i.test(trimmed)) return trimmed
  // A relative link is a note or a file beside it; in a page on its own it
  // leads nowhere, so it is shown as text rather than as a dead link.
  return null
}

/** Marks that are syntax, not text: never on the page. */
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'LinkMark',
  'HighlightMark',
  'StrikethroughMark',
  'TaskMarker',
  'WikiMark',
  'FrontMatterMark',
])

interface Context {
  state: EditorState
  resources: Resources
}

/** The picture names a wikilink embed can show. */
const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i

/** The links of every picture and every diagram source in a note — what has to
 *  be resolved before the page can be written. */
export function resourcesOf(state: EditorState): { images: string[]; wikiImages: string[]; diagrams: string[] } {
  const images: string[] = []
  const wikiImages: string[] = []
  const diagrams: string[] = []
  fullTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Image') {
        const url = node.node.getChild('URL')
        if (url) images.push(state.sliceDoc(url.from, url.to))
      } else if (node.name === 'WikiEmbed') {
        const target = node.node.getChild('WikiTarget')
        const text = target ? state.sliceDoc(target.from, target.to) : ''
        if (PICTURE.test(text)) wikiImages.push(text)
      } else if (node.name === 'FencedCode' && languageOf(state, node.node) === 'mermaid') {
        diagrams.push(codeOf(state, node.node))
        return false
      }
    },
  })
  return { images, wikiImages, diagrams }
}

function languageOf(state: EditorState, node: SyntaxNode): string {
  const info = node.getChild('CodeInfo')
  return info ? state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() : ''
}

function codeOf(state: EditorState, node: SyntaxNode): string {
  const text = node.getChild('CodeText')
  return text ? state.sliceDoc(text.from, text.to) : ''
}

/** The inline content of a node between `from` and `to`: its text, with its
 *  children rendered in place and its markers left out. */
function inline(cx: Context, node: SyntaxNode, from = node.from, to = node.to): string {
  let out = ''
  let at = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue
    if (child.from > at) out += escapeHtml(cx.state.sliceDoc(at, child.from))
    out += inlineNode(cx, child)
    at = Math.max(at, child.to)
  }
  if (at < to) out += escapeHtml(cx.state.sliceDoc(at, to))
  return out
}

/** The text between the first two `[` `]` marks of a link or an image. */
function labelRange(node: SyntaxNode): { from: number; to: number } | null {
  const marks = node.getChildren('LinkMark')
  if (marks.length < 2) return null
  return { from: marks[0].to, to: marks[1].from }
}

function inlineNode(cx: Context, node: SyntaxNode): string {
  const { state } = cx
  const text = () => state.sliceDoc(node.from, node.to)
  if (MARKS.has(node.name)) return ''
  switch (node.name) {
    case 'Emphasis':
      return `<em>${inline(cx, node)}</em>`
    case 'StrongEmphasis':
      return `<strong>${inline(cx, node)}</strong>`
    case 'Strikethrough':
      return `<del>${inline(cx, node)}</del>`
    case 'Highlight':
      return `<mark>${inline(cx, node)}</mark>`
    case 'InlineCode': {
      const marks = node.getChildren('CodeMark')
      const from = marks[0]?.to ?? node.from
      const to = marks[1]?.from ?? node.to
      let code = state.sliceDoc(from, to)
      // Inside a table cell `\|` is how a pipe gets into code at all, and GFM
      // shows it as the pipe it stands for.
      if (node.parent?.name === 'TableCell') code = code.replace(/\\\|/g, '|')
      return `<code>${escapeHtml(code)}</code>`
    }
    case 'Link': {
      const label = labelRange(node)
      const url = node.getChild('URL')
      const shown = label ? inline(cx, node, label.from, label.to) : escapeHtml(text())
      const href = url ? safeHref(state.sliceDoc(url.from, url.to)) : null
      return href ? `<a href="${escapeHtml(href)}">${shown}</a>` : shown
    }
    case 'Image': {
      const label = labelRange(node)
      const alt = label ? state.sliceDoc(label.from, label.to) : ''
      const url = node.getChild('URL')
      const src = url ? cx.resources.images.get(state.sliceDoc(url.from, url.to)) : undefined
      return src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`
        : `<span class="missing-image">${escapeHtml(alt || text())}</span>`
    }
    case 'Autolink':
    case 'URL': {
      const url = node.name === 'Autolink' ? node.getChild('URL') : node
      const href = url ? state.sliceDoc(url.from, url.to) : ''
      const safe = safeHref(href) ?? (/^www\./i.test(href) ? `https://${href}` : null)
      return safe ? `<a href="${escapeHtml(safe)}">${escapeHtml(href)}</a>` : escapeHtml(href)
    }
    case 'Escape':
      return escapeHtml(text().slice(1))
    case 'Entity':
      // Already HTML, and nothing but a character: `&amp;`, `&#8212;`.
      return /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);$/i.test(text()) ? text() : escapeHtml(text())
    case 'HardBreak':
      return '<br>'
    case 'Comment':
      return ''
    case 'Wikilink': {
      const alias = node.getChild('WikiAlias')
      const target = node.getChild('WikiTarget')
      const shown = alias
        ? state.sliceDoc(alias.from, alias.to)
        : target
          ? state.sliceDoc(target.from, target.to).replace(/#\^?/, ' › ')
          : ''
      return `<span class="wikilink">${escapeHtml(shown)}</span>`
    }
    case 'WikiEmbed': {
      const target = node.getChild('WikiTarget')
      const name = target ? state.sliceDoc(target.from, target.to) : ''
      const src = cx.resources.images.get(`[[${name}]]`)
      return src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}">`
        : `<span class="wikilink">${escapeHtml(name)}</span>`
    }
    default:
      return inline(cx, node)
  }
}

const HEADING = /^(ATX|Setext)Heading(\d)$/

/** A table's column alignments, from its row of dashes. */
function alignments(cx: Context, table: SyntaxNode): (string | null)[] {
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'TableDelimiter' || child.to - child.from <= 1) continue
    return cx.state
      .sliceDoc(child.from, child.to)
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => {
        const trimmed = cell.trim()
        const left = trimmed.startsWith(':')
        const right = trimmed.endsWith(':')
        return left && right ? 'center' : right ? 'right' : left ? 'left' : null
      })
  }
  return []
}

function tableRow(cx: Context, row: SyntaxNode, tag: 'th' | 'td', align: (string | null)[]): string {
  let cells = ''
  let index = 0
  for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
    if (cell.name !== 'TableCell') continue
    const style = align[index] ? ` style="text-align:${align[index]}"` : ''
    cells += `<${tag}${style}>${inline(cx, cell).trim()}</${tag}>`
    index++
  }
  return `<tr>${cells}</tr>`
}

function blocks(cx: Context, node: SyntaxNode): string {
  let out = ''
  for (let child = node.firstChild; child; child = child.nextSibling) out += block(cx, child)
  return out
}

/** A callout's kind and title, when a quote opens with `[!kind]`. */
const CALLOUT = /^\[!([\w-]+)\][+-]?[ \t]*(.*)$/

function block(cx: Context, node: SyntaxNode): string {
  const { state } = cx
  const heading = HEADING.exec(node.name)
  if (heading) return `<h${heading[2]}>${inline(cx, node).trim()}</h${heading[2]}>\n`

  switch (node.name) {
    case 'FrontMatter':
    case 'LinkReference':
    case 'CommentBlock':
      return ''
    case 'Paragraph':
      return `<p>${inline(cx, node).trim()}</p>\n`
    case 'HorizontalRule':
      return '<hr>\n'
    case 'FencedCode': {
      const language = languageOf(state, node)
      const code = codeOf(state, node)
      const svg = language === 'mermaid' ? cx.resources.diagrams.get(code) : undefined
      if (svg) return `<figure class="diagram">${svg}</figure>\n`
      const attr = language ? ` class="language-${escapeHtml(language)}"` : ''
      return `<pre><code${attr}>${escapeHtml(code)}</code></pre>\n`
    }
    case 'CodeBlock': {
      const lines = state
        .sliceDoc(node.from, node.to)
        .split('\n')
        .map((line) => line.replace(/^( {4}|\t)/, ''))
      return `<pre><code>${escapeHtml(lines.join('\n'))}</code></pre>\n`
    }
    case 'Blockquote': {
      const first = node.getChild('Paragraph')
      const opening = first ? state.sliceDoc(first.from, first.to).split('\n')[0] : ''
      const callout = CALLOUT.exec(opening)
      if (callout && first) {
        const kind = callout[1].toLowerCase()
        const title = callout[2] || kind.charAt(0).toUpperCase() + kind.slice(1)
        // The rest of the first paragraph, after the `[!kind]` line.
        const rest = state.doc.lineAt(first.from).to
        let body = rest < first.to ? `<p>${inline(cx, first, rest + 1, first.to).trim()}</p>\n` : ''
        for (let child = first.nextSibling; child; child = child.nextSibling) body += block(cx, child)
        return `<div class="callout callout-${escapeHtml(kind)}"><p class="callout-title">${escapeHtml(title)}</p>\n${body}</div>\n`
      }
      return `<blockquote>\n${blocks(cx, node)}</blockquote>\n`
    }
    case 'BulletList':
      return `<ul>\n${blocks(cx, node)}</ul>\n`
    case 'OrderedList': {
      const mark = node.firstChild?.getChild('ListMark')
      const start = mark ? parseInt(state.sliceDoc(mark.from, mark.to), 10) : 1
      return `<ol${start !== 1 && !Number.isNaN(start) ? ` start="${start}"` : ''}>\n${blocks(cx, node)}</ol>\n`
    }
    case 'ListItem': {
      const task = node.getChild('Task')
      if (task) {
        const marker = task.getChild('TaskMarker')
        const done = marker ? /\[[xX]\]/.test(state.sliceDoc(marker.from, marker.to)) : false
        let rest = ''
        for (let child = task.nextSibling; child; child = child.nextSibling) rest += block(cx, child)
        return `<li class="task"><input type="checkbox" disabled${done ? ' checked' : ''}> ${inline(cx, task).trim()}${rest}</li>\n`
      }
      return `<li>${blocks(cx, node)}</li>\n`
    }
    case 'Task':
      return inline(cx, node)
    case 'Table': {
      const align = alignments(cx, node)
      let head = ''
      let body = ''
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'TableHeader') head += tableRow(cx, child, 'th', align)
        else if (child.name === 'TableRow') body += tableRow(cx, child, 'td', align)
      }
      return `<table>\n<thead>${head}</thead>\n<tbody>${body}</tbody>\n</table>\n`
    }
    case 'HTMLBlock':
    case 'ProcessingInstructionBlock':
      return `<pre class="source">${escapeHtml(state.sliceDoc(node.from, node.to))}</pre>\n`
    default:
      // Anything the list above does not name is shown as its text, never
      // dropped: a page that loses a paragraph is worse than one that shows
      // its markup.
      return node.firstChild ? blocks(cx, node) : `<p>${escapeHtml(state.sliceDoc(node.from, node.to))}</p>\n`
  }
}

/** The page's own look: the window's light theme, set for paper. */
const STYLE = `
:root { color-scheme: light; }
body { margin: 0 auto; padding: 2.5rem 1.5rem; max-width: 46rem; color: #24211e; background: #fdfcfa;
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1, h2, h3, h4, h5, h6 { color: #16130f; line-height: 1.25; margin: 1.6em 0 0.5em; }
h1 { font-size: 1.9em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
p, ul, ol, pre, table, blockquote, figure, .callout { margin: 0 0 1em; }
a { color: #a8452a; }
code, pre { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 0.9em; }
code { padding: 0.05em 0.3em; border-radius: 3px; background: #f0ebe5; color: #a8452a; }
pre { padding: 0.8em 1em; overflow-x: auto; border-radius: 5px; background: #f0ebe5; }
pre code { padding: 0; background: none; color: inherit; }
blockquote { padding: 0 1em; border-left: 3px solid #d8cec2; color: #6a635b; }
mark { background: #fbe6a8; color: #3d3527; }
li > p { margin: 0; }
li.task { list-style: none; margin-left: -1.3em; }
table { border-collapse: collapse; }
th, td { padding: 0.35em 0.7em; border: 1px solid #e5ded6; vertical-align: top; }
th { background: #f5f1ec; text-align: left; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #e5ded6; margin: 2em 0; }
.wikilink { color: #a8452a; }
.missing-image { color: #8a8279; font-style: italic; }
.callout { padding: 0.6em 1em; border-left: 3px solid #3b82c4; background: #3b82c40f; }
.callout-title { margin: 0 0 0.4em; font-weight: 600; }
.diagram { text-align: center; }
.diagram svg { max-width: 100%; height: auto; }
pre.source { white-space: pre-wrap; }
@media print {
  body { padding: 0; max-width: none; background: none; }
  a { color: inherit; }
  pre, table, figure, img, .callout { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
}
`

/** The whole page. */
export function renderPage(state: EditorState, title: string, resources: Resources): string {
  const body = blocks({ state, resources }, fullTree(state).topNode)
  return `<!doctype html>
<html lang="${noteLanguage(state.doc)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="scheda">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}</body>
</html>
`
}

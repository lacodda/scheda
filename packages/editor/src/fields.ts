// The fields of a note's front matter, read and written in place.
//
// The same narrow dialect the core reads (`src-tauri/src/frontmatter.rs`):
// `key: value`, `key: [a, b]`, and a key followed by a block of `- item` lines.
// Anything else — a nested map, a `|` block, a line the dialect has no name
// for — is reported as `complex` and left for the person to edit as text. A
// form that half-understood YAML would write it back half-right.
//
// Writing is surgical. Changing one field replaces that field's own lines and
// nothing else, so the key order, the comments, the blank lines and every
// field the form did not touch stay byte for byte what they were (ADR 0002).
//
// Positions are in the editor's text, where every line break is `\n`: the file's
// own endings are the core's to replay on save.

/** A value, as the form shows it. */
export type FieldValue =
  | { kind: 'text'; value: string; quote: '"' | "'" | '' }
  | { kind: 'number'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'list'; items: string[]; style: 'flow' | 'block'; indent: string }
  | { kind: 'empty' }
  | { kind: 'complex' }

export interface Field {
  /** The key as written, quotes and all. */
  raw: string
  /** The key as a reader sees it. */
  key: string
  value: FieldValue
  /** Where the field's first line starts. */
  from: number
  /** Where its last line ends, before the line break. */
  to: number
  /** A list's items as written, by what they say: an item the form did not
   *  touch is written back in its own quotes rather than the form's. */
  written: Map<string, string>
}

export interface FrontMatter {
  fields: Field[]
  /** Where the closing fence's line starts — the place a new field goes. */
  closing: number
}

/** Where the body starts: after the closing `---`, or 0 when there is no front
 *  matter. The same rule as `frontmatter::end` in the core. */
export function frontMatterEnd(text: string): number {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return 0
  let at = text.indexOf('\n') + 1
  while (at < text.length) {
    const next = text.indexOf('\n', at)
    const lineEnd = next === -1 ? text.length : next + 1
    if (text.slice(at, lineEnd).trimEnd() === '---') return lineEnd
    at = lineEnd
  }
  // Unterminated front matter is not front matter.
  return 0
}

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const BOOLEAN = /^(true|false)$/i
const NULL = /^(null|~)$/i

/** What an unquoted scalar is, by its look — the way YAML itself decides. */
function scalar(text: string): FieldValue {
  if (text === '') return { kind: 'empty' }
  if (BOOLEAN.test(text)) return { kind: 'boolean', value: text.toLowerCase() === 'true' }
  if (NUMBER.test(text)) return { kind: 'number', value: text }
  if (DATE.test(text)) return { kind: 'date', value: text }
  return { kind: 'text', value: text, quote: '' }
}

/** A quoted scalar's text, or null when the quotes do not close where the
 *  value ends. */
function unquote(text: string): { value: string; quote: '"' | "'" } | null {
  const quote = text[0]
  if ((quote !== '"' && quote !== "'") || text.length < 2 || text[text.length - 1] !== quote) {
    return null
  }
  const inner = text.slice(1, -1)
  if (quote === "'") {
    // Inside single quotes the only escape is a doubled quote.
    if (inner.replace(/''/g, '').includes("'")) return null
    return { value: inner.replace(/''/g, "'"), quote }
  }
  let value = ''
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]
    if (char === '"') return null
    if (char !== '\\') {
      value += char
      continue
    }
    const next = inner[++i]
    if (next === '"' || next === '\\' || next === '/') value += next
    else if (next === 'n') value += '\n'
    else if (next === 't') value += '\t'
    // An escape the form does not know how to write back: not a form's job.
    else return null
  }
  return { value, quote }
}

/** Splits a flow list's inside on the commas that are not inside quotes. */
function flowItems(inner: string): string[] | null {
  const items: string[] = []
  let current = ''
  let quote: string | null = null
  for (const char of inner) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    // Nested structure is not a list of words.
    if (char === '[' || char === ']' || char === '{' || char === '}') return null
    if (char === ',') {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (quote) return null
  items.push(current)
  const trimmed = items.map((item) => item.trim())
  // `[]` is an empty list, not a list holding one empty string.
  if (trimmed.length === 1 && trimmed[0] === '') return []
  const values: string[] = []
  for (const item of trimmed) {
    const value = itemValue(item)
    if (value === null) return null
    values.push(value)
    lastWritten.set(value, item)
  }
  return values
}

/** The items of the list being read, as written. Filled by the two list
 *  readers and taken by the field that owns them. */
let lastWritten = new Map<string, string>()

/** One list item's text: quotes taken off, or as written. */
function itemValue(text: string): string | null {
  if (text.startsWith('"') || text.startsWith("'")) return unquote(text)?.value ?? null
  return text
}

/** The value written after `key:` on the same line. */
function inlineValue(text: string): FieldValue {
  if (text === '') return { kind: 'empty' }
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = unquote(text)
    return quoted ? { kind: 'text', value: quoted.value, quote: quoted.quote } : { kind: 'complex' }
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) return { kind: 'complex' }
    const items = flowItems(text.slice(1, -1))
    return items ? { kind: 'list', items, style: 'flow', indent: '' } : { kind: 'complex' }
  }
  // Block scalars, maps written inline, anchors, tags and comments after a
  // value: all YAML, none of it the dialect.
  if (/^[|>{&*!%@`]/.test(text) || text.includes(' #') || text.includes(': ')) {
    return { kind: 'complex' }
  }
  if (NULL.test(text)) return { kind: 'complex' }
  return scalar(text)
}

/** Reads the front matter of a note. Null when it has none. */
export function readFrontMatter(text: string): FrontMatter | null {
  const end = frontMatterEnd(text)
  if (end === 0) return null

  // The lines between the fences, each with where it starts.
  const lines: { from: number; text: string }[] = []
  let at = text.indexOf('\n') + 1
  let closing = at
  while (at < end) {
    const next = text.indexOf('\n', at)
    const lineEnd = next === -1 ? text.length : next
    const line = text.slice(at, lineEnd).replace(/\r$/, '')
    if (line.trimEnd() === '---') {
      closing = at
      break
    }
    lines.push({ from: at, text: line })
    at = lineEnd + 1
  }

  const fields: Field[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Comments and blank lines belong to nobody and are never touched.
    if (line.text.trim() === '' || line.text.trimStart().startsWith('#')) continue
    // An indented line here is under no key the reader understood.
    if (/^\s/.test(line.text) || line.text.startsWith('-')) continue

    const colon = keyEnd(line.text)
    if (colon === -1) continue
    const raw = line.text.slice(0, colon)
    const key = keyText(raw)
    const rest = line.text.slice(colon + 1).trim()

    // The lines under this key: indented, or list items at the margin.
    let last = i
    while (
      last + 1 < lines.length &&
      (/^\s/.test(lines[last + 1].text) || lines[last + 1].text.startsWith('-') ||
        lines[last + 1].text.trim() === '')
    ) {
      last++
    }
    // Blank lines after the block are the gap before the next key, not part of
    // this one.
    while (last > i && lines[last].text.trim() === '') last--

    lastWritten = new Map()
    let value: FieldValue
    if (last === i) {
      value = inlineValue(rest)
    } else if (rest === '') {
      value = blockList(lines.slice(i + 1, last + 1).map((entry) => entry.text))
    } else {
      value = { kind: 'complex' }
    }

    fields.push({
      raw,
      key,
      value,
      from: line.from,
      // Before any trailing spaces: they are not part of the value, and a
      // field written back must leave them exactly where they were.
      to: lines[last].from + lines[last].text.trimEnd().length,
      written: lastWritten,
    })
    i = last
  }

  return { fields, closing }
}

/** Where the key ends: the first colon followed by a space or the line's end,
 *  outside quotes. */
function keyEnd(line: string): number {
  const quote = line[0] === '"' || line[0] === "'" ? line[0] : null
  let start = 0
  if (quote) {
    const close = line.indexOf(quote, 1)
    if (close === -1) return -1
    start = close + 1
  }
  for (let i = start; i < line.length; i++) {
    if (line[i] === ':' && (i + 1 === line.length || line[i + 1] === ' ' || line[i + 1] === '\t')) {
      return i
    }
  }
  return -1
}

function keyText(raw: string): string {
  const trimmed = raw.trim()
  return unquote(trimmed)?.value ?? trimmed
}

/** A block of `- item` lines, or complex when the block is anything else. */
function blockList(lines: string[]): FieldValue {
  const items: string[] = []
  let indent: string | null = null
  for (const line of lines) {
    if (line.trim() === '') continue
    const match = /^(\s*)-(?: (.*)|)$/.exec(line)
    if (!match) return { kind: 'complex' }
    if (indent === null) indent = match[1]
    else if (indent !== match[1]) return { kind: 'complex' }
    const item = (match[2] ?? '').trim()
    // An item that is itself a map or a list is structure, not a word.
    if (/^[[{]/.test(item) || keyEnd(item) !== -1 || item.includes(' #')) return { kind: 'complex' }
    const value = itemValue(item)
    if (value === null) return { kind: 'complex' }
    items.push(value)
    lastWritten.set(value, item)
  }
  return { kind: 'list', items, style: 'block', indent: indent ?? '' }
}

/** Whether a string would read back as something other than the same string
 *  if written without quotes. */
function needsQuotes(value: string, inList: boolean): boolean {
  if (value === '') return true
  if (value !== value.trim()) return true
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true
  if (value.includes(': ') || value.endsWith(':') || value.includes(' #')) return true
  if (/[\n\t]/.test(value)) return true
  if (BOOLEAN.test(value) || NUMBER.test(value) || DATE.test(value) || NULL.test(value)) return true
  // Inside `[a, b]` a comma or a bracket would split or end the list.
  if (inList && /[,[\]{}]/.test(value)) return true
  return false
}

function doubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
}

/** A string as a scalar, in the quoting it had — or none, when none is needed. */
function writeText(value: string, quote: '"' | "'" | ''): string {
  if (quote === "'" && !/[\n\t]/.test(value)) return `'${value.replace(/'/g, "''")}'`
  if (quote === '"') return doubleQuoted(value)
  return needsQuotes(value, false) ? doubleQuoted(value) : value
}

function writeItem(value: string, inList: boolean, written: Map<string, string>): string {
  const was = written.get(value)
  if (was !== undefined) return was
  return needsQuotes(value, inList) ? doubleQuoted(value) : value
}

/** The text a field is written as, from its key to the end of its last line.
 *  `written` is the list's items as they stood, so the ones left alone keep
 *  their quotes. */
export function writeField(
  raw: string,
  value: FieldValue,
  written: Map<string, string> = new Map(),
): string {
  switch (value.kind) {
    case 'empty':
      return `${raw}:`
    case 'text':
      return `${raw}: ${writeText(value.value, value.quote)}`
    case 'number':
    case 'date':
      return `${raw}: ${value.value}`
    case 'boolean':
      return `${raw}: ${value.value ? 'true' : 'false'}`
    case 'list':
      if (value.style === 'flow') {
        return `${raw}: [${value.items.map((item) => writeItem(item, true, written)).join(', ')}]`
      }
      if (value.items.length === 0) return `${raw}: []`
      return [
        `${raw}:`,
        ...value.items.map((item) => {
          // A bare `-` is an empty item, and it stays bare: `- ` with a
          // trailing space is the same item and a different line.
          const text = writeItem(item, false, written)
          return text === '' ? `${value.indent}-` : `${value.indent}- ${text}`
        }),
      ].join(
        '\n',
      )
    case 'complex':
      throw new Error('a complex field is edited as text')
  }
}

/** A value from what was typed into a field that had no type of its own yet:
 *  the type is whatever the text looks like, the way YAML would read it. */
export function valueFromTyping(text: string): FieldValue {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'empty' }
  const read = scalar(trimmed)
  // Text that only looks like text: what was typed is what is kept.
  if (read.kind === 'text') return { kind: 'text', value: text, quote: '' }
  return read
}

/** A new key, in a form that reads back as the same key. */
export function writeKey(key: string): string {
  const trimmed = key.trim()
  return keyEnd(`${trimmed}: x`) === trimmed.length && !/^[-?[{#&*!|>'"%@`]/.test(trimmed)
    ? trimmed
    : doubleQuoted(trimmed)
}

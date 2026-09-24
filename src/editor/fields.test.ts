// The front matter reader and writer behind the form.
//
// Two promises, each with tests that would fail if it broke: every field's
// value is read as the type it has, and writing a field back rewrites that
// field and nothing else — the text around it byte for byte.
import { describe, expect, it } from 'vitest'
import {
  frontMatterEnd,
  readFrontMatter,
  valueFromTyping,
  writeField,
  writeKey,
  type FieldValue,
} from './fields'

const NOTE = [
  '---',
  'title: A walk in the rain',
  'draft: true',
  'rating: 4.5',
  'published: 2026-09-24',
  '# a comment the form must keep',
  'tags: [travel, "rain, mostly", notes]',
  'aliases:',
  '  - Rain walk',
  "  - 'The ''wet'' one'",
  'quoted: "42"',
  'empty:',
  'nested:',
  '  inner: value',
  'block: |',
  '  line one',
  '---',
  '',
  'Body text.',
  '',
].join('\n')

function valueOf(key: string): FieldValue | undefined {
  return readFrontMatter(NOTE)?.fields.find((field) => field.key === key)?.value
}

describe('reading the fields', () => {
  it('finds where the body starts, as the core does', () => {
    expect(NOTE.slice(frontMatterEnd(NOTE))).toBe('\nBody text.\n')
    expect(frontMatterEnd('no front matter\n')).toBe(0)
    expect(frontMatterEnd('---\ntitle: unterminated\n')).toBe(0)
  })

  it('types each value by its look', () => {
    expect(valueOf('title')).toEqual({ kind: 'text', value: 'A walk in the rain', quote: '' })
    expect(valueOf('draft')).toEqual({ kind: 'boolean', value: true })
    expect(valueOf('rating')).toEqual({ kind: 'number', value: '4.5' })
    expect(valueOf('published')).toEqual({ kind: 'date', value: '2026-09-24' })
    expect(valueOf('empty')).toEqual({ kind: 'empty' })
  })

  it('keeps a quoted number a string', () => {
    // `"42"` is text in YAML; a form that showed a number box would change it.
    expect(valueOf('quoted')).toEqual({ kind: 'text', value: '42', quote: '"' })
  })

  it('reads both list shapes, quotes and all', () => {
    expect(valueOf('tags')).toEqual({
      kind: 'list',
      items: ['travel', 'rain, mostly', 'notes'],
      style: 'flow',
      indent: '',
    })
    expect(valueOf('aliases')).toEqual({
      kind: 'list',
      items: ['Rain walk', "The 'wet' one"],
      style: 'block',
      indent: '  ',
    })
  })

  it('leaves what it does not understand to the text', () => {
    expect(valueOf('nested')).toEqual({ kind: 'complex' })
    expect(valueOf('block')).toEqual({ kind: 'complex' })
  })

  it('does not count a comment as a field', () => {
    expect(readFrontMatter(NOTE)?.fields.map((field) => field.key)).toEqual([
      'title',
      'draft',
      'rating',
      'published',
      'tags',
      'aliases',
      'quoted',
      'empty',
      'nested',
      'block',
    ])
  })
})

/** The note with one field rewritten, the way the form writes it. */
function rewrite(text: string, key: string, value: FieldValue): string {
  const field = readFrontMatter(text)!.fields.find((candidate) => candidate.key === key)!
  return text.slice(0, field.from) + writeField(field.raw, value, field.written) + text.slice(field.to)
}

describe('writing a field', () => {
  it('writes every editable field back exactly as it was', () => {
    // The strongest form of "changes nothing it was not asked to": each field,
    // written back with its own value, gives the same bytes.
    for (const field of readFrontMatter(NOTE)!.fields) {
      if (field.value.kind === 'complex') continue
      expect(rewrite(NOTE, field.key, field.value), field.key).toBe(NOTE)
    }
  })

  it('leaves trailing spaces after a value where they were', () => {
    // Found on a real vault: a description ending in a space, which a writer
    // that trimmed would have taken away on the first save.
    const text = '---\ndescription: ends with a space \nnext: 1\n---\n'
    const field = readFrontMatter(text)!.fields[0]
    expect(text.slice(field.from, field.to)).toBe('description: ends with a space')
    expect(rewrite(text, 'description', field.value)).toBe(text)
    expect(rewrite(text, 'description', { kind: 'text', value: 'new', quote: '' })).toBe(
      '---\ndescription: new \nnext: 1\n---\n',
    )
  })

  it('changes one line and leaves the rest byte for byte', () => {
    const text = rewrite(NOTE, 'draft', { kind: 'boolean', value: false })
    expect(text).toBe(NOTE.replace('draft: true', 'draft: false'))
  })

  it('quotes text that would otherwise read back as something else', () => {
    for (const [typed, written] of [
      ['true', '"true"'],
      ['12', '"12"'],
      ['2026-01-01', '"2026-01-01"'],
      ['a: b', '"a: b"'],
      ['#hashtag', '"#hashtag"'],
      ['say "hi"', 'say "hi"'],
      ['- dash', '"- dash"'],
      ['back\\slash', 'back\\slash'],
    ]) {
      const text = rewrite(NOTE, 'title', { kind: 'text', value: typed, quote: '' })
      expect(text).toContain(`title: ${written}\n`)
      // And it reads back as the same text.
      const read = readFrontMatter(text)!.fields.find((f) => f.key === 'title')!.value
      expect(read.kind === 'text' && read.value).toBe(typed)
    }
  })

  it('keeps the quoting a value had', () => {
    const text = rewrite(NOTE, 'quoted', { kind: 'text', value: 'it\'s "fine"', quote: '"' })
    expect(text).toContain('quoted: "it\'s \\"fine\\""\n')
    const single = "title: 'x'\n"
    const read = readFrontMatter(`---\n${single}---\n`)!
    expect(read.fields[0].value).toEqual({ kind: 'text', value: 'x', quote: "'" })
    expect(writeField("title", { kind: 'text', value: "it's", quote: "'" })).toBe("title: 'it''s'")
  })

  it('writes a block list in its own indentation', () => {
    const text = rewrite(NOTE, 'aliases', {
      kind: 'list',
      items: ['Rain walk', 'Drizzle'],
      style: 'block',
      indent: '  ',
    })
    expect(text).toContain('aliases:\n  - Rain walk\n  - Drizzle\nquoted:')
  })

  it('quotes a list item that would split the list', () => {
    expect(
      writeField('tags', { kind: 'list', items: ['a, b', 'c'], style: 'flow', indent: '' }),
    ).toBe('tags: ["a, b", c]')
  })

  it('takes the type of what was typed into a field that had none', () => {
    expect(valueFromTyping('true')).toEqual({ kind: 'boolean', value: true })
    expect(valueFromTyping('3')).toEqual({ kind: 'number', value: '3' })
    expect(valueFromTyping('')).toEqual({ kind: 'empty' })
    expect(valueFromTyping('words')).toEqual({ kind: 'text', value: 'words', quote: '' })
  })

  it('writes a new key so it reads back as itself', () => {
    expect(writeKey('status')).toBe('status')
    expect(writeKey('key: with colon')).toBe('"key: with colon"')
    expect(writeKey('#tag')).toBe('"#tag"')
  })
})

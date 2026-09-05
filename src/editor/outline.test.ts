// Reading a document's headings.
//
// The reason this comes from the syntax tree and not from a regular expression
// is the fenced-code case: shell examples are full of `# comments`, and an
// outline that lists them is worse than no outline. That case has a test.
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { outlineOf } from './outline'
import { schedaSetup } from './setup'

function outline(doc: string) {
  return outlineOf(EditorState.create({ doc, extensions: schedaSetup() }))
}

describe('the outline', () => {
  it('lists headings in document order', () => {
    const headings = outline('# One\n\ntext\n\n## Two\n\nmore\n\n# Three\n')
    expect(headings.map((h) => h.text)).toEqual(['One', 'Two', 'Three'])
  })

  it('records the level of each', () => {
    const headings = outline('# One\n\n### Deep\n\n###### Deepest\n')
    expect(headings.map((h) => h.level)).toEqual([1, 3, 6])
  })

  it('ignores a hash inside a code fence', () => {
    // The whole reason for reading the tree. A shell example is not an outline.
    const headings = outline('# Real\n\n```bash\n# not a heading\necho hi\n```\n\n## Also real\n')
    expect(headings.map((h) => h.text)).toEqual(['Real', 'Also real'])
  })

  it('ignores a hash inside an indented code block', () => {
    const headings = outline('# Real\n\n    # not a heading\n\n## Also real\n')
    expect(headings.map((h) => h.text)).toEqual(['Real', 'Also real'])
  })

  it('reads a heading underlined with equals signs', () => {
    // Setext headings are rarer but legal, and a note written that way should
    // not come up with an empty outline.
    const headings = outline('Title\n=====\n\ntext\n\nSubtitle\n--------\n')
    expect(headings.map((h) => h.text)).toEqual(['Title', 'Subtitle'])
    expect(headings.map((h) => h.level)).toEqual([1, 2])
  })

  it('strips a closing run of hashes', () => {
    const headings = outline('## Balanced ##\n')
    expect(headings[0]?.text).toBe('Balanced')
  })

  it('keeps the inline markup a heading was written with', () => {
    // `The **hard** part` reads better with its asterisks than with its words
    // run together, and the outline is a list of what the document says.
    const headings = outline('## The **hard** part\n')
    expect(headings[0]?.text).toBe('The **hard** part')
  })

  it('points at the start of the heading line, for scrolling to it', () => {
    const doc = '# One\n\ntext\n\n## Two\n'
    const headings = outline(doc)
    expect(doc.slice(headings[1].from, headings[1].from + 6)).toBe('## Two')
  })

  it('numbers the lines from one', () => {
    const headings = outline('# One\n\ntext\n\n## Two\n')
    expect(headings.map((h) => h.line)).toEqual([1, 5])
  })

  it('is empty for a document with no headings', () => {
    expect(outline('Just prose.\n\nAnd more of it.\n')).toEqual([])
  })

  it('survives a heading with nothing after the hashes', () => {
    const headings = outline('#\n\ntext\n')
    expect(headings).toHaveLength(1)
    expect(headings[0].text).toBe('')
  })
})

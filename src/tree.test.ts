// Which branch of the tree opens, and which row is marked as the file you are
// editing.
//
// Both come down to comparing two paths, and the two do not arrive spelled the
// same way: the tree carries whatever the filesystem returned — backslashes on
// Windows — while the document path can come from a command line typed by hand.
// The first version compared them with `startsWith` and the branch holding the
// open file silently never opened.
import { describe, expect, it } from 'vitest'
import { ancestorsOf, samePath } from './tree'

const TREE = [
  {
    name: 'Projects',
    path: 'C:\\vault\\Projects',
    children: [
      {
        name: 'scheda',
        path: 'C:\\vault\\Projects\\scheda',
        children: [{ name: 'README.md', path: 'C:\\vault\\Projects\\scheda\\README.md' }],
      },
    ],
  },
  { name: 'note.md', path: 'C:\\vault\\note.md' },
]

describe('comparing paths', () => {
  it('sees one file through two spellings of its path', () => {
    expect(samePath('C:\\vault\\note.md', 'C:/vault/note.md')).toBe(true)
  })

  it('ignores case, because Windows does', () => {
    expect(samePath('C:\\Vault\\Note.md', 'c:\\vault\\note.md')).toBe(true)
  })

  it('ignores a trailing separator', () => {
    expect(samePath('C:\\vault\\Projects\\', 'C:/vault/Projects')).toBe(true)
  })

  it('still tells two different files apart', () => {
    expect(samePath('C:\\vault\\one.md', 'C:\\vault\\two.md')).toBe(false)
  })

  it('does not confuse a folder with one whose name starts the same', () => {
    // `Projects` and `Projects-old` share a prefix and are not the same place.
    expect(samePath('C:\\vault\\Projects', 'C:\\vault\\Projects-old')).toBe(false)
  })
})

describe('finding the branch that holds a file', () => {
  it('lists the folders down to it', () => {
    expect(ancestorsOf(TREE, 'C:\\vault\\Projects\\scheda\\README.md')).toEqual([
      'C:\\vault\\Projects',
      'C:\\vault\\Projects\\scheda',
    ])
  })

  it('works when the document path is spelled the other way', () => {
    // The case that shipped broken: the tree has backslashes, the document
    // arrived with forward ones, and nothing opened.
    expect(ancestorsOf(TREE, 'C:/vault/Projects/scheda/README.md')).toEqual([
      'C:\\vault\\Projects',
      'C:\\vault\\Projects\\scheda',
    ])
  })

  it('needs no folders for a file at the top', () => {
    expect(ancestorsOf(TREE, 'C:\\vault\\note.md')).toEqual([])
  })

  it('answers nothing for a file that is not in the tree', () => {
    expect(ancestorsOf(TREE, 'C:\\elsewhere\\other.md')).toBeNull()
  })

  it('does not walk into a folder whose name merely starts the same', () => {
    // `C:\vault\Projects\one.md` starts with `C:\vault\Proj` as a string and is
    // not inside that folder at all. The lookalike comes first and holds the
    // *same path* as a child, so a containment test that forgets the separator
    // returns the wrong branch rather than merely walking one folder too many.
    const tree = [
      {
        name: 'Proj',
        path: 'C:\\vault\\Proj',
        children: [{ name: 'one.md', path: 'C:\\vault\\Projects\\one.md' }],
      },
      {
        name: 'Projects',
        path: 'C:\\vault\\Projects',
        children: [{ name: 'one.md', path: 'C:\\vault\\Projects\\one.md' }],
      },
    ]
    expect(ancestorsOf(tree, 'C:\\vault\\Projects\\one.md')).toEqual(['C:\\vault\\Projects'])
  })
})

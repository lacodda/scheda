// Which branch of the tree opens, and which row is marked as the file you are
// editing.
//
// Both come down to comparing two paths, and the two do not arrive spelled the
// same way: the tree carries whatever the filesystem returned — backslashes on
// Windows — while the document path can come from a command line typed by hand.
// The first version compared them with `startsWith` and the branch holding the
// open file silently never opened.
import { describe, expect, it } from 'vitest'
import { ancestorsOf, editableName, folderFor } from './tree'

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

describe('deciding where a new file goes', () => {
  const root = 'C:\\vault'

  it('puts it in the folder that was clicked', () => {
    expect(folderFor({ name: 'Notes', path: 'C:\\vault\\Notes', children: [] }, root)).toBe(
      'C:\\vault\\Notes',
    )
  })

  it('puts it beside a file, not inside it', () => {
    // The obvious implementation passes the clicked path straight through and
    // asks the core to create `C:\vault\Notes\one.md\new.md`, which is not a
    // place. A file's neighbour is its folder.
    expect(folderFor({ name: 'one.md', path: 'C:\\vault\\Notes\\one.md' }, root)).toBe(
      'C:\\vault\\Notes',
    )
  })

  it('puts it in the root when nothing was clicked', () => {
    expect(folderFor(null, root)).toBe(root)
  })
})

describe('offering a name to edit', () => {
  it('separates the name from the extension', () => {
    // Typing replaces the name and keeps the `.md`: renaming a note should not
    // begin by making it stop being one.
    expect(editableName('note.md')).toEqual({ stem: 'note', suffix: '.md' })
  })

  it('treats a dotfile as all name', () => {
    // `.gitignore` has no extension to keep, and selecting an empty stem would
    // make the first keystroke delete the whole name.
    expect(editableName('.gitignore')).toEqual({ stem: '.gitignore', suffix: '' })
  })

  it('takes the last dot, not the first', () => {
    expect(editableName('archive.tar.gz')).toEqual({ stem: 'archive.tar', suffix: '.gz' })
  })

  it('leaves a name with no dot alone', () => {
    expect(editableName('Notes')).toEqual({ stem: 'Notes', suffix: '' })
  })
})


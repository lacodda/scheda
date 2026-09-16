// Comparing paths, which the tree and the editor both depend on: one to open
// the branch holding the file you are editing, the other to make a tab follow
// the file when it is renamed out from under it.
import { describe, expect, it } from 'vitest'
import { basename, dirname, isInside, samePath } from './paths'

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
    expect(samePath('C:\\vault\\Projects', 'C:\\vault\\Projects-old')).toBe(false)
  })
})

describe('deciding whether a file is under a folder', () => {
  it('sees a file in the folder and one deeper down', () => {
    expect(isInside('C:\\vault\\Notes', 'C:\\vault\\Notes\\one.md')).toBe(true)
    expect(isInside('C:\\vault\\Notes', 'C:\\vault\\Notes\\deep\\one.md')).toBe(true)
  })

  it('needs the separator, not just the prefix', () => {
    // `C:\vault\Notes-old\one.md` starts with `C:\vault\Notes` as a string and
    // is in a different folder entirely. Deleting `Notes` must not orphan the
    // tab showing a file from `Notes-old`.
    expect(isInside('C:\\vault\\Notes', 'C:\\vault\\Notes-old\\one.md')).toBe(false)
  })

  it('does not call a folder its own child', () => {
    expect(isInside('C:\\vault\\Notes', 'C:\\vault\\Notes')).toBe(false)
  })

  it('reads across two spellings, like everything else here', () => {
    expect(isInside('C:\\vault\\Notes', 'C:/vault/notes/one.md')).toBe(true)
  })
})

describe('taking a path apart', () => {
  it('finds the last component and everything before it', () => {
    expect(basename('C:\\vault\\Notes\\one.md')).toBe('one.md')
    expect(dirname('C:\\vault\\Notes\\one.md')).toBe('C:\\vault\\Notes')
  })

  it('handles a path with no separator at all', () => {
    expect(basename('one.md')).toBe('one.md')
    expect(dirname('one.md')).toBe('')
  })
})

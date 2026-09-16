// What counts as a pasted picture.
//
// The decision has cases in it, and getting it wrong is loud: a copied cell
// from a spreadsheet carries a picture of itself *and* the number in it, so a
// handler that takes any image on the clipboard writes a screenshot of a cell
// into the vault instead of pasting the number.
import { describe, expect, it } from 'vitest'
import { pictureOn } from './paste'

/** A stand-in for the clipboard. `DataTransfer` is not constructible in jsdom
 *  with files in it, and only two of its members are read here. */
function clipboard(types: string[], files: { name: string; type: string }[]): DataTransfer {
  return { types, files: files as unknown as FileList } as unknown as DataTransfer
}

describe('finding a picture on the clipboard', () => {
  it('takes a screenshot', () => {
    const data = clipboard(['Files'], [{ name: 'image.png', type: 'image/png' }])
    expect(pictureOn(data)?.extension).toBe('png')
  })

  it('knows the formats a picture arrives as', () => {
    for (const [type, extension] of [
      ['image/jpeg', 'jpg'],
      ['image/gif', 'gif'],
      ['image/webp', 'webp'],
      ['image/svg+xml', 'svg'],
    ]) {
      const data = clipboard(['Files'], [{ name: 'x', type }])
      expect(pictureOn(data)?.extension).toBe(extension)
    }
  })

  it('leaves text alone even when a picture comes with it', () => {
    // The case this exists for: a copied spreadsheet cell, a copied link, a
    // snippet from a web page. All carry an image alongside the text, and the
    // text is what was meant.
    const data = clipboard(['text/plain', 'Files'], [{ name: 'cell.png', type: 'image/png' }])
    expect(pictureOn(data)).toBeNull()
  })

  it('does not guess at an image type it does not know', () => {
    // Writing `.bin` into a vault is worse than letting the paste fall through.
    const data = clipboard(['Files'], [{ name: 'thing.heic', type: 'image/heic' }])
    expect(pictureOn(data)).toBeNull()
  })

  it('ignores a pasted file that is not a picture', () => {
    const data = clipboard(['Files'], [{ name: 'report.pdf', type: 'application/pdf' }])
    expect(pictureOn(data)).toBeNull()
  })

  it('answers nothing for an empty clipboard', () => {
    expect(pictureOn(null)).toBeNull()
    expect(pictureOn(clipboard([], []))).toBeNull()
  })
})

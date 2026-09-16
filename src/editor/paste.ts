// A screenshot on the clipboard, pasted into a note.
//
// The clipboard is the one thing the core cannot read for itself: it belongs to
// the window, not to the process. So the bytes come from here — and nothing
// else does. Where the file goes, what it is called and how the link is spelled
// are the core's answers, read from the vault's own `.obsidian/app.json` so
// that Obsidian and scheda do not put pictures in two different folders
// (ADR 0001, ADR 0003).
//
// The paste is intercepted only when the clipboard holds a picture and no text.
// A copied cell from a spreadsheet carries both an image and its text, and
// pasting a screenshot of the cell instead of the number in it is not what
// anybody meant.
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { pasteImage } from '../core'
import { documentPath } from './images'

/** The extensions a picture can arrive as, by clipboard type.
 *
 *  Windows puts a screenshot on the clipboard as PNG, and that is the case this
 *  exists for; the rest are here because a browser or a file manager may hand
 *  over what it has. An unknown image type is not guessed at — better to let
 *  the paste fall through than to write `.bin` into the vault. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

/** The picture on a clipboard, if that is what is on it and nothing else.
 *
 *  Exported for its own test: the decision of what counts as "a pasted picture"
 *  is the part with cases in it, and the rest of this file is plumbing around a
 *  `fetch` of the file's bytes.
 */
export function pictureOn(data: DataTransfer | null): { file: File; extension: string } | null {
  if (!data) return null
  // Text wins. A copied cell, a copied link, a snippet from a web page: all of
  // them carry an image *and* the text they came from, and the text is what the
  // person meant to paste into a note.
  if (data.types.includes('text/plain')) return null

  for (const item of Array.from(data.files)) {
    const extension = EXTENSIONS[item.type]
    if (extension) return { file: item, extension }
  }
  return null
}

/** Pasting a picture writes it into the vault and links it.
 *
 *  Nothing is inserted until the file is on disk. Writing the link first and
 *  the file second would leave a note pointing at a picture that does not exist
 *  whenever the write fails — and the write fails for the ordinary reasons: a
 *  read-only vault, a full disk, a draft with no folder to be relative to.
 */
export const imagePaste: Extension = EditorView.domEventHandlers({
  paste(event, view) {
    const picture = pictureOn(event.clipboardData)
    if (!picture) return false

    // The document's path decides where the picture goes. A draft has none, and
    // the core says so in a sentence rather than inventing a folder.
    const path = view.state.field(documentPath, false) ?? null

    event.preventDefault()
    void (async () => {
      try {
        const bytes = new Uint8Array(await picture.file.arrayBuffer())
        const written = await pasteImage(path, picture.extension, Array.from(bytes))
        // At the selection, replacing it, like any other paste. `![](link)`
        // with no alt text: the alt is the author's to write, and inventing
        // "Pasted image 20260916120000" as the description of a picture is
        // noise in the source of every note.
        view.dispatch({
          ...view.state.replaceSelection(`![](${written.link})`),
          scrollIntoView: true,
        })
      } catch (error) {
        // Thrown, not swallowed: `main.tsx` puts it on screen. A picture that
        // silently did not paste is the kind of failure that gets noticed a
        // week later, when the note is needed.
        const message =
          error !== null && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : String(error)
        queueMicrotask(() => {
          throw new Error(`the picture could not be pasted: ${message}`)
        })
      }
    })()
    return true
  },
})

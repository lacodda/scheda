// Printing a note, and writing it out as one HTML file.
//
// Both are the same page (`editor/html.ts`) with its pictures resolved two ways.
// Printing shows the page in a frame the window can already load pictures into,
// so the pictures go through the asset door the editor uses. The file is meant
// to leave the machine, so its pictures travel inside it as data URLs — read by
// the core, under the same root check (ADR 0004).
//
// Loaded when first asked for, not at start: nothing here has to exist before
// the text is on screen (ADR 0001).
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { exportPage, inlinePicture, resolveAsset, resolveWikilinks } from './core'
import { renderPage, resourcesOf, type Resources } from './editor/html'
import { draw } from './editor/mermaid'
import { relativeFrom } from './editor/wikilinks'
import { basename, dirname } from './paths'
import type { EditorHandle } from './editor/mount'

/** The note's name, as the page's title and the file's. */
function titleOf(path: string | null): string {
  return path ? basename(path).replace(/\.[^.]+$/, '') : 'Untitled'
}

/** Everything the page needs from outside the text. */
async function resourcesFor(editor: EditorHandle, forFile: boolean): Promise<Resources> {
  const state = editor.view.state
  const path = editor.active().path
  const wanted = resourcesOf(state)
  const images = new Map<string, string>()

  if (path !== null) {
    const load = (link: string) => (forFile ? inlinePicture(path, link) : resolveAsset(path, link))
    for (const link of new Set(wanted.images)) {
      const src = await load(link).catch(() => null)
      if (src !== null) images.set(link, src)
    }
    const names = [...new Set(wanted.wikiImages)]
    if (names.length > 0) {
      const found = await resolveWikilinks(path, names).catch(() => [])
      for (const [index, name] of names.entries()) {
        const resolved = found[index]?.path ?? null
        if (resolved === null) continue
        const src = await load(relativeFrom(path, resolved)).catch(() => null)
        if (src !== null) images.set(`[[${name}]]`, src)
      }
    }
  }

  const diagrams = new Map<string, string>()
  for (const source of new Set(wanted.diagrams)) {
    // Light, whatever the window is: paper is white, and so is a page opened in
    // somebody else's browser. A diagram that does not draw stays its code.
    const svg = await draw(source, 'default').catch(() => null)
    if (svg !== null) diagrams.set(source, svg)
  }
  return { images, diagrams }
}

/** Prints the note in front of you, through the system's print dialog.
 *
 *  The page goes into a hidden frame and the frame is printed, not the window:
 *  printing the window would print the tab strip, the status bar and the
 *  editor's markers, and the one thing asked for is the note. */
export async function printNote(editor: EditorHandle): Promise<void> {
  const html = renderPage(editor.view.state, titleOf(editor.active().path), await resourcesFor(editor, false))
  const frame = document.createElement('iframe')
  frame.className = 'print-frame'
  frame.setAttribute('aria-hidden', 'true')
  frame.srcdoc = html
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true })
    document.body.appendChild(frame)
  })
  const page = frame.contentWindow
  if (!page) {
    frame.remove()
    return
  }
  // The pictures are loading from the moment the frame is; printing before
  // they arrive prints empty boxes.
  await Promise.all(
    [...page.document.images].map((image) =>
      image.complete ? null : new Promise((done) => image.addEventListener('load', done, { once: true })),
    ),
  )
  page.focus()
  page.print()
  // `print` returns once the dialog is closed, printed or not; the frame has
  // nothing left to do. Removed on the next turn so the spooler has the page.
  setTimeout(() => frame.remove(), 0)
}

/** Writes the note in front of you as one HTML file, asking where. */
export async function exportNote(editor: EditorHandle): Promise<string | null> {
  const path = editor.active().path
  const title = titleOf(path)
  const target = await saveDialog({
    defaultPath: path
      ? `${dirname(path)}${path.includes('\\') ? '\\' : '/'}${title}.html`
      : `${title}.html`,
    filters: [{ name: 'Web page', extensions: ['html', 'htm'] }],
  })
  if (!target) return null
  const html = renderPage(editor.view.state, title, await resourcesFor(editor, true))
  await exportPage(target, html)
  return target
}

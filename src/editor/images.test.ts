// Embedded pictures: which link becomes a picture, and which does not.
//
// The core is mocked here, because what these tests are about is the editor's
// half — that a link is asked about once, that the answer redraws the document,
// that a buffer with no path asks nothing. Whether a link may be read at all is
// decided in the core and tested there (`root.rs`), where the filesystem is
// real and `..` can actually climb.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAsset = vi.fn<(document: string, link: string) => Promise<string | null>>()

vi.mock('../core', async () => {
  const actual = await vi.importActual<typeof import('../core')>('../core')
  return { ...actual, resolveAsset: (d: string, l: string) => resolveAsset(d, l) }
})

const { forgetAllAssets, setDocumentPath } = await import('./images')
const { schedaSetup } = await import('./setup')

function view(doc: string, path: string | null): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const editor = new EditorView({
    state: EditorState.create({ doc, extensions: schedaSetup() }),
    parent,
  })
  if (path !== null) editor.dispatch({ effects: setDocumentPath.of(path) })
  return editor
}

/** Lets the resolver's promise settle and the redraw land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const NOTE = 'Text\n\n![a diagram](assets/diagram.png)\n\nMore text.\n'

describe('embedded pictures', () => {
  beforeEach(() => {
    resolveAsset.mockReset()
    // Every cache, not the two paths these tests happen to use. Naming them
    // made the suite blind: a mutation that resolved under a made-up path left
    // its entries behind, so the next test found the links already claimed and
    // asked nothing — which is exactly what it was asserting.
    forgetAllAssets()
  })

  it('asks the core about a link and draws what comes back', async () => {
    resolveAsset.mockResolvedValue('asset://localhost/vault/assets/diagram.png')
    const v = view(NOTE, '/vault/note.md')
    await settle()
    expect(resolveAsset).toHaveBeenCalledWith('/vault/note.md', 'assets/diagram.png')
    const img = v.dom.querySelector('.cm-md-image img') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toBe('asset://localhost/vault/assets/diagram.png')
    v.destroy()
  })

  it('carries the alt text onto the picture', async () => {
    resolveAsset.mockResolvedValue('asset://localhost/x.png')
    const v = view(NOTE, '/vault/note.md')
    await settle()
    const img = v.dom.querySelector('.cm-md-image img') as HTMLImageElement | null
    expect(img?.getAttribute('alt')).toBe('a diagram')
    v.destroy()
  })

  it('draws nothing when the core refuses the link', async () => {
    // A link pointing outside the root comes back null, and the line stays the
    // text it was. Not an error the reader has to dismiss.
    resolveAsset.mockResolvedValue(null)
    const v = view('![out](../../etc/passwd)\n', '/vault/note.md')
    await settle()
    expect(v.dom.querySelector('.cm-md-image')).toBeNull()
    v.destroy()
  })

  it('hides the line of a refused link too, alt text and all', async () => {
    // Found in a screenshot: the picture was gone, as intended, and `escapes`
    // was left sitting there reading as a word the author wrote. The line goes
    // whether or not there is a picture to put in its place.
    resolveAsset.mockResolvedValue(null)
    const v = view('Before\n\n![escapes](../../secret.png)\n\nAfter\n', '/vault/note.md')
    // No dispatch of our own before the check. One would redraw the view by
    // itself and hide whether the resolver asks for a redraw when every answer
    // was "no" — which is the case that shipped the defect.
    await settle()
    expect(v.dom.textContent).not.toContain('escapes')
    expect(v.dom.querySelector('.cm-md-image')).toBeNull()
    v.destroy()
  })

  it('asks about a link once, not on every keystroke', async () => {
    resolveAsset.mockResolvedValue('asset://localhost/x.png')
    const v = view(NOTE, '/vault/note.md')
    await settle()
    const afterFirst = resolveAsset.mock.calls.length
    for (const insert of ['a', 'b', 'c']) {
      v.dispatch({ changes: { from: 0, insert } })
      await settle()
    }
    expect(resolveAsset.mock.calls.length).toBe(afterFirst)
    v.destroy()
  })

  it('asks once even while the first answer is still in flight', async () => {
    // The claim exists for this window: a note is edited while the core is
    // still resolving, and without it every keystroke starts another request
    // for the same picture. The plain "asks once" test cannot see it, because
    // by then the answer has landed and the cache holds it either way.
    // Typed through a holder: assigning to a `let` from inside the promise
    // narrows it to `never` for every use afterwards.
    const inFlight: { resolve?: (url: string | null) => void } = {}
    resolveAsset.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight.resolve = resolve
        }),
    )
    const v = view(NOTE, '/vault/note.md')
    await settle()
    expect(resolveAsset).toHaveBeenCalledTimes(1)

    // Three edits arrive before the core has answered.
    for (const insert of ['a', 'b', 'c']) {
      v.dispatch({ changes: { from: 0, insert } })
      await settle()
    }
    expect(resolveAsset).toHaveBeenCalledTimes(1)

    inFlight.resolve?.('asset://localhost/x.png')
    await settle()
    v.destroy()
  })

  it('asks nothing at all for a buffer with no path', async () => {
    // A relative link has nothing to be relative to yet.
    const v = view(NOTE, null)
    await settle()
    expect(resolveAsset).not.toHaveBeenCalled()
    expect(v.dom.querySelector('.cm-md-image')).toBeNull()
    v.destroy()
  })

  it('leaves the document alone while drawing the picture', async () => {
    // The rule the whole decoration layer follows: the markdown is still there,
    // whatever is drawn over it (ADR 0002).
    resolveAsset.mockResolvedValue('asset://localhost/x.png')
    const v = view(NOTE, '/vault/note.md')
    await settle()
    expect(v.state.doc.toString()).toBe(NOTE)
    v.destroy()
  })

  it('hides the source line while the caret is elsewhere', async () => {
    // Hiding only the brackets and the URL would leave `a diagram` above the
    // picture, reading as a caption the author wrote — the same failure as a
    // link whose target stayed when its brackets went.
    resolveAsset.mockResolvedValue('asset://localhost/x.png')
    const v = view(NOTE, '/vault/note.md')
    v.dispatch({ selection: { anchor: 0 } })
    await settle()
    expect(v.dom.textContent).not.toContain('a diagram')
    v.destroy()
  })

  it('brings the source line back when the caret lands on it', async () => {
    resolveAsset.mockResolvedValue('asset://localhost/x.png')
    const v = view(NOTE, '/vault/note.md')
    await settle()
    // Somewhere inside `![a diagram](assets/diagram.png)`.
    v.dispatch({ selection: { anchor: NOTE.indexOf('a diagram') + 2 } })
    await settle()
    expect(v.dom.textContent).toContain('a diagram')
    v.destroy()
  })

  it('does not survive into another document', async () => {
    // The same relative link means a different file in a different note, so a
    // cached answer must not leak across.
    resolveAsset.mockResolvedValue('asset://localhost/first.png')
    const first = view(NOTE, '/vault/note.md')
    await settle()
    first.destroy()

    resolveAsset.mockResolvedValue('asset://localhost/second.png')
    const second = view(NOTE, '/vault/other.md')
    await settle()
    expect(resolveAsset).toHaveBeenLastCalledWith('/vault/other.md', 'assets/diagram.png')
    const img = second.dom.querySelector('.cm-md-image img') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toBe('asset://localhost/second.png')
    second.destroy()
  })

  it('leaves a remote image to the core to refuse', async () => {
    resolveAsset.mockResolvedValue(null)
    const v = view('![tracker](https://example.com/pixel.png)\n', '/vault/note.md')
    await settle()
    expect(resolveAsset).toHaveBeenCalledWith('/vault/note.md', 'https://example.com/pixel.png')
    expect(v.dom.querySelector('.cm-md-image')).toBeNull()
    v.destroy()
  })
})

// The boundary between the editor and the program it runs in.
//
// Three promises are held here. An editor leaves out what its host cannot
// answer, rather than drawing it half-working. Answers belong to the host that
// gave them, so two editors with two hosts cannot read each other's. And the
// host decides when an answer is stale: forgetting a document makes the next
// draw ask again.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { forgetDocument, forgetNotes } from './forget.js'
import { documentPath, type EditorHost, type LinkTarget } from './host.js'
import { schedaEditor } from './setup.js'
import { followTarget } from './wikilinks.js'

function view(doc: string, host?: EditorHost, path: string | null = '/vault/note.md'): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      // The caret on the last line, so the lines above are all being drawn.
      selection: { anchor: doc.length },
      extensions: [...schedaEditor({ host }), documentPath.init(() => path)],
    }),
    parent,
  })
}

/** What the reader sees, read off the DOM. */
function rendered(v: EditorView): string {
  return [...v.dom.querySelectorAll('.cm-line')].map((line) => line.textContent).join('\n')
}

/** Lets the host's promises settle and the redraws they dispatch land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A host whose notes all resolve to `answer`, counting the questions. */
function notesHost(answer: string | null) {
  const resolve = vi.fn(async (_document: string, targets: string[]): Promise<LinkTarget[]> =>
    targets.map(() => ({ path: answer, target: null })),
  )
  const host: EditorHost = {
    notes: {
      resolve,
      create: async () => '/vault/new.md',
      suggest: async () => [],
      headings: async () => [],
      peek: async () => null,
    },
  }
  return { host, resolve }
}

const NOTE = 'See [[plan|the plan]] here.\n\n![a diagram](assets/diagram.png)\n\nend'

describe('an editor without a host', () => {
  it('draws markdown and leaves links and pictures the text they are', async () => {
    const v = view(NOTE)
    await settle()
    // The wikilink is not drawn as a link that leads nowhere, and the picture
    // line is not hidden behind a picture that will never come.
    expect(rendered(v)).toContain('[[plan|the plan]]')
    expect(rendered(v)).toContain('![a diagram](assets/diagram.png)')
    expect(v.dom.querySelector('.cm-md-wikilink')).toBeNull()
    expect(v.dom.querySelector('.cm-md-image')).toBeNull()
    v.destroy()
  })

  it('follows nothing, because nothing was given to follow with', async () => {
    // The click handlers are not there to call, but the function the window
    // uses for a key press is public — and must not throw without a host.
    await expect(followTarget({}, '/vault/note.md', 'plan', null)).resolves.toBeUndefined()
  })
})

describe('a host with only part of the answers', () => {
  it('draws pictures without notes', async () => {
    const host: EditorHost = { assets: { resolve: async () => 'asset://x.png' } }
    const v = view(NOTE, host)
    await settle()
    expect(v.dom.querySelector('.cm-md-image img')?.getAttribute('src')).toBe('asset://x.png')
    expect(v.dom.querySelector('.cm-md-wikilink')).toBeNull()
    v.destroy()
  })

  it('draws links without pictures', async () => {
    const { host } = notesHost('/vault/plan.md')
    const v = view(NOTE, host)
    await settle()
    expect(v.dom.querySelector('.cm-md-wikilink')?.textContent).toBe('the plan')
    expect(rendered(v)).toContain('![a diagram](assets/diagram.png)')
    v.destroy()
  })

  it('leaves a pasted picture to the page when the host cannot write one', () => {
    const host: EditorHost = { assets: { resolve: async () => null } }
    const v = view('', host)
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent
    v.contentDOM.dispatchEvent(event)
    // Not taken: the editor's ordinary paste is what happens.
    expect(event.defaultPrevented).toBe(false)
    v.destroy()
  })
})

describe('answers belong to the host that gave them', () => {
  it('keeps two hosts apart over the same document path', async () => {
    // Two programs on one page — or two kinds of document in one program —
    // name a note `plan` and mean different things by it.
    const found = notesHost('/vault/plan.md')
    const missing = notesHost(null)
    const a = view('See [[plan]] here.\n\nend', found.host)
    const b = view('See [[plan]] here.\n\nend', missing.host)
    await settle()
    expect(a.dom.querySelector('.cm-md-wikilink-missing')).toBeNull()
    expect(b.dom.querySelector('.cm-md-wikilink-missing')).not.toBeNull()
    // And each asked its own host once, rather than one reading the other's.
    expect(found.resolve).toHaveBeenCalledTimes(1)
    expect(missing.resolve).toHaveBeenCalledTimes(1)
    a.destroy()
    b.destroy()
  })
})

describe('forgetting', () => {
  it('asks again about a document the host says has moved', async () => {
    const { host, resolve } = notesHost('/vault/plan.md')
    const v = view('See [[plan]] here.\n\nend', host)
    await settle()
    expect(resolve).toHaveBeenCalledTimes(1)

    // Answered, so an edit asks nothing.
    v.dispatch({ changes: { from: v.state.doc.length, insert: '.' } })
    await settle()
    expect(resolve).toHaveBeenCalledTimes(1)

    forgetDocument(host, '/vault/note.md')
    v.dispatch({ changes: { from: v.state.doc.length, insert: '.' } })
    await settle()
    expect(resolve).toHaveBeenCalledTimes(2)
    v.destroy()
  })

  it('asks again about every note after the vault changed', async () => {
    const { host, resolve } = notesHost('/vault/plan.md')
    const v = view('See [[plan]] here.\n\nend', host)
    await settle()
    forgetNotes(host)
    v.dispatch({ changes: { from: v.state.doc.length, insert: '.' } })
    await settle()
    expect(resolve).toHaveBeenCalledTimes(2)
    v.destroy()
  })

  it('forgets nothing of another host', async () => {
    const first = notesHost('/vault/plan.md')
    const second = notesHost('/vault/plan.md')
    const a = view('See [[plan]] here.\n\nend', first.host)
    const b = view('See [[plan]] here.\n\nend', second.host)
    await settle()
    forgetNotes(first.host)
    for (const v of [a, b]) v.dispatch({ changes: { from: v.state.doc.length, insert: '.' } })
    await settle()
    expect(first.resolve).toHaveBeenCalledTimes(2)
    expect(second.resolve).toHaveBeenCalledTimes(1)
    a.destroy()
    b.destroy()
  })
})

describe('the hover card', () => {
  it('hangs in a wrapper carrying the editor’s theme', () => {
    // Theme rules are scoped to the editor's classes. A card in the body
    // without them would be an unstyled box in the corner of the page.
    const { host } = notesHost('/vault/plan.md')
    const v = view('See [[plan]] here.', host)
    const card = document.body.querySelector('.cm-md-peek')
    expect(card).not.toBeNull()
    expect(card!.parentElement!.className).toBe(v.themeClasses)
    v.destroy()
    // And it leaves with the editor.
    expect(document.body.querySelector('.cm-md-peek')).toBeNull()
  })
})

describe('following a link', () => {
  it('reads the follow handler at the moment of the click', async () => {
    // A program may bring up what follows a link after the editor's first
    // frame — scheda's window does — so the handler is looked up late.
    const open = vi.fn()
    let follow: EditorHost['follow'] = undefined
    const { host: notes } = notesHost('/vault/plan.md')
    const host: EditorHost = {
      notes: notes.notes,
      get follow() {
        return follow
      },
    }
    await followTarget(host, '/vault/note.md', 'plan', null)
    expect(open).not.toHaveBeenCalled()

    follow = { open, goToHeading: vi.fn(), confirmCreate: vi.fn(), report: vi.fn() }
    await followTarget(host, '/vault/note.md', 'plan', null)
    expect(open).toHaveBeenCalledWith('/vault/plan.md')
  })
})

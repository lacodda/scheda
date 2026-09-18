// Wikilinks, held at the two places they can go wrong.
//
// The first is the parser: a `[[` inside a code span or a fence is not a link,
// and only the syntax tree knows that — which is the whole reason the parsing is
// a dialect extension rather than a regular expression over the text.
//
// The second is the rule this product has broken four times: hide a construction
// whole or not at all. A wikilink whose brackets went while its target stayed
// reads as `plan|the plan` — text the author never wrote. So the tests assert on
// what the reader sees, not on which spans were collapsed.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The core is mocked at the module boundary — the one door the frontend has
// (`core.ts`) — so these tests exercise the real editor against a known vault
// rather than a stub of the editor.
const resolveWikilinks = vi.fn()
const createFromWikilink = vi.fn()
const peekNote = vi.fn()
const resolveAsset = vi.fn()

vi.mock('../core', () => ({
  resolveWikilinks: (...args: unknown[]) => resolveWikilinks(...args),
  createFromWikilink: (...args: unknown[]) => createFromWikilink(...args),
  peekNote: (...args: unknown[]) => peekNote(...args),
  resolveAsset: (...args: unknown[]) => resolveAsset(...args),
  completeWikilink: vi.fn(async () => []),
  readHeadings: vi.fn(async () => []),
  pasteImage: vi.fn(),
}))

const { schedaSetup } = await import('./setup')
const {
  forgetAllEmbeds,
  forgetAllLinks,
  followTarget,
  labelOf,
  parseTarget,
  relativeFrom,
  setFollowLink,
  wikilinksIn,
} = await import('./wikilinks')
const { documentPath } = await import('./images')

/** An editor over `doc`, told it is the file at `path`. */
function view(doc: string, cursor = 0, path: string | null = '/vault/note.md'): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [...schedaSetup(), documentPath.init(() => path)],
      selection: { anchor: cursor },
    }),
    parent,
  })
}

/** What the reader sees: the editor's text with the decorations applied.
 *
 *  Read off the DOM rather than off the document, because the document is the
 *  source and the whole question here is what was drawn over it. */
function rendered(v: EditorView): string {
  return [...v.dom.querySelectorAll('.cm-line')]
    .map((line) => line.textContent)
    .join('\n')
    .trim()
}

/** The label of every wikilink widget drawn. */
function drawn(v: EditorView): string[] {
  return [...v.dom.querySelectorAll('.cm-md-wikilink')].map((e) => e.textContent ?? '')
}

/** Lets the resolver's promise and the redraw it dispatches land. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  forgetAllLinks()
  forgetAllEmbeds()
  setFollowLink(null)
  resolveWikilinks.mockReset()
  createFromWikilink.mockReset()
  peekNote.mockReset()
  resolveAsset.mockReset()
  resolveWikilinks.mockResolvedValue([])
})

describe('taking a wikilink apart', () => {
  it('reads a plain name', () => {
    expect(parseTarget('note')).toEqual({ target: 'note', heading: null, alias: null })
  })

  it('reads a heading and an alias', () => {
    expect(parseTarget('plan#Risks|what could go wrong')).toEqual({
      target: 'plan',
      heading: 'Risks',
      alias: 'what could go wrong',
    })
  })

  it('leaves a hash inside an alias alone', () => {
    // The order is `path#heading|alias`, so the alias is split off first.
    // Splitting on `#` first reads `issue #4` as a heading — and this is the case
    // the core's own test holds, because the two have to agree.
    expect(parseTarget('plan|issue #4')).toEqual({
      target: 'plan',
      heading: null,
      alias: 'issue #4',
    })
  })

  it('treats empty halves as absent', () => {
    expect(parseTarget('note#').heading).toBeNull()
    expect(parseTarget('note|').alias).toBeNull()
  })

  it('shows the alias, else the name, else the heading', () => {
    const link = (target: string, heading: string | null, alias: string | null) => ({
      from: 0,
      to: 0,
      embed: false,
      target,
      heading,
      alias,
    })
    expect(labelOf(link('plan', null, 'the plan'))).toBe('the plan')
    // The folders come off: the sentence around the link was written to read as
    // the name.
    expect(labelOf(link('projects/scheda/plan', null, null))).toBe('plan')
    // The heading stays: showing `plan` for `[[plan#Risks]]` loses the half of
    // the link that says where in the note it goes.
    expect(labelOf(link('plan', 'Risks', null))).toBe('plan › Risks')
    expect(labelOf(link('', 'Risks', null))).toBe('#Risks')
  })
})

describe('finding wikilinks in a document', () => {
  it('finds a link, an alias and an embed', () => {
    const v = view('See [[plan]] and [[a|b]] and ![[shot.png]]\n')
    const found = wikilinksIn(v.state)
    expect(found.map((link) => link.target)).toEqual(['plan', 'a', 'shot.png'])
    expect(found.map((link) => link.embed)).toEqual([false, false, true])
    v.destroy()
  })

  it('does not find one inside a code span', () => {
    // The reason the parsing is a dialect extension: a note *about* wikilinks
    // writes them in code spans, and a regular expression over the text would
    // turn every one of them into a link.
    const v = view('Write `[[like this]]` to link.\n')
    expect(wikilinksIn(v.state)).toHaveLength(0)
    v.destroy()
  })

  it('does not find one inside a fenced block', () => {
    const v = view('```\n[[not a link]]\n```\n')
    expect(wikilinksIn(v.state)).toHaveLength(0)
    v.destroy()
  })

  it('does not read an unclosed pair as a link', () => {
    // What somebody has while they are typing one. A parser that took the rest
    // of the note as the target would redraw the whole paragraph per keystroke.
    const v = view('half typed [[pl\n')
    expect(wikilinksIn(v.state)).toHaveLength(0)
    v.destroy()
  })

  it('does not let a link swallow the next line', () => {
    const v = view('[[open\nand [[closed]]\n')
    expect(wikilinksIn(v.state).map((link) => link.target)).toEqual(['closed'])
    v.destroy()
  })

  it('reads an empty pair as no link at all', () => {
    const v = view('[[]] is nothing\n')
    expect(wikilinksIn(v.state)).toHaveLength(0)
    v.destroy()
  })
})

describe('drawing a wikilink', () => {
  it('draws the label and none of the syntax', async () => {
    // The rule this product has broken four times: a construction is hidden
    // whole or not at all. `[[plan|the plan]]` drawn as `plan|the plan` is text
    // the author never wrote.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    const v = view('See [[plan|the plan]] here.\n\nelsewhere\n', 30)
    await settle()

    expect(rendered(v)).toBe('See the plan here.\n\nelsewhere')
    expect(rendered(v)).not.toContain('[[')
    expect(rendered(v)).not.toContain('|')
    v.destroy()
  })

  it('shows the source on the line being edited', async () => {
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    // Caret inside the link: the brackets are text being edited, and an editor
    // that hides them cannot be typed into.
    const v = view('See [[plan|the plan]] here.\n', 8)
    await settle()

    expect(rendered(v)).toBe('See [[plan|the plan]] here.')
    v.destroy()
  })

  it('shows every link on the line being edited, not only the one under the caret', async () => {
    // Every other marker in the editor comes back when the caret steps onto its
    // line. A line where `[[plan]]` shows its brackets while the aliased link
    // beside it stays drawn is half source and half rendering — which is the
    // seam this product keeps closing, and which the tests missed because each
    // of them put one link on a line.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    const v = view('A [[plan]] and [[plan|the week ahead]].\n', 4)
    await settle()

    expect(drawn(v)).toHaveLength(0)
    expect(rendered(v)).toBe('A [[plan]] and [[plan|the week ahead]].')
    v.destroy()
  })

  it('draws every link on a line the caret is not on', async () => {
    // The other half of the same rule, so the test above cannot pass by never
    // drawing anything.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    const v = view('A [[plan]] and [[plan|the week ahead]].\n\nelsewhere\n', 41)
    await settle()

    expect(drawn(v)).toEqual(['plan', 'the week ahead'])
    v.destroy()
  })

  it('marks a link whose note does not exist', async () => {
    resolveWikilinks.mockResolvedValue([{ path: null, target: null }])
    const v = view('See [[the idea]] here.\n\nelsewhere\n', 25)
    await settle()

    // Drawn, not hidden: writing a link before its note is how a vault grows.
    expect(drawn(v)).toEqual(['the idea'])
    expect(v.dom.querySelector('.cm-md-wikilink-missing')).not.toBeNull()
    v.destroy()
  })

  it('does not mark a link whose note exists', async () => {
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    const v = view('See [[plan]] here.\n\nelsewhere\n', 21)
    await settle()

    expect(drawn(v)).toEqual(['plan'])
    expect(v.dom.querySelector('.cm-md-wikilink-missing')).toBeNull()
    v.destroy()
  })

  it('asks the core once for a target that appears twice', async () => {
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    const v = view('[[plan]] and [[plan]] again\n\nelsewhere\n', 31)
    await settle()

    expect(resolveWikilinks).toHaveBeenCalledTimes(1)
    expect(resolveWikilinks).toHaveBeenCalledWith('/vault/note.md', ['plan'])
    v.destroy()
  })

  it('asks for every link in the note in one call', async () => {
    // A note of a hundred wikilinks is ordinary in a vault. One call per link
    // would be the round-trip-per-item shape the product keeps refusing.
    resolveWikilinks.mockResolvedValue([
      { path: '/vault/a.md', target: 'a' },
      { path: '/vault/b.md', target: 'b' },
    ])
    const v = view('[[a]] [[b]]\n\nelsewhere\n', 15)
    await settle()

    expect(resolveWikilinks).toHaveBeenCalledTimes(1)
    expect(resolveWikilinks.mock.calls[0][1]).toEqual(['a', 'b'])
    v.destroy()
  })

  it('asks nothing of a buffer with no file', async () => {
    // An unsaved draft has no vault, so a name in it points at nothing yet.
    const v = view('[[plan]]\n\nelsewhere\n', 12, null)
    await settle()
    expect(resolveWikilinks).not.toHaveBeenCalled()
    v.destroy()
  })

  it('never changes the document', async () => {
    // The whole difference between this and a WYSIWYG editor: everything above
    // is drawn over the text, and the text is the file. The caret sits on the
    // last line so the links above it are all being drawn while this is asked.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    const source = 'See [[plan|the plan]] and ![[shot.png]]\n\nelsewhere\n'
    const v = view(source, 45)
    await settle()
    expect(v.state.doc.toString()).toBe(source)
    v.destroy()
  })
})

describe('following a wikilink', () => {
  it('opens the note a link resolves to', async () => {
    const open = vi.fn()
    setFollowLink({ open, goToHeading: vi.fn(), confirmCreate: vi.fn(), report: vi.fn() })
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])

    await followTarget('/vault/note.md', 'plan', null)
    expect(open).toHaveBeenCalledWith('/vault/plan.md')
  })

  it('goes to a heading in this note without opening anything', async () => {
    const open = vi.fn()
    const goToHeading = vi.fn()
    setFollowLink({ open, goToHeading, confirmCreate: vi.fn(), report: vi.fn() })

    await followTarget('/vault/note.md', '', 'Risks')
    expect(goToHeading).toHaveBeenCalledWith('Risks')
    expect(open).not.toHaveBeenCalled()
    // And it works with no vault at all, which is the point of the case.
    await followTarget(null, '', 'Risks')
    expect(goToHeading).toHaveBeenCalledTimes(2)
  })

  it('offers to create a note that is not there, and opens what it made', async () => {
    const open = vi.fn()
    const confirmCreate = vi.fn(async () => true)
    setFollowLink({ open, goToHeading: vi.fn(), confirmCreate, report: vi.fn() })
    resolveWikilinks.mockResolvedValue([{ path: null, target: null }])
    createFromWikilink.mockResolvedValue('/vault/the idea.md')

    await followTarget('/vault/note.md', 'the idea', null)
    expect(confirmCreate).toHaveBeenCalledWith('the idea')
    expect(createFromWikilink).toHaveBeenCalledWith('/vault/note.md', 'the idea')
    expect(open).toHaveBeenCalledWith('/vault/the idea.md')
  })

  it('creates nothing when the offer is declined', async () => {
    // A stray click on a typo must not leave a file behind.
    const open = vi.fn()
    setFollowLink({
      open,
      goToHeading: vi.fn(),
      confirmCreate: async () => false,
      report: vi.fn(),
    })
    resolveWikilinks.mockResolvedValue([{ path: null, target: null }])

    await followTarget('/vault/note.md', 'typo', null)
    expect(createFromWikilink).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('says so rather than doing nothing when the note has no file', async () => {
    const report = vi.fn()
    setFollowLink({ open: vi.fn(), goToHeading: vi.fn(), confirmCreate: vi.fn(), report })

    await followTarget(null, 'plan', null)
    expect(report).toHaveBeenCalled()
    expect(resolveWikilinks).not.toHaveBeenCalled()
  })

  it('does not offer to create a note when the vault could not be searched', async () => {
    // The difference between "no such note" and "no answer". Offering to create
    // one here would put a second note of that name in the vault's new-note
    // folder while the first sits wherever it sits — and the click that did it
    // would look like it worked.
    const confirmCreate = vi.fn(async () => true)
    const report = vi.fn()
    setFollowLink({ open: vi.fn(), goToHeading: vi.fn(), confirmCreate, report })
    resolveWikilinks.mockRejectedValue(new Error('the core is not answering'))

    await followTarget('/vault/note.md', 'plan', null)
    expect(confirmCreate).not.toHaveBeenCalled()
    expect(createFromWikilink).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalled()
  })

  it('asks again after a failed lookup rather than giving up on the link', async () => {
    // A failed call must not leave the link cached as missing: the next draw has
    // to ask, or one hiccup makes the link dead until the tab is reopened.
    resolveWikilinks.mockRejectedValueOnce(new Error('not answering'))
    const v = view('See [[plan]] here.\n\nelsewhere\n', 21)
    await settle()

    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    // A change to the document is what makes the plugin ask again.
    v.dispatch({ changes: { from: v.state.doc.length, insert: 'more\n' } })
    await settle()

    expect(resolveWikilinks).toHaveBeenCalledTimes(2)
    expect(v.dom.querySelector('.cm-md-wikilink-missing')).toBeNull()
    v.destroy()
  })

  it('reports a refusal from the core', async () => {
    const report = vi.fn()
    setFollowLink({
      open: vi.fn(),
      goToHeading: vi.fn(),
      confirmCreate: async () => true,
      report,
    })
    resolveWikilinks.mockResolvedValue([{ path: null, target: null }])
    createFromWikilink.mockRejectedValue(new Error('“what?” is not a name this vault can hold'))

    await followTarget('/vault/note.md', 'what?', null)
    expect(report).toHaveBeenCalledWith('“what?” is not a name this vault can hold')
  })

  it('follows a click on a drawn link', async () => {
    const open = vi.fn()
    setFollowLink({ open, goToHeading: vi.fn(), confirmCreate: vi.fn(), report: vi.fn() })
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])

    const v = view('See [[plan]] here.\n\nelsewhere\n', 21)
    await settle()
    const span = v.dom.querySelector<HTMLElement>('.cm-md-wikilink')
    expect(span).not.toBeNull()
    span!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await settle()

    expect(open).toHaveBeenCalledWith('/vault/plan.md')
    v.destroy()
  })
})

describe('embedding a note', () => {
  it('draws an embedded note as its opening', async () => {
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    peekNote.mockResolvedValue({ name: 'plan', text: 'The first line of the plan.' })

    const v = view('![[plan]]\n\nelsewhere\n', 14)
    await settle()
    await settle()

    const embed = v.dom.querySelector('.cm-md-embed')
    expect(embed).not.toBeNull()
    expect(embed!.querySelector('.cm-md-embed-head')?.textContent).toBe('plan')
    expect(embed!.querySelector('.cm-md-embed-body')?.textContent).toBe(
      'The first line of the plan.',
    )
    v.destroy()
  })

  it('draws an embedded picture through the asset door', async () => {
    // Not a second way in: `resolveAsset` is the core's checked door for anything
    // the webview loads (ADR 0004), and an embed goes through it like a markdown
    // image does.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/assets/shot.png', target: null }])
    resolveAsset.mockResolvedValue('asset://localhost/shot.png')

    const v = view('![[shot.png]]\n\nelsewhere\n', 18)
    await settle()
    await settle()

    const img = v.dom.querySelector<HTMLImageElement>('.cm-md-image img')
    expect(img).not.toBeNull()
    expect(img!.src).toContain('shot.png')
    expect(resolveAsset).toHaveBeenCalled()
    expect(peekNote).not.toHaveBeenCalled()
    v.destroy()
  })

  it('leaves the source showing on the line being edited', async () => {
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    peekNote.mockResolvedValue({ name: 'plan', text: 'body' })

    const v = view('![[plan]]\n', 3)
    await settle()
    await settle()

    expect(v.dom.querySelector('.cm-md-embed')).toBeNull()
    expect(rendered(v)).toContain('![[plan]]')
    v.destroy()
  })

  it('draws embeds in a view that mounted while the answers were in flight', async () => {
    // Two views over the same note — two tabs, or a tab reopened a moment after
    // the first draw. The cache is shared and the *claim* on a pending target is
    // what the second view sees, so it finds nothing to ask for and would sit
    // with no embeds forever: the nudge that lands only goes to the view that
    // asked. Found by looking at the preview page, with every test green.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])
    peekNote.mockResolvedValue({ name: 'plan', text: 'The opening.' })

    const first = view('![[plan]]\n\nelsewhere\n', 14)
    // Mounted before the first view's request has landed.
    const second = view('![[plan]]\n\nelsewhere\n', 14)
    await settle()
    await settle()

    expect(first.dom.querySelector('.cm-md-embed')).not.toBeNull()
    expect(second.dom.querySelector('.cm-md-embed')).not.toBeNull()
    first.destroy()
    second.destroy()
  })

  it('draws links in a view that mounted while the answers were in flight', async () => {
    // The same hole on the inline side.
    resolveWikilinks.mockResolvedValue([{ path: '/vault/plan.md', target: 'plan' }])

    const first = view('See [[plan]].\n', 14)
    const second = view('See [[plan]].\n', 14)
    await settle()
    await settle()

    // Neither may be left drawn as a link to a note that does not exist.
    expect(first.dom.querySelector('.cm-md-wikilink-missing')).toBeNull()
    expect(second.dom.querySelector('.cm-md-wikilink-missing')).toBeNull()
    first.destroy()
    second.destroy()
  })

  it('leaves an embed of a missing note as a link', async () => {
    // Nothing to show. A grey box would say less than the link does.
    resolveWikilinks.mockResolvedValue([{ path: null, target: null }])

    const v = view('![[not yet]]\n\nelsewhere\n', 17)
    await settle()
    await settle()

    expect(v.dom.querySelector('.cm-md-embed')).toBeNull()
    expect(drawn(v)).toEqual(['not yet'])
    v.destroy()
  })
})

describe('a path written back as a link', () => {
  it('climbs out of the note’s folder', () => {
    expect(relativeFrom('/vault/daily/today.md', '/vault/assets/shot.png')).toBe(
      '../assets/shot.png',
    )
  })

  it('stays inside the folder when it can', () => {
    expect(relativeFrom('/vault/daily/today.md', '/vault/daily/shot.png')).toBe('shot.png')
  })

  it('keeps the platform’s separator', () => {
    expect(relativeFrom('C:\\vault\\daily\\today.md', 'C:\\vault\\shot.png')).toBe('..\\shot.png')
  })
})

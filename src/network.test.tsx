// What the network panel puts on screen for the answers the core gives it.
//
// The reading is tested where it lives (`network.rs`, `rename_links.rs`): which
// notes link here, what resolves to nothing, which links a rename would rewrite.
// What is tested here is the part that is the window's own work — that an empty
// answer, a pending one and a full one each say the right thing, and that an
// answer is never shown against a note it was not read for.
//
// Rendered with `react-dom/client` and `act` rather than a testing library. The
// project has React, jsdom and vitest already; a rendering library would be a
// fourth dependency for the four queries below, which the DOM answers itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NetworkPanel } from './network'
import type { EditorHandle } from './editor/mount'
import type { Network } from './core'

const readNetwork = vi.hoisted(() => vi.fn())
vi.mock('./core', () => ({ readNetwork }))

/** Just enough editor for the panel: it asks for the open tab's path. */
function editorShowing(path: string | null): EditorHandle {
  return { active: () => ({ id: 1, path }) } as unknown as EditorHandle
}

function answer(links: Partial<Network>): Network {
  return { backlinks: [], unresolved: [], ...links }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  readNetwork.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Draws the panel and waits for whatever it asked the core to settle. */
async function draw(
  path: string | null = '/vault/plan.md',
  { visible = true, revision = 0, onOpen = vi.fn(), onCreate = vi.fn() } = {},
) {
  await act(async () => {
    root.render(
      <NetworkPanel
        editor={editorShowing(path)}
        visible={visible}
        revision={revision}
        onOpen={onOpen}
        onCreate={onCreate}
      />,
    )
  })
}

/** The text of every row, as a person would read the list. */
function rows(): string[] {
  return [...host.querySelectorAll('.network-item')].map((row) =>
    [...row.children].map((part) => part.textContent).join(' · '),
  )
}

function clickRow(text: string): void {
  const row = [...host.querySelectorAll('.network-item')].find((candidate) =>
    candidate.textContent?.includes(text),
  )
  if (!row) throw new Error(`no row saying “${text}” — rows are ${JSON.stringify(rows())}`)
  act(() => {
    ;(row as HTMLButtonElement).click()
  })
}

describe('the panel', () => {
  it('is nothing at all until it is asked for', async () => {
    // A notepad that opens with three sidebars is not a notepad. Hidden means
    // not rendered rather than rendered with no width, so it costs nothing and
    // asks the core nothing.
    readNetwork.mockResolvedValue(answer({}))
    await draw('/vault/plan.md', { visible: false })
    expect(host.innerHTML).toBe('')
    expect(readNetwork).not.toHaveBeenCalled()
  })

  it('says the note is not in a vault rather than that nothing links here', async () => {
    // Two different facts, and only one of them is about the note. A lone file
    // on the Desktop has no vault whose links could point at it.
    await draw(null)
    expect(host.textContent).toContain('Not in a vault')
    expect(readNetwork).not.toHaveBeenCalled()
  })

  it('says it is reading before the answer arrives', async () => {
    // On a vault of a few thousand notes the read is the one part a person can
    // notice, and an empty panel during it would say "nothing links here" —
    // a claim, and at that moment an unfounded one.
    readNetwork.mockReturnValue(new Promise(() => {}))
    await draw()
    expect(host.textContent).toContain('Reading the vault…')
    expect(host.textContent).not.toContain('Nothing links here')
  })

  it('lists what links here, with the sentence each link sits in', async () => {
    readNetwork.mockResolvedValue(
      answer({
        backlinks: [
          {
            path: '/vault/notes/one.md',
            relative: 'notes/one.md',
            line: 3,
            context: 'we follow [[plan]] closely',
            target: 'plan',
          },
        ],
      }),
    )
    await draw()
    // The sentence, not only the file name: a list of names says which notes
    // mention this one, a list of sentences says what they say about it.
    expect(rows()).toEqual(['notes/one.md · we follow [[plan]] closely'])
  })

  it('opens a backlink at the line the link is on', async () => {
    const onOpen = vi.fn()
    readNetwork.mockResolvedValue(
      answer({
        backlinks: [
          {
            path: '/vault/notes/one.md',
            relative: 'notes/one.md',
            line: 42,
            context: 'here',
            target: 'plan',
          },
        ],
      }),
    )
    await draw('/vault/plan.md', { onOpen })
    clickRow('notes/one.md')
    // The line, not only the file: a backlink that opens a long note at its
    // first paragraph has answered "which note" and dropped "where in it".
    expect(onOpen).toHaveBeenCalledWith('/vault/notes/one.md', 42)
  })

  it('shows two links from one note as two rows', async () => {
    // They are two places, and a note that mentions this one twice says two
    // things about it.
    readNetwork.mockResolvedValue(
      answer({
        backlinks: [
          { path: '/v/a.md', relative: 'a.md', line: 1, context: 'first', target: 'plan' },
          { path: '/v/a.md', relative: 'a.md', line: 9, context: 'second', target: 'plan' },
        ],
      }),
    )
    await draw()
    expect(rows()).toEqual(['a.md · first', 'a.md · second'])
  })

  it('offers to write a note a link points at in vain', async () => {
    const onCreate = vi.fn()
    readNetwork.mockResolvedValue(
      answer({
        unresolved: [{ target: 'the thing', line: 2, context: 'see [[the thing]]' }],
      }),
    )
    await draw('/vault/plan.md', { onCreate })
    // A vault accumulates these on purpose — writing `[[the thing]]` before the
    // thing exists is how notes get planned — so the row is an offer, not an
    // error.
    expect(host.textContent).toContain('Not written yet')
    clickRow('the thing')
    expect(onCreate).toHaveBeenCalledWith('the thing')
  })

  it('does not show the unwritten heading when there is nothing under it', async () => {
    readNetwork.mockResolvedValue(answer({}))
    await draw()
    expect(host.textContent).toContain('Nothing links here')
    expect(host.textContent).not.toContain('Not written yet')
  })

  it('asks again when the vault has been written to', async () => {
    // The answer is about the files on disk. A rename that rewrote links in
    // three notes changed what points here, and a panel still showing the old
    // answer is showing something that is no longer true.
    readNetwork.mockResolvedValue(answer({}))
    await draw()
    expect(readNetwork).toHaveBeenCalledTimes(1)

    await draw('/vault/plan.md', { revision: 1 })
    expect(readNetwork).toHaveBeenCalledTimes(2)
  })

  it('does not show one note’s answer against another note', async () => {
    // The answer belongs to the note it was read for. Switching tabs while a
    // read is in flight would otherwise put the first note's backlinks under
    // the second note's name.
    let settle: ((value: Network) => void) | null = null
    readNetwork.mockReturnValueOnce(
      new Promise<Network>((resolve) => {
        settle = resolve
      }),
    )
    await draw('/vault/first.md')

    readNetwork.mockResolvedValue(answer({}))
    await draw('/vault/second.md')

    await act(async () => {
      settle?.(
        answer({
          backlinks: [
            {
              path: '/v/a.md',
              relative: 'a.md',
              line: 1,
              context: 'about the first',
              target: 'first',
            },
          ],
        }),
      )
    })
    expect(host.textContent).not.toContain('about the first')
  })
})

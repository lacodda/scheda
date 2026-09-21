// What the tags panel puts on screen for the answers the core gives it.
//
// The reading is tested where it lives (`tags.rs`): what counts as a tag, what
// a heading is, what a colour is. What is tested here is the part that is the
// window's own work — that the panel is about the VAULT rather than about the
// open note, which is the one way it differs from the network panel beside it
// and therefore the one thing worth getting wrong.
//
// Rendered with `react-dom/client` and `act` rather than a testing library, for
// the reason `network.test.tsx` gives: the project has React, jsdom and vitest
// already, and the DOM answers these queries itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TagsPanel } from './tags'
import type { EditorHandle } from './editor/mount'
import type { Tag } from './core'

const readTags = vi.hoisted(() => vi.fn())
vi.mock('./core', () => ({ readTags }))

/** Just enough editor for the panel: it asks for the open tab's path. */
function editorShowing(path: string | null): EditorHandle {
  return { active: () => ({ id: 1, path }) } as unknown as EditorHandle
}

function tag(name: string, paths: string[], line: number | null = 3): Tag {
  return {
    name,
    notes: paths.length,
    places: paths.map((path) => ({
      path,
      relative: path.replace('/vault/', ''),
      line,
      context: line === null ? '' : `a line mentioning #${name}`,
    })),
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  readTags.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Renders the panel and lets the answer arrive. */
async function show(
  path: string | null,
  answer: Tag[] | Promise<Tag[]>,
  props: { visible?: boolean } = {},
) {
  readTags.mockReturnValue(answer instanceof Promise ? answer : Promise.resolve(answer))
  await act(async () => {
    root.render(
      <TagsPanel
        editor={editorShowing(path)}
        visible={props.visible ?? true}
        revision={0}
        onOpen={() => undefined}
      />,
    )
  })
}

/** Types into a controlled input.
 *
 *  Setting `.value` directly does not reach React: it caches the last value it
 *  rendered on the node, sees no difference and drops the event. The native
 *  setter is what React's own test utilities use, for exactly this. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const names = () => [...host.querySelectorAll('.tags-name')].map((e) => e.textContent)
const rows = () => [...host.querySelectorAll('.tags-item')] as HTMLButtonElement[]

describe('the tags panel', () => {
  it('lists the vault, most-used first, as the core ordered it', async () => {
    await show('/vault/note.md', [
      tag('rust', ['/vault/a.md', '/vault/b.md']),
      tag('prose', ['/vault/a.md']),
    ])

    expect(names()).toEqual(['#rust', '#prose'])
    // Notes, not mentions.
    expect([...host.querySelectorAll('.tags-notes')].map((e) => e.textContent)).toEqual(['2', '1'])
  })

  it('keeps the vault list for a note carrying no tags', async () => {
    // The point of the panel, and the way it differs from the network beside
    // it. A note with no tags is the ordinary case and the moment the panel is
    // most likely to be opened — going blank there would make it useless.
    await show('/vault/untagged.md', [tag('rust', ['/vault/a.md'])])

    expect(names()).toEqual(['#rust'])
    expect(rows()[0].className).not.toContain('tags-item--here')
  })

  it("marks the tags the open note carries", async () => {
    await show('/vault/a.md', [tag('rust', ['/vault/a.md']), tag('prose', ['/vault/b.md'])])

    const [rust, prose] = rows()
    expect(rust.className).toContain('tags-item--here')
    expect(prose.className).not.toContain('tags-item--here')
  })

  it('matches the open note however the path is spelled', async () => {
    // Windows hands the same file back in more than one case, and a mark that
    // depends on the spelling is a mark that is sometimes simply absent.
    await show('C:\\vault\\A.md', [tag('rust', ['c:\\vault\\a.md'])])
    expect(rows()[0].className).toContain('tags-item--here')
  })

  it('says it is reading rather than saying there is nothing', async () => {
    // A panel that says "No tags in this vault" while it is still reading is a
    // panel that lies for as long as the read takes.
    let settle: (tags: Tag[]) => void = () => undefined
    const pending = new Promise<Tag[]>((resolve) => {
      settle = resolve
    })
    await show('/vault/note.md', pending)

    expect(host.querySelector('.tags-empty')?.textContent).toBe('Reading the vault…')

    await act(async () => {
      settle([tag('rust', ['/vault/a.md'])])
      await pending
    })
    expect(names()).toEqual(['#rust'])
  })

  it('says a lone file is not in a vault', async () => {
    await show(null, [])
    expect(host.querySelector('.tags-empty')?.textContent).toBe('Not in a vault')
    expect(readTags).not.toHaveBeenCalled()
  })

  it('says the vault has none, which is not the same as no match', async () => {
    await show('/vault/note.md', [])
    expect(host.querySelector('.tags-empty')?.textContent).toBe('No tags in this vault')
  })

  it('filters by name and says so when nothing matches', async () => {
    await show('/vault/note.md', [tag('rust', ['/vault/a.md']), tag('prose', ['/vault/b.md'])])

    const filter = host.querySelector('.tags-filter') as HTMLInputElement
    await act(async () => {
      type(filter, 'ru')
    })
    expect(names()).toEqual(['#rust'])

    await act(async () => {
      type(filter, 'nothing like it')
    })
    expect(host.querySelector('.tags-empty')?.textContent).toBe('No tag matches')
  })

  it('opens a tag to show where it is carried', async () => {
    await show('/vault/note.md', [tag('rust', ['/vault/a.md', '/vault/b.md'])])

    expect(host.querySelectorAll('.tags-place')).toHaveLength(0)
    await act(async () => {
      rows()[0].click()
    })
    expect([...host.querySelectorAll('.tags-where')].map((e) => e.textContent)).toEqual([
      'a.md',
      'b.md',
    ])
  })

  it('opens a front-matter tag at the top of the note', async () => {
    // It has no line of its own — it is a property of the note — so line 1 is
    // the honest answer rather than a guess at where the body starts.
    const opened: [string, number][] = []
    readTags.mockReturnValue(Promise.resolve([tag('rust', ['/vault/a.md'], null)]))
    await act(async () => {
      root.render(
        <TagsPanel
          editor={editorShowing('/vault/note.md')}
          visible
          revision={0}
          onOpen={(path, line) => opened.push([path, line])}
        />,
      )
    })

    await act(async () => {
      rows()[0].click()
    })
    await act(async () => {
      ;(host.querySelector('.tags-place') as HTMLButtonElement).click()
    })
    expect(opened).toEqual([['/vault/a.md', 1]])
  })

  it('asks for nothing while it is hidden', async () => {
    await show('/vault/note.md', [], { visible: false })
    expect(readTags).not.toHaveBeenCalled()
    expect(host.querySelector('.tags')).toBeNull()
  })
})

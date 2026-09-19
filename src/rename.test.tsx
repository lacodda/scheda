// The rename preview: what a person is shown before anything is written to
// somebody else's notes, and what happens to the answer they give.
//
// Which links would change is the core's, and tested there (`rename_links.rs`).
// What is tested here is the promise the window makes around it: that a plan is
// never applied without an answer, that a rename with nothing to rewrite does
// not stop to ask, and that cancelling writes nothing at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RenamePreview, UndoBar } from './rename'
import type { RenameApplied, RenamePlan } from './core'

const planRename = vi.hoisted(() => vi.fn())
const applyRename = vi.hoisted(() => vi.fn())
vi.mock('./core', () => ({ planRename, applyRename }))

function plan(over: Partial<RenamePlan> = {}): RenamePlan {
  return {
    from: '/vault/plan.md',
    to: '/vault/roadmap.md',
    files: [],
    links: 0,
    unreadable: [],
    ...over,
  }
}

/** A plan that would rewrite one link, which is what makes the dialog appear. */
function planWithOneLink(): RenamePlan {
  return plan({
    links: 1,
    files: [
      {
        path: '/vault/notes/one.md',
        relative: 'notes/one.md',
        edits: [
          {
            line: 3,
            before: 'plan',
            after: 'roadmap',
            lineBefore: 'see [[plan]] for the shape',
            lineAfter: 'see [[roadmap]] for the shape',
          },
        ],
      },
    ],
  })
}

function applied(over: Partial<RenameApplied> = {}): RenameApplied {
  return { from: '/vault/plan.md', to: '/vault/roadmap.md', files: [], links: 0, ...over }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  planRename.mockReset()
  applyRename.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function draw(onDone = vi.fn(), onFailure = vi.fn()) {
  await act(async () => {
    root.render(
      <RenamePreview
        path="/vault/plan.md"
        name="roadmap.md"
        onDone={onDone}
        onFailure={onFailure}
      />,
    )
  })
  return { onDone, onFailure }
}

function click(label: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) {
    const seen = [...host.querySelectorAll('button')].map((b) => b.textContent?.trim())
    throw new Error(`no button “${label}” — there is ${JSON.stringify(seen)}`)
  }
  act(() => button.click())
}

describe('the rename preview', () => {
  it('does not stop to ask when no link would change', async () => {
    // A dialog saying "0 links will be updated, proceed?" teaches people to
    // click through dialogs. The tree already renames a file in one gesture,
    // and this is that gesture.
    planRename.mockResolvedValue(plan())
    applyRename.mockResolvedValue(applied())
    const { onDone } = await draw()

    expect(applyRename).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith(applied())
    // Nothing was ever put up to approve. (The component is still mounted here
    // because this test has no parent to unmount it; in the window `onDone` is
    // what takes it down.)
    expect(host.querySelector('.rename-actions')).toBeNull()
  })

  it('asks before writing when links would change', async () => {
    planRename.mockResolvedValue(planWithOneLink())
    const { onDone } = await draw()

    // Nothing has been written, and nothing will be until the button is
    // pressed. This is the whole shape of the feature.
    expect(applyRename).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(host.textContent).toContain('1 link')
    expect(host.textContent).toContain('1 note')
  })

  it('shows every line that would change, before and after', async () => {
    // What is being approved is a write to somebody's notes, and a count is not
    // something a person can check.
    planRename.mockResolvedValue(planWithOneLink())
    await draw()

    expect(host.querySelector('.rename-file-name')?.textContent).toBe('notes/one.md')
    expect(host.querySelector('.rename-line-number')?.textContent).toBe('3')
    expect(host.querySelector('.rename-before')?.textContent).toBe('see [[plan]] for the shape')
    expect(host.querySelector('.rename-after')?.textContent).toBe('see [[roadmap]] for the shape')
  })

  it('writes nothing when the person backs out', async () => {
    planRename.mockResolvedValue(planWithOneLink())
    const { onDone } = await draw()

    click('Cancel')
    expect(applyRename).not.toHaveBeenCalled()
    // Null rather than a result: nothing happened, and the caller must not move
    // a tab or a recent entry as though something had.
    expect(onDone).toHaveBeenCalledWith(null)
  })

  it('writes what was shown when the person agrees', async () => {
    const shown = planWithOneLink()
    planRename.mockResolvedValue(shown)
    applyRename.mockResolvedValue(applied({ links: 1 }))
    const { onDone } = await draw()

    click('Rename and update')
    await act(async () => {})

    // The same plan goes back, so what is performed is what was approved rather
    // than a second reading of a vault that may have moved on.
    expect(applyRename).toHaveBeenCalledWith(shown)
    expect(onDone).toHaveBeenCalledWith(applied({ links: 1 }))
  })

  it('names the notes it could not read', async () => {
    // One of them may hold a link that is about to break, and the person is the
    // one who can go and look. Passing over them silently is the failure this
    // whole design is against.
    planRename.mockResolvedValue(plan({ ...planWithOneLink(), unreadable: ['latin1.md'] }))
    await draw()
    expect(host.textContent).toContain('latin1.md')
    expect(host.textContent).toContain('could not be read')
  })

  it('hands a refusal on and closes rather than leaving a dialog nobody can answer', async () => {
    planRename.mockRejectedValue({ message: '“roadmap.md” already exists' })
    const { onDone, onFailure } = await draw()

    expect(onFailure).toHaveBeenCalledWith('“roadmap.md” already exists')
    expect(onDone).toHaveBeenCalledWith(null)
  })

  it('closes on Escape without writing', async () => {
    planRename.mockResolvedValue(planWithOneLink())
    const { onDone } = await draw()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(applyRename).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith(null)
  })
})

describe('the undo offer', () => {
  it('says what happened and offers to take it back', () => {
    const onUndo = vi.fn()
    act(() => {
      root.render(
        <UndoBar
          applied={applied({ links: 2, files: [{ path: '/v/a.md', relative: 'a.md', edits: [] }] })}
          onUndo={onUndo}
          onDismiss={vi.fn()}
        />,
      )
    })

    expect(host.textContent).toContain('roadmap.md')
    expect(host.textContent).toContain('2 links')
    click('Undo')
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('goes away on its own', () => {
    // The horizon is honest: the bytes it would restore are only the right ones
    // while nothing else has written over them, so the offer does not outlive
    // the truth behind it.
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    act(() => {
      root.render(<UndoBar applied={applied({ links: 1 })} onUndo={vi.fn()} onDismiss={onDismiss} />)
    })

    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(12_000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

// The card that appears when a link is hovered: the name of the note it goes to
// and its opening lines.
//
// dowel has a `PreviewCard` and scheda does not use it. That component is built
// on Base UI, `class-variance-authority`, Tailwind and `dowel-ui`, and scheda has
// none of the four: the product's first rule is that nothing runs before the
// text is on screen, and four packages plus a stylesheet for one hover card is
// exactly the thing that rule refuses. What is taken from dowel is the part worth
// copying — the tokens the card is coloured with, and two rules its own
// documentation states:
//
//  - The card stays open while the pointer travels from the link to it. A card
//    that vanishes when the pointer leaves the link cannot be read, let alone
//    clicked into.
//  - Nothing in the card is the only place it appears. Base UI says plainly that
//    a preview card is not reachable on a touch screen and not announced by a
//    screen reader, so everything in it is also in the note the link goes to.
//    Here that is true by construction: the card holds the note's opening.
import { EditorView, ViewPlugin } from '@codemirror/view'
import { type Extension } from '@codemirror/state'
import { documentPath } from './images'
import { peekNote, resolveWikilinks, type NotePeek } from '../core'
import { resolvedTarget } from './wikilinks'

/** How long the pointer rests on a link before the card appears.
 *
 *  Long enough that dragging the pointer across a paragraph of links does not
 *  flash a card for each one; short enough that resting on one deliberately does
 *  not feel like waiting. */
const OPEN_DELAY_MS = 350

/** How long the card survives the pointer leaving.
 *
 *  This is the travel time between the link and the card. Without it the card
 *  closes in the gap between the two and cannot be reached — the failure dowel's
 *  own component exists to avoid. */
const CLOSE_DELAY_MS = 160

/** What a note's opening was, per path. A note is read once per hover session
 *  rather than on every entry into the same link. */
const peeked = new Map<string, NotePeek | null>()

/** Forgets the openings read so far — for the watcher, since a note whose text
 *  changed would otherwise keep showing the old opening in its card. */
export function forgetPeeks(): void {
  peeked.clear()
}

/** The card, created once and moved rather than built per hover.
 *
 *  One element in the document: a card per link would leave one behind on every
 *  redraw, and the redraws are frequent. */
class Card {
  private readonly element: HTMLElement
  private readonly title: HTMLElement
  private readonly body: HTMLElement
  /** True while the pointer is over the card itself, which is what keeps it
   *  open. */
  private hovered = false
  private closing: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.element = document.createElement('div')
    this.element.className = 'cm-md-peek'
    this.element.setAttribute('role', 'tooltip')
    // Out of the tab order and out of the accessibility tree: it is a shortcut
    // for the person who can see it, and the note it quotes is the real content.
    this.element.setAttribute('aria-hidden', 'true')
    this.element.hidden = true

    this.title = document.createElement('div')
    this.title.className = 'cm-md-peek-title'
    this.body = document.createElement('div')
    this.body.className = 'cm-md-peek-body'
    this.element.appendChild(this.title)
    this.element.appendChild(this.body)

    // The pointer travelling onto the card keeps it open; leaving it closes it
    // on the same delay as leaving the link.
    this.element.addEventListener('pointerenter', () => {
      this.hovered = true
      clearTimeout(this.closing)
    })
    this.element.addEventListener('pointerleave', () => {
      this.hovered = false
      this.scheduleClose()
    })

    document.body.appendChild(this.element)
  }

  /** Puts the card beside `anchor` and fills it.
   *
   *  Positioned against the viewport rather than inside the editor: a card inside
   *  a scrolling, line-wrapped document is clipped by it, and `position: fixed`
   *  in the body is the arrangement that survives both. */
  show(anchor: HTMLElement, peek: NotePeek): void {
    clearTimeout(this.closing)
    this.title.textContent = peek.name
    this.body.textContent = peek.text
    this.element.hidden = false

    const box = anchor.getBoundingClientRect()
    // Measured after being made visible, because a hidden element has no size
    // and the flip below would then always decide there is room.
    const card = this.element.getBoundingClientRect()
    const margin = 8

    // Below the link, or above it when there is no room below — the flip a
    // positioner does, written out because there is one card and one axis.
    const below = box.bottom + margin
    const above = box.top - card.height - margin
    const top = below + card.height <= window.innerHeight || above < 0 ? below : above

    // Shifted back onto the screen rather than allowed to run off the right
    // edge, which is the other half of what a positioner does.
    const left = Math.max(
      margin,
      Math.min(box.left, window.innerWidth - card.width - margin),
    )

    this.element.style.top = `${Math.max(margin, top)}px`
    this.element.style.left = `${left}px`
  }

  scheduleClose(): void {
    clearTimeout(this.closing)
    this.closing = setTimeout(() => {
      if (!this.hovered) this.element.hidden = true
    }, CLOSE_DELAY_MS)
  }

  hide(): void {
    clearTimeout(this.closing)
    this.hovered = false
    this.element.hidden = true
  }

  destroy(): void {
    clearTimeout(this.closing)
    this.element.remove()
  }
}

/** The opening of the note a target points at, or null when there is none to
 *  show.
 *
 *  Exported for its own test: the ordering — resolve, then read, both cached — is
 *  the part with cases in it.
 */
export async function peekFor(document: string, target: string): Promise<NotePeek | null> {
  let path = resolvedTarget(document, target)
  if (path === undefined) {
    try {
      path = (await resolveWikilinks(document, [target]))[0]?.path ?? null
    } catch {
      return null
    }
  }
  // A link to a note that is not there has no opening to show, and a card saying
  // so would be a card in the way of a click that creates it.
  if (path === null) return null

  if (!peeked.has(path)) {
    try {
      peeked.set(path, await peekNote(path))
    } catch {
      peeked.set(path, null)
    }
  }
  const peek = peeked.get(path) ?? null
  // An empty note has nothing to preview. The card would be an empty box, which
  // says less than no card at all.
  return peek !== null && peek.text.trim() !== '' ? peek : null
}

/** Shows a card for the link under the pointer. */
export const linkPeek: Extension = ViewPlugin.fromClass(
  class {
    private readonly card = new Card()
    private opening: ReturnType<typeof setTimeout> | undefined
    /** Which link the pending card is for, so a pointer that has moved on since
     *  does not get the previous link's card. */
    private wanted: HTMLElement | null = null

    constructor(private readonly view: EditorView) {
      view.dom.addEventListener('pointerover', this.onOver)
      view.dom.addEventListener('pointerout', this.onOut)
      // Scrolling moves the link out from under a card that is anchored to where
      // it was. Closing is the honest answer; re-anchoring on every scroll frame
      // is work for a thing the pointer is about to leave anyway.
      view.scrollDOM.addEventListener('scroll', this.onScroll)
    }

    private readonly onOver = (event: PointerEvent) => {
      const span = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-wiki-target]',
      )
      if (!span) return
      // A heading inside this note has no other note to show.
      const target = span.dataset.wikiTarget ?? ''
      if (target === '') return

      const document = this.view.state.field(documentPath, false) ?? null
      if (document === null) return

      clearTimeout(this.opening)
      this.wanted = span
      this.opening = setTimeout(() => {
        void peekFor(document, target).then((peek) => {
          // The pointer may have left, or moved to another link, while the note
          // was being read. Checked against the element rather than a boolean, so
          // two links hovered in quick succession cannot cross.
          if (peek !== null && this.wanted === span) this.card.show(span, peek)
        })
      }, OPEN_DELAY_MS)
    }

    private readonly onOut = (event: PointerEvent) => {
      const span = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-wiki-target]',
      )
      if (!span) return
      clearTimeout(this.opening)
      this.wanted = null
      this.card.scheduleClose()
    }

    private readonly onScroll = () => {
      clearTimeout(this.opening)
      this.wanted = null
      this.card.hide()
    }

    destroy() {
      clearTimeout(this.opening)
      this.view.dom.removeEventListener('pointerover', this.onOver)
      this.view.dom.removeEventListener('pointerout', this.onOut)
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
      this.card.destroy()
    }
  },
)

// The card that appears when a link is hovered: the name of the note it goes to
// and its opening lines.
//
// dowel has a `PreviewCard` and this editor does not use it. That component is
// built on Base UI, `class-variance-authority`, Tailwind and `dowel-ui`, and
// scheda — the first program this editor lives in — has none of the four: its
// first rule is that nothing runs before the text is on screen, and four
// packages plus a stylesheet for one hover card is exactly the thing that rule
// refuses. What is taken from dowel is the part worth copying — the tokens the
// card is coloured with, and two rules its own documentation states:
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
import { type EditorHost, hostOf, type NotePeek, pathOf, perHost } from './host.js'
import { resolvedTarget } from './wikilinks.js'

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

/** What a note's opening was, per host and path. A note is read once per hover
 *  session rather than on every entry into the same link. */
const peeked = perHost(() => new Map<string, NotePeek | null>())

/** Forgets the openings read so far — for the watcher, since a note whose text
 *  changed would otherwise keep showing the old opening in its card. */
export function forgetPeeks(host: EditorHost): void {
  peeked(host).clear()
}

/** The card, created once per editor and moved rather than built per hover.
 *
 *  One element in the document: a card per link would leave one behind on every
 *  redraw, and the redraws are frequent.
 *
 *  It hangs in the body inside a wrapper that carries the editor's theme
 *  classes — the arrangement CodeMirror's own tooltips use when they are
 *  mounted outside the editor. Theme rules are scoped to those classes, so the
 *  card is styled by the same theme as the text it came from, and a program
 *  using the editor needs no stylesheet of its own for it. */
class Card {
  private readonly wrapper: HTMLElement
  private readonly element: HTMLElement
  private readonly title: HTMLElement
  private readonly body: HTMLElement
  /** True while the pointer is over the card itself, which is what keeps it
   *  open. */
  private hovered = false
  private closing: ReturnType<typeof setTimeout> | undefined

  constructor(themeClasses: string) {
    this.wrapper = document.createElement('div')
    this.wrapper.className = themeClasses
    // No box of its own. The theme's rules for the editor's root reach anything
    // with these classes — `height: 100%`, and CodeMirror's own
    // `display: flex !important` — and a wrapper that took them added a
    // window's height of empty page below the window. Only an inline
    // `!important` outranks CodeMirror's. The card is still its child for the
    // selectors and for what it inherits.
    this.wrapper.style.setProperty('display', 'contents', 'important')
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

    this.wrapper.appendChild(this.element)
    document.body.appendChild(this.wrapper)
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
    this.wrapper.remove()
  }
}

/** The opening of the note a target points at, or null when there is none to
 *  show.
 *
 *  Exported for its own test: the ordering — resolve, then read, both cached — is
 *  the part with cases in it.
 */
export async function peekFor(
  host: EditorHost,
  document: string,
  target: string,
): Promise<NotePeek | null> {
  const notes = host.notes
  if (!notes) return null
  let path = resolvedTarget(host, document, target)
  if (path === undefined) {
    try {
      path = (await notes.resolve(document, [target]))[0]?.path ?? null
    } catch {
      return null
    }
  }
  // A link to a note that is not there has no opening to show, and a card saying
  // so would be a card in the way of a click that creates it.
  if (path === null) return null

  const openings = peeked(host)
  if (!openings.has(path)) {
    try {
      openings.set(path, await notes.peek(path))
    } catch {
      openings.set(path, null)
    }
  }
  const peek = openings.get(path) ?? null
  // An empty note has nothing to preview. The card would be an empty box, which
  // says less than no card at all.
  return peek !== null && peek.text.trim() !== '' ? peek : null
}

/** Shows a card for the link under the pointer. */
export const linkPeek: Extension = ViewPlugin.fromClass(
  class {
    private readonly card: Card
    private opening: ReturnType<typeof setTimeout> | undefined
    /** Which link the pending card is for, so a pointer that has moved on since
     *  does not get the previous link's card. */
    private wanted: HTMLElement | null = null

    constructor(private readonly view: EditorView) {
      this.card = new Card(view.themeClasses)
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

      const document = pathOf(this.view.state)
      if (document === null) return
      const host = hostOf(this.view.state)

      clearTimeout(this.opening)
      this.wanted = span
      this.opening = setTimeout(() => {
        void peekFor(host, document, target).then((peek) => {
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

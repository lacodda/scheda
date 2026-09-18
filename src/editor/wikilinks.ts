// `[[links]]` on screen: what they look like, where they go, and what happens
// when the note at the other end is not there yet.
//
// The parsing is the dialect's (`markdown.ts`, as an inline parser so a `[[` in
// a code span is not a link). The *resolving* is the core's (`links.rs`, because
// Obsidian resolves a name against the whole vault and the vault's file list is
// the core's). What is left for this file is the three things that are genuinely
// the window's: drawing the link, following the click, and offering a name while
// one is being typed.
//
// The timing is the same awkwardness `images.ts` has, and the same answer.
// Decorations are built synchronously from the syntax tree, but asking where a
// link goes is a round trip. So the links in the document are asked about in one
// call, the answers are remembered, and the editor is nudged to redraw when they
// land. Until then a link is drawn as a link with an unknown destination — which
// is what it is.
import { fullTree } from './parsed'
import { documentPath } from './images'
import {
  createFromWikilink,
  peekNote,
  resolveAsset,
  resolveWikilinks,
  type LinkTarget,
} from '../core'
import { type EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

/** A wikilink as the window needs it: where in the text, and its three parts. */
export interface Wikilink {
  /** The start of the whole construction, including the `!` of an embed. */
  from: number
  to: number
  /** The path or name before `#` and `|`. Empty for `[[#heading]]`, which points
   *  into the note it is written in. */
  target: string
  heading: string | null
  alias: string | null
  /** True for `![[...]]`. */
  embed: boolean
}

/** Takes a wikilink apart, the same way the core does.
 *
 *  The same order — `path#heading|alias` — and the same reason for splitting on
 *  `|` first: a `#` after the bar belongs to the alias, so `[[plan|issue #4]]`
 *  has no heading. The two implementations have to agree, and the test below
 *  holds the cases the core's own tests hold. */
export function parseTarget(inner: string): {
  target: string
  heading: string | null
  alias: string | null
} {
  const bar = inner.indexOf('|')
  const beforeAlias = bar === -1 ? inner : inner.slice(0, bar)
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim()

  const hash = beforeAlias.indexOf('#')
  const target = (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim()
  const heading = hash === -1 ? null : beforeAlias.slice(hash + 1).trim()

  return {
    target,
    // `[[note#]]` points at the note; `[[note|]]` shows the target.
    heading: heading === null || heading === '' ? null : heading,
    alias: alias === null || alias === '' ? null : alias,
  }
}

/** What the reader sees for a link: the alias, else the name with its heading. */
export function labelOf(link: Wikilink): string {
  if (link.alias !== null) return link.alias
  // The folders come off: `[[projects/scheda/plan]]` reads as `plan`, which is
  // what the sentence around it was written to read as.
  const name = link.target.split(/[/\\]/).pop() ?? link.target
  if (link.heading === null) return name
  // `[[#Risks]]` — a link inside this note.
  return name === '' ? `#${link.heading}` : `${name} › ${link.heading}`
}

/** Every wikilink in the document, in order.
 *
 *  From the tree, not a regular expression: a `[[` inside a code fence is not a
 *  link, and only the parser knows that. */
export function wikilinksIn(state: EditorState): Wikilink[] {
  const links: Wikilink[] = []
  fullTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Wikilink' && node.name !== 'WikiEmbed') return
      const embed = node.name === 'WikiEmbed'
      // Between the brackets: past `[[` or `![[`, and short of `]]`.
      const open = state.doc.sliceString(node.from, node.from + 3) === '![['
      const inner = state.doc.sliceString(node.from + (open ? 3 : 2), node.to - 2)
      links.push({ from: node.from, to: node.to, embed, ...parseTarget(inner) })
    },
  })
  return links
}

/** What a target resolved to, per document. `undefined` means "not asked yet",
 *  and `null` means "asked, and the vault holds no such note". */
type Resolved = string | null

const caches = new Map<string, Map<string, Resolved>>()

function cacheFor(path: string): Map<string, Resolved> {
  let cache = caches.get(path)
  if (!cache) {
    cache = new Map()
    caches.set(path, cache)
  }
  return cache
}

/** What a document's links resolved to, for the window to read. */
export function resolvedTarget(document: string, target: string): Resolved | undefined {
  return caches.get(document)?.get(target)
}

/** Forgets what a document's links resolved to — after a rename, or when the
 *  vault changed under it and a missing note may now exist. */
export function forgetLinks(path: string): void {
  caches.delete(path)
}

/** Forgets every document's answers.
 *
 *  For the watcher, which cannot know which open note linked to the file that
 *  just appeared — and for tests, where a cache outliving one of them makes the
 *  next pass for the wrong reason. */
export function forgetAllLinks(): void {
  caches.clear()
}

/** Announces that some links now have answers. */
const linksResolved = StateEffect.define<null>()

/** Every editor currently on screen.
 *
 *  The answers are cached per document, but the *nudge* that makes a view redraw
 *  is a transaction, and a transaction goes to one view. So a second view over
 *  the same note — two tabs, or a tab rebuilt while a request was in flight —
 *  would find every target already claimed in the cache, ask for nothing, and sit
 *  with its links undrawn until something else happened to it.
 *
 *  Keeping the views is the smaller of the two fixes. The other is a cache per
 *  view, which would mean asking the core once per tab for the same answer.
 *
 *  Found by looking at the preview page with every test green. */
const views = new Set<EditorView>()

/** Tells every view on screen that answers have landed. */
function nudgeAll(path: string, effect: StateEffect<null>): void {
  for (const view of views) {
    // Only the views showing the document the answers belong to. A window holds
    // one editor per tab and the answers are filed per document, so nudging the
    // rest is a redraw that can change nothing — and, for a view whose document
    // these answers say nothing about, a transaction it never asked for.
    if ((view.state.field(documentPath, false) ?? null) !== path) continue
    view.dispatch({ effects: effect })
  }
}

/** Bumped when an answer lands, so the decorations facet — which recomputes on a
 *  changed *value* and not on an effect — knows to run again. */
const linksGeneration = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(linksResolved)) return value + 1
    }
    return value
  },
})

/** Whether the caret is on the line holding this range.
 *
 *  The *line*, not the range. Every other marker in the editor comes back when
 *  the caret steps onto its line (see `decorations.ts`), and asking a narrower
 *  question here would mean a line where `[[plan]]` shows its brackets while the
 *  `[[plan|the week ahead]]` beside it stays drawn — half a line of source and
 *  half a line of rendering, which is the seam this product keeps closing.
 *
 *  Caught on the preview page: the tests all asked about one link on a line. */
function caretIn(state: EditorState, from: number, to: number): boolean {
  // The head line and the anchor line, exactly as `decorations.ts` counts them —
  // not every line a selection spans. Selecting three paragraphs is reading, not
  // editing one of them, and unwrapping all of it would be a page of source.
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  const onIt = (at: number) => at >= first && at <= last
  return state.selection.ranges.some(
    (range) =>
      onIt(state.doc.lineAt(range.head).number) ||
      onIt(state.doc.lineAt(range.anchor).number),
  )
}

/** The class a link's rendered text carries, by whether its note exists.
 *
 *  A link to a note that is not there is drawn differently rather than not drawn:
 *  writing `[[the idea]]` before the note exists is how notes get written in a
 *  vault, and a link that looks broken while it is being planned is a link that
 *  looks like a mistake. */
function classFor(known: Resolved | undefined): string {
  if (known === undefined) return 'cm-md-wikilink'
  return known === null ? 'cm-md-wikilink cm-md-wikilink-missing' : 'cm-md-wikilink'
}

function build(state: EditorState): DecorationSet {
  const path = state.field(documentPath, false) ?? null
  const cache = path === null ? null : cacheFor(path)
  const marks: Range<Decoration>[] = []

  for (const link of wikilinksIn(state)) {
    // On the line being edited the source shows, exactly like every other
    // marker: a link whose brackets vanished cannot be typed into.
    if (caretIn(state, link.from, link.to)) continue

    const known = cache?.get(link.target)
    const label = labelOf(link)

    // The whole construction is replaced by its label, never half of it. Hiding
    // the brackets and leaving the target would render `[[plan|the plan]]` as
    // `plan|the plan` — text the author did not write, which is the failure this
    // product has met four times now (ADR 0002's corollary).
    marks.push(
      Decoration.replace({
        widget: new LinkWidget(label, classFor(known), link.target, link.heading),
      }).range(link.from, link.to),
    )
  }

  marks.sort((a, b) => a.from - b.from)
  return Decoration.set(marks, true)
}

/** A wikilink drawn as its label.
 *
 *  A widget rather than a mark plus hidden spans: the label of an aliased link is
 *  not a substring of the source in the right place — `[[plan|the plan]]` shows
 *  `the plan`, which sits after the bar — and a mark can only style characters
 *  that are already where they need to be. */
class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly className: string,
    readonly target: string,
    readonly heading: string | null,
  ) {
    super()
  }

  eq(other: LinkWidget) {
    return (
      other.label === this.label &&
      other.className === this.className &&
      other.target === this.target &&
      other.heading === this.heading
    )
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = this.className
    span.textContent = this.label
    // Read by the click and the hover handlers, which are registered on the
    // editor rather than here: a listener per link in a note of a hundred is a
    // hundred listeners, and they would have to be torn down on every redraw.
    span.dataset.wikiTarget = this.target
    if (this.heading !== null) span.dataset.wikiHeading = this.heading
    span.setAttribute('role', 'link')
    // Reachable by keyboard, because a link that only a mouse can follow is not
    // a link for everyone. Enter on a focused one follows it, below.
    span.tabIndex = 0
    return span
  }

  ignoreEvent(event: Event) {
    // The click and the hover are ours; everything else — selection, typing
    // beside it — belongs to the editor.
    return event.type !== 'mousedown' && event.type !== 'keydown'
  }
}

/** Asks the core where a document's links go, then nudges every view. */
async function resolvePending(path: string, targets: string[]): Promise<void> {
  const cache = cacheFor(path)
  // Claimed before the call, because `build` runs on every update and an
  // unanswered link would be asked about again on every keystroke.
  for (const target of targets) {
    if (!cache.has(target)) cache.set(target, null)
  }

  let answers: LinkTarget[]
  try {
    answers = await resolveWikilinks(path, targets)
  } catch {
    // The claims above are taken back. A link left cached as "no such note"
    // because the core did not answer is a link that offers to *create* the note
    // on the next click — and the new one would land in the vault's new-note
    // folder rather than where the existing note actually sits, leaving two notes
    // of one name. Forgetting instead means the next draw asks again.
    for (const target of targets) cache.delete(target)
    return
  }
  targets.forEach((target, index) => {
    cache.set(target, answers[index]?.path ?? null)
  })
  // Always, not only when something resolved: a link that came back missing is
  // drawn differently from one that has not been asked about yet, and skipping
  // the redraw would leave the second drawing on screen.
  nudgeAll(path, linksResolved.of(null))
}

/** How the window follows a link. Registered by the shell, which is the only
 *  thing that can open a tab or scroll a document.
 *
 *  A module-level hook rather than a facet threaded through the state, because
 *  there is one window and one answer to "what happens when a link is clicked" —
 *  a per-document one would be a setting nobody could use differently. */
let follow: FollowLink | null = null

export interface FollowLink {
  /** Open this file, in a tab. */
  open: (path: string) => void
  /** Go to a heading in the document already on screen. */
  goToHeading: (heading: string) => void
  /** Ask whether a note that does not exist should be created. `true` creates
   *  it. The shell asks because asking is a dialog, and dialogs are the shell's.
   */
  confirmCreate: (target: string) => Promise<boolean>
  /** Something went wrong in a way the person can act on. */
  report: (message: string) => void
}

/** Tells the editor how to follow a link. Called once, by the shell. */
export function setFollowLink(handler: FollowLink | null): void {
  follow = handler
}

/** Follows a wikilink: opens the note, or offers to write it.
 *
 *  Exported for its own test. The three outcomes are the whole behaviour — an
 *  existing note opens, a heading in this note scrolls, and a missing note is
 *  offered — and they are worth holding without a DOM in the way.
 */
export async function followTarget(
  document: string | null,
  target: string,
  heading: string | null,
): Promise<void> {
  if (!follow) return

  // `[[#heading]]`: a link inside this note, and the one case that needs no
  // vault and no file at all.
  if (target === '') {
    if (heading !== null) follow.goToHeading(heading)
    return
  }
  if (document === null) {
    // An unsaved draft has no vault, so a name in it points at nothing yet. Said
    // out loud rather than silently ignored: a click that does nothing reads as
    // a broken link.
    follow.report('save this draft to a file before following a link out of it')
    return
  }

  const known = resolvedTarget(document, target)
  if (known !== undefined && known !== null) {
    follow.open(known)
    return
  }

  // Not there, or not asked about yet. Asking again covers the second case, and
  // costs one call on a click.
  let path: string | null = known ?? null
  if (known === undefined) {
    try {
      const answer = await resolveWikilinks(document, [target])
      path = answer[0]?.path ?? null
      cacheFor(document).set(target, path)
    } catch {
      // No answer is not the same as "no such note", and the difference matters
      // here: offering to create one would put a second note of that name in the
      // vault's new-note folder while the first sits wherever it sits.
      follow.report('the vault could not be searched just now — try again')
      return
    }
  }
  if (path !== null) {
    follow.open(path)
    return
  }

  // The note is not there. Writing it is how a vault grows, so the offer is the
  // honest response — but it is an offer: a stray click on a typo should not
  // leave a file behind.
  if (!(await follow.confirmCreate(target))) return
  try {
    const created = await createFromWikilink(document, target)
    cacheFor(document).set(target, created)
    follow.open(created)
  } catch (error) {
    follow.report(error instanceof Error ? error.message : String(error))
  }
}

/** The clicks and keys that follow a link.
 *
 *  Registered on the editor rather than on each widget: a note of a hundred links
 *  would otherwise carry a hundred listeners, all of them torn down and rebuilt
 *  on every redraw. */
const wikilinkClicks: Extension = EditorView.domEventHandlers({
  mousedown(event, view) {
    const span = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-wiki-target]')
    if (!span) return false
    // The middle and right buttons are not "follow": one is paste on some
    // platforms and the other is a menu.
    if (event.button !== 0) return false
    event.preventDefault()
    const document = view.state.field(documentPath, false) ?? null
    void followTarget(document, span.dataset.wikiTarget ?? '', span.dataset.wikiHeading ?? null)
    return true
  },
  keydown(event, view) {
    if (event.key !== 'Enter' && event.key !== ' ') return false
    const active = window.document.activeElement as HTMLElement | null
    const span = active?.closest<HTMLElement>('[data-wiki-target]')
    if (!span) return false
    event.preventDefault()
    const document = view.state.field(documentPath, false) ?? null
    void followTarget(document, span.dataset.wikiTarget ?? '', span.dataset.wikiHeading ?? null)
    return true
  },
})

/** What an embed resolved to: a picture URL, a note's text, or nothing. */
type Embedded =
  | { kind: 'image'; url: string }
  | { kind: 'note'; name: string; text: string }
  | { kind: 'missing' }

const embeds = new Map<string, Map<string, Embedded>>()

function embedsFor(path: string): Map<string, Embedded> {
  let cache = embeds.get(path)
  if (!cache) {
    cache = new Map()
    embeds.set(path, cache)
  }
  return cache
}

/** Forgets what a document's embeds resolved to. */
export function forgetEmbeds(path: string): void {
  embeds.delete(path)
}

/** Forgets every document's embeds. For the watcher and for tests. */
export function forgetAllEmbeds(): void {
  embeds.clear()
}

/** The file extensions drawn as a picture rather than read as a note.
 *
 *  The ones the webview can decode. Anything else embedded — a PDF, a video — is
 *  left as a link rather than drawn as a broken picture: saying "this is a link
 *  to a file" is honest, and drawing a grey box is not. */
const PICTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])

/** Whether a resolved path is a picture. */
function isPicture(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return PICTURE_EXTENSIONS.has(extension)
}

/** A picture embedded by `![[shot.png]]`. */
class EmbeddedImage extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super()
  }

  eq(other: EmbeddedImage) {
    return other.url === this.url && other.alt === this.alt
  }

  toDOM() {
    const figure = window.document.createElement('div')
    figure.className = 'cm-md-image'
    const img = window.document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.addEventListener('error', () => figure.classList.add('cm-md-image-failed'))
    figure.appendChild(img)
    return figure
  }

  ignoreEvent() {
    return true
  }
}

/** A note embedded by `![[note]]`, shown as its opening.
 *
 *  The opening rather than the whole note. An embed is a quotation of another
 *  note, and a quotation of a thousand words inside a note is the other note,
 *  pasted — which is the thing a vault of links exists to avoid. The card has a
 *  header that opens the real thing, so nothing here is the only place it is. */
class EmbeddedNote extends WidgetType {
  constructor(
    readonly name: string,
    readonly text: string,
    readonly target: string,
  ) {
    super()
  }

  eq(other: EmbeddedNote) {
    return other.name === this.name && other.text === this.text && other.target === this.target
  }

  toDOM() {
    const block = window.document.createElement('div')
    block.className = 'cm-md-embed'

    const head = window.document.createElement('span')
    head.className = 'cm-md-embed-head'
    head.textContent = this.name
    // The same hook the click handler reads, so opening an embed's source is the
    // same code path as following a link to it.
    head.dataset.wikiTarget = this.target
    head.setAttribute('role', 'link')
    head.tabIndex = 0
    block.appendChild(head)

    const body = window.document.createElement('div')
    body.className = 'cm-md-embed-body'
    // Text, not markup. Rendering the embedded note's markdown would mean a
    // second renderer for the same format, and two renderers disagree — see
    // reading mode, which is deliberately the same view rather than a preview.
    body.textContent = this.text
    block.appendChild(body)

    return block
  }

  ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'keydown'
  }
}

/** Reads what a document's embeds resolved to and draws them. */
function buildEmbeds(state: EditorState): DecorationSet {
  const path = state.field(documentPath, false) ?? null
  if (path === null) return Decoration.none
  const cache = embedsFor(path)
  const marks: Range<Decoration>[] = []

  for (const link of wikilinksIn(state)) {
    if (!link.embed) continue
    const known = cache.get(link.target)
    if (known === undefined) continue

    // An embed takes its whole line, like a picture does: the line is replaced
    // rather than hidden above the widget, because a hidden line keeps its
    // height and leaves a blank band over every embed.
    const line = state.doc.lineAt(link.to)
    const wholeLine = line.from === link.from && line.to === link.to
    if (!wholeLine) continue
    // On the line being edited the source shows, like every other marker.
    if (caretIn(state, line.from, line.to)) continue

    if (known.kind === 'missing') {
      // Nothing to show. The line is left as its text rather than replaced with
      // an empty band: an embed of a note that is not there should read as the
      // link it is, which is what the inline decoration above already draws.
      continue
    }
    const widget =
      known.kind === 'image'
        ? new EmbeddedImage(known.url, link.alias ?? labelOf(link))
        : new EmbeddedNote(known.name, known.text, link.target)
    marks.push(Decoration.replace({ widget, block: true }).range(line.from, line.to))
  }

  marks.sort((a, b) => a.from - b.from)
  return Decoration.set(marks, true)
}

/** Works out what each embed should show, then nudges every view.
 *
 *  A picture goes through `resolveAsset`, which is the core's checked door for
 *  anything the webview loads (ADR 0004) — an embed is not a second way in. A
 *  note goes through `peekNote`, the same reader the hover card uses. */
async function resolveEmbeds(path: string, targets: string[]): Promise<void> {
  const cache = embedsFor(path)
  for (const target of targets) {
    if (!cache.has(target)) cache.set(target, { kind: 'missing' })
  }

  let answers: LinkTarget[]
  try {
    answers = await resolveWikilinks(path, targets)
  } catch {
    // Forgotten rather than left as missing, so the next draw asks again. An
    // embed that gives up permanently on one failed call is a picture that never
    // appears until the tab is reopened.
    for (const target of targets) cache.delete(target)
    return
  }

  for (const [index, target] of targets.entries()) {
    const resolved = answers[index]?.path ?? null
    if (resolved === null) continue
    try {
      if (isPicture(resolved)) {
        // Through the asset door, with the link the core resolved rather than
        // the one that was typed: `![[shot.png]]` names a file anywhere in the
        // vault, and `resolveAsset` takes a link relative to the document.
        const url = await resolveAsset(path, relativeFrom(path, resolved))
        if (url !== null) cache.set(target, { kind: 'image', url })
      } else {
        const peek = await peekNote(resolved)
        if (peek !== null) cache.set(target, { kind: 'note', ...peek })
      }
    } catch {
      // Left as missing: the line stays the link it is.
    }
  }
  nudgeAll(path, embedsResolved.of(null))
}

/** An absolute path expressed from the document that refers to it.
 *
 *  `resolveAsset` takes a link as a note would write one, and a wikilink does not
 *  write one — it names a file anywhere in the vault. So the path the core
 *  resolved is turned back into a relative link for the one door that loads
 *  pictures, rather than a second door being opened beside it. */
export function relativeFrom(document: string, target: string): string {
  const separator = document.includes('\\') ? '\\' : '/'
  const from = document.split(/[/\\]/).slice(0, -1)
  const to = target.split(/[/\\]/)

  // On Windows two spellings of the same folder differ only in case.
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && same(from[shared], to[shared])) {
    shared += 1
  }
  if (shared === 0) return target

  const climbs = new Array(from.length - shared).fill('..')
  return [...climbs, ...to.slice(shared)].join(separator)
}

const embedsResolved = StateEffect.define<null>()

const embedsGeneration = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(embedsResolved)) return value + 1
    }
    return value
  },
})

const wikilinkEmbeds: Extension = [
  embedsGeneration,
  EditorView.decorations.compute([documentPath, 'doc', 'selection', embedsGeneration], buildEmbeds),
  ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        views.add(view)
        this.ask(view)
      }

      destroy() {
        views.delete(this.view)
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.startState.field(documentPath) !== update.state.field(documentPath)
        ) {
          this.ask(update.view)
        }
      }

      ask(view: EditorView) {
        const path = view.state.field(documentPath, false) ?? null
        if (path === null) return
        const cache = embedsFor(path)
        const pending = [
          ...new Set(
            wikilinksIn(view.state)
              .filter((link) => link.embed && link.target !== '' && !cache.has(link.target))
              .map((link) => link.target),
          ),
        ]
        if (pending.length > 0) void resolveEmbeds(path, pending)
      }
    },
  ),
]

export const wikilinkDecorations: Extension = [
  linksGeneration,
  // Computed rather than provided by a plugin, for the reason `images.ts`
  // states: a set given to this facet as a function may not introduce block
  // decorations, and the embeds below are block ones.
  EditorView.decorations.compute([documentPath, 'doc', 'selection', linksGeneration], build),
  // The asking is a side effect and does not belong in a facet's compute, which
  // runs while state is being built and has no view to nudge afterwards.
  ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        views.add(view)
        this.ask(view)
      }

      destroy() {
        views.delete(this.view)
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.startState.field(documentPath) !== update.state.field(documentPath)
        ) {
          this.ask(update.view)
        }
      }

      ask(view: EditorView) {
        const path = view.state.field(documentPath, false) ?? null
        if (path === null) return
        const cache = cacheFor(path)
        const pending = [
          ...new Set(
            wikilinksIn(view.state)
              .map((link) => link.target)
              // `[[#heading]]` points into this note; there is nothing to resolve.
              .filter((target) => target !== '' && !cache.has(target)),
          ),
        ]
        if (pending.length > 0) void resolvePending(path, pending)
      }
    },
  ),
  wikilinkClicks,
  wikilinkEmbeds,
]

// What the editor asks of scheda, answered by the core.
//
// The editor package knows markdown and nothing about files. Every question it
// has about the world outside the text — where a picture is, which note a
// `[[link]]` names, what a note opens with — goes through the one door the
// window has to the disk, `core.ts`, and from there to Rust. A link is resolved
// by the core (ADR 0008), and a picture is loaded through the scoped asset
// protocol the core opens for it (ADR 0004).
import type { EditorHost, FollowLink } from '@lacodda/scheda-editor'
import {
  completeWikilink,
  createFromWikilink,
  pasteImage,
  peekNote,
  readHeadings,
  resolveAsset,
  resolveWikilinks,
} from '../core'

/** How the window follows a link, once the shell is up to do it. The editor
 *  is on screen before the shell is loaded, and a click in that moment does
 *  nothing rather than half of something. */
let following: FollowLink | undefined

/** Tells the editor how to follow a link. Called once, by the shell. */
export function setFollowLink(handler: FollowLink | null): void {
  following = handler ?? undefined
}

/** One host for the window: every tab's editor asks the same core, so the
 *  answers one tab learnt are answers for the next.
 *
 *  Each answer calls into `core.ts` when it is asked for rather than holding
 *  the function from the start, so a test that stands in for part of the core
 *  is not made to stand in for all of it. */
export const schedaHost: EditorHost = {
  assets: {
    resolve: (document, link) => resolveAsset(document, link),
    // The bytes cross to the core as a plain array: that is what `invoke`
    // serialises.
    paste: (document, extension, bytes) => pasteImage(document, extension, Array.from(bytes)),
  },
  notes: {
    resolve: (document, targets) => resolveWikilinks(document, targets),
    create: (document, target) => createFromWikilink(document, target),
    suggest: (document, query) => completeWikilink(document, query),
    headings: (path) => readHeadings(path),
    peek: (path) => peekNote(path),
  },
  // A getter, so the editor reads whatever the shell set at the moment a link
  // is clicked.
  get follow() {
    return following
  },
}

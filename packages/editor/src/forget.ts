// Letting go of answers the host gave.
//
// The editor remembers what links resolved to, what pictures loaded from and
// what notes open with, so that a keystroke does not become a round trip. The
// host is the one who knows when those answers went stale — a file was renamed,
// a note appeared — and these are the two things it can say about it.
import { type EditorHost } from './host.js'
import { forgetAssets } from './images.js'
import { forgetPeeks } from './peek.js'
import { forgetAllEmbeds, forgetAllLinks, forgetEmbeds, forgetLinks } from './wikilinks.js'

/** Forgets what one document's links, pictures and embeds resolved to — after
 *  it was saved under a new name or moved, since relative links now start from
 *  somewhere else. The next draw asks again. */
export function forgetDocument(host: EditorHost, path: string): void {
  forgetAssets(host, path)
  forgetLinks(host, path)
  forgetEmbeds(host, path)
}

/** Forgets everything learnt about the notes — after the vault changed, when
 *  any open document's `[[link]]` may now lead somewhere else and any note's
 *  opening may read differently. Pictures are kept: a link relative to the
 *  document still names the same file. */
export function forgetNotes(host: EditorHost): void {
  forgetAllLinks(host)
  forgetAllEmbeds(host)
  forgetPeeks(host)
}

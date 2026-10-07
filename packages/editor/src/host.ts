// What the editor asks of the program it runs in.
//
// The editor draws markdown; it does not know where files live. Turning
// `assets/shot.png` into something an `<img>` can load, finding the note
// `[[plan]]` names, opening that note in a tab — each of these is a question
// only the program around the editor can answer, and each program answers it
// differently. scheda asks its Rust core, which resolves links the way Obsidian
// does; another program may have no vault at all.
//
// So the questions are one interface, handed to the editor once, and every part
// of the editor that needs an answer reads it from the state. A part whose
// questions the host cannot answer is left out rather than drawn half-working:
// an editor with no notes behind it shows `[[plan]]` as the text it is, which is
// honest, rather than as a link that leads nowhere.
import { type EditorState, Facet, StateEffect, StateField } from '@codemirror/state'

/** Where a wikilink leads. */
export interface LinkTarget {
  /** The file it resolves to, or null when there is no such note. */
  path: string | null
  /** What to write between the brackets for a link to this file. */
  target: string | null
}

/** The opening of a note: what the hover card and an embed show. */
export interface NotePeek {
  name: string
  text: string
}

/** One note offered while a wikilink is being typed. */
export interface NoteSuggestion {
  /** What to put between the brackets. */
  target: string
  name: string
  /** Shown dim beside the name; empty for a note at the top. */
  folder: string
  path: string
}

/** A picture that was written somewhere, and how a note links to it. */
export interface PastedPicture {
  link: string
}

/** Pictures: the links a note makes to files. */
export interface AssetHost {
  /** A URL the page can load for a picture linked from `document`, or null
   *  when the link does not lead to a file the host will show. */
  resolve(document: string, link: string): Promise<string | null>
  /** Writes a pasted picture and answers with the link to put in the text.
   *  `document` is null for a buffer that has never been saved; the host
   *  decides whether that is somewhere a picture can go. Without this, pasting
   *  a picture does what the editor does with any other paste. */
  paste?(document: string | null, extension: string, bytes: Uint8Array): Promise<PastedPicture>
}

/** Notes: the vault a wikilink points into. */
export interface NoteHost {
  /** Where several wikilinks written in `document` lead, in order. */
  resolve(document: string, targets: string[]): Promise<LinkTarget[]>
  /** Creates the note a wikilink names and answers with its path. */
  create(document: string, target: string): Promise<string>
  /** The notes a half-typed wikilink could be completed to, best first. */
  suggest(document: string, query: string): Promise<NoteSuggestion[]>
  /** A note's headings, for completing `[[note#`. */
  headings(path: string): Promise<string[]>
  /** The opening of a note, or null when it cannot be read. */
  peek(path: string): Promise<NotePeek | null>
}

/** What happens when a link is followed. Every one of these is the program's:
 *  opening a tab, scrolling, asking a question, saying something went wrong. */
export interface FollowLink {
  /** Open this file. */
  open: (path: string) => void
  /** Go to a heading in the document already on screen. */
  goToHeading: (heading: string) => void
  /** Ask whether a note that does not exist should be created. */
  confirmCreate: (target: string) => Promise<boolean>
  /** Something went wrong in a way the person can act on. */
  report: (message: string) => void
}

/** Everything the editor may ask. Each part is optional, and the editor leaves
 *  out what depends on a part that is missing. */
export interface EditorHost {
  readonly assets?: AssetHost
  readonly notes?: NoteHost
  /** Read when a link is clicked, not when the editor is made — so a host
   *  whose window comes up after the first frame can answer it later. */
  readonly follow?: FollowLink
}

/** The host of an editor made without one: it can answer nothing. */
const NO_HOST: EditorHost = {}

/** The host an editor state belongs to. */
export const editorHost = Facet.define<EditorHost, EditorHost>({
  combine: (hosts) => hosts[0] ?? NO_HOST,
})

/** The host of a state. */
export function hostOf(state: EditorState): EditorHost {
  return state.facet(editorHost)
}

/** Where the document lives, in the host's own words — a path in scheda.
 *  Set when a document is opened or saved under a new name; null for a buffer
 *  that has never been saved, where nothing can be resolved and nothing is. */
export const setDocumentPath = StateEffect.define<string | null>()

export const documentPath = StateField.define<string | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDocumentPath)) return effect.value
    }
    return value
  },
})

/** The document path of a state, or null when it has none. */
export function pathOf(state: EditorState): string | null {
  return state.field(documentPath, false) ?? null
}

/** A cache kept per host.
 *
 *  The answers the editor remembers — what a link resolved to, what a note
 *  opens with — are answers one host gave. Two editors with two hosts in one
 *  page must not read each other's: the same `plan` names a different note in
 *  each. Held weakly, so a host that is let go takes its answers with it. */
export function perHost<T>(make: () => T): (host: EditorHost) => T {
  const caches = new WeakMap<EditorHost, T>()
  return (host) => {
    let cache = caches.get(host)
    if (cache === undefined) {
      cache = make()
      caches.set(host, cache)
    }
    return cache
  }
}

/** What each document's links resolved to, per host.
 *
 *  Per document as well, because the same relative link means different files
 *  in different notes. */
export class DocumentCache<V> {
  private readonly documents = perHost(() => new Map<string, Map<string, V>>())

  /** The answers for one document, made empty on first use. */
  of(host: EditorHost, path: string): Map<string, V> {
    const documents = this.documents(host)
    let answers = documents.get(path)
    if (answers === undefined) {
      answers = new Map()
      documents.set(path, answers)
    }
    return answers
  }

  /** One answer, or undefined when the question has not been asked. */
  get(host: EditorHost, path: string, key: string): V | undefined {
    return this.documents(host).get(path)?.get(key)
  }

  /** Forgets one document's answers — after a save-as or a rename. */
  forget(host: EditorHost, path: string): void {
    this.documents(host).delete(path)
  }

  /** Forgets every document's answers. */
  forgetAll(host: EditorHost): void {
    this.documents(host).clear()
  }
}

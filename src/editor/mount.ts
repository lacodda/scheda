// The editor, and the documents it is holding.
//
// One `EditorView` serves every tab: switching swaps the state into it rather
// than building a second view. That keeps opening a tab cheap, keeps the first
// frame exactly as expensive as it was when there was only one document, and
// gives each tab its own undo history for free — the history lives in the
// state, so it travels with the tab instead of being shared or thrown away.
//
// The shape of a file (BOM, line endings) travels with it untouched: the editor
// edits characters, and only the core knows how those become bytes.
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  discardDraft,
  keepDraft,
  openFile,
  releaseWaiter,
  rereadFile,
  saveFile,
  type DocumentShape,
  type Draft,
  type OpenFile,
} from '../core'
import { isInside, samePath } from '../paths'
import { documentPath, forgetAssets, setDocumentPath } from './images'
import { schedaSetup } from './setup'

/** A document with a filename, or an unnamed buffer that has never been saved. */
export interface Tab {
  readonly id: number
  path: string | null
  shape: DocumentShape
  readOnly: boolean
  /** The text as it stands on disk. Anything else means unsaved changes. */
  saved: string
  /** The tab's editor state, held while another tab is on screen. */
  state: EditorState
  /** The key this tab's draft is filed under, for a tab with no path. Set once
   *  the draft has been written; null while it is still empty. */
  draftKey: string | null
  /** True for a tab whose file went to the recycle bin under it. The text is
   *  still here and still saveable — under a new name, since the old one no
   *  longer names anything. */
  orphaned: boolean
  /** True when a process is blocked on this file: it was opened by
   *  `scheda --wait`, and closing this tab is what lets that process go. */
  awaited: boolean
}

/** The shape a brand new file is written with: no BOM, LF, nothing to replay. */
const NEW_FILE_SHAPE: DocumentShape = { line_ending: 'lf', bom: false }

export interface EditorHandle {
  readonly view: EditorView
  tabs: () => readonly Tab[]
  active: () => Tab
  /** Called whenever the document, the tab list or the active tab changes. */
  subscribe: (listener: () => void) => () => void
  /** Bumped on every such change. A stable snapshot for `useSyncExternalStore`,
   *  which loops forever on a value derived from mutable state. */
  revision: () => number
  /** Opens a path: focuses the tab already showing it, or adds one. */
  open: (path: string) => Promise<void>
  /** Adds a tab for a file the core has already read. */
  adopt: (file: OpenFile) => void
  /** Opens an empty, unnamed buffer. */
  openBlank: () => void
  /** Reopens a draft that survived a restart, under the key it was filed with. */
  adoptDraft: (draft: Draft) => void
  /** Points the tab showing `from` at `to` — a file was renamed under it. Does
   *  nothing when no tab is showing it. */
  follow: (from: string, to: string) => void
  /** Tells the tab showing `path` that its file has gone. The text stays. */
  orphan: (path: string) => void
  /** Takes the text a tab's file now holds, discarding what was on screen.
   *
   *  For a tab with no unsaved changes this is the whole answer to an external
   *  edit; for one with them it is what happens after the person chooses. The
   *  shape travels with the text, because a file rewritten elsewhere may have
   *  come back with different line endings. */
  reload: (id: number) => Promise<void>
  /** Marks the text on screen as being what is on disk, without writing
   *  anything. For the person who looked at both versions and kept theirs: the
   *  file will be overwritten when they save, and until then the window must
   *  stop asking about a change they have already answered. */
  acceptAsSaved: (id: number, text: string) => void
  select: (id: number) => void
  /** Closes a tab. Returns false when it has unsaved changes and `force` was
   *  not set — the caller is expected to ask before discarding work. */
  close: (id: number, force?: boolean) => boolean
  save: (id?: number) => Promise<void>
  /** Saves the active tab to a new path, adopting it as the tab's own. */
  saveAs: (path: string) => Promise<void>
  isDirty: (id?: number) => boolean
  anyDirty: () => boolean
  /** Writes every unnamed tab's text out now, without waiting for the pause
   *  that usually triggers it. For the moment the window is closing. */
  keepDrafts: () => Promise<void>
}

export function mountEditor(root: HTMLElement, file: OpenFile | null): EditorHandle {
  const host = document.createElement('div')
  host.className = 'editor-host'
  root.appendChild(host)

  const listeners = new Set<() => void>()
  let revision = 0
  const notify = () => {
    revision += 1
    listeners.forEach((listener) => listener())
  }

  let nextId = 1
  const tabs: Tab[] = []
  let activeId = 0

  const baseExtensions: Extension[] = [
    ...schedaSetup(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) notify()
      if (update.docChanged) scheduleDraft()
    }),
  ]

  function stateFor(text: string, readOnly: boolean, path: string | null): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        ...baseExtensions,
        EditorState.readOnly.of(readOnly),
        // Which file this is. Embedded pictures are resolved relative to it,
        // and a buffer with no path resolves nothing — correctly, since a
        // relative link has nothing to be relative to yet.
        documentPath.init(() => path),
      ],
    })
  }

  function addTab(source: OpenFile | null, draftKey: string | null = null): Tab {
    const tab: Tab = {
      id: nextId++,
      path: source?.path ?? null,
      shape: source?.shape ?? NEW_FILE_SHAPE,
      readOnly: source?.readOnly ?? false,
      saved: source?.text ?? '',
      state: stateFor(source?.text ?? '', source?.readOnly ?? false, source?.path ?? null),
      draftKey,
      orphaned: false,
      awaited: source?.awaited ?? false,
    }
    tabs.push(tab)
    return tab
  }

  /** Writes an unnamed tab's text where it survives a restart.
   *
   *  Only unnamed ones. A tab with a path is saved by saving it, and filing a
   *  second copy in `%APPDATA%` would give a product whose promise is "the file
   *  is the truth" a second truth to disagree with (ADR 0002).
   *
   *  Keyed by tab id rather than awaited in order: two drafts written at once
   *  would otherwise race, and the later write could land first and file the
   *  older text. */
  const drafting = new Map<number, Promise<void>>()

  /** How long typing has to pause before a draft is written.
   *
   *  A write per keystroke would be a file operation on every character, and a
   *  write only on close would lose the text to a crash — which is the case the
   *  whole draft exists for. Half a second is long enough that a sentence is
   *  one write and short enough that nothing typed is more than a moment from
   *  being safe. */
  const DRAFT_DELAY_MS = 500
  let draftTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleDraft(): void {
    const tab = active()
    if (!tab || tab.path !== null) return
    clearTimeout(draftTimer)
    draftTimer = setTimeout(() => keep(tab), DRAFT_DELAY_MS)
  }

  function keep(tab: Tab): void {
    if (tab.path !== null) return
    const text = textOf(tab)
    const previous = drafting.get(tab.id) ?? Promise.resolve()
    const next = previous
      .then(async () => {
        tab.draftKey = await keepDraft(tab.draftKey, text)
      })
      .catch(() => {
        // A draft that cannot be filed is not worth a dialog while someone is
        // typing; the text is on screen and `Ctrl+S` still works.
      })
    drafting.set(tab.id, next)
  }

  const first = addTab(file)
  activeId = first.id

  const view = new EditorView({ state: first.state, parent: host })

  const active = (): Tab => tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  /** Puts the live state back into its tab before anything reads it. */
  function stash() {
    const current = tabs.find((tab) => tab.id === activeId)
    if (current) current.state = view.state
  }

  function show(tab: Tab) {
    stash()
    activeId = tab.id
    view.setState(tab.state)
    view.focus()
    notify()
  }

  /** The text of a tab: the live view for the active one, its stashed state
   *  otherwise. Reading `tab.state` for the active tab would return whatever it
   *  held when it was last switched away from. */
  function textOf(tab: Tab): string {
    return tab.id === activeId ? view.state.doc.toString() : tab.state.doc.toString()
  }

  const byId = (id?: number): Tab | undefined =>
    id === undefined ? active() : tabs.find((tab) => tab.id === id)

  const handle: EditorHandle = {
    view,
    tabs: () => tabs,
    active,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    revision: () => revision,

    async open(path) {
      // By path, not by string: the same file reaches here spelled two ways —
      // from the tree with the filesystem's separators, from a command line
      // with whatever was typed — and `===` between them opens a second tab on
      // the file already in front of you.
      const existing = tabs.find((tab) => tab.path !== null && samePath(tab.path, path))
      if (existing) {
        show(existing)
        return
      }
      handle.adopt(await openFile(path))
    },

    adopt(next) {
      const existing = tabs.find((tab) => tab.path !== null && samePath(tab.path, next.path))
      if (existing) {
        // Somebody ran `scheda --wait` on a file this window already had open.
        // The tab is the one that has to release them, so it takes on the
        // promise rather than leaving a process blocked on a tab that will
        // never know about it.
        if (next.awaited) existing.awaited = true
        show(existing)
        return
      }
      // An untouched blank tab is a placeholder, not work: reuse it rather than
      // leaving an empty tab behind every time a file is opened.
      const current = active()
      const blankAndUnused =
        current && current.path === null && !handle.isDirty(current.id) && tabs.length === 1
      if (blankAndUnused) {
        // It was empty, so any draft filed for it is empty too — and an empty
        // draft is never filed. Nothing to discard.
        current.path = next.path
        current.shape = next.shape
        current.readOnly = next.readOnly
        current.saved = next.text
        current.awaited = next.awaited ?? false
        current.state = stateFor(next.text, next.readOnly, next.path)
        show(current)
        return
      }
      show(addTab(next))
    },

    openBlank() {
      show(addTab(null))
    },

    adoptDraft(draft) {
      const tab = addTab(null, draft.key)
      // `saved` stays empty: a draft that was never written to a file has
      // unsaved changes by definition, and the dot in the tab strip is the
      // honest way to say so.
      tab.state = stateFor(draft.text, false, null)
      show(tab)
    },

    follow(from, to) {
      const tab = tabs.find((candidate) => candidate.path !== null && samePath(candidate.path, from))
      if (!tab) return
      tab.path = to
      tab.orphaned = false
      // The document moved, so its relative links resolve from somewhere else
      // now — and the state carrying the old path has to be told, whether it is
      // the live one or a stashed one.
      forgetAssets(from)
      if (tab.id === activeId) {
        view.dispatch({ effects: setDocumentPath.of(to) })
      } else {
        tab.state = tab.state.update({ effects: setDocumentPath.of(to) }).state
      }
      notify()
    },

    orphan(path) {
      // A folder was deleted, so every tab under it loses its file, not just
      // the one named exactly.
      for (const tab of tabs) {
        if (tab.path === null) continue
        if (samePath(tab.path, path) || isInside(path, tab.path)) tab.orphaned = true
      }
      notify()
    },

    async reload(id) {
      const tab = tabs.find((candidate) => candidate.id === id)
      if (!tab || tab.path === null) return
      const fresh = await rereadFile(tab.path)

      // The shape too, not just the text: a file that came back from a sync
      // client with CRLF where it had LF would otherwise be written back in the
      // old shape on the next save, rewriting every line of it.
      tab.shape = fresh.shape
      tab.readOnly = fresh.readOnly
      tab.saved = fresh.text
      tab.orphaned = false

      const next = stateFor(fresh.text, fresh.readOnly, tab.path)
      if (tab.id === activeId) {
        // Through the live view rather than by swapping the state in, so the
        // caret and the scroll position are the view's to keep where it can.
        view.setState(next)
        tab.state = next
      } else {
        tab.state = next
      }
      notify()
    },

    acceptAsSaved(id, text) {
      const tab = tabs.find((candidate) => candidate.id === id)
      if (!tab) return
      tab.saved = text
      notify()
    },

    select(id) {
      const tab = tabs.find((candidate) => candidate.id === id)
      if (tab) show(tab)
    },

    close(id, force = false) {
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return true
      if (!force && handle.isDirty(id)) return false

      const closing = tabs[index]
      const wasActive = closing.id === activeId
      // A draft closed on purpose is a draft thrown away; keeping it would mean
      // the tab comes back on the next launch after being told to go.
      if (closing.draftKey !== null) void discardDraft(closing.draftKey)
      // Somebody's `$EDITOR` was this tab, and they have been blocked since it
      // opened. Closing it is the signal they are waiting for — so it is sent
      // here, in the one place every close goes through, rather than beside
      // each of the three ways a tab can be closed.
      if (closing.awaited && closing.path !== null) void releaseWaiter(closing.path)
      drafting.delete(closing.id)
      tabs.splice(index, 1)

      // Never leave the window with no document: the last tab closing means a
      // fresh blank one, the way a notepad behaves.
      if (tabs.length === 0) {
        const blank = addTab(null)
        activeId = blank.id
        view.setState(blank.state)
        view.focus()
        notify()
        return true
      }

      if (wasActive) {
        show(tabs[Math.min(index, tabs.length - 1)])
      } else {
        notify()
      }
      return true
    },

    async save(id) {
      const tab = byId(id)
      if (!tab || !tab.path || tab.readOnly) return
      stash()
      const current = textOf(tab)
      await saveFile(tab.path, current, tab.shape)
      tab.saved = current
      notify()
    },

    async saveAs(path) {
      const tab = active()
      stash()
      const current = textOf(tab)
      await saveFile(path, current, tab.shape)
      const previous = tab.path
      tab.path = path
      tab.saved = current
      // The text has a file now, so the draft that stood in for one is done.
      // Discarded after the write, not before: a failed save must not take the
      // only copy of the text with it.
      if (tab.draftKey !== null) {
        void discardDraft(tab.draftKey)
        tab.draftKey = null
      }
      // Whatever it was before, this tab now names a file that exists.
      tab.orphaned = false
      // The document moved, so its relative links point somewhere else now.
      if (previous) forgetAssets(previous)
      view.dispatch({ effects: setDocumentPath.of(path) })
      // A file saved under a new name is no longer the read-only thing it may
      // have been opened as: the bytes just written are ours and are UTF-8.
      tab.readOnly = false
      notify()
    },

    isDirty(id) {
      const tab = byId(id)
      return tab ? textOf(tab) !== tab.saved : false
    },

    anyDirty: () => tabs.some((tab) => handle.isDirty(tab.id)),

    async keepDrafts() {
      clearTimeout(draftTimer)
      stash()
      for (const tab of tabs) keep(tab)
      // Awaited, not fired: the window is about to go, and a write still in
      // flight when the process ends is a draft that was never written.
      await Promise.all(drafting.values())
    },
  }

  view.focus()
  return handle
}

// The editor, and the documents it is holding.
//
// A tab is a document; a pane is a place on screen that shows one. There are
// one or two panes, and every tab belongs to the one strip whichever pane it is
// shown in (ADR 0012).
//
// Each pane has its own `EditorView`, and switching a pane to another tab swaps
// that tab's state into the view rather than building a new one. That keeps
// opening a tab cheap, keeps the first frame exactly as expensive as it was
// when there was only one document, and gives each tab its own undo history for
// free — the history lives in the state, so it travels with the tab through
// switches and between panes instead of being shared or thrown away.
//
// A tab is shown in at most one pane. Its state can only be in one view at a
// time, and two views editing two copies of one document would be two truths
// about the same file an instant after the first keystroke (ADR 0002).
//
// The shape of a file (BOM, line endings) travels with it untouched: the editor
// edits characters, and only the core knows how those become bytes.
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
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
  type WindowSession,
} from '../core'
import {
  documentPath,
  forgetDocument,
  schedaEditor,
  setBracketClosing,
  setDocumentPath,
  setSpelling,
} from '@lacodda/scheda-editor'
import { isInside, samePath } from '../paths'
import { schedaHost } from './host'

/** A document with a filename, or an unnamed buffer that has never been saved. */
export interface Tab {
  readonly id: number
  path: string | null
  shape: DocumentShape
  readOnly: boolean
  /** The text as it stands on disk. Anything else means unsaved changes. */
  saved: string
  /** The tab's editor state, held while no pane is showing it. */
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
  /** Pinned tabs stand first in the strip and are left alone by "close all". */
  pinned: boolean
  /** The position at the top of the pane when the tab was last on screen, so
   *  coming back to it — or to the window, next launch — is coming back to
   *  what was being looked at rather than to the first line. */
  top: number
}

/** The shape a brand new file is written with: no BOM, LF, nothing to replay. */
const NEW_FILE_SHAPE: DocumentShape = { line_ending: 'lf', bom: false }

/** How long typing has to pause before a named file is written, when autosave
 *  is on. Longer than a draft's pause: a draft is a file of our own, and this
 *  one is somebody's note that a sync client or a git hook may be watching. */
const AUTOSAVE_DELAY_MS = 1000

/** Things that belong to the window rather than to any one document. */
export interface WindowOptions {
  closeBrackets: boolean
  spellcheck: boolean
  autosave: boolean
}

/** A tab to put back, as a session remembered it and the core read it. */
export interface RestoredTab {
  file: OpenFile | null
  draft: Draft | null
  pinned: boolean
  anchor: number
  head: number
  top: number
}

export interface EditorHandle {
  /** The view the keyboard is in: the only pane, or the focused one of two. */
  readonly view: EditorView
  /** Every pane's view, for what applies to the whole window. */
  views: () => readonly EditorView[]
  /** The element the panes live in: where the keys of the note's own
   *  commands are answered. */
  readonly host: HTMLElement
  tabs: () => readonly Tab[]
  active: () => Tab
  /** Called whenever a document, the tab list, a pane or the focus changes. */
  subscribe: (listener: () => void) => () => void
  /** Bumped on every such change. A stable snapshot for `useSyncExternalStore`,
   *  which loops forever on a value derived from mutable state. */
  revision: () => number
  /** Opens a path in the focused pane: focuses the tab already showing it, or
   *  adds one. */
  open: (path: string) => Promise<void>
  /** Adds a tab for a file the core has already read. */
  adopt: (file: OpenFile) => void
  /** Opens an empty, unnamed buffer. */
  openBlank: () => void
  /** Reopens a draft that survived a restart, under the key it was filed with. */
  adoptDraft: (draft: Draft) => void
  /** Puts a remembered session back: the tabs in order, what each was showing,
   *  and the split. Tabs already open are kept and take their place in the
   *  order. `keepFront` leaves the tab in front where it is — the window was
   *  launched with a file, and that file is what was asked for. */
  restore: (
    tabs: RestoredTab[],
    layout: Pick<WindowSession, 'active' | 'beside' | 'focused'>,
    keepFront: boolean,
  ) => void
  /** What the window has open, as a session to remember. */
  snapshot: () => WindowSession
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
  /** Shows a tab: in the pane that already has it, or in the focused one. */
  select: (id: number) => void
  /** Closes a tab. Returns false when it has unsaved changes and `force` was
   *  not set — the caller is expected to ask before discarding work. */
  close: (id: number, force?: boolean) => boolean
  /** The path of the most recently closed tab that had one, taken off the list. */
  takeClosed: () => string | null
  save: (id?: number) => Promise<void>
  /** Saves the active tab to a new path, adopting it as the tab's own. */
  saveAs: (path: string) => Promise<void>
  isDirty: (id?: number) => boolean
  anyDirty: () => boolean
  /** Writes every unnamed tab's text out now, without waiting for the pause
   *  that usually triggers it. For the moment the window is closing. */
  keepDrafts: () => Promise<void>
  /** Writes every named tab with unsaved changes, if autosave is on, now. For
   *  the window losing focus or closing. Resolves when the writes are done. */
  flushAutosave: () => Promise<void>
  /** Called with a tab autosave did not write because its file changed on
   *  disk since the tab last saw it — the question is the shell's to ask. */
  onAutosaveRefused: (handler: ((id: number) => void) | null) => void
  pin: (id: number, pinned: boolean) => void
  /** Moves a tab before another in the strip, or to the end of its group.
   *  Pinned and unpinned tabs stay in their own groups. */
  move: (id: number, before: number | null) => void
  /** Which tab each pane shows: one entry, or two when split. */
  panes: () => readonly number[]
  /** Which pane has the keyboard. */
  focusedPane: () => number
  focusPane: (index: number) => void
  /** Shows a tab in a pane, splitting the window when that is the second one.
   *  A tab already shown in the other pane changes places with this pane's. */
  showIn: (id: number, pane: number) => void
  /** Splits the window, or closes the split. Split, the second pane shows the
   *  tab used before the one in front, or a new draft when there is none; the
   *  keyboard stays where it was. */
  toggleSplit: () => void
  configure: (options: Partial<WindowOptions>) => void
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

  const options: WindowOptions = { closeBrackets: false, spellcheck: false, autosave: false }

  let nextId = 1
  const tabs: Tab[] = []
  /** Tab ids, most recently shown last: which tab a pane falls back to. */
  const used: number[] = []
  const closed: string[] = []

  interface Pane {
    view: EditorView
    element: HTMLElement
    tabId: number
  }
  const panes: Pane[] = []
  let focused = 0

  const listening: Extension = [
    EditorView.updateListener.of((update) => {
      // Effects too: a mode switched from the keyboard (focus, reading) is news
      // for the status bar even though neither the text nor the caret moved.
      const switched = update.transactions.some((transaction) => transaction.effects.length > 0)
      if (update.docChanged || update.selectionSet || switched) notify()
      if (update.docChanged) {
        const tab = tabOfView(update.view)
        if (tab) {
          scheduleDraft(tab)
          scheduleAutosave(tab)
        }
      }
    }),
  ]

  function stateFor(text: string, readOnly: boolean, path: string | null): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        // With the window's current answer on bracket closing, so a tab opened
        // after the setting changed does not come up with the answer the
        // window started with.
        ...schedaEditor({ host: schedaHost, closeBrackets: options.closeBrackets }),
        listening,
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
      pinned: false,
      top: 0,
    }
    tabs.push(tab)
    return tab
  }

  // ------------------------------------------------------------------ panes

  function makePane(tab: Tab): Pane {
    const element = document.createElement('div')
    element.className = 'pane'
    host.appendChild(element)
    const view = new EditorView({ state: tab.state, parent: element })
    const pane: Pane = { view, element, tabId: tab.id }
    // The pane the keyboard went into is the one the window acts on. Focus in,
    // not the editor's own focus: a click on a widget inside the note counts.
    element.addEventListener('focusin', () => {
      const index = panes.indexOf(pane)
      if (index !== -1 && index !== focused) {
        focused = index
        markFocus()
        notify()
      }
    })
    panes.push(pane)
    markFocus()
    return pane
  }

  /** The focused pane says so, but only when there are two to tell apart. */
  function markFocus() {
    host.classList.toggle('editor-host--split', panes.length > 1)
    panes.forEach((pane, index) => {
      pane.element.classList.toggle('pane--focused', panes.length > 1 && index === focused)
    })
  }

  const paneShowing = (id: number): number => panes.findIndex((pane) => pane.tabId === id)
  const tabById = (id: number): Tab | undefined => tabs.find((tab) => tab.id === id)

  function tabOfView(view: EditorView): Tab | undefined {
    const pane = panes.find((candidate) => candidate.view === view)
    return pane ? tabById(pane.tabId) : undefined
  }

  /** The position at the top of a view: the line the person was looking at. */
  function topOf(view: EditorView): number {
    const height = view.scrollDOM.scrollTop - view.documentPadding.top
    if (height <= 0) return 0
    return view.lineBlockAtHeight(height).from
  }

  /** Puts every pane's live state back into its tab before anything reads it. */
  function stash() {
    for (const pane of panes) {
      const tab = tabById(pane.tabId)
      if (!tab) continue
      tab.state = pane.view.state
      tab.top = topOf(pane.view)
    }
  }

  function scrollTo(view: EditorView, top: number) {
    const at = Math.min(Math.max(top, 0), view.state.doc.length)
    if (at === 0) return
    view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
  }

  /** Puts a tab into a pane, taking the pane's tab out first. */
  function place(tab: Tab, index: number) {
    const pane = panes[index]
    const leaving = tabById(pane.tabId)
    // The same tab placed again takes the state it has been given, not the one
    // on screen: that is how a restored caret reaches a tab already showing.
    if (leaving && leaving !== tab) {
      leaving.state = pane.view.state
      leaving.top = topOf(pane.view)
    }
    pane.tabId = tab.id
    pane.view.setState(tab.state)
    scrollTo(pane.view, tab.top)
    remember(tab.id)
  }

  function remember(id: number) {
    const at = used.indexOf(id)
    if (at !== -1) used.splice(at, 1)
    used.push(id)
  }

  function show(tab: Tab, index = focused) {
    const already = paneShowing(tab.id)
    if (already !== -1) {
      // Shown in the other pane: the keyboard goes there rather than the tab
      // coming here, since a tab is only ever in one place.
      focused = already
    } else {
      place(tab, index)
      focused = index
    }
    markFocus()
    panes[focused].view.focus()
    notify()
  }

  /** The tab a pane shows when its own goes: the one used most recently that
   *  no other pane is showing. */
  function fallbackFor(index: number): Tab | undefined {
    for (let at = used.length - 1; at >= 0; at -= 1) {
      const candidate = tabById(used[at])
      if (candidate && paneShowing(candidate.id) === -1) return candidate
    }
    return tabs.find((tab) => paneShowing(tab.id) === -1 && tab.id !== panes[index]?.tabId)
  }

  function closePane(index: number) {
    if (panes.length < 2) return
    const [pane] = panes.splice(index, 1)
    const tab = tabById(pane.tabId)
    if (tab) {
      tab.state = pane.view.state
      tab.top = topOf(pane.view)
    }
    pane.view.destroy()
    pane.element.remove()
    focused = Math.min(focused, panes.length - 1)
    markFocus()
  }

  const active = (): Tab => tabById(panes[focused].tabId) ?? tabs[0]

  /** The text of a tab: the live view for one on screen, its stashed state
   *  otherwise. Reading `tab.state` for a shown tab would return whatever it
   *  held when it was last switched away from. */
  function stateOf(tab: Tab): EditorState {
    const index = paneShowing(tab.id)
    return index === -1 ? tab.state : panes[index].view.state
  }
  const textOf = (tab: Tab): string => stateOf(tab).doc.toString()

  // ----------------------------------------------------------------- drafts

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
  const draftTimers = new Map<number, ReturnType<typeof setTimeout>>()

  function scheduleDraft(tab: Tab): void {
    if (tab.path !== null) return
    clearTimeout(draftTimers.get(tab.id))
    draftTimers.set(
      tab.id,
      setTimeout(() => keep(tab), DRAFT_DELAY_MS),
    )
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

  // --------------------------------------------------------------- autosave

  const autosaveTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const autosaving = new Map<number, Promise<void>>()
  let refused: ((id: number) => void) | null = null

  /** Whether autosave may write this tab at all. A draft has no file, a
   *  read-only file is never written (ADR 0002), and an orphan's path names a
   *  file somebody deleted — writing it would bring the file back. */
  const autosavable = (tab: Tab) => options.autosave && tab.path !== null && !tab.readOnly && !tab.orphaned

  function scheduleAutosave(tab: Tab): void {
    if (!autosavable(tab)) return
    clearTimeout(autosaveTimers.get(tab.id))
    autosaveTimers.set(
      tab.id,
      setTimeout(() => void autosave(tab), AUTOSAVE_DELAY_MS),
    )
  }

  /** Writes a tab if it still has changes, and only over the file it last saw.
   *  Chained per tab so two writes of one file can never land out of order. */
  function autosave(tab: Tab): Promise<void> {
    clearTimeout(autosaveTimers.get(tab.id))
    autosaveTimers.delete(tab.id)
    const previous = autosaving.get(tab.id) ?? Promise.resolve()
    const next = previous
      .then(async () => {
        if (!tabs.includes(tab) || !autosavable(tab) || tab.path === null) return
        const text = textOf(tab)
        if (text === tab.saved) return
        const written = await saveFile(tab.path, text, tab.shape, tab.saved)
        if (written === true) {
          tab.saved = text
          notify()
        } else {
          // The file is not the one this tab last saw. Whatever happened to
          // it, a timer is not who decides between the two versions.
          refused?.(tab.id)
        }
      })
      .catch(() => {
        // A write that failed leaves the dot on the tab, which is the honest
        // account of it; `Ctrl+S` reports the reason.
      })
    autosaving.set(tab.id, next)
    return next
  }

  // ------------------------------------------------------------------ start

  const first = addTab(file)
  makePane(first)
  remember(first.id)

  const byId = (id?: number): Tab | undefined => (id === undefined ? active() : tabById(id))

  /** Pinned tabs first, each group in the order it already had. */
  function regroup() {
    const pinned = tabs.filter((tab) => tab.pinned)
    const rest = tabs.filter((tab) => !tab.pinned)
    tabs.splice(0, tabs.length, ...pinned, ...rest)
  }

  function clampSelection(state: EditorState, anchor: number, head: number): EditorSelection {
    const length = state.doc.length
    const clamp = (at: number) => Math.min(Math.max(at, 0), length)
    return EditorSelection.single(clamp(anchor), clamp(head))
  }

  const handle: EditorHandle = {
    get view() {
      return panes[focused].view
    },
    views: () => panes.map((pane) => pane.view),
    host,
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
      // An untouched blank tab in front is a placeholder, not work: reuse it
      // rather than leaving an empty tab behind every time a file is opened -
      // the one a bare launch shows, and the one a folder is shown over, which
      // stands among other tabs. A pinned one was kept on purpose.
      const current = active()
      const blankAndUnused =
        current && current.path === null && !current.pinned && !handle.isDirty(current.id)
      if (blankAndUnused) {
        // It was empty, so any draft filed for it is empty too — and an empty
        // draft is never filed. Nothing to discard.
        current.path = next.path
        current.shape = next.shape
        current.readOnly = next.readOnly
        current.saved = next.text
        current.awaited = next.awaited ?? false
        current.state = stateFor(next.text, next.readOnly, next.path)
        current.top = 0
        panes[focused].view.setState(current.state)
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

    restore(entries, layout, keepFront) {
      stash()
      const front = active()
      // The placeholder a bare launch opens with is not part of anybody's
      // session. It goes once something real has taken its place.
      const placeholder =
        tabs.length === 1 && front.path === null && front.draftKey === null && !handle.isDirty(front.id)
          ? front
          : null

      const ordered: Tab[] = []
      for (const entry of entries) {
        let tab: Tab | undefined
        if (entry.file) {
          const path = entry.file.path
          tab = tabs.find((candidate) => candidate.path !== null && samePath(candidate.path, path))
          tab ??= addTab(entry.file)
        } else if (entry.draft) {
          const key = entry.draft.key
          tab = tabs.find((candidate) => candidate.draftKey === key)
          if (!tab) {
            tab = addTab(null, key)
            tab.state = stateFor(entry.draft.text, false, null)
          }
        }
        if (!tab || ordered.includes(tab)) continue
        tab.pinned = entry.pinned
        // A tab the window is already showing keeps its own caret: it was
        // opened on purpose a moment ago, and the session is older news.
        if (paneShowing(tab.id) === -1 || !keepFront) {
          tab.state = tab.state.update({ selection: clampSelection(tab.state, entry.anchor, entry.head) }).state
          tab.top = entry.top
        }
        ordered.push(tab)
      }
      if (ordered.length === 0) return

      // No file was in front when the session was written: a blank was - the
      // window empty, or a folder's empty window - and a blank comes back to
      // the front. The placeholder serves, and is kept for it.
      const blankInFront = !keepFront && layout.active === null
      // Tabs open before the session came back — the file the window was
      // launched with — stay, after the session's own.
      const rest = tabs.filter(
        (tab) => !ordered.includes(tab) && (tab !== placeholder || blankInFront),
      )
      tabs.splice(0, tabs.length, ...ordered, ...rest)
      regroup()
      for (const tab of ordered) remember(tab.id)

      const at = (index: number | null) => (index === null ? undefined : ordered[index])
      const inFront =
        keepFront && front !== placeholder
          ? front
          : blankInFront
            ? (placeholder ?? addTab(null))
            : (at(layout.active) ?? ordered[0])
      const beside = at(layout.beside)
      remember(inFront.id)

      // One pane first, then the split: the tab the keyboard was in goes back
      // to the side it was on.
      while (panes.length > 1) closePane(panes.length - 1)
      const firstPane = beside && layout.focused === 1 && !keepFront ? beside : inFront
      const secondPane = firstPane === inFront ? beside : inFront
      place(firstPane, 0)
      if (secondPane && secondPane !== firstPane) {
        makePane(secondPane)
        remember(secondPane.id)
        scrollTo(panes[1].view, secondPane.top)
      }
      focused = panes.findIndex((pane) => pane.tabId === inFront.id)
      if (focused === -1) focused = 0
      markFocus()
      panes[focused].view.focus()
      notify()
    },

    snapshot() {
      stash()
      const kept = tabs.filter((tab) => tab.path !== null || tab.draftKey !== null)
      const indexOf = (id: number | undefined) => {
        const at = kept.findIndex((tab) => tab.id === id)
        return at === -1 ? null : at
      }
      return {
        tabs: kept.map((tab) => ({
          path: tab.path,
          draft: tab.path === null ? tab.draftKey : null,
          pinned: tab.pinned,
          anchor: tab.state.selection.main.anchor,
          head: tab.state.selection.main.head,
          top: tab.top,
        })),
        active: indexOf(panes[focused].tabId),
        beside: panes.length > 1 ? indexOf(panes[1 - focused].tabId) : null,
        focused: (panes.length > 1 ? focused : 0) as 0 | 1,
      }
    },

    follow(from, to) {
      const tab = tabs.find((candidate) => candidate.path !== null && samePath(candidate.path, from))
      if (!tab) return
      tab.path = to
      tab.orphaned = false
      // The document moved, so its relative links resolve from somewhere else
      // now — and the state carrying the old path has to be told, whether it is
      // the live one or a stashed one. Its wikilinks too: a wikilink resolves
      // against the vault rather than against the note, so most of them still
      // land where they did — but the answers are filed under the old path, and
      // a cache nobody can reach is a cache that only grows.
      forgetDocument(schedaHost, from)
      const index = paneShowing(tab.id)
      if (index !== -1) {
        panes[index].view.dispatch({ effects: setDocumentPath.of(to) })
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
      const tab = tabById(id)
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
      const index = paneShowing(tab.id)
      if (index !== -1) {
        // Through the live view rather than by swapping the state in, so the
        // caret and the scroll position are the view's to keep where it can.
        panes[index].view.setState(next)
      }
      tab.state = next
      notify()
    },

    acceptAsSaved(id, text) {
      const tab = tabById(id)
      if (!tab) return
      tab.saved = text
      notify()
    },

    select(id) {
      const tab = tabById(id)
      if (tab) show(tab)
    },

    close(id, force = false) {
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return true
      if (!force && handle.isDirty(id)) return false

      const closing = tabs[index]
      // A draft closed on purpose is a draft thrown away; keeping it would mean
      // the tab comes back on the next launch after being told to go.
      if (closing.draftKey !== null) void discardDraft(closing.draftKey)
      // Somebody's `$EDITOR` was this tab, and they have been blocked since it
      // opened. Closing it is the signal they are waiting for — so it is sent
      // here, in the one place every close goes through, rather than beside
      // each of the three ways a tab can be closed.
      if (closing.awaited && closing.path !== null) void releaseWaiter(closing.path)
      if (closing.path !== null) {
        closed.push(closing.path)
        if (closed.length > 20) closed.shift()
      }
      drafting.delete(closing.id)
      clearTimeout(draftTimers.get(closing.id))
      clearTimeout(autosaveTimers.get(closing.id))
      const pane = paneShowing(closing.id)
      if (pane !== -1) {
        const leaving = panes[pane]
        closing.state = leaving.view.state
      }
      tabs.splice(index, 1)
      const usedAt = used.indexOf(closing.id)
      if (usedAt !== -1) used.splice(usedAt, 1)

      if (pane === -1) {
        notify()
        return true
      }

      // The pane that showed it shows the tab beside it in the strip, as a
      // single window always has; failing that, the one used last. With
      // nothing left for it, a second pane closes and the last one gets a
      // blank page — the window never has no document.
      const neighbour = [tabs[index], tabs[index - 1]].find(
        (candidate) => candidate && paneShowing(candidate.id) === -1,
      )
      const next = neighbour ?? fallbackFor(pane)
      if (next) {
        place(next, pane)
      } else if (panes.length > 1) {
        closePane(pane)
      } else {
        place(addTab(null), pane)
      }
      if (focused >= panes.length) focused = panes.length - 1
      if (pane === focused || panes.length === 1) {
        markFocus()
        panes[focused].view.focus()
      }
      notify()
      return true
    },

    takeClosed: () => closed.pop() ?? null,

    async save(id) {
      const tab = byId(id)
      if (!tab || !tab.path || tab.readOnly) return
      stash()
      const current = textOf(tab)
      clearTimeout(autosaveTimers.get(tab.id))
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
      if (previous) forgetDocument(schedaHost, previous)
      handle.view.dispatch({ effects: setDocumentPath.of(path) })
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
      for (const timer of draftTimers.values()) clearTimeout(timer)
      draftTimers.clear()
      stash()
      for (const tab of tabs) keep(tab)
      // Awaited, not fired: the window is about to go, and a write still in
      // flight when the process ends is a draft that was never written.
      await Promise.all(drafting.values())
    },

    async flushAutosave() {
      if (!options.autosave) return
      await Promise.all(tabs.filter((tab) => autosavable(tab) && handle.isDirty(tab.id)).map(autosave))
    },

    onAutosaveRefused(handler) {
      refused = handler
    },

    pin(id, pinned) {
      const tab = tabById(id)
      if (!tab || tab.pinned === pinned) return
      tab.pinned = pinned
      // A tab pinned goes to the end of the pinned ones; unpinned, it leads
      // the rest. Either way it lands next to where it was pinned from.
      tabs.splice(tabs.indexOf(tab), 1)
      const firstUnpinned = tabs.findIndex((candidate) => !candidate.pinned)
      tabs.splice(firstUnpinned === -1 ? tabs.length : firstUnpinned, 0, tab)
      notify()
    },

    move(id, before) {
      const tab = tabById(id)
      if (!tab || id === before) return
      tabs.splice(tabs.indexOf(tab), 1)
      const target = before === null ? undefined : tabById(before)
      if (target && target.pinned === tab.pinned) {
        tabs.splice(tabs.indexOf(target), 0, tab)
      } else {
        // The end of its own group: a pinned tab dropped among the unpinned
        // ones stays the last pinned tab rather than quietly unpinning.
        const group = tabs.filter((candidate) => candidate.pinned === tab.pinned)
        const last = group[group.length - 1]
        const at = last ? tabs.indexOf(last) + 1 : tab.pinned ? 0 : tabs.length
        tabs.splice(at, 0, tab)
      }
      notify()
    },

    panes: () => panes.map((pane) => pane.tabId),
    focusedPane: () => focused,

    focusPane(index) {
      if (!panes[index]) return
      focused = index
      markFocus()
      panes[index].view.focus()
      notify()
    },

    showIn(id, index) {
      const tab = tabById(id)
      if (!tab) return
      const target = Math.min(index, 1)
      if (target === 1 && panes.length === 1) {
        if (paneShowing(id) === 0) {
          // The only pane's own tab asked for the second pane: it moves there,
          // and the first shows what was used before it.
          const other = fallbackFor(0) ?? addTab(null)
          stash()
          place(other, 0)
        }
        makePane(tab)
        remember(tab.id)
        focused = 1
      } else {
        const from = paneShowing(id)
        if (from !== -1 && from !== target) {
          // Already in the other pane: the two change places.
          const other = tabById(panes[target].tabId)
          stash()
          panes[from].tabId = -1
          place(tab, target)
          if (other) place(other, from)
        } else if (from === -1) {
          place(tab, target)
        }
        focused = target
      }
      markFocus()
      panes[focused].view.focus()
      notify()
    },

    toggleSplit() {
      if (panes.length > 1) {
        // Closing the split keeps the tab the keyboard is in on screen.
        if (focused === 1) {
          const keep = tabById(panes[1].tabId)
          closePane(0)
          if (keep) remember(keep.id)
        } else {
          closePane(1)
        }
        focused = 0
        markFocus()
        panes[0].view.focus()
        notify()
        return
      }
      const other = fallbackFor(0) ?? addTab(null)
      stash()
      makePane(other)
      remember(other.id)
      remember(panes[0].tabId)
      focused = 0
      markFocus()
      panes[0].view.focus()
      notify()
    },

    configure(next) {
      const bracketsChanged = next.closeBrackets !== undefined && next.closeBrackets !== options.closeBrackets
      Object.assign(options, next)
      if (bracketsChanged) {
        // A compartment lives in each state, so every tab is told — the ones
        // on screen through their view, the rest in place. The document, the
        // undo history and the caret all survive the change.
        const spec = setBracketClosing(options.closeBrackets)
        for (const tab of tabs) {
          const index = paneShowing(tab.id)
          if (index !== -1) panes[index].view.dispatch(spec)
          else tab.state = tab.state.update(spec).state
        }
      }
      if (next.spellcheck !== undefined) {
        for (const pane of panes) setSpelling(pane.view, options.spellcheck)
      }
      if (next.autosave === false) {
        for (const timer of autosaveTimers.values()) clearTimeout(timer)
        autosaveTimers.clear()
      }
    },
  }

  panes[0].view.focus()
  return handle
}

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
import { openFile, saveFile, type DocumentShape, type OpenFile } from '../core'
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
  select: (id: number) => void
  /** Closes a tab. Returns false when it has unsaved changes and `force` was
   *  not set — the caller is expected to ask before discarding work. */
  close: (id: number, force?: boolean) => boolean
  save: (id?: number) => Promise<void>
  /** Saves the active tab to a new path, adopting it as the tab's own. */
  saveAs: (path: string) => Promise<void>
  isDirty: (id?: number) => boolean
  anyDirty: () => boolean
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

  function addTab(source: OpenFile | null): Tab {
    const tab: Tab = {
      id: nextId++,
      path: source?.path ?? null,
      shape: source?.shape ?? NEW_FILE_SHAPE,
      readOnly: source?.readOnly ?? false,
      saved: source?.text ?? '',
      state: stateFor(source?.text ?? '', source?.readOnly ?? false, source?.path ?? null),
    }
    tabs.push(tab)
    return tab
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
      const existing = tabs.find((tab) => tab.path === path)
      if (existing) {
        show(existing)
        return
      }
      handle.adopt(await openFile(path))
    },

    adopt(next) {
      const existing = tabs.find((tab) => tab.path === next.path)
      if (existing) {
        show(existing)
        return
      }
      // An untouched blank tab is a placeholder, not work: reuse it rather than
      // leaving an empty tab behind every time a file is opened.
      const current = active()
      const blankAndUnused =
        current && current.path === null && !handle.isDirty(current.id) && tabs.length === 1
      if (blankAndUnused) {
        current.path = next.path
        current.shape = next.shape
        current.readOnly = next.readOnly
        current.saved = next.text
        current.state = stateFor(next.text, next.readOnly, next.path)
        show(current)
        return
      }
      show(addTab(next))
    },

    openBlank() {
      show(addTab(null))
    },

    select(id) {
      const tab = tabs.find((candidate) => candidate.id === id)
      if (tab) show(tab)
    },

    close(id, force = false) {
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return true
      if (!force && handle.isDirty(id)) return false

      const wasActive = tabs[index].id === activeId
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
  }

  view.focus()
  return handle
}

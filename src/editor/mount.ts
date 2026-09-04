// The editor and the document it is showing.
//
// The shape of the file (BOM, line endings) travels with it untouched: the
// editor edits characters, and only the core knows how those become bytes.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { openFile, saveFile, type DocumentShape, type OpenFile } from '../core'
import { schedaSetup } from './setup'

/** A document with a filename, or an unnamed buffer that has never been saved. */
export interface Session {
  view: EditorView
  path: string | null
  shape: DocumentShape
  readOnly: boolean
  /** The text as it stands on disk. Anything else means unsaved changes. */
  saved: string
}

/** The shape a brand new file is written with: no BOM, LF, nothing to replay. */
const NEW_FILE_SHAPE: DocumentShape = { line_ending: 'lf', bom: false }

export interface EditorHandle {
  session: Session
  /** Called whenever the document, the path or the dirty state changes. */
  subscribe: (listener: () => void) => () => void
  /** Bumped on every such change. A stable snapshot for `useSyncExternalStore`,
   *  which loops forever on a value derived from mutable state. */
  revision: () => number
  load: (path: string) => Promise<void>
  save: () => Promise<void>
  isDirty: () => boolean
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

  const view = new EditorView({
    state: EditorState.create({
      doc: file?.text ?? '',
      extensions: [
        ...schedaSetup(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet) notify()
        }),
        EditorState.readOnly.of(file?.readOnly ?? false),
      ],
    }),
    parent: host,
  })

  const session: Session = {
    view,
    path: file?.path ?? null,
    shape: file?.shape ?? NEW_FILE_SHAPE,
    readOnly: file?.readOnly ?? false,
    saved: file?.text ?? '',
  }

  const text = () => session.view.state.doc.toString()

  const handle: EditorHandle = {
    session,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    revision: () => revision,
    async load(path) {
      const next = await openFile(path)
      session.path = next.path
      session.shape = next.shape
      session.readOnly = next.readOnly
      session.saved = next.text
      session.view.dispatch({
        changes: { from: 0, to: session.view.state.doc.length, insert: next.text },
        selection: { anchor: 0 },
      })
      notify()
    },
    async save() {
      if (!session.path || session.readOnly) return
      const current = text()
      await saveFile(session.path, current, session.shape)
      session.saved = current
      notify()
    },
    isDirty: () => text() !== session.saved,
  }

  view.focus()
  return handle
}

// Everything around the text: the tab strip, the status line, the shortcuts,
// the drop target and the guard on unsaved work.
//
// Mounted after the first paint. If this file were slow it would cost the
// window nothing, which is exactly why it is a separate module.
import { StrictMode, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ask, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  forgetRecent,
  loadSettings,
  onFileHandedOver,
  onHandoverFailed,
  rememberRecent,
} from './core'
import { apply as applyAppearance } from './appearance'
import { Outline } from './outline'
import { FileTree } from './tree'
import { setBracketClosing } from './editor/edits'
import { RecentFiles } from './recent'
import { Mark, ResizeEdges, WindowButtons, useTitleBarGestures } from './titlebar'
import type { EditorHandle, Tab } from './editor/mount'

const LINE_ENDING_LABEL = { lf: 'LF', crlf: 'CRLF', mixed: 'mixed' } as const

const MARKDOWN_FILTER = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All files', extensions: ['*'] },
]

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

function tabLabel(tab: Tab): string {
  return tab.path ? basename(tab.path) : 'Untitled'
}

/** Subscribes a component to the editor. The snapshot is a counter rather than
 *  anything derived from the document, because useSyncExternalStore re-renders
 *  forever on a snapshot that is not stable. */
function useEditor(editor: EditorHandle) {
  useSyncExternalStore(editor.subscribe, editor.revision)
}

/** Closing a tab, asking first when it holds unsaved work. Shared so the strip
 *  and the keyboard cannot drift into asking differently. */
function useCloseTab(editor: EditorHandle) {
  return useCallback(
    async (id: number) => {
      if (editor.close(id)) return
      const tab = editor.tabs().find((candidate) => candidate.id === id)
      const discard = await ask(`${tab ? tabLabel(tab) : 'This file'} has unsaved changes.`, {
        title: 'Close without saving?',
        kind: 'warning',
        okLabel: 'Discard',
        cancelLabel: 'Keep editing',
      })
      if (discard) editor.close(id, true)
    },
    [editor],
  )
}

function TabStrip({ editor, onClose }: { editor: EditorHandle; onClose: (id: number) => void }) {
  useEditor(editor)
  const tabs = editor.tabs()
  const activeId = editor.active().id

  // Every document gets a tab, including the only one. The strip used to hide
  // itself for a single file, back when it was a second band under the system
  // title bar; now it *is* the title bar, and an empty one would just be a
  // window that has forgotten what it is showing.
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab${tab.id === activeId ? ' tab--active' : ''}`}
          onClick={() => editor.select(tab.id)}
          onAuxClick={(event) => {
            // Middle click closes, the way every tabbed thing does.
            if (event.button === 1) {
              event.preventDefault()
              onClose(tab.id)
            }
          }}
          title={tab.path ?? 'Untitled'}
        >
          <span className="tab-name">{tabLabel(tab)}</span>
          {editor.isDirty(tab.id) && <span className="tab-dirty">•</span>}
          {tabs.length > 1 && (
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tabLabel(tab)}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function StatusBar({ editor }: { editor: EditorHandle }) {
  useEditor(editor)

  const tab = editor.active()
  const state = editor.view.state
  const line = state.doc.lineAt(state.selection.main.head)
  const column = state.selection.main.head - line.from + 1
  const characters = state.doc.length
  const words = countWords(state.doc.toString())

  return (
    <footer className="status">
      <span className="status-name">
        {tabLabel(tab)}
        {editor.isDirty() ? ' •' : ''}
      </span>
      <span className="status-spacer" />
      {tab.readOnly && <span className="status-warning">read-only</span>}
      <span>
        Ln {line.number}, Col {column}
      </span>
      <span>
        {words} {words === 1 ? 'word' : 'words'}
      </span>
      <span>{characters} chars</span>
      <span>{LINE_ENDING_LABEL[tab.shape.line_ending]}</span>
      <span>{tab.shape.bom ? 'UTF-8 BOM' : 'UTF-8'}</span>
    </footer>
  )
}

/** Words, counted the way a writer means them: runs of non-whitespace. */
function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

function Shell({ editor }: { editor: EditorHandle }) {
  /** Opens a path and records it as recent. A file that has gone is dropped
   *  from the list rather than reported: the list is a convenience, and an
   *  error dialog for a stale entry is not what the user asked for. */
  const openPath = useCallback(
    async (path: string) => {
      try {
        await editor.open(path)
        void rememberRecent(path)
      } catch (error) {
        void forgetRecent(path)
        void ask(error instanceof Error ? error.message : String(error), {
          title: 'Cannot open that file',
          kind: 'error',
          okLabel: 'OK',
        })
      }
    },
    [editor],
  )

  const saveAs = useCallback(async () => {
    const path = await saveDialog({ filters: MARKDOWN_FILTER })
    if (!path) return
    await editor.saveAs(path)
  }, [editor])

  const saveActive = useCallback(async () => {
    if (editor.active().path) await editor.save()
    else await saveAs()
  }, [editor, saveAs])

  const closeTab = useCloseTab(editor)

  useEffect(() => {
    // The file the window opened with counts as recently opened; the core read
    // it before this module existed, so nothing recorded it then. Once, on
    // mount: every later open records itself.
    const path = editor.active().path
    if (path) void rememberRecent(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()

      if (key === 's') {
        event.preventDefault()
        if (event.shiftKey) void saveAs()
        else void saveActive()
      } else if (key === 'o') {
        event.preventDefault()
        void openDialog({ multiple: false, filters: MARKDOWN_FILTER }).then((path) => {
          if (typeof path === 'string') void openPath(path)
        })
      } else if (key === 'n') {
        event.preventDefault()
        editor.openBlank()
      } else if (key === 'w') {
        event.preventDefault()
        void closeTab(editor.active().id)
      } else if (key === 'tab') {
        // Ctrl+Tab walks the strip in order, wrapping at the end.
        event.preventDefault()
        const tabs = editor.tabs()
        if (tabs.length < 2) return
        const index = tabs.findIndex((tab) => tab.id === editor.active().id)
        const step = event.shiftKey ? -1 : 1
        editor.select(tabs[(index + step + tabs.length) % tabs.length].id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, saveActive, saveAs, closeTab, openPath])

  useEffect(() => {
    // Dropping files on the window opens them. The webview reports paths; the
    // core is still the only thing that reads them.
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      for (const path of event.payload.paths) void openPath(path)
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [editor, openPath])

  useEffect(() => {
    // A second launch hands its file to this window rather than opening one of
    // its own; the core has already read it.
    const opened = onFileHandedOver((file) => {
      editor.adopt(file)
      void rememberRecent(file.path)
    })
    const failed = onHandoverFailed((message) => {
      void ask(message, { title: 'Cannot open that file', kind: 'error', okLabel: 'OK' })
    })
    return () => {
      void opened.then((stop) => stop())
      void failed.then((stop) => stop())
    }
  }, [editor])

  useEffect(() => {
    // The look the user chose. Read here rather than before the first frame:
    // the window appearing in the system theme and correcting itself a frame
    // later is cheaper than a blank window waiting on a file read.
    void loadSettings()
      .then((settings) => {
        applyAppearance(settings)
        // Bracket closing is an editor extension rather than a CSS variable,
        // so it is reconfigured rather than applied. The compartment means the
        // document, the undo history and the caret all survive the change.
        editor.view.dispatch(setBracketClosing(settings.close_brackets))
      })
      .catch(() => {
        // Unreadable settings are not worth a dialog on startup; the defaults
        // are already on screen.
      })
  }, [editor])

  useEffect(() => {
    // Closing the window with unsaved work asks first. Tauri lets us take the
    // close request back, which is the only reason this can be honest.
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!editor.anyDirty()) return
      event.preventDefault()
      const dirty = editor.tabs().filter((tab) => editor.isDirty(tab.id))
      const names = dirty.map(tabLabel).join(', ')
      const discard = await ask(
        dirty.length === 1
          ? `${names} has unsaved changes.`
          : `${dirty.length} files have unsaved changes: ${names}.`,
        {
          title: 'Quit without saving?',
          kind: 'warning',
          okLabel: 'Discard',
          cancelLabel: 'Keep editing',
        },
      )
      if (discard) await getCurrentWindow().destroy()
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [editor])

  return <StatusBar editor={editor} />
}

/** The outline, and the key that shows it.
 *
 *  The state lives here rather than in the editor: it is a property of the
 *  window, not of the document, and switching tabs should not close a panel
 *  that was open. */
function OutlinePanel({ editor }: { editor: EditorHandle }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'o') return
      event.preventDefault()
      setVisible((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <Outline editor={editor} visible={visible} />
}

/** The file tree, and the key that shows it.
 *
 *  Like the outline, the state belongs to the window rather than to the
 *  document: switching tabs should not close a panel that was open. The path
 *  it reads from does follow the tabs, because the tree is the vault of
 *  whatever is being edited. */
function TreePanel({ editor }: { editor: EditorHandle }) {
  const [visible, setVisible] = useState(false)
  useEditor(editor)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'e') return
      event.preventDefault()
      setVisible((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <FileTree
      documentPath={editor.active().path}
      visible={visible}
      onOpen={(path) => {
        void editor.open(path).catch(() => {
          // A file that will not open leaves the tree as it was; the banner in
          // main.tsx is what says why.
        })
      }}
    />
  )
}

/** Mounts the title bar above the editor and the status bar below it. */
export function mountShell(editor: EditorHandle) {
  const root = document.getElementById('root')!
  const editorHost = root.querySelector('.editor-host')!

  const stripHost = document.createElement('div')
  stripHost.className = 'strip-host'
  root.insertBefore(stripHost, editorHost)

  const shellHost = document.createElement('div')
  shellHost.className = 'shell-host'
  root.appendChild(shellHost)

  // The outline sits beside the editor rather than above or below it, so the
  // two are wrapped in a row of their own. Done here rather than in the markup
  // because the editor host already exists by now — the text was on screen
  // before this file ran, which is the whole ordering (ADR 0001).
  const middle = document.createElement('div')
  middle.className = 'middle'
  editorHost.parentElement!.insertBefore(middle, editorHost)
  // The tree on the left, the editor in the middle, the outline on the right —
  // the order they are appended is the order they appear.
  const treeHost = document.createElement('div')
  treeHost.className = 'tree-host'
  const outlineHost = document.createElement('div')
  outlineHost.className = 'outline-host'
  middle.appendChild(treeHost)
  middle.appendChild(editorHost)
  middle.appendChild(outlineHost)

  // The title bar and the status bar are separate roots so the first can sit
  // above the editor and the second below it: React cannot render one component
  // into two places.
  createRoot(shellHost).render(
    <StrictMode>
      <Shell editor={editor} />
    </StrictMode>,
  )
  createRoot(outlineHost).render(
    <StrictMode>
      <OutlinePanel editor={editor} />
    </StrictMode>,
  )
  createRoot(treeHost).render(
    <StrictMode>
      <TreePanel editor={editor} />
    </StrictMode>,
  )
  createRoot(stripHost).render(
    <StrictMode>
      <TitleBar
        editor={editor}
        onOpen={(path) => {
          void editor.open(path).then(
            () => rememberRecent(path),
            () => forgetRecent(path),
          )
        }}
      />
    </StrictMode>,
  )
}

/** The title bar: the mark, the tabs, the window buttons — plus the recent list
 *  an empty window shows and the edges a frameless window is resized by. */
function TitleBar({ editor, onOpen }: { editor: EditorHandle; onOpen: (path: string) => void }) {
  useEditor(editor)
  const closeTab = useCloseTab(editor)
  const gestures = useTitleBarGestures()

  // The list belongs to an empty, unnamed, untouched document and nothing else:
  // one character typed and it would be in the way.
  const tab = editor.active()
  const empty =
    tab.path === null && editor.view.state.doc.length === 0 && editor.tabs().length === 1

  return (
    <>
      <header className="titlebar" {...gestures}>
        <Mark />
        <TabStrip editor={editor} onClose={(id) => void closeTab(id)} />
        {/* The gap between the tabs and the buttons is the part of the bar that
            is only there to be dragged. */}
        <div className="titlebar-drag" />
        <WindowButtons
          onClose={() => {
            // Ask the window to close rather than closing it: the unsaved-work
            // guard listens for the request, so the button and the system's own
            // close cannot drift into behaving differently.
            void getCurrentWindow().close()
          }}
        />
      </header>
      <ResizeEdges />
      <RecentFiles visible={empty} onOpen={onOpen} />
    </>
  )
}

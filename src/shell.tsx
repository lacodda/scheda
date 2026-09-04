// Everything around the text: the status line, the shortcuts, the drop target.
//
// Mounted after the first paint. If this file were slow it would cost the
// window nothing, which is exactly why it is a separate module.
import { StrictMode, useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { EditorHandle } from './editor/mount'

const LINE_ENDING_LABEL = { lf: 'LF', crlf: 'CRLF', mixed: 'mixed' } as const

const MARKDOWN_FILTER = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  { name: 'All files', extensions: ['*'] },
]

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

function StatusBar({ editor }: { editor: EditorHandle }) {
  // The session is mutable and lives outside React; subscribing to it is
  // cheaper than mirroring it into state on every keystroke. The snapshot is a
  // counter rather than anything derived from the document, because
  // useSyncExternalStore re-renders forever on a snapshot that is not stable.
  useSyncExternalStore(editor.subscribe, editor.revision)

  const { session } = editor
  const state = session.view.state
  const line = state.doc.lineAt(state.selection.main.head)
  const column = state.selection.main.head - line.from + 1
  const characters = state.doc.length

  return (
    <footer className="status">
      <span className="status-name">
        {session.path ? basename(session.path) : 'Untitled'}
        {editor.isDirty() ? ' •' : ''}
      </span>
      <span className="status-spacer" />
      {session.readOnly && <span className="status-warning">read-only</span>}
      <span>
        Ln {line.number}, Col {column}
      </span>
      <span>{characters} chars</span>
      <span>{LINE_ENDING_LABEL[session.shape.line_ending]}</span>
      <span>{session.shape.bom ? 'UTF-8 BOM' : 'UTF-8'}</span>
    </footer>
  )
}

function Shell({ editor }: { editor: EditorHandle }) {
  useEffect(() => {
    async function saveAs() {
      const path = await saveDialog({ filters: MARKDOWN_FILTER })
      if (!path) return
      editor.session.path = path
      await editor.save()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        if (editor.session.path) void editor.save()
        else void saveAs()
      } else if (key === 'o') {
        event.preventDefault()
        void openDialog({ multiple: false, filters: MARKDOWN_FILTER }).then((path) => {
          if (typeof path === 'string') void editor.load(path)
        })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor])

  useEffect(() => {
    // Dropping a file on the window opens it. The webview reports a path; the
    // core is still the only thing that reads it.
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      const [path] = event.payload.paths
      if (path) void editor.load(path)
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [editor])

  return <StatusBar editor={editor} />
}

export function mountShell(editor: EditorHandle) {
  const host = document.createElement('div')
  host.className = 'shell-host'
  document.getElementById('root')!.appendChild(host)
  createRoot(host).render(
    <StrictMode>
      <Shell editor={editor} />
    </StrictMode>,
  )
}

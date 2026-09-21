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
import { EditorView } from '@codemirror/view'
import {
  createFromWikilink,
  fileDiffers,
  forgetFileIndex,
  forgetRecent,
  loadSettings,
  obsidianUrl,
  onFileHandedOver,
  onHandoverFailed,
  onVaultChanged,
  rememberRecent,
  restoreDrafts,
  watchVault,
} from './core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Palette } from './palette'
import { basename, samePath } from './paths'
import { apply as applyAppearance } from './appearance'
import { Outline } from './outline'
import { outlineOf } from './editor/outline'
import { FileTree } from './tree'
import { NetworkPanel } from './network'
import { RenamePreview, UndoBar } from './rename'
import { undoRename, type RenameApplied } from './core'
import { setBracketClosing } from './editor/edits'
import { forgetPeeks } from './editor/peek'
import { forgetAllEmbeds, forgetAllLinks, setFollowLink } from './editor/wikilinks'
import { RecentFiles } from './recent'
import { Mark, ResizeEdges, WindowButtons, useTitleBarGestures } from './titlebar'
import { Splash, useSlowStart } from './splash'
import { TagsPanel } from './tags'
import type { EditorHandle, Tab } from './editor/mount'

/** The version the build was made from, for the splash to show. */
const VERSION = __APP_VERSION__

const LINE_ENDING_LABEL = { lf: 'LF', crlf: 'CRLF', mixed: 'mixed' } as const

const MARKDOWN_FILTER = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All files', extensions: ['*'] },
]

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
      const tab = editor.tabs().find((candidate) => candidate.id === id)
      // Closing a draft is closing it: the text was never a file, and the
      // question "discard?" about a scratch tab is the notepad asking whether
      // you meant the thing you just did. Closing the *window* is different —
      // nobody said anything about this tab, so the draft is kept.
      if (tab && tab.path === null) {
        editor.close(id, true)
        return
      }
      if (editor.close(id)) return
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
      {tab.orphaned && <span className="status-warning">file deleted — save as</span>}
      {tab.readOnly && <span className="status-warning">read-only</span>}
      {/* Somebody is blocked on this tab. Worth a word: a terminal sitting
          there doing nothing is otherwise a mystery, and the way out of it —
          close the tab — is not something anybody guesses. */}
      {tab.awaited && <span className="status-waiting">waiting — close to return</span>}
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
  // The watch below follows the active tab, so this component has to hear about
  // tabs changing. The status bar renders from the same subscription.
  useEditor(editor)
  const revision = editor.revision()

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
    const tab = editor.active()
    // A tab whose file went to the recycle bin has a path that names nothing.
    // Writing to it would quietly recreate the file somebody just deleted, so
    // it asks where to put the text instead.
    if (tab.path && !tab.orphaned) await editor.save()
    else await saveAs()
  }, [editor, saveAs])

  const closeTab = useCloseTab(editor)
  const [picking, setPicking] = useState(false)

  /** A file under an open tab was written by somebody else. Works out what that
   *  actually means for this tab, and asks only when it has to.
   *
   *  Three cases, and only one of them is a question:
   *
   *  - The bytes match what the tab is holding. Nothing happened as far as
   *    anybody is concerned — a sync client rewriting an unchanged file, or a
   *    save in another editor with nothing typed. Silence is the right answer,
   *    and asking here is how an editor teaches people to dismiss its dialogs
   *    without reading them.
   *  - The tab has no unsaved changes. The file is the truth (ADR 0002) and the
   *    tab is simply behind it; it takes the new text without a word. Asking
   *    would be asking whether you meant to edit the file you just edited.
   *  - The tab has unsaved changes and the file moved under them. That is the
   *    only real conflict, and it is the one thing this version must never
   *    resolve on its own — either answer silently destroys somebody's writing.
   */
  const reconcile = useCallback(
    async (id: number) => {
      const tab = editor.tabs().find((candidate) => candidate.id === id)
      if (!tab || tab.path === null) return

      // What is on screen, not what was last saved: the question is whether the
      // file differs from what this person is looking at.
      const onScreen = tab.id === editor.active().id ? editor.view.state.doc.toString() : tab.state.doc.toString()

      let differs = true
      try {
        differs = await fileDiffers(tab.path, onScreen)
      } catch {
        // Unreadable now. Whatever happened, re-reading it is what finds out,
        // and the reload below reports the failure honestly if it is gone.
      }
      if (!differs) {
        // Identical bytes. If the tab thought it was dirty, it was dirty
        // against an older file — somebody else has since typed the same thing,
        // or saved our text for us. Either way the dot goes.
        editor.acceptAsSaved(tab.id, onScreen)
        return
      }

      if (!editor.isDirty(tab.id)) {
        await editor.reload(tab.id).catch(() => {
          // The file changed and then went. `orphan` is what says so, and the
          // watcher will have sent that too.
        })
        return
      }

      // The real conflict, and the only place the person is asked. Both
      // versions are named, neither is called the right one, and the dialog
      // never runs on its own: an editor that silently picks a side here is an
      // editor that loses writing.
      const takeTheirs = await ask(
        `${tabLabel(tab)} was changed by another program, and you have unsaved changes here.`,
        {
          title: 'This file changed outside scheda',
          kind: 'warning',
          okLabel: 'Load theirs (lose yours)',
          cancelLabel: 'Keep mine (overwrite on save)',
        },
      )
      if (takeTheirs) {
        await editor.reload(tab.id).catch(() => {})
      } else {
        // Theirs is on disk, mine is on screen, and mine wins when I save. What
        // must not happen is being asked about this same change again — the
        // person has answered, and a dialog that returns is a dialog that
        // trained them to click it away.
        editor.acceptAsSaved(tab.id, onScreen)
      }
    },
    [editor],
  )

  useEffect(() => {
    // The file the window opened with counts as recently opened; the core read
    // it before this module existed, so nothing recorded it then. Once, on
    // mount: every later open records itself.
    const path = editor.active().path
    if (path) void rememberRecent(path)

    // Drafts from a previous run come back as tabs. After the recent list, so
    // the order on screen is "the file you launched with, then what you had
    // open" rather than the other way round.
    void restoreDrafts()
      .then((drafts) => {
        for (const draft of drafts) editor.adoptDraft(draft)
      })
      .catch(() => {
        // No drafts is the ordinary case, and an unreadable draft folder is not
        // worth a dialog on startup.
      })
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
      } else if (key === 'p' && !event.shiftKey) {
        // Go to file. `Ctrl+P` is what every editor with this feature uses, and
        // a notepad that printed on it would be a notepad nobody expects.
        event.preventDefault()
        setPicking(true)
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
    // How the editor follows a `[[link]]`. Registered here because every one of
    // these four things is the shell's: opening a tab, scrolling the document,
    // putting a question on screen, and saying that something went wrong.
    setFollowLink({
      open: (path) => void openPath(path),
      goToHeading: (heading) => {
        // `[[#Somewhere]]` — a link inside the note already on screen. The
        // outline knows where every heading is, so the answer is a scroll rather
        // than an open.
        const found = outlineOf(editor.view.state).find((entry) => entry.text === heading)
        if (!found) return
        editor.view.dispatch({
          selection: { anchor: found.from },
          effects: EditorView.scrollIntoView(found.from, { y: 'start' }),
        })
        editor.view.focus()
      },
      confirmCreate: (target) =>
        ask(`“${target}” does not exist yet in this vault.`, {
          title: 'Create this note?',
          kind: 'info',
          okLabel: 'Create',
          cancelLabel: 'Cancel',
        }),
      report: (message) => {
        void ask(message, { title: 'That link goes nowhere', kind: 'error', okLabel: 'OK' })
      },
    })
    return () => setFollowLink(null)
  }, [editor, openPath])

  useEffect(() => {
    // The watch follows whatever tab is in front of you. Pointed again on every
    // change because switching to a tab in another vault has to move it — and
    // the core answers cheaply when the root is already the one being watched.
    void watchVault(editor.active().path).catch(() => {
      // A folder that cannot be watched is a folder whose changes we will not
      // hear about. The window still works; it is simply as stale as it was
      // before this version existed, and a dialog about it would be a dialog
      // nobody can act on.
    })
  }, [editor, revision])

  useEffect(() => {
    // Somebody else wrote in the folder. Three questions, and they are asked of
    // different things: does an open tab show a file that changed, has a tab
    // lost its file, and is the picker's list of the vault out of date.
    const unlisten = onVaultChanged((changes) => {
      // The picker's list always, whatever else happened: a note created in
      // Obsidian that Ctrl+P cannot find is exactly the staleness this version
      // is about.
      void forgetFileIndex()
      // And what every open note's links resolved to. Thrown away wholesale
      // rather than per path: a note that appeared may be the target of a
      // `[[link]]` in any open tab, and the window cannot know which without
      // resolving them all again — which is what dropping the answers makes
      // happen, lazily, on the next draw.
      forgetAllLinks()
      forgetAllEmbeds()
      forgetPeeks()

      for (const path of changes.removed) {
        editor.orphan(path)
        void forgetRecent(path)
      }

      for (const path of changes.changed) {
        const tab = editor.tabs().find((candidate) => candidate.path !== null && samePath(candidate.path, path))
        if (tab) void reconcile(tab.id)
      }
      // A file that appeared where a tab's file used to be is that tab's file
      // coming back — a sync client restoring it, or an editor that saves by
      // writing a new file over the old one on a platform that reports it that
      // way. The tab stops being orphaned and takes the text.
      for (const path of changes.added) {
        const tab = editor
          .tabs()
          .find((candidate) => candidate.orphaned && candidate.path !== null && samePath(candidate.path, path))
        if (tab) void reconcile(tab.id)
      }
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [editor, reconcile])

  useEffect(() => {
    // Closing the window with unsaved work asks first. Tauri lets us take the
    // close request back, which is the only reason this can be honest.
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      // A tab with no file is not work about to be lost: its text is written to
      // the draft folder and comes back on the next launch. So the question is
      // only ever about named files whose edits are not on disk.
      const dirty = editor.tabs().filter((tab) => tab.path !== null && editor.isDirty(tab.id))
      if (dirty.length === 0) {
        // Still taken back, because writing the drafts is a round trip to the
        // core and the window would otherwise go first.
        event.preventDefault()
        await editor.keepDrafts()
        await getCurrentWindow().destroy()
        return
      }
      event.preventDefault()
      await editor.keepDrafts()
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

  return (
    <>
      <StatusBar editor={editor} />
      <Palette
        documentPath={editor.active().path}
        visible={picking}
        onPick={(path) => void openPath(path)}
        onClose={() => setPicking(false)}
      />
    </>
  )
}

/** How many times the vault has been written to, as something the panels in
 *  different React roots can all watch.
 *
 *  The panels are separate roots — the tree on the left, the network on the
 *  right — because React cannot render one component into two places, and a
 *  root cannot pass state to another root. So the one fact they share lives
 *  outside React and is read with `useSyncExternalStore`, which is the same way
 *  every panel already watches the editor.
 *
 *  It counts writes rather than describing them: what the network panel does
 *  with the news is re-read, and it would re-read for any of them. */
const vaultWrites = {
  count: 0,
  listeners: new Set<() => void>(),
  bump() {
    vaultWrites.count += 1
    for (const listener of vaultWrites.listeners) listener()
  },
  subscribe(listener: () => void) {
    vaultWrites.listeners.add(listener)
    return () => {
      vaultWrites.listeners.delete(listener)
    }
  },
}

function useVaultWrites(): number {
  return useSyncExternalStore(vaultWrites.subscribe, () => vaultWrites.count)
}

/** The network panel, and the key that shows it.
 *
 *  `Ctrl+Shift+B` — for backlinks, which is what the panel is mostly about. Like
 *  the outline and the tree, the state belongs to the window rather than to the
 *  document: switching tabs should not close a panel that was open. */
/** Opens a note at a line, for a panel that lists places rather than files.
 *
 *  Shared by the network and the tags panels: both answer "here, on this line",
 *  and a note opened at its first paragraph has answered "which note" and
 *  dropped "where in it". Two copies of this would be two ways to drift about
 *  what a row does when it is clicked. */
function openAt(editor: EditorHandle, path: string, line: number) {
  void editor.open(path).then(
    () => {
      rememberRecent(path)
      const at = editor.view.state.doc.line(
        Math.min(Math.max(line, 1), editor.view.state.doc.lines),
      )
      editor.view.dispatch({
        selection: { anchor: at.from },
        effects: EditorView.scrollIntoView(at.from, { y: 'center' }),
      })
      editor.view.focus()
    },
    () => {
      // A note that will not open leaves the panel as it was.
    },
  )
}

/** The tags panel, and the key that shows it.
 *
 *  `Ctrl+Shift+T` — the same shape as the tree's `E`, the network's `B` and the
 *  outline's `O`: hidden until asked for, because a notepad that opens with
 *  four sidebars is not a notepad. */
function TagsHost({ editor }: { editor: EditorHandle }) {
  const [visible, setVisible] = useState(false)
  const revision = useVaultWrites()
  useEditor(editor)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 't') return
      event.preventDefault()
      setVisible((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <TagsPanel
      editor={editor}
      visible={visible}
      revision={revision}
      onOpen={(path, line) => openAt(editor, path, line)}
    />
  )
}

function NetworkHost({ editor }: { editor: EditorHandle }) {
  const [visible, setVisible] = useState(false)
  const revision = useVaultWrites()
  useEditor(editor)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'b') return
      event.preventDefault()
      setVisible((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <NetworkPanel
      editor={editor}
      visible={visible}
      revision={revision}
      onOpen={(path, line) => openAt(editor, path, line)}
      onCreate={(target) => {
        const path = editor.active().path
        if (path === null) return
        void createFromWikilink(path, target)
          .then((made) => {
            vaultWrites.bump()
            return editor.open(made).then(() => rememberRecent(made))
          })
          .catch(() => {
            // The core refuses a target that cannot be a file; the note is open
            // either way and the row is still there to try again.
          })
      }}
    />
  )
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
function TreePanel({
  editor,
  onVaultWritten,
}: {
  editor: EditorHandle
  onVaultWritten: () => void
}) {
  const [visible, setVisible] = useState(false)
  // The rename being asked about, and the one just done. Both live here because
  // the tree hands a rename up rather than performing it: a rename in a vault
  // may rewrite other people's notes, and the dry run, the approval and the
  // undo are the window's business rather than a panel's.
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [undoable, setUndoable] = useState<RenameApplied | null>(null)
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

  const refuse = useCallback((message: string) => {
    // The core's own words: "“notes.md” already exists", "“note.md” is open in
    // another program". A dialog nobody can act on is the same as none.
    void ask(message, { title: 'That did not work', kind: 'error', okLabel: 'OK' })
  }, [])

  return (
    <>
      <FileTree
        documentPath={editor.active().path}
        visible={visible}
        onOpen={(path) => {
          void editor.open(path).then(
            () => rememberRecent(path),
            () => {
              // A file that will not open leaves the tree as it was; the banner
              // in main.tsx is what says why.
            },
          )
        }}
        onRename={(path, name) => setRenaming({ path, name })}
        onDeleted={(path) => {
          editor.orphan(path)
          void forgetRecent(path)
        }}
        onFailure={refuse}
      />
      {renaming && (
        <RenamePreview
          path={renaming.path}
          name={renaming.name}
          onFailure={refuse}
          onDone={(applied) => {
            setRenaming(null)
            if (!applied) return
            // The tab showing the file follows it, and the recent list learns
            // the new name — the same three things the tree used to do itself.
            editor.follow(applied.from, applied.to)
            void forgetRecent(applied.from)
            void rememberRecent(applied.to)
            onVaultWritten()
            // The offer to take it back, but only when there was more to it
            // than moving one file. An undo bar for an ordinary rename is a bar
            // in the way of a thing that worked.
            if (applied.links > 0) setUndoable(applied)
          }}
        />
      )}
      {undoable && (
        <UndoBar
          applied={undoable}
          onDismiss={() => setUndoable(null)}
          onUndo={() => {
            const taken = undoable
            setUndoable(null)
            void undoRename()
              .then((undone) => {
                if (!undone) return
                editor.follow(taken.to, taken.from)
                void forgetRecent(taken.to)
                void rememberRecent(taken.from)
                onVaultWritten()
              })
              .catch((error: unknown) => refuse(messageOf(error)))
          }}
        />
      )}
    </>
  )
}

/** The core's own words for a refusal, when there are any. */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export interface ShellOptions {
  /** Whether the window came up with nothing to open. The splash belongs to
   *  this case and to no other — see `src/splash.tsx`. */
  launchedBare: boolean
}

/** Mounts the title bar above the editor and the status bar below it. */
export function mountShell(editor: EditorHandle, options: ShellOptions = { launchedBare: false }) {
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
  const networkHost = document.createElement('div')
  networkHost.className = 'network-host'
  const tagsHost = document.createElement('div')
  tagsHost.className = 'tags-host'
  middle.appendChild(treeHost)
  middle.appendChild(editorHost)
  middle.appendChild(tagsHost)
  middle.appendChild(networkHost)
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
  createRoot(networkHost).render(
    <StrictMode>
      <NetworkHost editor={editor} />
    </StrictMode>,
  )
  createRoot(tagsHost).render(
    <StrictMode>
      <TagsHost editor={editor} />
    </StrictMode>,
  )
  createRoot(treeHost).render(
    <StrictMode>
      <TreePanel editor={editor} onVaultWritten={() => vaultWrites.bump()} />
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

  // The splash gets a host only when the window came up with nothing to open.
  // Not a hidden one, not one that renders null: the element is never created,
  // so a launch with a file cannot grow a splash through any later bug. The
  // cheapest guarantee is the one that has nothing to go wrong.
  if (options.launchedBare) {
    const splashHost = document.createElement('div')
    splashHost.className = 'splash-host'
    root.appendChild(splashHost)
    createRoot(splashHost).render(
      <StrictMode>
        <OpeningScreen />
      </StrictMode>,
    )
  }
}

/** The splash and the work it is waiting on.
 *
 *  On a bare launch there is no file to read and no vault to walk, so what is
 *  left is the application's own state: the settings and the drafts from the
 *  previous run. Both are ordinarily instant, which is the point — the splash
 *  has a delay in front of it and a fast start never reaches it. What it covers
 *  is the slow one: a cold disk, a scanner reading the data directory, a folder
 *  of drafts that has grown. */
function OpeningScreen() {
  const [busy, setBusy] = useState(true)
  const shown = useSlowStart(busy)

  useEffect(() => {
    let current = true
    const done = () => {
      if (current) setBusy(false)
    }
    // Settled rather than resolved: a draft folder that cannot be read is a
    // window that opens empty, not a window that shows a sweeping bar forever.
    // A splash that outlives its own failure is the blank window it replaced.
    void Promise.allSettled([restoreDrafts(), loadSettings()]).then(done)
    return () => {
      current = false
    }
  }, [])

  if (!shown) return null
  return <Splash status="Opening" version={VERSION} />
}

/** The button that hands this note to Obsidian.
 *
 *  scheda reads Obsidian's conventions and never writes its folder; this is the
 *  other half of that. The graph, the plugins and the daily note are over there,
 *  and the honest shape of "we are not competing with it" is a button that opens
 *  the file you are looking at in the program that has them.
 *
 *  It appears only for a note in a vault, because that is the only case where
 *  Obsidian has a vault to open it in — and a button that is there but does
 *  nothing is worse than one that is not. */
function OpenInObsidian({ editor }: { editor: EditorHandle }) {
  useEditor(editor)
  const path = editor.active().path
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    if (path === null) {
      queueMicrotask(() => {
        if (current) setUrl(null)
      })
      return () => {
        current = false
      }
    }
    void obsidianUrl(path)
      .then((found) => {
        if (current) setUrl(found)
      })
      .catch(() => {
        if (current) setUrl(null)
      })
    return () => {
      current = false
    }
  }, [path])

  if (url === null) return null

  return (
    <button
      type="button"
      className="titlebar-action"
      title="Open in Obsidian"
      aria-label="Open in Obsidian"
      onClick={() => {
        // Through the opener rather than a shell command. On Windows
        // `cmd /c start` cuts a URL at its first ampersand and runs the tail as
        // a command, and every URL this builds has `&file=` in it.
        void openUrl(url).catch(() => {
          // Obsidian is not installed, or nothing handles the scheme. The note
          // is open here either way, and a dialog saying somebody else's
          // program is missing is not something this window can help with.
        })
      }}
    >
      {/* The obsidian stone: a cut gem, which is what the name says. Drawn
          rather than imported so the bar carries no second asset for one
          button. */}
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M8 1.5 13 6l-2 8.5H5L3 6z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M8 1.5 6 14.5M8 1.5l3 13M3 6h10" fill="none" stroke="currentColor" strokeWidth="0.9" />
      </svg>
    </button>
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
        <OpenInObsidian editor={editor} />
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

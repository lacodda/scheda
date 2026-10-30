// Everything around the text: the tab strip, the status line, the commands and
// their keys, the palettes, the settings, the session, the drop target and the
// guard on unsaved work.
//
// Mounted after the first paint. If this file were slow it would cost the
// window nothing, which is exactly why it is a separate module.
import { StrictMode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ask, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { EditorView } from '@codemirror/view'
import { foldAll, foldCode, unfoldAll, unfoldCode } from '@codemirror/language'
import {
  closeFolder,
  createFromWikilink,
  fileDiffers,
  forgetRecent,
  loadSession,
  obsidianUrl,
  onFileWritten,
  onHanded,
  onVaultChanged,
  openDropped,
  openFile,
  openFolder,
  rememberRecent,
  restoreDrafts,
  saveSession,
  showQuickNote,
  takeHandovers,
  watchVault,
  type Draft,
  type Folder,
  type Handed,
  type OpenFile,
  type Session,
} from './core'
import { folder as folderStore, useFolder, useFolderOpened } from './folder'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Palette } from './palette'
import { Picker } from './picker'
import { basename, isInside, samePath } from './paths'
import { apply as applyAppearance } from './appearance'
import { Outline } from './outline'
import {
  WORDS_PER_MINUTE,
  blocks,
  bodyWords,
  countWords,
  forgetNotes,
  isFocusing,
  outlineOf,
  readingMinutes,
  setFocusing,
  toggleReading,
  type Block,
} from '@lacodda/scheda-editor'
import { FileTree } from './tree'
import { NetworkPanel } from './network'
import { RenamePreview, UndoBar } from './rename'
import { undoRename, type RenameApplied } from './core'
import { schedaHost, setFollowLink } from './editor/host'
import { RecentFiles } from './recent'
import { Mark, ResizeEdges, WindowButtons, useTitleBarGestures } from './titlebar'
import { Splash, useSlowStart } from './splash'
import { TagsPanel } from './tags'
import { SearchPanel } from './search'
import { SettingsScreen } from './settings'
import { settings as settingsStore } from './settings-store'
import { applyKeys, ORDER, showKeys, useCommand } from './commands'
import { useCommandList, type ListedCommand } from './ui/commands'
import { TabStrip, tabLabel } from './tabstrip'
import type { EditorHandle, RestoredTab } from './editor/mount'

/** The version the build was made from, for the splash to show. */
const VERSION = __APP_VERSION__

const LINE_ENDING_LABEL = { lf: 'LF', crlf: 'CRLF', mixed: 'mixed' } as const

const MARKDOWN_FILTER = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All files', extensions: ['*'] },
]

/** How long the window has to be still before the session is written. The
 *  caret moves on every keystroke; the file is written once somebody pauses. */
const SESSION_DELAY_MS = 1500

/** Subscribes a component to the editor. The snapshot is a counter rather than
 *  anything derived from the document, because useSyncExternalStore re-renders
 *  forever on a snapshot that is not stable. */
function useEditor(editor: EditorHandle) {
  useSyncExternalStore(editor.subscribe, editor.revision)
}

/** Closing tabs, asking first when they hold unsaved work. Shared so the strip,
 *  the menu and the keyboard cannot drift into asking differently. */
function useClosing(editor: EditorHandle) {
  const close = useCallback(
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

  /** Several at once — "close others", "close all". One question for all of
   *  them rather than one per tab, and a draft with text in it is on the list:
   *  closing one on purpose throws it away, and a bulk close is not the same
   *  purpose as closing that one tab. */
  const closeMany = useCallback(
    async (ids: number[]) => {
      const tabs = ids
        .map((id) => editor.tabs().find((candidate) => candidate.id === id))
        .filter((tab) => tab !== undefined)
      // A draft is dirty exactly when it has text: it has never been saved.
      const unsaved = tabs.filter((tab) => editor.isDirty(tab.id))
      let discard = true
      if (unsaved.length > 0) {
        const names = unsaved.map(tabLabel).join(', ')
        discard = await ask(
          unsaved.length === 1 ? `${names} has unsaved changes.` : `${unsaved.length} tabs have unsaved changes: ${names}.`,
          { title: 'Close without saving?', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Keep those open' },
        )
      }
      for (const tab of tabs) {
        if (unsaved.includes(tab) && !discard) continue
        editor.close(tab.id, true)
      }
    },
    [editor],
  )

  return { close, closeMany }
}

function StatusBar({ editor }: { editor: EditorHandle }) {
  useEditor(editor)
  const autosave = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.current()?.autosave ?? false)

  const tab = editor.active()
  const state = editor.view.state
  const line = state.doc.lineAt(state.selection.main.head)
  const column = state.selection.main.head - line.from + 1
  const characters = state.doc.length
  const words = bodyWords(state.doc)
  // Words in the selection, when there is one: "how long is this paragraph"
  // is a question asked by selecting it.
  const selected = state.selection.ranges.reduce(
    (sum, range) => sum + (range.empty ? 0 : countWords(state.sliceDoc(range.from, range.to))),
    0,
  )
  const minutes = readingMinutes(words)

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
      {isFocusing() && <span className="status-mode">focus</span>}
      {/* Said, because a window that writes files on its own should say that it
          does: the dot on a tab means something different when it will be
          gone in a second. */}
      {autosave && tab.path !== null && !tab.readOnly && <span className="status-mode">autosave</span>}
      <span>
        Ln {line.number}, Col {column}
      </span>
      <span className="status-words">
        {selected > 0 ? `${count(selected)} of ` : ''}
        {count(words)} {words === 1 ? 'word' : 'words'}
      </span>
      {minutes > 0 && <span title={`At ${WORDS_PER_MINUTE} words a minute`}>{minutes} min read</span>}
      <span>{characters} chars</span>
      <span>{LINE_ENDING_LABEL[tab.shape.line_ending]}</span>
      <span>{tab.shape.bom ? 'UTF-8 BOM' : 'UTF-8'}</span>
    </footer>
  )
}

/** A count with its thousands grouped: 1,240 reads at a glance, 1240 does not. */
function count(value: number): string {
  return value.toLocaleString('en-US')
}

/** Says why a page could not be printed or written — the core's own words. */
function reportExport(error: unknown): void {
  void ask(messageOf(error), { title: 'The page was not made', kind: 'error', okLabel: 'OK' })
}

/** Which palette is over the text, if any. One at a time: two lists taking the
 *  keyboard at once is one list too many. */
type Overlay = 'files' | 'commands' | 'blocks' | 'settings' | null

/** Puts back what the window had open when it last closed.
 *
 *  After the first frame, like everything that is not the text: the file in
 *  front was read before the window existed (the core preloads it), and the
 *  others are read here in the background. A file that has gone since is left
 *  out without a word — the session is a convenience, not a promise — and so is
 *  a draft whose text is no longer in the draft folder. */
async function restoreSession(editor: EditorHandle, launchedWith: string | null): Promise<void> {
  const [session, drafts] = await Promise.all([
    loadSession().catch(
      (): Session => ({ tabs: [], active: null, beside: null, focused: 0, folder: null, roots: [] }),
    ),
    restoreDrafts().catch((): Draft[] => []),
  ])
  // The folder first, so the tree has something to show for a window that
  // comes back with no file in front.
  if (session.folder !== null) {
    folderStore.set({ root: session.folder, name: basename(session.folder) || session.folder }, false)
  }
  const front = session.active !== null ? session.tabs[session.active]?.path : null
  // Launched with the file that was in front anyway — the preload came from the
  // session — is the session coming back. Launched with another file is that
  // file, asked for now, with the rest of the session behind it.
  const keepFront = launchedWith !== null && !(front && samePath(front, launchedWith))

  const opened = await Promise.all(
    session.tabs.map(async (entry): Promise<RestoredTab | null> => {
      const base = { pinned: entry.pinned, anchor: entry.anchor, head: entry.head, top: entry.top }
      if (entry.path !== null) {
        const path = entry.path
        // A file the window already has — the one read before the first frame —
        // is not read twice; `restore` finds its tab by the path.
        const already = editor.tabs().some((tab) => tab.path !== null && samePath(tab.path, path))
        const file: OpenFile | null = already
          ? { path, text: '', shape: { line_ending: 'lf', bom: false }, readOnly: false }
          : await openFile(path).catch(() => null)
        return file ? { ...base, file, draft: null } : null
      }
      const draft = drafts.find((candidate) => candidate.key === entry.draft)
      return draft ? { ...base, file: null, draft } : null
    }),
  )

  // Drafts the session does not mention — the window closed before it was
  // written, or an older version filed them — still come back, after the rest.
  const mentioned = new Set(session.tabs.map((entry) => entry.draft))
  const loose = drafts
    .filter((draft) => !mentioned.has(draft.key))
    .map((draft): RestoredTab => ({ file: null, draft, pinned: false, anchor: 0, head: 0, top: 0 }))

  // The indices in the session are into its own list; the ones that did not
  // come back are dropped, and the layout is moved to match.
  const kept: RestoredTab[] = []
  const moved = new Map<number, number>()
  opened.forEach((entry, index) => {
    if (entry === null) return
    moved.set(index, kept.length)
    kept.push(entry)
  })
  const remap = (index: number | null) => (index === null ? null : (moved.get(index) ?? null))
  editor.restore(
    [...kept, ...loose],
    // A session whose front tab was no file had a blank in front - with a
    // folder open, the folder's own empty window - and gets one back. An
    // index that pointed at a file which did not come back is not that.
    {
      active: session.active === null ? null : (remap(session.active) ?? 0),
      beside: remap(session.beside),
      focused: session.focused,
    },
    keepFront,
  )
  // Back to the folder with nothing in front of it: that is the folder's empty
  // window, and the tree is what it shows.
  if (session.folder !== null && !keepFront && isUntouchedBlank(editor)) {
    folderStore.set(folderStore.current(), true)
  }
}

/** Whether the tab in front is an empty, unnamed, untouched document - the
 *  placeholder a window shows when there is nothing in front of it. */
function isUntouchedBlank(editor: EditorHandle): boolean {
  const tab = editor.active()
  return tab.path === null && !tab.pinned && editor.view.state.doc.length === 0
}

function Shell({ editor, launchedWith }: { editor: EditorHandle; launchedWith: string | null }) {
  // The watch below follows the active tab, so this component has to hear about
  // tabs changing. The status bar renders from the same subscription.
  useEditor(editor)
  const revision = editor.revision()
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [restored, setRestored] = useState(false)
  // Settles once the session is back. What arrives from outside before then -
  // the folder the window was launched with, a second launch in the first
  // moments - waits for it, so the session coming back after does not put its
  // own front tab over what was just asked for.
  const [sessionBack] = useState(() => {
    let settle = () => {}
    const promise = new Promise<void>((resolve) => {
      settle = resolve
    })
    return { promise, settle }
  })
  const openFolderRoot = useFolder()?.root ?? null

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

  const { close: closeTab, closeMany } = useClosing(editor)

  const refuse = useCallback((message: string) => {
    void ask(message, { title: 'Cannot open that', kind: 'error', okLabel: 'OK' })
  }, [])

  /** Puts an opened folder in front of the person. A note already in front
   *  that is in it stays there; anything else gives way to an empty tab, and
   *  the window shows the folder: its tree, and what was opened in it lately.
   *  Opening a folder is asking to see it, and a note from another vault left
   *  in front would keep the tree on that vault instead. */
  const showFolder = useCallback(
    (opened: Folder) => {
      folderStore.set(opened, true)
      const tab = editor.active()
      if (tab.path !== null && isInside(opened.root, tab.path)) return
      if (isUntouchedBlank(editor)) return
      const blank = editor
        .tabs()
        .find((candidate) => candidate.path === null && !candidate.pinned && !editor.isDirty(candidate.id))
      if (blank) editor.select(blank.id)
      else editor.openBlank()
    },
    [editor],
  )

  /** Takes what a path from outside became: a tab, a folder, or a refusal in
   *  the core's own words. */
  const receive = useCallback(
    (handed: Handed) => {
      if (handed.kind === 'file') {
        editor.adopt(handed.file)
        void rememberRecent(handed.file.path)
      } else if (handed.kind === 'folder') {
        showFolder(handed.folder)
      } else {
        refuse(handed.message)
      }
    },
    [editor, showFolder, refuse],
  )

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
      const shown = editor.panes().indexOf(tab.id)
      const onScreen = shown !== -1 ? editor.views()[shown].state.doc.toString() : tab.state.doc.toString()

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
    if (launchedWith) void rememberRecent(launchedWith)

    // The session comes back after the recent list, so the order on screen is
    // "the file you launched with, then what you had open" rather than the
    // other way round. Nothing is written back until it has: a session saved
    // over the top of one still being read is a session lost.
    void restoreSession(editor, launchedWith)
      .catch(() => {
        // An unreadable session is an empty window, not a dialog on startup.
      })
      .finally(() => {
        setRestored(true)
        sessionBack.settle()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!restored) return
    // Written a moment after the window settles. Every tab change, caret move
    // and scroll that matters arrives through the editor's subscription.
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = editor.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void saveSession(editor.snapshot()).catch(() => {}), SESSION_DELAY_MS)
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [editor, restored])

  // The settings, applied wherever they are held: the look, the editor, the
  // keys. Again on every change — the settings screen changes them live, and a
  // setting that waits for a restart is one people assume did not work.
  useEffect(() => {
    const applyAll = () => {
      const current = settingsStore.current()
      if (!current) return
      applyAppearance(current)
      editor.configure({
        closeBrackets: current.closeBrackets,
        spellcheck: current.spellcheck,
        autosave: current.autosave,
      })
      applyKeys(current.keys)
    }
    const stop = settingsStore.subscribe(applyAll)
    // Read here rather than before the first frame: the window appearing in
    // the system theme and correcting itself a frame later is cheaper than a
    // blank window waiting on a file read.
    void settingsStore.load().catch(() => {
      // Unreadable settings are not worth a dialog on startup; the defaults
      // are already on screen.
    })
    applyAll()
    return stop
  }, [editor])

  // ------------------------------------------------------------- commands

  // Where the note's own commands answer their keys: in the panes, and not in
  // a search box or a panel beside them.
  const notes = useMemo(() => ({ current: editor.host }), [editor])

  useCommand(
    'file.save',
    useCallback(() => void saveActive(), [saveActive]),
  )
  useCommand(
    'file.saveAs',
    useCallback(() => void saveAs(), [saveAs]),
  )
  useCommand(
    'file.open',
    useCallback(() => {
      void openDialog({ multiple: false, filters: MARKDOWN_FILTER }).then((path) => {
        if (typeof path === 'string') void openPath(path)
      })
    }, [openPath]),
  )
  useCommand(
    'file.openFolder',
    useCallback(() => {
      void openDialog({ directory: true, multiple: false }).then((path) => {
        if (typeof path !== 'string') return
        void openFolder(path)
          .then(showFolder)
          .catch((error: unknown) => refuse(messageOf(error)))
      })
    }, [showFolder, refuse]),
  )
  useCommand(
    'file.closeFolder',
    useCallback(() => {
      void closeFolder().then(() => folderStore.set(null, false))
    }, []),
    { enabled: openFolderRoot !== null },
  )
  useCommand(
    'file.new',
    useCallback(() => editor.openBlank(), [editor]),
  )
  useCommand(
    'file.print',
    useCallback(() => {
      // The page printed is the note, not the window.
      void import('./export').then(({ printNote }) => printNote(editor)).catch(reportExport)
    }, [editor]),
  )
  useCommand(
    'file.export',
    useCallback(() => {
      // One HTML file, pictures inside it.
      void import('./export').then(({ exportNote }) => exportNote(editor)).catch(reportExport)
    }, [editor]),
  )
  useCommand(
    'file.goTo',
    useCallback(() => setOverlay('files'), []),
  )
  useCommand(
    'palette.commands',
    useCallback(() => setOverlay('commands'), []),
  )
  useCommand(
    'insert.block',
    useCallback(() => setOverlay('blocks'), []),
    { notes, enabled: !editor.view.state.readOnly },
  )
  useCommand(
    'settings.open',
    useCallback(() => setOverlay('settings'), []),
  )
  useCommand(
    'tab.close',
    useCallback(() => void closeTab(editor.active().id), [editor, closeTab]),
  )
  useCommand(
    'tab.closeOthers',
    useCallback(() => {
      const id = editor.active().id
      void closeMany(editor.tabs().filter((tab) => tab.id !== id && !tab.pinned).map((tab) => tab.id))
    }, [editor, closeMany]),
  )
  useCommand(
    'tab.closeAll',
    useCallback(() => {
      void closeMany(editor.tabs().filter((tab) => !tab.pinned).map((tab) => tab.id))
    }, [editor, closeMany]),
  )
  useCommand(
    'tab.reopen',
    useCallback(() => {
      const path = editor.takeClosed()
      if (path) void openPath(path)
    }, [editor, openPath]),
  )
  useCommand(
    'tab.pin',
    useCallback(() => {
      const tab = editor.active()
      editor.pin(tab.id, !tab.pinned)
    }, [editor]),
  )
  const step = useCallback(
    (by: number) => {
      // Walks the strip in order, wrapping at the end.
      const tabs = editor.tabs()
      if (tabs.length < 2) return
      const index = tabs.findIndex((tab) => tab.id === editor.active().id)
      editor.select(tabs[(index + by + tabs.length) % tabs.length].id)
    },
    [editor],
  )
  useCommand(
    'tab.next',
    useCallback(() => step(1), [step]),
  )
  useCommand(
    'tab.previous',
    useCallback(() => step(-1), [step]),
  )
  useCommand(
    'pane.split',
    useCallback(() => editor.toggleSplit(), [editor]),
  )
  useCommand(
    'pane.first',
    useCallback(() => editor.focusPane(0), [editor]),
  )
  useCommand(
    'pane.second',
    useCallback(() => editor.focusPane(1), [editor]),
    { enabled: editor.panes().length > 1 },
  )
  useCommand(
    'view.reading',
    useCallback(() => {
      editor.view.dispatch({ effects: toggleReading.of() })
    }, [editor]),
    { notes },
  )
  useCommand(
    'view.focus',
    useCallback(() => {
      // A property of the window: both panes fade, or neither.
      const on = !isFocusing()
      for (const view of editor.views()) setFocusing(view, on)
    }, [editor]),
    { notes },
  )
  // Nothing to fold at the caret is still the fold key pressed: it is taken
  // and does nothing, rather than reaching an editor binding behind it.
  useCommand(
    'fold.section',
    useCallback(() => void foldCode(editor.view), [editor]),
    { notes },
  )
  useCommand(
    'unfold.section',
    useCallback(() => void unfoldCode(editor.view), [editor]),
    { notes },
  )
  useCommand(
    'fold.all',
    useCallback(() => void foldAll(editor.view), [editor]),
    { notes },
  )
  useCommand(
    'unfold.all',
    useCallback(() => void unfoldAll(editor.view), [editor]),
    { notes },
  )
  useCommand(
    'quick.note',
    useCallback(() => void showQuickNote().catch(() => {}), []),
  )
  useCommand(
    'theme.system',
    useCallback(() => void settingsStore.update({ theme: 'system' }).catch(() => {}), []),
  )
  useCommand(
    'theme.light',
    useCallback(() => void settingsStore.update({ theme: 'light' }).catch(() => {}), []),
  )
  useCommand(
    'theme.dark',
    useCallback(() => void settingsStore.update({ theme: 'dark' }).catch(() => {}), []),
  )
  useCommand(
    'autosave.toggle',
    useCallback(() => {
      const on = settingsStore.current()?.autosave ?? false
      void settingsStore.update({ autosave: !on }).catch(() => {})
    }, []),
  )

  // ------------------------------------------------------------- the window

  useEffect(() => {
    // Dropping files on the window opens them, and a folder opens as the
    // window's. The webview reports paths; the core is still the only thing
    // that reads them, and the one that tells a folder from a file.
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      for (const path of event.payload.paths) {
        void openDropped(path)
          .then(receive)
          .catch((error: unknown) => refuse(messageOf(error)))
      }
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [receive, refuse])

  useEffect(() => {
    // A second launch hands its file or folder to this window rather than
    // opening one of its own; the core has already read the one or opened the
    // other. After the session is back, like everything from outside.
    const later = (handed: Handed) => void sessionBack.promise.then(() => receive(handed))
    const handed = onHanded(later)
    // Listening first, then taking what came before this shell existed: the
    // core held those rather than send them to nobody.
    void handed
      .then(() => takeHandovers())
      .then((waited) => {
        for (const one of waited) later(one)
      })
    // A quick note went into a file this window may be showing. The watcher
    // hears about it only inside the vault it is watching, so the core says so
    // itself, and the tab takes the line the same way it takes any outside
    // change.
    const written = onFileWritten((path) => {
      const tab = editor.tabs().find((candidate) => candidate.path !== null && samePath(candidate.path, path))
      if (tab) void reconcile(tab.id)
    })
    return () => {
      void handed.then((stop) => stop())
      void written.then((stop) => stop())
    }
  }, [editor, reconcile, receive, sessionBack])

  useEffect(() => {
    // Autosave did not write a tab because its file changed on disk since the
    // tab last saw it. That is the outside-change question, asked the way it
    // is always asked.
    editor.onAutosaveRefused((id) => void reconcile(id))
    // Leaving the window is a pause as good as any: whatever was typed goes to
    // disk before the person is in another program looking at the file.
    const onBlur = () => void editor.flushAutosave()
    window.addEventListener('blur', onBlur)
    return () => {
      editor.onAutosaveRefused(null)
      window.removeEventListener('blur', onBlur)
    }
  }, [editor, reconcile])

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
    // The watch follows whatever tab is in front of you, or the window's folder
    // when that tab is in no vault. Pointed again on every change because
    // switching to a tab in another vault has to move it — and the core
    // answers cheaply when the root is already the one being watched.
    void watchVault(editor.active().path).catch(() => {
      // A folder that cannot be watched is a folder whose changes we will not
      // hear about. The window still works; it is simply as stale as it was
      // before this version existed, and a dialog about it would be a dialog
      // nobody can act on.
    })
  }, [editor, revision, openFolderRoot])

  useEffect(() => {
    // Somebody else wrote in the folder. Three questions, and they are asked of
    // different things: does an open tab show a file that changed, has a tab
    // lost its file, and is the picker's list of the vault out of date.
    const unlisten = onVaultChanged((changes) => {
      // The core has already brought the picker's list and the vault's index
      // up to date before telling us; what is left here is to tell the panels
      // that read them to ask again.
      vaultWrites.bump()
      // And what every open note's links resolved to. Thrown away wholesale
      // rather than per path: a note that appeared may be the target of a
      // `[[link]]` in any open tab, and the window cannot know which without
      // resolving them all again — which is what dropping the answers makes
      // happen, lazily, on the next draw.
      forgetNotes(schedaHost)

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
      // Taken back every time: writing the drafts, the autosaves and the
      // session are round trips to the core, and the window would otherwise
      // go first.
      event.preventDefault()
      await editor.flushAutosave()
      await editor.keepDrafts()
      await saveSession(editor.snapshot()).catch(() => {})
      // A tab with no file is not work about to be lost: its text is written to
      // the draft folder and comes back on the next launch. So the question is
      // only ever about named files whose edits are not on disk.
      const dirty = editor.tabs().filter((tab) => tab.path !== null && editor.isDirty(tab.id))
      if (dirty.length === 0) {
        await getCurrentWindow().destroy()
        return
      }
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

  const closeOverlay = useCallback(() => {
    setOverlay(null)
    editor.view.focus()
  }, [editor])

  return (
    <>
      <StatusBar editor={editor} />
      <Palette
        documentPath={editor.active().path}
        visible={overlay === 'files'}
        onPick={(path) => void openPath(path)}
        onClose={closeOverlay}
      />
      {overlay === 'commands' && <CommandPalette onClose={closeOverlay} />}
      {overlay === 'blocks' && (
        <Picker<Block>
          items={BLOCKS}
          text={blockTitle}
          id={blockId}
          label="Insert block"
          placeholder="Insert a block"
          empty="No block by that name"
          onClose={closeOverlay}
          onPick={(block) => {
            editor.view.dispatch(block.build(editor.view.state))
            editor.view.focus()
          }}
        />
      )}
      {overlay === 'settings' && <SettingsScreen onClose={closeOverlay} />}
    </>
  )
}

const BLOCKS = blocks()
const blockTitle = (block: Block) => block.title
const blockId = (block: Block) => block.id

const commandTitle = (command: ListedCommand) => command.label
const commandId = (command: ListedCommand) => command.id
const commandKeys = (command: ListedCommand) => command.keys.map((keys) => showKeys(keys)).join('  ')

/** Every command, with its key beside it. Choosing one runs it; the key is
 *  shown so that next time it need not be chosen. */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const listed = useCommandList()
  // What can be run, in the catalogue's order rather than the order the
  // owners happened to mount in: the things reached for most come first. The
  // palette itself is not offered - choosing it would do nothing.
  const commands = useMemo(
    () =>
      listed
        .filter((command) => command.run !== undefined)
        .sort((a, b) => (ORDER.get(a.id) ?? Infinity) - (ORDER.get(b.id) ?? Infinity)),
    [listed],
  )
  return (
    <Picker<ListedCommand>
      items={commands}
      text={commandTitle}
      id={commandId}
      detail={commandKeys}
      label="Commands"
      placeholder="Run a command"
      empty="No command by that name"
      onClose={onClose}
      onPick={(command) => {
        // After the palette has gone, so a command that opens a panel of its
        // own — the settings, the block list — opens it into an empty window.
        queueMicrotask(() => command.run?.())
      }}
    />
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

/** A panel's visibility, and the command that shows and hides it.
 *
 *  The state belongs to the window rather than to the document: switching tabs
 *  should not close a panel that was open. */
function usePanel(id: string): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState(false)
  useCommand(
    id,
    useCallback(() => setVisible((was) => !was), []),
  )
  return [visible, setVisible]
}

/** Opens a note at a line, for a panel that lists places rather than files.
 *
 *  Shared by the network and the tags panels: both answer "here, on this line",
 *  and a note opened at its first paragraph has answered "which note" and
 *  dropped "where in it". Two copies of this would be two ways to drift about
 *  what a row does when it is clicked. */
function openAt(editor: EditorHandle, path: string, line: number, column = 0, length = 0) {
  void editor.open(path).then(
    () => {
      rememberRecent(path)
      const at = editor.view.state.doc.line(
        Math.min(Math.max(line, 1), editor.view.state.doc.lines),
      )
      // A search knows where on the line, not only which line, and selects
      // what it found. The column is in UTF-16 units — the editor's own — and
      // is clamped to the line in case the note changed since it was read.
      const anchor = Math.min(at.from + column, at.to)
      const head = Math.min(anchor + length, at.to)
      editor.view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      })
      editor.view.focus()
    },
    () => {
      // A note that will not open leaves the panel as it was.
    },
  )
}

/** The tags panel — hidden until asked for, because a notepad that opens with
 *  four sidebars is not a notepad. */
function TagsHost({ editor }: { editor: EditorHandle }) {
  const [visible] = usePanel('panel.tags')
  const revision = useVaultWrites()
  useEditor(editor)

  return (
    <TagsPanel
      editor={editor}
      visible={visible}
      revision={revision}
      onOpen={(path, line) => openAt(editor, path, line)}
    />
  )
}

/** The vault search, and the two commands that show it.
 *
 *  Search and replace — the keys every editor people come from already uses for
 *  the same two things. Asking again while the panel is open puts the cursor
 *  back in the search box rather than closing it: the command means "search",
 *  and closing is what the same key does in the panels that have nothing to
 *  type into. */
function SearchHost({ editor }: { editor: EditorHandle }) {
  const [visible, setVisible] = useState(false)
  const [focusAsked, setFocusAsked] = useState(0)
  const [replaceAsked, setReplaceAsked] = useState(false)
  const revision = useVaultWrites()
  useEditor(editor)

  const show = useCallback((replace: boolean) => {
    setVisible(true)
    setReplaceAsked(replace)
    setFocusAsked((was) => was + 1)
  }, [])
  useCommand(
    'search.vault',
    useCallback(() => show(false), [show]),
  )
  useCommand(
    'search.replace',
    useCallback(() => show(true), [show]),
  )

  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      // Escape from inside the panel closes it and hands the keyboard back to
      // the note, which is where it was before the search was asked for.
      if (event.key !== 'Escape') return
      const panel = document.querySelector('.search')
      if (!panel || !panel.contains(document.activeElement)) return
      event.preventDefault()
      setVisible(false)
      editor.view.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, editor])

  return (
    <SearchPanel
      editor={editor}
      visible={visible}
      revision={revision}
      focusAsked={focusAsked}
      replaceAsked={replaceAsked}
      onOpen={(path, line, column, length) => openAt(editor, path, line, column, length)}
      onReplaced={() => vaultWrites.bump()}
    />
  )
}

/** The network panel — mostly about backlinks. */
function NetworkHost({ editor }: { editor: EditorHandle }) {
  const [visible] = usePanel('panel.network')
  const revision = useVaultWrites()
  useEditor(editor)

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

/** The outline. */
function OutlinePanel({ editor }: { editor: EditorHandle }) {
  const [visible] = usePanel('panel.outline')
  return <Outline editor={editor} visible={visible} />
}

/** The file tree. The path it reads from follows the tabs, because the tree is
 *  the vault of whatever is being edited - or the window's folder, when that is
 *  in no vault. */
function TreePanel({
  editor,
  onVaultWritten,
}: {
  editor: EditorHandle
  onVaultWritten: () => void
}) {
  const [visible, setVisible] = usePanel('panel.tree')
  // A folder opened, or come back as what is in front, brings the tree out:
  // the tree is what there is to see of it. Hidden again by its key as ever.
  // Counted from none rather than from what the store holds at mount: this
  // panel is a root of its own and may first render after the session has
  // already brought a folder back - which is a folder opened all the same.
  const folderOpened = useFolderOpened()
  const [seenOpened, setSeenOpened] = useState(0)
  if (folderOpened !== seenOpened) {
    setSeenOpened(folderOpened)
    setVisible(true)
  }
  const folder = useFolder()
  // The rename being asked about, and the one just done. Both live here because
  // the tree hands a rename up rather than performing it: a rename in a vault
  // may rewrite other people's notes, and the dry run, the approval and the
  // undo are the window's business rather than a panel's.
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [undoable, setUndoable] = useState<RenameApplied | null>(null)
  useEditor(editor)

  const refuse = useCallback((message: string) => {
    // The core's own words: "“notes.md” already exists", "“note.md” is open in
    // another program". A dialog nobody can act on is the same as none.
    void ask(message, { title: 'That did not work', kind: 'error', okLabel: 'OK' })
  }, [])

  return (
    <>
      <FileTree
        documentPath={editor.active().path}
        folder={folder?.root ?? null}
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
  /** The file the window came up with, whether it was asked for or brought
   *  back from the session — or null for a window that came up with nothing.
   *  The splash belongs to that last case and to no other (`src/splash.tsx`). */
  launchedWith: string | null
}

/** Mounts the title bar above the editor and the status bar below it. */
export function mountShell(editor: EditorHandle, options: ShellOptions = { launchedWith: null }) {
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
  const searchHost = document.createElement('div')
  searchHost.className = 'search-host'
  middle.appendChild(treeHost)
  middle.appendChild(searchHost)
  middle.appendChild(editorHost)
  middle.appendChild(tagsHost)
  middle.appendChild(networkHost)
  middle.appendChild(outlineHost)

  // The title bar and the status bar are separate roots so the first can sit
  // above the editor and the second below it: React cannot render one component
  // into two places.
  createRoot(shellHost).render(
    <StrictMode>
      <Shell editor={editor} launchedWith={options.launchedWith} />
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
  createRoot(searchHost).render(
    <StrictMode>
      <SearchHost editor={editor} />
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
  if (options.launchedWith === null) {
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
 *  left is the application's own state: the settings, the session and the
 *  drafts from the previous run. All are ordinarily instant, which is the point
 *  — the splash has a delay in front of it and a fast start never reaches it.
 *  What it covers is the slow one: a cold disk, a scanner reading the data
 *  directory, a folder of drafts that has grown. */
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
    void Promise.allSettled([restoreDrafts(), loadSession(), settingsStore.load()]).then(done)
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
 *  nothing is worse than one that is not. The command is there on the same
 *  terms: attached only while there is somewhere to send the note. */
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

  const send = useCallback(() => {
    if (url === null) return false
    // Through the opener rather than a shell command. On Windows
    // `cmd /c start` cuts a URL at its first ampersand and runs the tail as
    // a command, and every URL this builds has `&file=` in it.
    void openUrl(url).catch(() => {
      // Obsidian is not installed, or nothing handles the scheme. The note
      // is open here either way, and a dialog saying somebody else's
      // program is missing is not something this window can help with.
    })
  }, [url])

  // Declared either way and offered only in a vault, so the keys somebody
  // gave it stay in the list rather than coming and going with the note.
  useCommand('file.obsidian', send, { enabled: url !== null })

  if (url === null) return null

  return (
    <button type="button" className="titlebar-action" title="Open in Obsidian" aria-label="Open in Obsidian" onClick={send}>
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
  const { close, closeMany } = useClosing(editor)
  const gestures = useTitleBarGestures()

  // The list belongs to an empty, unnamed, untouched document and nothing else:
  // one character typed and it would be in the way. Without a folder, only the
  // window's one tab - a blank among other tabs is a draft about to be typed
  // into; with one, any blank in front, which is the folder's empty window.
  const folder = useFolder()
  const empty = isUntouchedBlank(editor) && (editor.tabs().length === 1 || folder !== null)

  return (
    <>
      <header className="titlebar" {...gestures}>
        <Mark />
        <TabStrip
          editor={editor}
          actions={{ close: (id) => void close(id), closeMany: (ids) => void closeMany(ids) }}
        />
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
      <RecentFiles visible={empty} folder={folder} container={editor.host} onOpen={onOpen} />
    </>
  )
}

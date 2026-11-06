// The history panel: what git remembers of the note in front.
//
// Hidden until asked for, like the other panels, and nothing about git happens
// before it is: the first frame is the text's, and a note in no repository earns
// the panel nothing.
//
// A row says one thing that changed the note. Opened, it shows the lines; asked,
// it shows the whole note as it was, in a pane of its own beside the note as it
// is. That pane is not a tab (ADR 0023): a tab is a document that can be edited
// and saved and comes back next launch, and a past version is none of those.
//
// The reading is the core's (`history.rs`); what is here is when to ask and how
// to show it.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { documentPath, schedaEditor, toggleReading } from '@lacodda/scheda-editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { readChange, readHistory, readRevision, type Change, type History, type Revision } from './core'
import type { EditorHandle } from './editor/mount'
import { schedaHost } from './editor/host'
import { basename } from './paths'

/** How much of a commit id is enough to tell it from its neighbours. */
const SHORT = 7

// In the language the window is in, whatever the system's: a date in another one
// would be the only thing on screen that is.
const DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
const MOMENT = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

/** What the core said, in the words it said it. */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

/** A history that came back, and which note it is about. */
interface Answer {
  for: string
  /** Null when the note is in no repository. */
  history: History | null
  problem: string | null
}

/** Reads the note's history when the panel opens, when the note changes, when
 *  it is saved, and when the window comes back: the commit that adds to it is
 *  usually made in a terminal, and nothing in the vault says so.
 *
 *  An answer about this note stays on screen while the next one is read, so a
 *  panel looked at does not blink each time the window is clicked back into. */
function useHistory(path: string | null, revision: number) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [returned, setReturned] = useState(0)

  useEffect(() => {
    const again = () => setReturned((count) => count + 1)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])

  useEffect(() => {
    if (path === null) return
    let current = true
    void readHistory(path)
      .then((history) => {
        if (current) setAnswer({ for: path, history, problem: null })
      })
      .catch((error: unknown) => {
        if (current) setAnswer({ for: path, history: null, problem: messageOf(error) })
      })
    return () => {
      current = false
    }
  }, [path, revision, returned])

  return answer !== null && answer.for === path ? answer : null
}

/** A past version on screen, and which note it is a version of. */
interface Past {
  for: string
  revision: Revision
  text: string
}

export function HistoryPanel({ editor, revision }: { editor: EditorHandle; revision: number }) {
  const path = editor.active().path
  const answer = useHistory(path, revision)
  const [open, setOpen] = useState<{ for: string; commit: string } | null>(null)
  const [past, setPast] = useState<Past | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const asked = useRef(0)

  const opened = open !== null && open.for === path ? open.commit : null
  const shown = past !== null && past.for === path ? past : null

  const show = useCallback(
    (row: Revision) => {
      if (path === null) return
      // The last one asked for is the one wanted, whichever comes back first.
      asked.current += 1
      const ask = asked.current
      setRefused(null)
      void readRevision(path, row.commit, row.path)
        .then((text) => {
          if (ask === asked.current) setPast({ for: path, revision: row, text })
        })
        .catch((error: unknown) => {
          if (ask === asked.current) setRefused(messageOf(error))
        })
    },
    [path],
  )

  const close = useCallback(() => {
    setPast(null)
    editor.view.focus()
  }, [editor])

  /** Going down the list with the pane open is reading the note's past, so the
   *  pane follows. A deletion has no text to follow to, and leaves it as it is. */
  const toggle = (row: Revision) => {
    if (path === null) return
    const opening = opened !== row.commit
    setOpen(opening ? { for: path, commit: row.commit } : null)
    if (opening && shown !== null && row.status !== 'deleted') show(row)
  }

  const history = answer?.history ?? null
  const revisions = history?.revisions ?? []

  return (
    <>
      <aside className="history" aria-label="History of this note">
        <h2 className="history-heading">
          History
          {revisions.length > 0 && (
            <span className="history-count">
              {revisions.length}
              {history?.truncated ? '+' : ''}
            </span>
          )}
        </h2>
        {path === null ? (
          <p className="history-empty">A draft has no history yet.</p>
        ) : answer === null ? (
          <p className="history-empty">Reading the history…</p>
        ) : answer.problem !== null ? (
          <p className="history-empty">{answer.problem}</p>
        ) : history === null ? (
          <p className="history-empty">This note is not in a git repository.</p>
        ) : revisions.length === 0 ? (
          <p className="history-empty">Git has no record of this note yet.</p>
        ) : (
          <ol className="history-list">
            {revisions.map((row) => (
              <Row
                key={row.commit}
                note={path}
                row={row}
                open={opened === row.commit}
                showing={shown?.revision.commit === row.commit}
                refused={opened === row.commit ? refused : null}
                onToggle={() => toggle(row)}
                onShow={() => show(row)}
              />
            ))}
          </ol>
        )}
        {history?.truncated && <p className="history-note">Older changes are not listed.</p>}
      </aside>
      {shown !== null && <PastVersion editor={editor} past={shown} onClose={close} />}
    </>
  )
}

function statusOf(row: Revision): string | null {
  if (row.status === 'added') return 'Added'
  if (row.status === 'deleted') return 'Deleted'
  if (row.status === 'renamed' || row.status === 'copied') {
    return `${row.status === 'renamed' ? 'Moved' : 'Copied'} from ${row.from ?? 'elsewhere'}`
  }
  return null
}

function Row({
  note,
  row,
  open,
  showing,
  refused,
  onToggle,
  onShow,
}: {
  note: string
  row: Revision
  open: boolean
  showing: boolean
  refused: string | null
  onToggle: () => void
  onShow: () => void
}) {
  const when = new Date(row.seconds * 1000)
  const status = statusOf(row)
  return (
    <li className={showing ? 'history-row history-row--showing' : 'history-row'}>
      <button
        type="button"
        className="history-item"
        aria-expanded={open}
        onClick={onToggle}
        title={`${row.commit}\n${row.author}, ${MOMENT.format(when)}`}
      >
        <span className="history-subject">{row.subject === '' ? '(no message)' : row.subject}</span>
        <span className="history-meta">
          {DATE.format(when)} · {row.author} · {row.commit.slice(0, SHORT)}
        </span>
        {status !== null && <span className="history-status">{status}</span>}
      </button>
      {open && <Lines note={note} row={row} refused={refused} onShow={onShow} />}
    </li>
  )
}

/** The lines one commit changed. Read when the row is opened and not before: a
 *  list of two hundred commits is one question, and these would be two hundred. */
function Lines({
  note,
  row,
  refused,
  onShow,
}: {
  note: string
  row: Revision
  refused: string | null
  onShow: () => void
}) {
  const [answer, setAnswer] = useState<Change | string | null>(null)

  useEffect(() => {
    let current = true
    void readChange(note, row.commit, row.path)
      .then((change) => {
        if (current) setAnswer(change)
      })
      .catch((error: unknown) => {
        if (current) setAnswer(messageOf(error))
      })
    return () => {
      current = false
    }
  }, [note, row.commit, row.path])

  return (
    <div className="history-change">
      <div className="history-actions">
        {typeof answer === 'object' && answer !== null && answer.text && (
          <span className="history-counts">
            +{answer.added} −{answer.removed}
          </span>
        )}
        {/* A deletion has no text to show: the note is what the row before had. */}
        {row.status !== 'deleted' && (
          <button type="button" className="history-show" onClick={onShow}>
            Show this version
          </button>
        )}
      </div>
      {refused !== null && <p className="history-empty">{refused}</p>}
      {answer === null ? (
        <p className="history-empty">Reading the change…</p>
      ) : typeof answer === 'string' ? (
        <p className="history-empty">{answer}</p>
      ) : !answer.text ? (
        <p className="history-empty">This version is not text, so it has no lines to show.</p>
      ) : answer.hunks.length === 0 ? (
        <p className="history-empty">No lines changed.</p>
      ) : (
        answer.hunks.map((hunk, index) => (
          <ol key={index} className="history-hunk">
            {hunk.map((line, at) => (
              <li key={at} className={`history-line history-line--${line.kind}`}>
                {line.text}
              </li>
            ))}
          </ol>
        ))
      )}
      {typeof answer === 'object' && answer?.cut && (
        <p className="history-note">The rest of this change is too long to list here.</p>
      )}
    </div>
  )
}

/** The note as it was, beside the note as it is.
 *
 *  An editor, because it has to look like the note and link like the note, in
 *  reading mode, because it is not there to be written in. The note's own path
 *  goes with it, so its pictures and `[[links]]` resolve where the note's do. */
function PastVersion({
  editor,
  past,
  onClose,
}: {
  editor: EditorHandle
  past: Past
  onClose: () => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const { for: note, revision, text } = past

  useEffect(() => {
    const parent = holder.current
    if (parent === null) return
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          ...schedaEditor({ host: schedaHost, closeBrackets: false }),
          documentPath.init(() => note),
        ],
      }),
      parent,
    })
    view.dispatch({ effects: toggleReading.of() })
    view.focus()
    return () => view.destroy()
  }, [note, text])

  return createPortal(
    // The keyboard is in the version, so that is where it is let go of.
    <div
      className="pane past"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <header className="past-head">
        <span className="past-title" title={revision.subject}>
          {basename(revision.path)} at {revision.commit.slice(0, SHORT)}
        </span>
        <span className="past-when">{DATE.format(new Date(revision.seconds * 1000))}</span>
        <button type="button" className="past-close" aria-label="Close this version" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </header>
      <div ref={holder} className="past-text" />
    </div>,
    editor.host,
  )
}

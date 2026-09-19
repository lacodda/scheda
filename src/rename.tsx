// Renaming a note when other notes link to it: the dry run, the confirmation,
// and the offer to take it back.
//
// This is the one thing scheda does that writes to files nobody opened, and the
// shape follows from that. The person is shown what *would* happen — which
// files, which lines, what each one would read afterwards — and nothing has been
// touched while they read it. Only then does the rename happen, and for as long
// as the offer is on screen it can be undone to the exact bytes.
//
// A rename that changes no links skips all of this. A dialog that says "0 links
// will be updated, proceed?" is a dialog that teaches people to click through
// dialogs, and the tree already renames a file in one gesture.
import { useEffect, useState } from 'react'
import { applyRename, planRename, type RenameApplied, type RenamePlan } from './core'

/** What the dialog is doing. `planning` is the moment the vault is being read;
 *  it has its own state because on a large vault it is the one part a person
 *  can notice. */
type Stage =
  | { kind: 'planning' }
  | { kind: 'asking'; plan: RenamePlan }
  | { kind: 'working' }

export function RenamePreview({
  path,
  name,
  onDone,
  onFailure,
}: {
  path: string
  name: string
  /** Called with what happened, or null when the person backed out. The caller
   *  refreshes the tree and offers the undo. */
  onDone: (applied: RenameApplied | null) => void
  onFailure: (message: string) => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'planning' })

  useEffect(() => {
    let current = true
    void planRename(path, name)
      .then((plan) => {
        if (!current) return
        // Nothing to say: no links point here, so this is an ordinary rename and
        // the person asked for it already.
        if (plan.links === 0 && plan.unreadable.length === 0) {
          return applyRename(plan).then((applied) => {
            if (current) onDone(applied)
          })
        }
        setStage({ kind: 'asking', plan })
      })
      .catch((error: unknown) => {
        if (!current) return
        onFailure(messageOf(error))
        onDone(null)
      })
    return () => {
      current = false
    }
    // Once, for this request. The dialog is mounted with the path and name it
    // is about and unmounted when it is answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDone(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  if (stage.kind === 'planning') {
    return (
      <div className="rename-backdrop">
        <div className="rename-dialog" role="dialog" aria-label="Renaming">
          <p className="rename-reading">Looking for links to this note…</p>
        </div>
      </div>
    )
  }

  if (stage.kind === 'working') {
    return (
      <div className="rename-backdrop">
        <div className="rename-dialog" role="dialog" aria-label="Renaming">
          <p className="rename-reading">Renaming…</p>
        </div>
      </div>
    )
  }

  const { plan } = stage
  const files = plan.files.length

  return (
    <div className="rename-backdrop">
      <div className="rename-dialog" role="dialog" aria-label="Rename and update links">
        <h2 className="rename-title">
          Rename to <span className="rename-name">{name}</span>
        </h2>
        <p className="rename-summary">
          {plan.links === 1 ? '1 link' : `${plan.links} links`} in{' '}
          {files === 1 ? '1 note' : `${files} notes`} would be updated.
        </p>

        {/* Every line, not a count. What is being approved is a write to
            somebody's notes, and a number is not something a person can check.
            The list scrolls; the dialog does not grow past the window. */}
        <div className="rename-files">
          {plan.files.map((file) => (
            <section key={file.path} className="rename-file">
              <h3 className="rename-file-name">{file.relative}</h3>
              <ol className="rename-edits">
                {file.edits.map((edit, at) => (
                  <li key={`${edit.line}-${at}`} className="rename-edit">
                    <span className="rename-line-number">{edit.line}</span>
                    <span className="rename-lines">
                      <span className="rename-before">{edit.lineBefore}</span>
                      <span className="rename-after">{edit.lineAfter}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        {/* A note this rename could not look inside may hold a link that is
            about to break. Named rather than passed over: the person is the one
            who can go and look. */}
        {plan.unreadable.length > 0 && (
          <p className="rename-unreadable">
            {plan.unreadable.length === 1
              ? '1 note could not be read and was left alone: '
              : `${plan.unreadable.length} notes could not be read and were left alone: `}
            {plan.unreadable.join(', ')}
          </p>
        )}

        <div className="rename-actions">
          <button type="button" className="rename-cancel" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="rename-confirm"
            autoFocus
            onClick={() => {
              setStage({ kind: 'working' })
              void applyRename(plan)
                .then((applied) => onDone(applied))
                .catch((error: unknown) => {
                  onFailure(messageOf(error))
                  onDone(null)
                })
            }}
          >
            Rename and update
          </button>
        </div>
      </div>
    </div>
  )
}

/** The offer to take a rename back, for as long as it is on screen.
 *
 *  A bar rather than a dialog: the rename succeeded, and a modal asking whether
 *  the thing that just worked should be kept is a modal in the way. It says what
 *  happened and offers the one action, and it goes away on its own — which is
 *  what makes the horizon honest, since the bytes it would restore are only the
 *  right ones while nothing else has written over them.
 */
export function UndoBar({
  applied,
  onUndo,
  onDismiss,
}: {
  applied: RenameApplied
  onUndo: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    // Long enough to read the sentence and decide, short enough that the offer
    // does not outlive the truth behind it.
    const timer = window.setTimeout(onDismiss, 12_000)
    return () => window.clearTimeout(timer)
  }, [onDismiss])

  const name = applied.to.split(/[/\\]/).pop() ?? applied.to
  const files = applied.files.length

  return (
    <div className="undo-bar" role="status">
      <span className="undo-text">
        Renamed to <strong>{name}</strong>
        {applied.links > 0 && (
          <>
            {' '}— {applied.links === 1 ? '1 link' : `${applied.links} links`} in{' '}
            {files === 1 ? '1 note' : `${files} notes`} updated
          </>
        )}
      </span>
      <button type="button" className="undo-action" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="undo-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}

/** The core's own words for a refusal, when there are any. */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

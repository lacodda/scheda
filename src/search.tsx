// The vault search: every line in every note that matches, and — when asked —
// what replacing them would change, before anything is changed.
//
// Hidden until asked for (`Ctrl+Shift+F`, or `Ctrl+Shift+H` to open it with
// the replacement showing), like every other sidebar here.
//
// The searching is the core's (`search.rs`): it reads the notes, it knows which
// carry a tag or a field, and it stops a search that a newer keystroke made
// pointless. What is here is when to ask, how to show the answer, and the one
// decision that belongs to the window — which of the listed changes the person
// actually wants.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  applyReplace,
  planReplace,
  searchVault,
  undoReplace,
  type ReplaceApplied,
  type ReplacePlan,
  type SearchFound,
  type SearchHit,
  type SearchQuery,
} from './core'
import type { EditorHandle } from './editor/mount'

/** How long typing has to pause before the vault is searched. Short enough to
 *  feel like search-as-you-type, long enough that a word typed at speed is one
 *  search rather than six. */
const PAUSE_MS = 180

/** The filter box, read into the query's filters.
 *
 *  One box rather than three: `#tag`, `field:value` and a bare `field:` are
 *  written the way a person already writes them in a vault, and the shape of
 *  each says which filter it is. A word that is neither is left alone rather
 *  than guessed at. */
export function parseFilter(filter: string): Pick<SearchQuery, 'tag' | 'field' | 'value'> {
  let tag: string | null = null
  let field: string | null = null
  let value: string | null = null
  for (const token of filter.trim().split(/\s+/)) {
    if (token === '') continue
    if (token.startsWith('#') && token.length > 1) {
      tag = token.slice(1)
      continue
    }
    const colon = token.indexOf(':')
    if (colon > 0) {
      field = token.slice(0, colon)
      const rest = token.slice(colon + 1)
      value = rest === '' ? null : rest
    }
  }
  return { tag, field, value }
}

/** What came back, and what it was an answer to. */
interface Answer {
  for: string
  found: SearchFound | null
  error: string | null
}

/** A change in the plan, addressed by its file and its place in that file. */
function changeKey(file: number, change: number): string {
  return `${file}:${change}`
}

export function SearchPanel({
  editor,
  visible,
  revision,
  focusAsked,
  replaceAsked,
  onOpen,
  onReplaced,
}: {
  editor: EditorHandle
  visible: boolean
  /** Bumped by the shell when the vault changed, so the answer is asked again. */
  revision: number
  /** Bumped each time the key that shows the panel is pressed, so a second
   *  press puts the cursor back in the search box rather than doing nothing. */
  focusAsked: number
  /** True when the panel was opened to replace. */
  replaceAsked: boolean
  onOpen: (path: string, line: number, column: number, length: number) => void
  /** The vault was written to by a replacement, or by undoing one. */
  onReplaced: () => void
}) {
  const path = editor.active().path
  const [text, setText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [filter, setFilter] = useState('')
  const [replacing, setReplacing] = useState(replaceAsked)
  const [replacement, setReplacement] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const query: SearchQuery = useMemo(
    () => ({ text, caseSensitive, wholeWord, regex, ...parseFilter(filter) }),
    [text, caseSensitive, wholeWord, regex, filter],
  )
  // Nothing typed and no filter is not a question: the answer would be every
  // note in the vault, which is what the tree already is.
  const asking = text !== '' || query.tag !== null || query.field !== null
  const key = JSON.stringify({ path, query, revision })

  const [answer, setAnswer] = useState<Answer | null>(null)
  const fresh = answer !== null && answer.for === key
  const loading = visible && asking && path !== null && !fresh

  useEffect(() => {
    if (!visible || !asking || path === null) return
    let current = true
    const timer = window.setTimeout(() => {
      void searchVault(path, query)
        .then((found) => {
          // Null is a search the core stopped because a newer one started;
          // the newer one's answer is on its way.
          if (current && found !== null) setAnswer({ for: key, found, error: null })
        })
        .catch((error: unknown) => {
          if (current) setAnswer({ for: key, found: null, error: messageOf(error) })
        })
    }, PAUSE_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [visible, asking, path, query, key])

  useEffect(() => {
    if (!visible) return
    input.current?.focus()
    input.current?.select()
  }, [visible, focusAsked])

  // Opened with `Ctrl+Shift+H`: the replacement row comes with it. Only ever
  // turned on here — closing it is the person's toggle.
  const [seenReplaceAsk, setSeenReplaceAsk] = useState(replaceAsked)
  if (replaceAsked !== seenReplaceAsk) {
    setSeenReplaceAsk(replaceAsked)
    if (replaceAsked) setReplacing(true)
  }

  // The preview, and what it was made for. A preview for other words than the
  // ones in the boxes is not shown: approving it would do something the person
  // is no longer looking at.
  const planKey = JSON.stringify({ path, query, replacement })
  const [plan, setPlan] = useState<{ for: string; plan: ReplacePlan } | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [planning, setPlanning] = useState(false)
  const [done, setDone] = useState<{ applied: ReplaceApplied; left: string[] } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const shownPlan = plan !== null && plan.for === planKey ? plan.plan : null

  const preview = () => {
    if (path === null || text === '') return
    setPlanning(true)
    setProblem(null)
    void planReplace(path, query, replacement)
      .then((made) => {
        setPlan({ for: planKey, plan: made })
        setUnticked(new Set())
        setDone(null)
      })
      .catch((error: unknown) => setProblem(messageOf(error)))
      .finally(() => setPlanning(false))
  }

  const apply = () => {
    if (shownPlan === null) return
    // A note open with unsaved changes is left out. Writing it underneath the
    // tab would put the person in front of a "the file changed — reload?"
    // question about a change they asked for, with their own edits on the
    // other side of it.
    const dirty = new Set(
      editor
        .tabs()
        .filter((tab) => tab.path !== null && editor.isDirty(tab.id))
        .map((tab) => (tab.path as string).toLowerCase()),
    )
    const left: string[] = []
    const chosen: ReplacePlan = {
      ...shownPlan,
      files: shownPlan.files
        .map((file, fileIndex) => ({
          ...file,
          changes: file.changes.filter((_, index) => !unticked.has(changeKey(fileIndex, index))),
        }))
        .filter((file) => {
          if (file.changes.length === 0) return false
          if (dirty.has(file.path.toLowerCase())) {
            left.push(file.relative)
            return false
          }
          return true
        }),
    }
    void applyReplace(chosen)
      .then((applied) => {
        setPlan(null)
        setDone({ applied, left })
        onReplaced()
      })
      .catch((error: unknown) => setProblem(messageOf(error)))
  }

  const undo = () => {
    void undoReplace()
      .then((kept) => {
        setDone(null)
        setProblem(
          kept.length > 0
            ? `Put back, except ${kept.length} ${kept.length === 1 ? 'note' : 'notes'} written since: ${kept.join(', ')}`
            : null,
        )
        onReplaced()
      })
      .catch((error: unknown) => setProblem(messageOf(error)))
  }

  if (!visible) return null

  const found = fresh ? answer.found : null
  const error = fresh ? answer.error : null

  return (
    <aside className="search" aria-label="Search the vault">
      <h2 className="search-heading">Search</h2>

      <div className="search-row">
        <input
          ref={input}
          type="search"
          className="search-input"
          placeholder="Search the vault"
          aria-label="Search the vault"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Toggle label="Match case" glyph="Aa" on={caseSensitive} onChange={setCaseSensitive} />
        <Toggle label="Whole word" glyph="ab" on={wholeWord} onChange={setWholeWord} underline />
        <Toggle label="Regular expression" glyph=".*" on={regex} onChange={setRegex} />
      </div>

      <div className="search-row">
        <input
          type="search"
          className="search-input search-filter"
          placeholder="#tag or field:value"
          aria-label="Only notes with a tag or a field"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button
          type="button"
          className={`search-toggle search-replace-toggle${replacing ? ' search-toggle--on' : ''}`}
          aria-pressed={replacing}
          title="Replace in the vault (Ctrl+Shift+H)"
          onClick={() => setReplacing((was) => !was)}
        >
          Replace
        </button>
      </div>

      {replacing && (
        <div className="search-row">
          <input
            type="text"
            className="search-input"
            placeholder={regex ? 'Replace with ($1 for a group)' : 'Replace with'}
            aria-label="Replace with"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') preview()
            }}
          />
          <button
            type="button"
            className="search-action"
            disabled={text === '' || planning || path === null}
            onClick={preview}
          >
            {planning ? 'Reading…' : 'Preview'}
          </button>
        </div>
      )}

      {problem !== null && <p className="search-problem">{problem}</p>}

      {done !== null && (
        <div className="search-done" role="status">
          <span>
            Replaced {done.applied.changes} in {done.applied.paths.length}{' '}
            {done.applied.paths.length === 1 ? 'note' : 'notes'}
            {done.applied.skipped.length > 0 &&
              ` · ${done.applied.skipped.length} changed since the preview and were left alone`}
            {done.left.length > 0 &&
              ` · ${done.left.length} open with unsaved changes and were left alone`}
          </span>
          {done.applied.changes > 0 && (
            <button type="button" className="search-action" onClick={undo}>
              Undo
            </button>
          )}
        </div>
      )}

      {shownPlan !== null ? (
        <PlanView
          plan={shownPlan}
          unticked={unticked}
          onToggle={(keys, tick) =>
            setUnticked((was) => {
              const next = new Set(was)
              for (const one of keys) {
                if (tick) next.delete(one)
                else next.add(one)
              }
              return next
            })
          }
          onApply={apply}
          onCancel={() => setPlan(null)}
        />
      ) : (
        <Results
          found={found}
          error={error}
          loading={loading}
          asking={asking}
          inVault={path !== null}
          onOpen={onOpen}
        />
      )}
    </aside>
  )
}

function Toggle({
  label,
  glyph,
  on,
  onChange,
  underline = false,
}: {
  label: string
  glyph: string
  on: boolean
  onChange: (on: boolean) => void
  underline?: boolean
}) {
  return (
    <button
      type="button"
      className={`search-toggle${on ? ' search-toggle--on' : ''}${underline ? ' search-toggle--word' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
    >
      {glyph}
    </button>
  )
}

function Results({
  found,
  error,
  loading,
  asking,
  inVault,
  onOpen,
}: {
  found: SearchFound | null
  error: string | null
  loading: boolean
  asking: boolean
  inVault: boolean
  onOpen: (path: string, line: number, column: number, length: number) => void
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set())

  if (!inVault) return <p className="search-empty">Not in a vault</p>
  if (error !== null) return <p className="search-problem">{error}</p>
  if (!asking) return null
  if (found === null) return <p className="search-empty">{loading ? 'Searching…' : ''}</p>
  if (found.files.length === 0) {
    return <p className="search-empty">Nothing in {found.notes} notes</p>
  }

  return (
    <>
      <p className="search-summary">
        {found.matches > 0
          ? `${found.matches} in ${found.files.length} ${found.files.length === 1 ? 'note' : 'notes'}`
          : `${found.files.length} ${found.files.length === 1 ? 'note' : 'notes'}`}
        {found.truncated && ' · the first of them'}
      </p>
      <ol className="search-files">
        {found.files.map((file) => {
          const closed = folded.has(file.path)
          return (
            <li key={file.path}>
              <button
                type="button"
                className="search-file"
                aria-expanded={file.hits.length > 0 ? !closed : undefined}
                title={file.relative}
                onClick={() => {
                  if (file.hits.length === 0) {
                    onOpen(file.path, 1, 0, 0)
                    return
                  }
                  setFolded((was) => {
                    const next = new Set(was)
                    if (next.has(file.path)) next.delete(file.path)
                    else next.add(file.path)
                    return next
                  })
                }}
              >
                <span className="search-where">{file.relative}</span>
                {file.matches > 0 && <span className="search-count">{file.matches}</span>}
              </button>
              {!closed && file.hits.length > 0 && (
                <ol className="search-hits">
                  {file.hits.map((hit) => (
                    <li key={hit.line}>
                      <button
                        type="button"
                        className="search-hit"
                        title={`${file.relative}:${hit.line}`}
                        onClick={() => onOpen(file.path, hit.line, hit.column, hit.length)}
                      >
                        <span className="search-line">{hit.line}</span>
                        <Marked hit={hit} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}

/** A line with its matches marked. The ranges are UTF-16 offsets, which is
 *  what a JavaScript string is indexed by — so they slice directly. */
function Marked({ hit }: { hit: SearchHit }) {
  const parts: ReactNode[] = []
  let at = 0
  hit.ranges.forEach(([start, end], index) => {
    if (start > at) parts.push(hit.text.slice(at, start))
    parts.push(<mark key={index}>{hit.text.slice(start, end)}</mark>)
    at = end
  })
  if (at < hit.text.length) parts.push(hit.text.slice(at))
  return <span className="search-text">{parts}</span>
}

function PlanView({
  plan,
  unticked,
  onToggle,
  onApply,
  onCancel,
}: {
  plan: ReplacePlan
  unticked: Set<string>
  onToggle: (keys: string[], tick: boolean) => void
  onApply: () => void
  onCancel: () => void
}) {
  const chosen = plan.changes - unticked.size
  if (plan.changes === 0) {
    return (
      <div className="search-plan">
        <p className="search-empty">Nothing to replace</p>
        <button type="button" className="search-action" onClick={onCancel}>
          Back
        </button>
      </div>
    )
  }
  return (
    <div className="search-plan">
      <div className="search-plan-bar">
        <span>
          {chosen} of {plan.changes} in {plan.files.length}{' '}
          {plan.files.length === 1 ? 'note' : 'notes'}
          {plan.truncated && ' · the first of them'}
        </span>
        <button type="button" className="search-action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="search-action search-action--primary"
          disabled={chosen === 0}
          onClick={onApply}
        >
          Replace {chosen}
        </button>
      </div>
      <ol className="search-files">
        {plan.files.map((file, fileIndex) => {
          const keys = file.changes.map((_, index) => changeKey(fileIndex, index))
          const ticked = keys.filter((one) => !unticked.has(one)).length
          return (
            <li key={file.path}>
              <label className="search-file search-file--plan" title={file.relative}>
                <input
                  type="checkbox"
                  checked={ticked === keys.length}
                  ref={(box) => {
                    if (box) box.indeterminate = ticked > 0 && ticked < keys.length
                  }}
                  onChange={(event) => onToggle(keys, event.target.checked)}
                />
                <span className="search-where">{file.relative}</span>
                <span className="search-count">{file.changes.length}</span>
              </label>
              <ol className="search-hits">
                {file.changes.map((change, index) => {
                  const one = changeKey(fileIndex, index)
                  return (
                    <li key={one}>
                      <label className="search-hit search-hit--plan">
                        <input
                          type="checkbox"
                          checked={!unticked.has(one)}
                          onChange={(event) => onToggle([one], event.target.checked)}
                        />
                        <span className="search-line">{change.line}</span>
                        <span className="search-text">
                          {change.left}
                          <del>{change.found}</del>
                          <ins>{change.replacement}</ins>
                          {change.right}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ol>
            </li>
          )
        })}
      </ol>
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

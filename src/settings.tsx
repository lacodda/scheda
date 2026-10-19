// The settings screen: every setting scheda has, changed where it is shown.
//
// There is no Save button. A setting takes effect as it is changed, in every
// tab and pane, without a restart — the screen writes a patch, the core stores
// it, and the window applies what came back (`settings-store.ts`). A button
// that has to be remembered is a setting that was changed and then lost.
//
// Over the text rather than beside it, like the palettes: it is a place visited
// now and then, and a sidebar for it would be one more thing on screen the
// rest of the time.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { boundElsewhere, clash, COMMANDS, keymapOf, keysFor, showKeys, type CommandSpec } from './commands'
import {
  chooseQuickNoteFile,
  quickNoteStatus,
  settingsStatus,
  showQuickNote,
  type QuickNoteStatus,
  type Settings,
  type SettingsStatus,
  type Theme,
} from './core'
import { match } from './fuzzy'
import { isShortcut, showSystemKey, systemKeyOf } from './system-key'
import { formatStroke, normalizeKeys, strokeOf, typesInField } from './ui/shortcut'
import { settings as store } from './settings-store'

function useSettings(): Settings | null {
  useSyncExternalStore(store.subscribe, store.revision)
  return store.current()
}

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const current = useSettings()
  const panel = useRef<HTMLDivElement>(null)
  const [file, setFile] = useState<SettingsStatus | null>(null)

  useEffect(() => {
    void store.load()
    settingsStatus().then(setFile, () => {})
    panel.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="palette-backdrop" onPointerDown={onClose}>
      <div
        ref={panel}
        className="settings"
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </header>
        {current === null ? (
          <p className="settings-note">Reading the settings…</p>
        ) : (
          <div className="settings-body">
            {file?.newer != null && (
              <p className="settings-note settings-note--notice" role="status">
                These settings were written by a newer version of scheda (format {file.newer}). Changes apply to
                this window and are not saved, so the newer version finds its file as it left it.
              </p>
            )}
            <Appearance current={current} />
            <Writing current={current} />
            <QuickNote current={current} />
            <Keyboard />
            <Recent current={current} />
            {file && (
              <p className="settings-note settings-file">
                Kept in <code>{file.path}</code>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Sends a change and says so on screen when the core refused it. */
function change(patch: Parameters<typeof store.update>[0]) {
  void store.update(patch).catch(() => {
    // The screen keeps showing what is stored, which is the honest account of
    // a change that did not happen.
  })
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={'settings-switch' + (on ? ' settings-switch--on' : '')}
      onClick={() => onChange(!on)}
    >
      <span className="settings-switch-knob" />
    </button>
  )
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function Appearance({ current }: { current: Settings }) {
  const full = current.columnWidth === 0
  return (
    <section className="settings-section">
      <h3>Appearance</h3>
      <Row label="Theme">
        <div className="settings-segments" role="radiogroup" aria-label="Theme">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              role="radio"
              aria-checked={current.theme === theme.value}
              className={'settings-segment' + (current.theme === theme.value ? ' settings-segment--on' : '')}
              onClick={() => change({ theme: theme.value })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Text size" hint="In pixels, 10 to 32">
        <Stepper value={current.fontSize} min={10} max={32} label="Text size" onChange={(value) => change({ fontSize: value })} />
      </Row>
      <Row label="Reading column" hint={full ? 'The whole window' : `${current.columnWidth} rem wide`}>
        <input
          type="range"
          className="settings-range"
          min={24}
          max={120}
          step={2}
          value={full ? 120 : current.columnWidth}
          disabled={full}
          aria-label="Reading column width"
          onChange={(event) => change({ columnWidth: Number(event.target.value) })}
        />
        <label className="settings-check">
          <input
            type="checkbox"
            checked={full}
            onChange={(event) => change({ columnWidth: event.target.checked ? 0 : 46 })}
          />
          Full width
        </label>
      </Row>
    </section>
  )
}

function Stepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  label: string
  onChange: (value: number) => void
}) {
  return (
    <div className="settings-stepper" aria-label={label}>
      <button type="button" aria-label={`Smaller ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="settings-value">{value}</span>
      <button type="button" aria-label={`Larger ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}

function Writing({ current }: { current: Settings }) {
  return (
    <section className="settings-section">
      <h3>Writing</h3>
      <Row label="Autosave" hint="Writes a file a second after typing stops, and when the window loses focus">
        <Toggle on={current.autosave} label="Autosave" onChange={(on) => change({ autosave: on })} />
      </Row>
      <Row label="Close brackets" hint="An opening bracket or quote types its partner">
        <Toggle on={current.closeBrackets} label="Close brackets" onChange={(on) => change({ closeBrackets: on })} />
      </Row>
      <Row label="Spell check" hint="Underlines misspelt words, in the system's language">
        <Toggle on={current.spellcheck} label="Spell check" onChange={(on) => change({ spellcheck: on })} />
      </Row>
    </section>
  )
}

function QuickNote({ current }: { current: Settings }) {
  const [status, setStatus] = useState<QuickNoteStatus | null>(null)

  // Asked again whenever the key changes: the answer is the system's, and it
  // is only known once the core has tried.
  useEffect(() => {
    let live = true
    void quickNoteStatus()
      .then((answer) => {
        if (live) setStatus(answer)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [current.quickNoteKey])

  return (
    <section className="settings-section">
      <h3>Quick note</h3>
      <p className="settings-note">
        A key that works from any program while scheda is open. It brings up a small window; what you type there is added
        to the end of one file, with the date and time.
      </p>
      <Row label="File" hint={current.quickNoteFile ?? 'Not chosen yet'}>
        <button type="button" className="settings-button" onClick={() => void chooseQuickNoteFile().then(() => store.update({}))}>
          Choose…
        </button>
        {current.quickNoteFile && (
          <button type="button" className="settings-button" onClick={() => change({ quickNoteFile: null })}>
            Forget
          </button>
        )}
      </Row>
      <Row
        label="Key"
        hint={
          current.quickNoteKey === ''
            ? 'Off'
            : status && status.key === current.quickNoteKey && !status.registered && status.error
              ? `Not available: ${status.error}`
              : undefined
        }
      >
        <SystemKeyRecorder keys={current.quickNoteKey} onRecord={(keys) => change({ quickNoteKey: keys })} />
        {current.quickNoteKey !== '' && (
          <button type="button" className="settings-button" onClick={() => change({ quickNoteKey: '' })}>
            Turn off
          </button>
        )}
        <button type="button" className="settings-button" onClick={() => void showQuickNote()}>
          Try it
        </button>
      </Row>
    </section>
  )
}

/** What a key pressed on the settings screen records as: the keys, or null
 *  for a press that is not a shortcut yet - a modifier on its own, a letter. */
type Reading = (event: KeyboardEvent) => string | null

/** A system-wide key: the Windows key allowed, a letter alone not. */
const readSystemKey: Reading = (event) => {
  const keys = systemKeyOf(event)
  return keys !== null && isShortcut(keys) ? keys : null
}

/** A key of the window, in the line's notation. A key a field types with is
 *  refused: the commands answer inside the note, and there it would type. */
const readWindowKey: Reading = (event) => {
  const stroke = strokeOf(event)
  return stroke === null || typesInField(stroke) ? null : formatStroke(stroke)
}

/** Listens for the next key while `listening` is set: the keys a person
 *  presses to rebind something must reach this and nothing else, including
 *  the command they are bound to now. So it listens on the window in the
 *  capture phase - before the list of commands, which takes its keys on the
 *  way down as well - and stops the key there. `Escape` gives up. */
function useKeyListener(read: Reading, onRecord: (keys: string) => void) {
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setListening(false)
        return
      }
      const pressed = read(event)
      if (pressed === null) return
      setListening(false)
      onRecord(pressed)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, read, onRecord])

  return [listening, setListening] as const
}

/** A button that shows the system-wide key and, once pressed, listens for a
 *  new one. */
function SystemKeyRecorder({ keys, onRecord }: { keys: string; onRecord: (keys: string) => void }) {
  const [listening, setListening] = useKeyListener(readSystemKey, onRecord)

  return (
    <button
      type="button"
      className={'settings-chord' + (listening ? ' settings-chord--listening' : '')}
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
    >
      {listening ? 'Press a key…' : keys === '' ? 'None' : showSystemKey(keys)}
    </button>
  )
}

function Keyboard() {
  const current = useSettings()
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const overrides = useMemo(() => current?.keys ?? {}, [current])
  const keymap = useMemo(() => keymapOf(overrides), [overrides])

  const shown = COMMANDS.filter((command) => filter === '' || match(filter, command.title) !== null)

  function write(next: Record<string, string[]>) {
    change({ keys: next })
  }

  function add(command: CommandSpec, keys: string) {
    const next = { ...overrides }
    // Keys belong to one command. Taking them for this one takes them from
    // the other, and says so — a second binding that silently loses is a key
    // that does something different from what the screen shows.
    const others = boundElsewhere(keys, command.id, keymap)
    for (const other of others) next[other.id] = keysFor(other.id, keymap).filter((key) => !clash(key, keys))
    const mine = keysFor(command.id, keymap)
    const has = mine.some((key) => normalizeKeys(key) === normalizeKeys(keys))
    next[command.id] = has ? mine : [...mine.filter((key) => !clash(key, keys)), keys]
    setNotice(
      others.length > 0
        ? `${showKeys(keys)} was taken from “${others.map((other) => other.title).join('”, “')}”.`
        : null,
    )
    write(next)
  }

  function remove(command: CommandSpec, keys: string) {
    write({ ...overrides, [command.id]: keysFor(command.id, keymap).filter((key) => key !== keys) })
  }

  function reset(command: CommandSpec) {
    const next = { ...overrides }
    delete next[command.id]
    write(next)
  }

  return (
    <section className="settings-section">
      <h3>Keyboard</h3>
      <input
        className="settings-filter"
        placeholder="Find a command"
        aria-label="Find a command"
        value={filter}
        spellCheck={false}
        onChange={(event) => setFilter(event.target.value)}
      />
      {notice && <p className="settings-note settings-note--notice">{notice}</p>}
      <ul className="settings-keys">
        {shown.map((command) => {
          const keys = keysFor(command.id, keymap)
          const changed = command.id in keymap
          return (
            <li key={command.id} className="settings-key-row">
              <span className="settings-key-title">{command.title}</span>
              <span className="settings-key-chords">
                {keys.map((written) => (
                  <span key={written} className="settings-chip">
                    {showKeys(written)}
                    <button
                      type="button"
                      aria-label={`Remove ${showKeys(written)} from ${command.title}`}
                      onClick={() => remove(command, written)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <AddKeys onRecord={(recorded) => add(command, recorded)} />
                {changed && (
                  <button type="button" className="settings-link" onClick={() => reset(command)}>
                    Default
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AddKeys({ onRecord }: { onRecord: (keys: string) => void }) {
  const [listening, setListening] = useKeyListener(readWindowKey, onRecord)

  return (
    <button
      type="button"
      className={'settings-chip settings-chip--add' + (listening ? ' settings-chord--listening' : '')}
      aria-label="Add a key"
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
    >
      {listening ? 'Press a key…' : '+'}
    </button>
  )
}

function Recent({ current }: { current: Settings }) {
  return (
    <section className="settings-section">
      <h3>Recent files</h3>
      <Row label={`${current.recent.length} ${current.recent.length === 1 ? 'file' : 'files'} remembered`} hint="Shown on an empty window and first in Go to file">
        <button
          type="button"
          className="settings-button"
          disabled={current.recent.length === 0}
          onClick={() => change({ clearRecent: true })}
        >
          Clear the list
        </button>
      </Row>
    </section>
  )
}

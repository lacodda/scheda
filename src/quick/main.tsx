// The quick-note window: one field, one file, and back to whatever was in front.
//
// A page of its own rather than a mode of the main window: it has none of the
// editor, none of the panels, and has to be on screen the moment its key is
// pressed. What it does is small — take a few lines and hand them to the core,
// which appends them to the chosen file byte for byte (`inbox.rs`).
//
// It is hidden rather than closed when it goes, and what was typed but not
// added stays in the field: `Escape` is "not now", not "throw it away".
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { apply as applyAppearance } from '../appearance'
import type { Settings } from '../core'
import '../styles.css'
import './quick.css'
import { stampOf } from './stamp'

interface Target {
  path: string | null
  name: string | null
}

function QuickNote() {
  const [text, setText] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(() => {
    // Asked again every time the window comes up: the file may have been
    // chosen or changed in the settings since it was last here.
    void invoke<Target>('quick_note_target').then(setTarget, () => setTarget({ path: null, name: null }))
    void invoke<Settings>('load_settings').then(applyAppearance, () => {})
    field.current?.focus()
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const hide = () => void invoke('hide_quick_note')

  const add = async () => {
    if (text.trim() === '') {
      hide()
      return
    }
    try {
      await invoke<boolean>('append_quick_note', { text, stamp: stampOf(new Date()) })
      setText('')
      hide()
    } catch (error) {
      setProblem(typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error))
    }
  }

  const choose = async () => {
    const chosen = await invoke<string | null>('choose_quick_note_file').catch(() => null)
    if (chosen !== null) refresh()
    else field.current?.focus()
  }

  return (
    <div className="quick">
      <header className="quick-head">
        <span className="quick-title">Quick note</span>
        {target?.name ? (
          <span className="quick-target" title={target.path ?? undefined}>
            → {target.name}
          </span>
        ) : (
          <button type="button" className="quick-choose" onClick={() => void choose()}>
            Choose a file for quick notes…
          </button>
        )}
      </header>
      <textarea
        ref={field}
        className="quick-field"
        value={text}
        placeholder="A thought, a task, a link…"
        aria-label="Quick note"
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value)
          setProblem(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            hide()
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (target?.path) void add()
            else void choose()
          }
        }}
      />
      <footer className="quick-foot">
        {problem ? (
          <span className="quick-problem">{problem}</span>
        ) : (
          <span>
            <kbd>Enter</kbd> adds it · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>Esc</kbd> puts it away
          </span>
        )}
      </footer>
    </div>
  )
}

createRoot(document.getElementById('quick')!).render(
  <StrictMode>
    <QuickNote />
  </StrictMode>,
)

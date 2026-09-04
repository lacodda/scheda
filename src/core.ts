// The one door to the core. Nothing else in the frontend talks to Tauri, and
// nothing at all talks to the disk (ADR 0001).
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type LineEnding = 'lf' | 'crlf' | 'mixed'

/** Everything about a file that is not its characters. Opaque to the editor:
 *  it comes from the core and goes back untouched. */
export interface DocumentShape {
  line_ending: LineEnding
  bom: boolean
  mixed_endings?: LineEnding[]
}

export interface OpenFile {
  path: string
  text: string
  shape: DocumentShape
  readOnly: boolean
}

export interface CoreError {
  message: string
  read_only: boolean
}

/** The file the core read before the window existed, if the app was launched
 *  with one. Returns null for a bare launch. */
export function takePreloaded(): Promise<OpenFile | null> {
  return invoke<OpenFile | null>('take_preloaded')
}

export function openFile(path: string): Promise<OpenFile> {
  return invoke<OpenFile>('open_file', { path })
}

export function saveFile(path: string, text: string, shape: DocumentShape): Promise<void> {
  return invoke<void>('save_file', { path, text, shape })
}

/** Tells the core the first character is on screen. The startup gate reads
 *  this; without it the threshold is a guess. */
export function reportFirstPaint(): Promise<void> {
  return invoke<void>('report_first_paint')
}

export type Theme = 'system' | 'light' | 'dark'

/** Everything scheda remembers between runs. Kept in the application's own data
 *  directory — never in the folder the user opened (ADR 0003). */
export interface Settings {
  theme: Theme
  font_size: number
  column_width: number
  recent: string[]
}

export function loadSettings(): Promise<Settings> {
  return invoke<Settings>('load_settings')
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>('save_settings', { settings })
}

/** Records a file as most recently opened and returns the new list. The core
 *  owns the read-modify-write so two tabs opening at once cannot each write
 *  back a list that does not know about the other. */
export function rememberRecent(path: string): Promise<string[]> {
  return invoke<string[]>('remember_recent', { path })
}

export function forgetRecent(path: string): Promise<string[]> {
  return invoke<string[]>('forget_recent', { path })
}

/** A second launch handed the running window a file. The core has already read
 *  it, so what arrives is text, not a path to go and open. */
export function onFileHandedOver(handler: (file: OpenFile) => void): Promise<UnlistenFn> {
  return listen<OpenFile>('scheda://open-file', (event) => handler(event.payload))
}

/** A second launch could not read the file it was given. */
export function onHandoverFailed(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>('scheda://open-failed', (event) => handler(event.payload))
}

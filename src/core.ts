// The one door to the core. Nothing else in the frontend talks to Tauri, and
// nothing at all talks to the disk (ADR 0001).
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
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

/** Turns a link written in `document` into a URL the webview may load, or null
 *  if it does not point at a file inside the document's root.
 *
 *  The frontend does not resolve paths and does not decide what is inside the
 *  root — the core does both, and opens the asset scope while it is at it
 *  (ADR 0004). What comes back is a checked path; `convertFileSrc` only puts
 *  the protocol's host in front of it.
 */
export async function resolveAsset(document: string, link: string): Promise<string | null> {
  const path = await invoke<string | null>('resolve_asset', { document, link })
  return path === null ? null : convertFileSrc(path)
}

/** One entry in a vault's tree: a file, or a folder with its contents. */
export interface TreeEntry {
  name: string
  path: string
  /** Present on a folder, absent on a file — never both, so the two cannot
   *  blur into each other. */
  children?: TreeEntry[]
}

export interface Vault {
  root: string
  /** The folder's own name, which is what the panel calls the vault. */
  name: string
  entries: TreeEntry[]
}

/** The vault a document belongs to, with its files — or null when the document
 *  is not in one.
 *
 *  Null is the ordinary answer for a note opened on its own, and it is what
 *  keeps a notepad a notepad: no tree of the Desktop beside a Desktop file
 *  (decision 2026-09-05). */
export function readTree(document: string): Promise<Vault | null> {
  return invoke<Vault | null>('read_tree', { document })
}

/** Creates an empty note in a folder, and answers with its path. */
export function createFile(parent: string, name: string): Promise<string> {
  return invoke<string>('create_file', { parent, name })
}

export function createFolder(parent: string, name: string): Promise<string> {
  return invoke<string>('create_folder', { parent, name })
}

/** Where a renamed file ended up. */
export interface Moved {
  from: string
  to: string
}

/** Renames a file or folder. The answer is where it now is rather than what was
 *  asked for: a rename that only changes case, or one the filesystem adjusted,
 *  would otherwise leave a tab pointing at nothing. */
export function renameEntry(path: string, name: string): Promise<Moved> {
  return invoke<Moved>('rename_entry', { path, name })
}

/** Moves a file or folder to the operating system's recycle bin. Never an
 *  unlink: a misclick in a tree may not cost someone their writing. */
export function deleteEntry(path: string): Promise<void> {
  return invoke<void>('delete_entry', { path })
}

/** A picture that landed in the vault. */
export interface PastedImage {
  /** The link to write in the document, relative to it. */
  link: string
  path: string
}

/** Writes a pasted picture into the vault's attachment folder.
 *
 *  The bytes come from here because the clipboard belongs to the window, not to
 *  the process — it is the one thing the core cannot read for itself. Where the
 *  file goes and what it is called are still the core's answer (ADR 0001). */
export function pasteImage(
  document: string | null,
  extension: string,
  bytes: number[],
): Promise<PastedImage> {
  return invoke<PastedImage>('paste_image', { document, extension, bytes })
}

/** A draft with no file, kept where it survives a restart. */
export interface Draft {
  key: string
  text: string
}

/** Keeps an unsaved draft. Returns the key it is filed under, or null when the
 *  draft was empty and therefore not worth a file. */
export function keepDraft(key: string | null, text: string): Promise<string | null> {
  return invoke<string | null>('keep_draft', { key, text })
}

/** Forgets a draft — it was saved to a file, or closed on purpose. */
export function discardDraft(key: string): Promise<void> {
  return invoke<void>('discard_draft', { key })
}

/** The drafts left over from a previous run, oldest first. */
export function restoreDrafts(): Promise<Draft[]> {
  return invoke<Draft[]>('restore_drafts')
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
  /** Whether an opening bracket or quote types its closing partner. Off by
   *  default: in prose the guess is wrong more often than right. */
  close_brackets: boolean
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

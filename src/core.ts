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
  /** True when a process is blocked on this file — it was opened by
   *  `scheda --wait`, and closing the tab is what lets that process go. */
  awaited?: boolean
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

/** Reads a file again, for a tab whose file was written by somebody else.
 *
 *  The shape comes back with the text and replaces the tab's own: a note
 *  rewritten by a sync client may have arrived with different line endings, and
 *  saving it back in the shape it had *before* would rewrite every line of
 *  somebody else's file. */
export function rereadFile(path: string): Promise<OpenFile> {
  return invoke<OpenFile>('reread_file', { path })
}

/** Whether the file on disk still holds `text`.
 *
 *  Asked before the window says a word about an external change. A file
 *  rewritten with identical bytes — which is what a sync client does constantly
 *  — is not a change anybody wants to be told about, and an editor that asks
 *  "reload?" when nothing differs teaches people to dismiss the question
 *  without reading it. */
export function fileDiffers(path: string, text: string): Promise<boolean> {
  return invoke<boolean>('file_differs', { path, text })
}

/** Points the folder watcher at the vault of a document, or stops it when the
 *  document is not in one. */
export function watchVault(document: string | null): Promise<void> {
  return invoke<void>('watch_vault', { document })
}

/** What changed under the watched root, after a burst of filesystem events has
 *  settled. Paths are absolute. */
export interface VaultChanges {
  changed: string[]
  added: string[]
  removed: string[]
}

/** Somebody else wrote in the folder this window is looking at. */
export function onVaultChanged(handler: (changes: VaultChanges) => void): Promise<UnlistenFn> {
  return listen<VaultChanges>('scheda://vault-changed', (event) => handler(event.payload))
}

/** One row of the go-to-file list. */
export interface FileHit {
  path: string
  name: string
  /** The folders between the root and the file, joined with `/`. */
  folder: string
  /** Which characters of `name` matched, as indices. The row bolds these. */
  matched: number[]
}

/** The files in this document's vault that match `query`, best first.
 *
 *  Matched in the core, not here: the list of files is the core's, and shipping
 *  a few thousand paths across on every keystroke so this side can filter them
 *  is a round trip per character to answer a question the other side could
 *  answer once. */
export function findFiles(document: string, query: string): Promise<FileHit[]> {
  return invoke<FileHit[]>('find_files', { document, query })
}

/** Throws the picker's list away, so the next search reads the vault again. */
export function forgetFileIndex(): Promise<void> {
  return invoke<void>('forget_file_index')
}

/** The URL that opens a document in Obsidian, or null when it is not in a vault
 *  and Obsidian would have none to open it in. */
export function obsidianUrl(document: string): Promise<string | null> {
  return invoke<string | null>('obsidian_url', { document })
}

/** Lets every process waiting on this file go — the tab that was somebody's
 *  `$EDITOR` is closing. */
export function releaseWaiter(path: string): Promise<void> {
  return invoke<void>('release_waiter', { path })
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

/** Where a wikilink leads. */
export interface LinkTarget {
  /** The file it resolves to, or null when the vault holds no such note. */
  path: string | null
  /** What to write between the brackets for a link to this file, in the vault's
   *  own format. Filled only where the caller asked for one target. */
  target: string | null
}

/** Where a single wikilink written in `document` leads.
 *
 *  The target arrives as written — `folder/note` — with the alias and the
 *  heading already taken off: that split is the only part of a wikilink the
 *  window owns, because it is a question about the text on screen. Everything
 *  after it is Obsidian's resolution rules, which live in the core. */
export function resolveWikilink(document: string, target: string): Promise<LinkTarget> {
  return invoke<LinkTarget>('resolve_wikilink', { document, target })
}

/** Where several wikilinks lead, in one call.
 *
 *  One round trip for a note rather than one per link: a note of a hundred
 *  wikilinks is ordinary in a vault, and the core answers all of them from the
 *  one list it already holds. */
export function resolveWikilinks(document: string, targets: string[]): Promise<LinkTarget[]> {
  return invoke<LinkTarget[]>('resolve_wikilinks', { document, targets })
}

/** Creates the note a wikilink points at, and answers with its path.
 *
 *  Following a link to a note that is not there yet is how notes get written in
 *  a vault, not an error. Where the file lands is the vault's own setting unless
 *  the link named a folder itself. */
export function createFromWikilink(document: string, target: string): Promise<string> {
  return invoke<string>('create_from_wikilink', { document, target })
}

/** One note offered while a wikilink is being typed. */
export interface WikilinkCompletion {
  /** What to put between the brackets: the vault's own link format. */
  target: string
  name: string
  folder: string
  path: string
}

/** The notes a half-typed wikilink could be completed to, best first.
 *
 *  Ranked by the same scorer `Ctrl+P` uses, because it is the same question —
 *  "which file did you mean by these letters" — and a second ranking here would
 *  drift from the first. */
export function completeWikilink(
  document: string,
  query: string,
): Promise<WikilinkCompletion[]> {
  return invoke<WikilinkCompletion[]>('complete_wikilink', { document, query })
}

/** The headings of a note, for completing `[[note#` and for going to one. */
export function readHeadings(path: string): Promise<string[]> {
  return invoke<string[]>('read_headings', { path })
}

/** The opening of a note: what the hover card shows. */
export interface NotePeek {
  name: string
  text: string
}

/** The first lines of a note, or null when it cannot be read.
 *
 *  Short by design. The card is a glance at where a link goes — everything in it
 *  is also in the note it points at, so it is a shortcut rather than the only
 *  place anything appears. */
export function peekNote(path: string): Promise<NotePeek | null> {
  return invoke<NotePeek | null>('peek_note', { path })
}

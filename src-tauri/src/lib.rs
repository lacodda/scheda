//! The core. The webview never touches the disk: every read, write and path
//! question is a command here (ADR 0001).

#[cfg(windows)]
pub mod associations;
pub mod attachments;
pub mod document;
pub mod files;
pub mod links;
pub mod network;
pub mod notes;
pub mod obsidian;
pub mod quick;
pub mod rename;
pub mod root;
pub mod scratch;
mod settings;
pub mod startup;
pub mod tags;
pub mod tree;
pub mod vault;
pub mod wait;
pub mod watch;

use document::{Document, DocumentShape};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// A file the core has already read, waiting for the webview to ask for it.
///
/// The point of reading before the window exists is that the first frame can
/// carry text instead of waiting on a disk round trip after it. This is where
/// that text sits in between.
#[derive(Default)]
struct Preloaded(Mutex<Option<OpenFile>>);

/// A file as the editor sees it: the text, the shape to save it back with, and
/// where it came from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFile {
    pub path: String,
    pub text: String,
    pub shape: DocumentShape,
    /// True when the bytes could not be decoded as UTF-8. Such a file is shown
    /// but never written back (ADR 0002).
    pub read_only: bool,
    /// True when a process is blocked on this file, because it was opened by
    /// `scheda --wait`. The tab carries the flag and lets the waiter go when it
    /// closes; a tab without it is an ordinary tab.
    pub awaited: bool,
}

impl OpenFile {
    fn new(path: PathBuf, doc: Document) -> Self {
        Self {
            path: path.to_string_lossy().into_owned(),
            text: doc.text,
            shape: doc.shape,
            read_only: false,
            awaited: false,
        }
    }
}

/// A command failure the frontend can show. Anything the user can trigger by
/// pointing at the wrong file has to arrive as a message, not a panic.
#[derive(Debug, Serialize)]
pub struct CommandError {
    message: String,
    /// Set when the file is readable but not writable by us — the frontend
    /// opens it read-only rather than refusing it.
    read_only: bool,
}

impl From<document::DocumentError> for CommandError {
    fn from(error: document::DocumentError) -> Self {
        let read_only = matches!(error, document::DocumentError::NotUtf8);
        Self {
            message: error.to_string(),
            read_only,
        }
    }
}

/// Hands over the file the core read before the window opened, if there was
/// one. The frontend asks for this first and paints whatever comes back.
#[tauri::command]
fn take_preloaded(state: tauri::State<'_, Preloaded>) -> Option<OpenFile> {
    state.0.lock().expect("preload lock").take()
}

/// Reads a file the user chose while the app was already running.
#[tauri::command]
fn open_file(path: String) -> Result<OpenFile, CommandError> {
    let path = PathBuf::from(path);
    let doc = document::read(&path)?;
    Ok(OpenFile::new(path, doc))
}

/// Writes edited text back in the shape the file was read with.
#[tauri::command]
fn save_file(path: String, text: String, shape: DocumentShape) -> Result<(), CommandError> {
    document::write(&PathBuf::from(path), &text, &shape)?;
    Ok(())
}

/// Turns a link written in a document into a URL the webview may load.
///
/// The webview never resolves a path itself and never learns one it has not
/// been given (ADR 0004). This is the only door: the core finds the document's
/// root, checks the link stays inside it, opens the asset scope to that root,
/// and hands back a URL. A link that climbs out, points at an absolute path or
/// names something remote comes back as `None` — the picture simply does not
/// appear, which is the honest outcome for a link that does not point at the
/// vault.
///
/// Opening the scope here rather than at startup means it is opened for a root
/// the user actually opened a file in, and only then.
#[tauri::command]
fn resolve_asset(app: tauri::AppHandle, document: String, link: String) -> Option<String> {
    use tauri::Manager as _;
    let document = PathBuf::from(document);
    let root = root::for_file(&document);
    let target = root::resolve_link(&root, &document, &link).ok()?;

    // Allowing the root, not the file: a vault of notes referring to a shared
    // `assets/` folder would otherwise need one call per picture, and the
    // scope would grow a entry for every image ever displayed.
    if app
        .asset_protocol_scope()
        .allow_directory(&root, true)
        .is_err()
    {
        return None;
    }
    // The path, not a URL: turning it into one is `convertFileSrc` on the other
    // side, which knows the protocol's host for the platform it is running on.
    // What matters is that this path has already been checked.
    Some(target.to_string_lossy().into_owned())
}

/// The root a document belongs to, and the files in it — or nothing.
///
/// "Nothing" is the answer for a file that is not in a vault, and it is a
/// deliberate one (decision 2026-09-05): a note on the Desktop opens as a
/// notepad, without a tree of the Desktop beside it. A vault is recognised by
/// `.obsidian/`, the same rule the whole product hangs on (ADR 0003).
#[tauri::command]
fn read_tree(document: String) -> Option<Vault> {
    let document = PathBuf::from(document);
    let root = root::for_vault(&document)?;
    Some(Vault {
        root: root.to_string_lossy().into_owned(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        entries: tree::read(&root),
    })
}

/// A root and what is in it.
#[derive(Debug, Serialize)]
pub struct Vault {
    root: String,
    /// The folder's own name, which is what the panel calls the vault.
    name: String,
    entries: Vec<tree::Entry>,
}

impl From<files::FileError> for CommandError {
    fn from(error: files::FileError) -> Self {
        Self {
            message: error.to_string(),
            read_only: false,
        }
    }
}

impl From<scratch::ScratchError> for CommandError {
    fn from(error: scratch::ScratchError) -> Self {
        Self {
            message: error.to_string(),
            read_only: false,
        }
    }
}

/// Creates an empty note in a folder of the tree, and hands back its path.
#[tauri::command]
fn create_file(parent: String, name: String) -> Result<String, CommandError> {
    let path = files::create_file(Path::new(&parent), &name)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Creates a folder in the tree.
#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<String, CommandError> {
    let path = files::create_folder(Path::new(&parent), &name)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Renames a file or folder, returning where it now is.
///
/// The frontend needs the answer rather than assuming it: a rename that only
/// changes case, or one the filesystem adjusted, would otherwise leave a tab
/// pointing at a path that no longer names anything.
#[tauri::command]
fn rename_entry(path: String, name: String) -> Result<files::Moved, CommandError> {
    let from = PathBuf::from(&path);
    let to = files::rename(&from, &name)?;
    // A renamed document's pictures were resolved against its old path; the
    // frontend clears its own cache, and this is the moment it learns to.
    Ok(files::Moved {
        from: path,
        to: to.to_string_lossy().into_owned(),
    })
}

/// Moves a file or folder to the recycle bin.
#[tauri::command]
fn delete_entry(path: String) -> Result<(), CommandError> {
    files::delete(Path::new(&path))?;
    Ok(())
}

/// Writes a pasted picture into the vault's attachment folder and returns the
/// link to put in the document.
///
/// The bytes arrive from the webview — the clipboard is the one thing the core
/// cannot read for itself, since it belongs to the window rather than to the
/// process — but everything after that is the core's: where the folder is, what
/// the file is called, and creating it. The frontend receives a link, not a
/// path (ADR 0001).
#[tauri::command]
fn paste_image(
    document: Option<String>,
    extension: String,
    bytes: Vec<u8>,
) -> Result<PastedImage, CommandError> {
    // A picture pasted into an unsaved draft has nothing to be relative to. The
    // honest refusal is to say so rather than to invent a folder: the draft is
    // saved in a moment, and then the paste works.
    let Some(document) = document.map(PathBuf::from) else {
        return Err(CommandError {
            message: "save this draft to a file before pasting a picture into it".into(),
            read_only: false,
        });
    };

    let root = root::for_file(&document);
    let folder = vault::config_for(&root)
        .attachment_folder
        .resolve(&root, &document);
    std::fs::create_dir_all(&folder).map_err(|error| CommandError {
        message: format!(
            "the attachment folder “{}” could not be created: {error}",
            folder.display()
        ),
        read_only: false,
    })?;

    // The name Obsidian uses, so a vault read by both does not grow two
    // conventions: `Pasted image` plus the moment, and a counter when two
    // pastes land in the same second.
    let stem = format!("Pasted image {}", stamp());
    let target = files::free_name(&folder, &stem, &extension);
    std::fs::write(&target, &bytes).map_err(|error| CommandError {
        message: format!("the picture could not be written: {error}"),
        read_only: false,
    })?;

    Ok(PastedImage {
        link: attachments::link_from(&document, &target),
        path: target.to_string_lossy().into_owned(),
    })
}

/// A picture that landed in the vault: where it went, and how the document
/// should refer to it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastedImage {
    link: String,
    path: String,
}

/// `YYYYMMDDHHMMSS` in local time, the way Obsidian stamps a pasted picture.
///
/// Computed by hand rather than with a date crate: this is the only place a
/// calendar is needed, and a dependency for one format string is the trade the
/// line does not make.
fn stamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, seconds) = (now / 86_400, now % 86_400);
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}{month:02}{day:02}{:02}{:02}{:02}",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

/// Days since the epoch as a calendar date (Howard Hinnant's `civil_from_days`).
///
/// UTC, not local time: a timezone needs the platform's database, and the stamp
/// is a name for a file rather than a record of when anything happened. A
/// picture named an hour off is still the picture you just pasted.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Keeps an unsaved draft where it will survive a restart.
#[tauri::command]
fn keep_draft(key: Option<String>, text: String) -> Result<Option<String>, CommandError> {
    Ok(scratch::keep(key, &text)?)
}

/// Forgets a draft — it was saved to a file, or closed on purpose.
#[tauri::command]
fn discard_draft(key: String) -> Result<(), CommandError> {
    scratch::discard(&key)?;
    Ok(())
}

/// The drafts left over from a previous run.
#[tauri::command]
fn restore_drafts() -> Result<Vec<scratch::Draft>, CommandError> {
    Ok(scratch::restore()?)
}

/// Records that the frontend has painted the first character.
#[tauri::command]
fn report_first_paint() {
    startup::log("first paint", startup::elapsed_ms());
}

impl From<settings::SettingsError> for CommandError {
    fn from(error: settings::SettingsError) -> Self {
        Self {
            message: error.to_string(),
            read_only: false,
        }
    }
}

/// Everything scheda remembers between runs.
#[tauri::command]
fn load_settings() -> Result<settings::Settings, CommandError> {
    Ok(settings::load()?)
}

/// Replaces the stored settings wholesale.
#[tauri::command]
fn save_settings(settings: settings::Settings) -> Result<(), CommandError> {
    settings::save(&settings)?;
    Ok(())
}

/// Records a file as most recently opened.
///
/// Kept in the core rather than done by the frontend reading and writing the
/// whole settings object: two tabs opening at once would otherwise each write
/// back a list that does not know about the other.
#[tauri::command]
fn remember_recent(path: String) -> Result<Vec<String>, CommandError> {
    let mut current = settings::load()?;
    current.remember(&path);
    settings::save(&current)?;
    Ok(current.recent)
}

/// Drops a path from the recent list — for a file that has gone.
#[tauri::command]
fn forget_recent(path: String) -> Result<Vec<String>, CommandError> {
    let mut current = settings::load()?;
    current.forget(&path);
    settings::save(&current)?;
    Ok(current.recent)
}

/// Points the folder watcher at the vault of a document, so edits made
/// somewhere else reach the window.
///
/// Called by the window as tabs change rather than once at startup: the watch
/// follows what is on screen, and a window showing a note that is not in a
/// vault watches nothing at all. Starting it here rather than in `run` also
/// keeps the promise about ordering — nothing that is not the text happens
/// before the text is on screen (ADR 0001).
#[tauri::command]
fn watch_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, watch::Watch>,
    document: Option<String>,
) -> Result<(), CommandError> {
    let Some(root) = document
        .map(PathBuf::from)
        .as_deref()
        .and_then(root::for_vault)
    else {
        // No vault, nothing to watch. Stopping rather than leaving the previous
        // watch running: a tab switched to a lone note should not go on
        // reporting changes in a folder the window is no longer showing.
        state.stop();
        return Ok(());
    };

    state
        .point_at(&root, move |changes| {
            let _ = app.emit(watch::CHANGED_EVENT, changes);
        })
        .map_err(|error| CommandError {
            message: format!("this folder cannot be watched for changes: {error}"),
            read_only: false,
        })
}

/// Re-reads a file that changed under an open tab.
///
/// A plain read, but through its own name so the window's intent is legible and
/// so the shape comes back with it: a file rewritten by a sync client may have
/// arrived with different line endings, and saving it back with the shape it
/// had *before* would rewrite every line of somebody else's file.
#[tauri::command]
fn reread_file(path: String) -> Result<OpenFile, CommandError> {
    open_file(path)
}

/// Whether the file at `path` still holds the text the tab was last in step
/// with.
///
/// Asked before the window says a word about an external change. A file
/// rewritten with identical bytes — which is what a sync client does constantly,
/// and what saving in another editor without typing does — is not a change
/// anybody wants to be told about, and an editor that asks "reload?" when
/// nothing differs teaches people to dismiss the question without reading it.
#[tauri::command]
fn file_differs(path: String, text: String) -> Result<bool, CommandError> {
    match document::read(Path::new(&path)) {
        Ok(doc) => Ok(doc.text != text),
        // Unreadable now means it differs from anything we are holding; the
        // window finds out what actually happened when it tries to re-read.
        Err(_) => Ok(true),
    }
}

/// Everything the picker needs to find a file by name, for the vault a document
/// belongs to.
///
/// The whole list, once, rather than a query per keystroke: the matching is the
/// core's (`quick`), and the window asks it through [`find_files`] without the
/// paths ever crossing the boundary.
#[tauri::command]
fn find_files(
    state: tauri::State<'_, VaultIndex>,
    document: String,
    query: String,
) -> Vec<quick::Hit> {
    with_index(&state, &PathBuf::from(document), |index| {
        quick::search(&index.picker, &query)
    })
    .unwrap_or_default()
}

/// Throws the vault's file list away, so the next question reads it again.
///
/// Called when the watcher says the vault changed. Without it, a note created in
/// Obsidian is invisible to `Ctrl+P` and to every wikilink pointing at it until
/// the window is restarted.
#[tauri::command]
fn forget_file_index(state: tauri::State<'_, VaultIndex>) {
    *state.0.lock().expect("index lock") = None;
}

/// The vault's files, flattened the two ways they are asked about.
///
/// One cache, not two. The picker and the wikilinks both want "every file in
/// this vault", and reading the tree twice for the two of them would mean two
/// directory walks, two moments of staleness and two things for the watcher to
/// remember to invalidate.
#[derive(Default)]
struct VaultIndex(Mutex<Option<Index>>);

struct Index {
    root: PathBuf,
    /// The vault's own settings, read with the tree. They live in a file the
    /// user edits in Obsidian rather than here, so they are dropped and re-read
    /// whenever the list is — which the watcher already does on any change under
    /// the root, `.obsidian/` included.
    config: vault::VaultConfig,
    picker: Vec<quick::Candidate>,
    links: Vec<links::Candidate>,
}

/// Runs `job` against the index for a document's vault, reading the vault if
/// this is the first question about it.
///
/// `None` when the document is not in a vault: wikilinks and the picker are both
/// vault features, and a lone note on the Desktop has no vault for them to
/// search (decision 2026-09-05).
fn with_index<T>(
    state: &tauri::State<'_, VaultIndex>,
    document: &Path,
    job: impl FnOnce(&Index) -> T,
) -> Option<T> {
    let root = root::for_vault(document)?;
    let mut held = state.0.lock().expect("index lock");

    // Read once per root and kept: a vault of a few thousand notes is a
    // directory walk, and doing one per keystroke or per link would make the
    // feature slower the more there is to find.
    let fresh = !matches!(held.as_ref(), Some(index) if index.root == root);
    if fresh {
        let entries = tree::read(&root);
        *held = Some(Index {
            config: vault::config_for(&root),
            picker: quick::candidates(&root, &entries),
            links: links::candidates(&root, &entries),
            root,
        });
    }
    Some(job(held.as_ref().expect("just filled")))
}

/// What a wikilink points at.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    /// The file it resolves to, or null when the vault holds no such note.
    path: Option<String>,
    /// What to write in the document for a link to this file — filled only when
    /// the target resolved, and used by the completion rather than by the click.
    target: Option<String>,
}

/// Where a wikilink written in `document` leads.
///
/// The target arrives as written — `folder/note`, with the alias and the heading
/// already taken off by the window, which is the only part of a wikilink that is
/// the window's business. What comes back is a path or nothing; the rules that
/// decide which are Obsidian's and live in `links`.
#[tauri::command]
fn resolve_wikilink(
    state: tauri::State<'_, VaultIndex>,
    document: String,
    target: String,
) -> LinkTarget {
    let document = PathBuf::from(document);
    with_index(&state, &document, |index| {
        let path = links::resolve(&index.links, &target);
        LinkTarget {
            target: path.as_ref().map(|found| {
                links::target_for(&index.config, &index.links, &index.root, &document, found)
            }),
            path: path.map(|found| found.to_string_lossy().into_owned()),
        }
    })
    .unwrap_or(LinkTarget {
        path: None,
        target: None,
    })
}

/// Resolves several wikilinks in one call.
///
/// One round trip for a note rather than one per link. A note of a hundred
/// wikilinks is ordinary in a vault, and a hundred calls to answer a question the
/// core answers from one list is the round-trip-per-item shape this product keeps
/// refusing (the same reason `quick` matches in the core).
#[tauri::command]
fn resolve_wikilinks(
    state: tauri::State<'_, VaultIndex>,
    document: String,
    targets: Vec<String>,
) -> Vec<LinkTarget> {
    let document = PathBuf::from(document);
    with_index(&state, &document, |index| {
        targets
            .iter()
            .map(|target| {
                let path = links::resolve(&index.links, target);
                LinkTarget {
                    target: None,
                    path: path.map(|found| found.to_string_lossy().into_owned()),
                }
            })
            .collect()
    })
    .unwrap_or_else(|| {
        targets
            .iter()
            .map(|_| LinkTarget {
                path: None,
                target: None,
            })
            .collect()
    })
}

/// Creates the note a wikilink points at, and answers with its path.
///
/// Called when somebody follows a link to a note that is not there yet — which
/// is how notes get written in a vault, not an error. Where the file goes is the
/// vault's answer (`newFileLocation`) unless the link itself named a folder, in
/// which case the person already said where.
#[tauri::command]
fn create_from_wikilink(
    state: tauri::State<'_, VaultIndex>,
    document: String,
    target: String,
) -> Result<String, CommandError> {
    let document = PathBuf::from(document);
    let refusal = || CommandError {
        message: format!("“{target}” is not a name this vault can hold"),
        read_only: false,
    };

    let path = with_index(&state, &document, |index| {
        links::file_for_missing(&index.config, &index.root, &document, &target)
    })
    .ok_or_else(|| CommandError {
        message: "this note is not in a vault, so there is nowhere to put a new one".into(),
        read_only: false,
    })?
    .ok_or_else(refusal)?;

    // The folders the target named, if any. `create_dir_all` rather than a
    // refusal: `[[projects/2027/plan]]` in a vault with no `2027` yet is a
    // person saying where the note goes, not a mistake.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| CommandError {
            message: format!("“{}” could not be created: {error}", parent.display()),
            read_only: false,
        })?;
    }

    // Only if it is not there. The resolver said the vault holds no such note,
    // but a note may have appeared since — from a sync client, or from the
    // person creating it in Obsidian — and truncating it would cost writing.
    if !path.is_file() {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| CommandError {
                message: format!("“{}” could not be created: {error}", path.display()),
                read_only: false,
            })?;
    }

    // The list the resolver reads is now a file out of date. Dropped rather than
    // amended: the watcher is about to say the same thing, and one way of going
    // stale is easier to reason about than two.
    *state.0.lock().expect("index lock") = None;

    Ok(path.to_string_lossy().into_owned())
}

/// What points at this note, and what it points at in vain.
///
/// One call for both, because both are answered by the same walk over the
/// vault's notes and asking twice would read every file twice. Empty when the
/// document is not in a vault: a lone note on the Desktop has no vault whose
/// links could point at it, which is the same answer the picker and the
/// wikilinks give (decision 2026-09-05).
#[tauri::command]
fn read_network(state: tauri::State<'_, VaultIndex>, document: String) -> network::Network {
    let document = PathBuf::from(document);
    with_index(&state, &document, |index| {
        network::around(&index.root, &index.links, &document)
    })
    .unwrap_or_default()
}

/// Every tag in the vault, most-used first, with the notes carrying each.
///
/// Read on the same terms as the network: the vault's notes are read when the
/// panel is opened and again when the watcher says something changed, rather
/// than kept in an index that would be a second truth about a folder Obsidian
/// also writes to (`tags.rs`). The candidate list is the one the index already
/// holds, so the directory walk is not repeated for this panel.
///
/// Empty when the document is not in a vault: a lone note on the Desktop has no
/// vault whose tags could be collected, which is the same answer the picker, the
/// wikilinks and the network give (decision 2026-09-05).
#[tauri::command]
fn read_tags(state: tauri::State<'_, VaultIndex>, document: String) -> Vec<tags::Tag> {
    let document = PathBuf::from(document);
    with_index(&state, &document, |index| {
        tags::read(&index.root, &index.links)
    })
    .unwrap_or_default()
}

/// What renaming a file would change, without changing any of it.
///
/// The dry run. Nothing on disk is touched by this call — it reads the vault's
/// notes, works out which links would break, and answers with the list. The
/// window shows it, and only a second call performs it.
#[tauri::command]
fn plan_rename(
    state: tauri::State<'_, VaultIndex>,
    path: String,
    name: String,
) -> Result<rename::Plan, CommandError> {
    let from = PathBuf::from(&path);
    // The name is checked here rather than at the write: a plan for a name the
    // filesystem will refuse is a plan the person would approve and then watch
    // fail.
    files::check_name(&name)?;
    let parent = from.parent().ok_or_else(|| CommandError {
        message: "that file has nowhere to be renamed in".into(),
        read_only: false,
    })?;
    let to = parent.join(name.trim());

    with_index(&state, &from, |index| {
        rename::plan(&index.config, &index.links, &index.root, &from, &to)
    })
    .ok_or_else(|| CommandError {
        message: "this file is not in a vault, so there are no links to follow".into(),
        read_only: false,
    })
}

/// Performs a plan: moves the file, then rewrites the links.
///
/// The plan comes back from the window rather than being recomputed here, so
/// what is performed is what was shown. It is recomputed against each file's
/// text at the moment of writing all the same — a note that changed between the
/// showing and the doing is skipped rather than spliced at offsets that no
/// longer mean anything.
#[tauri::command]
fn apply_rename(
    state: tauri::State<'_, VaultIndex>,
    plan: rename::Plan,
) -> Result<rename::Applied, CommandError> {
    let applied = rename::apply(&plan)?;
    // The vault's file list now names a file that has moved, and every link
    // answer in it was computed against the old name.
    *state.0.lock().expect("index lock") = None;
    // Held so the window can undo it with a word rather than a second plan.
    *LAST_RENAME.lock().expect("rename lock") = Some(applied.clone());
    Ok(applied)
}

/// Puts back the last rename: the files' exact bytes, then the name.
///
/// The window offers this while the tab is alive, which is what "undo" means
/// for something that touched other people's files: an offer with a horizon,
/// not a stack. What is put back is the bytes that were read before the write,
/// so the undo is a restore rather than a second rewrite that has to be right
/// about a vault that has moved on.
#[tauri::command]
fn undo_rename(
    state: tauri::State<'_, VaultIndex>,
) -> Result<Option<rename::Applied>, CommandError> {
    let held = LAST_RENAME.lock().expect("rename lock").take();
    let Some(applied) = held else {
        return Ok(None);
    };
    rename::undo(&applied)?;
    *state.0.lock().expect("index lock") = None;
    Ok(Some(applied))
}

/// The rename that may still be undone.
///
/// One, not a stack. Undoing a rename means putting back the bytes that were
/// read before it, and those are only the right bytes while nothing else has
/// been written over them — which a second rename may well have done. A single
/// slot says exactly what is true: the last one, until something else happens.
static LAST_RENAME: std::sync::Mutex<Option<rename::Applied>> = std::sync::Mutex::new(None);

impl From<rename::RenameError> for CommandError {
    fn from(error: rename::RenameError) -> Self {
        Self {
            message: error.to_string(),
            read_only: false,
        }
    }
}

/// The notes a wikilink could be completed to, for what has been typed so far.
///
/// Ranked by the picker's own scorer, because the question is the same one:
/// "which file did you mean by these letters". A separate ranking here would be
/// a second answer to it, and the two would drift.
#[tauri::command]
fn complete_wikilink(
    state: tauri::State<'_, VaultIndex>,
    document: String,
    query: String,
) -> Vec<WikilinkCompletion> {
    let document = PathBuf::from(document);
    with_index(&state, &document, |index| {
        quick::search(&index.picker, &query)
            .into_iter()
            .filter_map(|hit| {
                let path = PathBuf::from(&hit.path);
                // A note links to itself with `[[#heading]]`, not by name, and
                // offering the open note as a completion of its own link is an
                // offer nobody takes.
                if path == document {
                    return None;
                }
                Some(WikilinkCompletion {
                    target: links::target_for(
                        &index.config,
                        &index.links,
                        &index.root,
                        &document,
                        &path,
                    ),
                    name: hit.name,
                    folder: hit.folder,
                    path: hit.path,
                })
            })
            .collect()
    })
    .unwrap_or_default()
}

/// One note offered while a wikilink is being typed.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikilinkCompletion {
    /// What to put between the brackets: the vault's own link format.
    target: String,
    /// The file's name, which is what the row leads with.
    name: String,
    /// The folders above it — the dimmer half of the row.
    folder: String,
    path: String,
}

/// The headings of a note, for completing `[[note#` and for following a link
/// into one.
#[tauri::command]
fn read_headings(path: String) -> Vec<String> {
    let Ok(doc) = document::read(Path::new(&path)) else {
        return Vec::new();
    };
    notes::headings_in(&doc.text)
}

/// The first lines of a note, for the card that appears when a link is hovered.
///
/// Short on purpose: the card is a glance at where a link goes, and a card
/// holding a whole note is the note, read in a box that cannot be scrolled. Front
/// matter comes off — it is the note's machinery, not its opening.
#[tauri::command]
fn peek_note(path: String) -> Option<NotePeek> {
    let doc = document::read(Path::new(&path)).ok()?;
    Some(NotePeek {
        text: notes::opening_of(&doc.text),
        name: Path::new(&path)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default(),
    })
}

/// The opening of a note: what the card shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePeek {
    name: String,
    text: String,
}

/// The URL that opens a document in Obsidian, or nothing when it is not in a
/// vault and Obsidian would have no vault to open it in.
#[tauri::command]
fn obsidian_url(document: String) -> Option<String> {
    let document = PathBuf::from(document);
    let root = root::for_vault(&document)?;
    obsidian::open_url(&root, &document)
}

/// Lets every process waiting on this file go.
///
/// Called when a tab opened by `scheda --wait` closes. The path is the tab's
/// own, and `wait::release` turns it into a name in scheda's own directory —
/// nothing from here becomes a path to delete.
#[tauri::command]
fn release_waiter(path: String) -> Result<(), CommandError> {
    wait::release(Path::new(&path)).map_err(|error| CommandError {
        message: error.to_string(),
        read_only: false,
    })?;
    Ok(())
}

pub fn run() {
    startup::mark_process_start();

    // The installer calls these; they do their work and exit without ever
    // creating a window. Checked before anything else so a registration run
    // costs nothing beyond the registry writes.
    #[cfg(windows)]
    if let Some(code) = handle_registration_flags() {
        std::process::exit(code);
    }

    let invocation = wait::parse(std::env::args().skip(1));

    // `--wait` puts this process in a different job entirely: it starts a
    // scheda that is not waiting, and then does nothing but watch for the tab
    // to close. It never builds a window of its own — see `wait` for why that
    // separation is the only arrangement that survives being the second launch.
    if invocation.wait {
        let code = match invocation.file.as_deref() {
            // Resolved before anything is derived from it: the caller may have
            // typed a relative path, and the window will be comparing against
            // what the filesystem returned.
            Some(path) => {
                let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
                wait::run_as_waiter(&path)
            }
            // Nothing to wait for. Opening a window would be reasonable, but
            // the caller is blocked on this process and would stay blocked
            // until somebody closed it — for a file they never named.
            None => {
                eprintln!("scheda --wait needs a file to wait for");
                1
            }
        };
        std::process::exit(code);
    }

    // Read the file before anything else exists. A window that opens with the
    // text already in hand is the whole point of the ordering (ADR 0001); a
    // window that opens and then asks for a file has already lost the frame.
    let preloaded = invocation
        .file
        .as_deref()
        .filter(|path| path.is_file())
        .and_then(|path| match document::read(path) {
            Ok(doc) => {
                let mut file = OpenFile::new(path.to_path_buf(), doc);
                // Asked of the disk rather than of the command line: the
                // process that is waiting started this one *without* the flag,
                // so the sentinel is the only evidence a promise was made.
                file.awaited = wait::is_awaited(path);
                Some(file)
            }
            // A file we cannot decode still opens — read-only, with its bytes
            // shown as best we can — rather than starting to an empty window.
            Err(document::DocumentError::NotUtf8) => None,
            Err(_) => None,
        });
    startup::log("file read", startup::elapsed_ms());

    tauri::Builder::default()
        // First, before anything else registers: a second launch has to hand
        // its file to the running window and get out of the way, not build a
        // second one. Everything below this line belongs to the first instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let handover = wait::parse(argv.iter().skip(1).cloned());

            let Some(path) = handover.file.filter(|p| p.is_file()) else {
                // A bare second launch means "show me the window I have".
                focus_main_window(app);
                return;
            };
            let path = std::fs::canonicalize(&path).unwrap_or(path);

            // The core reads it, the way it reads the first one — the webview
            // is handed text, never a path to open for itself (ADR 0001).
            match document::read(&path) {
                Ok(doc) => {
                    let mut file = OpenFile::new(path.clone(), doc);
                    // The sentinel, not the command line: whoever is waiting
                    // started this launch without the flag.
                    file.awaited = wait::is_awaited(&path);
                    let _ = app.emit(OPEN_FILE_EVENT, file);
                }
                Err(error) => {
                    // Unreadable. Anybody blocked on it is let go now rather
                    // than left waiting for a tab that will never exist.
                    let _ = wait::release(&path);
                    let _ = app.emit(OPEN_FAILED_EVENT, error.to_string());
                }
            }
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        // The dialog only ever returns a path; reading and writing it stays in
        // the core, so the webview still never touches the disk.
        .plugin(tauri_plugin_dialog::init())
        .manage(Preloaded(Mutex::new(preloaded)))
        .manage(watch::Watch::default())
        .manage(VaultIndex::default())
        .invoke_handler(tauri::generate_handler![
            take_preloaded,
            open_file,
            save_file,
            reread_file,
            file_differs,
            watch_vault,
            find_files,
            forget_file_index,
            read_network,
            plan_rename,
            apply_rename,
            undo_rename,
            resolve_wikilink,
            resolve_wikilinks,
            create_from_wikilink,
            complete_wikilink,
            read_headings,
            peek_note,
            obsidian_url,
            release_waiter,
            resolve_asset,
            read_tree,
            create_file,
            create_folder,
            rename_entry,
            delete_entry,
            paste_image,
            keep_draft,
            discard_draft,
            restore_drafts,
            report_first_paint,
            read_tags,
            load_settings,
            save_settings,
            remember_recent,
            forget_recent
        ])
        .run(tauri::generate_context!())
        .expect("scheda failed to start");
}

/// The event a second launch uses to hand its file to the running window.
const OPEN_FILE_EVENT: &str = "scheda://open-file";

/// The event for a second launch whose file could not be read.
const OPEN_FAILED_EVENT: &str = "scheda://open-failed";

/// Brings the running window forward, since the user just asked for it by
/// launching the application again.
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Handles `--register` and `--unregister`, returning the exit code when one of
/// them was asked for.
///
/// These exist for the installer, which is why they are flags rather than a
/// visible feature: a notepad has no business showing the user a registry
/// screen, and the shell registration has to happen at install and uninstall
/// time regardless of whether the app is ever launched.
#[cfg(windows)]
fn handle_registration_flags() -> Option<i32> {
    let flag = std::env::args().nth(1)?;
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            eprintln!("cannot locate the running executable: {error}");
            return Some(1);
        }
    };

    let result = match flag.as_str() {
        "--register" => associations::register(&exe),
        "--unregister" => associations::unregister(),
        _ => return None,
    };

    match result {
        Ok(()) => Some(0),
        Err(error) => {
            eprintln!("{error}");
            Some(1)
        }
    }
}

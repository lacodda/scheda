//! The core. The webview never touches the disk: every read, write and path
//! question is a command here (ADR 0001).

#[cfg(windows)]
pub mod associations;
pub mod attachments;
pub mod document;
pub mod files;
pub mod obsidian;
pub mod quick;
pub mod root;
pub mod scratch;
mod settings;
pub mod startup;
pub mod tree;
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
    let folder = attachments::folder_for(&root).resolve(&root, &document);
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
    state: tauri::State<'_, QuickIndex>,
    document: String,
    query: String,
) -> Vec<quick::Hit> {
    let document = PathBuf::from(document);
    let Some(root) = root::for_vault(&document) else {
        return Vec::new();
    };

    let mut held = state.0.lock().expect("index lock");
    // Read once per root and kept: a vault of a few thousand notes is a
    // directory walk, and doing one on every keystroke would make the picker
    // slower the more there is to find.
    let index = match held.as_ref() {
        Some(index) if index.root == root => index,
        _ => {
            let entries = tree::read(&root);
            *held = Some(Index {
                candidates: quick::candidates(&root, &entries),
                root,
            });
            held.as_ref().expect("just filled")
        }
    };

    quick::search(&index.candidates, &query)
}

/// Throws the picker's list away, so the next search reads the vault again.
///
/// Called when the watcher says the vault changed. Without it, a note created
/// in Obsidian is invisible to `Ctrl+P` until the window is restarted — which
/// is exactly the staleness this whole version is about.
#[tauri::command]
fn forget_file_index(state: tauri::State<'_, QuickIndex>) {
    *state.0.lock().expect("index lock") = None;
}

/// The picker's flattened view of one vault.
#[derive(Default)]
struct QuickIndex(Mutex<Option<Index>>);

struct Index {
    root: PathBuf,
    candidates: Vec<quick::Candidate>,
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
        .manage(QuickIndex::default())
        .invoke_handler(tauri::generate_handler![
            take_preloaded,
            open_file,
            save_file,
            reread_file,
            file_differs,
            watch_vault,
            find_files,
            forget_file_index,
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

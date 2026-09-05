//! The core. The webview never touches the disk: every read, write and path
//! question is a command here (ADR 0001).

#[cfg(windows)]
pub mod associations;
pub mod document;
pub mod root;
mod settings;
pub mod startup;
mod tree;

use document::{Document, DocumentShape};
use serde::Serialize;
use std::path::PathBuf;
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
}

impl OpenFile {
    fn new(path: PathBuf, doc: Document) -> Self {
        Self {
            path: path.to_string_lossy().into_owned(),
            text: doc.text,
            shape: doc.shape,
            read_only: false,
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

pub fn run() {
    startup::mark_process_start();

    // The installer calls these; they do their work and exit without ever
    // creating a window. Checked before anything else so a registration run
    // costs nothing beyond the registry writes.
    #[cfg(windows)]
    if let Some(code) = handle_registration_flags() {
        std::process::exit(code);
    }

    // Read the file before anything else exists. A window that opens with the
    // text already in hand is the whole point of the ordering (ADR 0001); a
    // window that opens and then asks for a file has already lost the frame.
    let preloaded = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .and_then(|path| match document::read(&path) {
            Ok(doc) => Some(OpenFile::new(path, doc)),
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
            let Some(path) = argv.get(1).map(PathBuf::from).filter(|p| p.is_file()) else {
                // A bare second launch means "show me the window I have".
                focus_main_window(app);
                return;
            };

            // The core reads it, the way it reads the first one — the webview
            // is handed text, never a path to open for itself (ADR 0001).
            match document::read(&path) {
                Ok(doc) => {
                    let file = OpenFile::new(path, doc);
                    let _ = app.emit(OPEN_FILE_EVENT, file);
                }
                Err(error) => {
                    let _ = app.emit(OPEN_FAILED_EVENT, error.to_string());
                }
            }
            focus_main_window(app);
        }))
        // The dialog only ever returns a path; reading and writing it stays in
        // the core, so the webview still never touches the disk.
        .plugin(tauri_plugin_dialog::init())
        .manage(Preloaded(Mutex::new(preloaded)))
        .invoke_handler(tauri::generate_handler![
            take_preloaded,
            open_file,
            save_file,
            resolve_asset,
            read_tree,
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

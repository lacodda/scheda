//! The core. The webview never touches the disk: every read, write and path
//! question is a command here (ADR 0001).

#[cfg(windows)]
pub mod associations;
pub mod document;
pub mod startup;

use document::{Document, DocumentShape};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

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

/// Records that the frontend has painted the first character.
#[tauri::command]
fn report_first_paint() {
    startup::log("first paint", startup::elapsed_ms());
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
        // The dialog only ever returns a path; reading and writing it stays in
        // the core, so the webview still never touches the disk.
        .plugin(tauri_plugin_dialog::init())
        .manage(Preloaded(Mutex::new(preloaded)))
        .invoke_handler(tauri::generate_handler![
            take_preloaded,
            open_file,
            save_file,
            report_first_paint
        ])
        .run(tauri::generate_context!())
        .expect("scheda failed to start");
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

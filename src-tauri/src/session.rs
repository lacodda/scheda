//! What the window had open, so the next launch can put it back.
//!
//! Kept beside the settings in the application's own directory and never in a
//! vault (ADR 0003): which notes somebody had open is a fact about their
//! window, not about their notes, and it would be the first thing to show up
//! uninvited in a synced or committed folder.
//!
//! One file for the one window. The tabs of a window can come from several
//! vaults at once, so a session filed under a vault's root would have to be
//! split across roots and put back together — for a window that is only ever
//! one.
//!
//! The window writes it whole, a moment after anything in it settles and once
//! more as it closes. It is a few hundred bytes, and a session lost to a crash
//! is worth more than the writes it takes to keep it.
//!
//! Positions are counted in the editor's own units (UTF-16 code units from the
//! start of the text) and are only ever handed back to the editor; the core
//! stores them without reading anything into them. A file that changed since is
//! the window's to clamp, because only the window knows how long it now is.
//!
//! The folders the window opened are kept here too, and they are the core's
//! half of the file: the window says which tabs it has, the core says which
//! folders, and only the core writes the two together (`Kept`). The core has
//! to hold them anyway — every question about a root asks them (`root.rs`) —
//! and a window writing back a list it was told would be a second copy of it.
//!
//! The format is frozen and numbered like the settings' (ADR 0016).

use crate::root;
use crate::stored::{self, Found, Kind};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The session file's formats. 0 is everything before formats were numbered
/// (up to 0.14), already in the shape 1 froze; 2 (0.19) adds the folders.
pub const FORMAT: Kind = Kind {
    name: "session",
    first: 0,
    current: 2,
    steps: &[stored::numbered, without_folders],
    pretty: true,
};

/// Format 1 to 2: no build before 0.19 could open a folder, so a window from
/// then had none open.
fn without_folders(fields: &mut Map<String, Value>) {
    fields.insert("folder".into(), Value::Null);
    fields.insert("roots".into(), Value::Array(Vec::new()));
}

/// One tab as it was left.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionTab {
    /// The file it showed, or `None` for a draft.
    pub path: Option<String>,
    /// The key a draft is filed under, for a tab with no file. The text is the
    /// draft's own file; the session only says where in the strip it stood.
    pub draft: Option<String>,
    /// Pinned tabs stand first and survive "close all".
    pub pinned: bool,
    /// The selection: where it started and where the caret is.
    pub anchor: u32,
    pub head: u32,
    /// The position at the top of the view: what the person was looking at,
    /// which after scrolling is often not where the caret is.
    pub top: u32,
}

/// The whole window.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Session {
    /// In strip order.
    pub tabs: Vec<SessionTab>,
    /// Which tab was in front of the pane that had the keyboard.
    pub active: Option<usize>,
    /// The tab in the second pane, when the window was split.
    pub beside: Option<usize>,
    /// Which pane had the keyboard: 0 for the first, 1 for the second.
    pub focused: u8,
    /// The folder the window has open, if one is: what the tree shows when
    /// the note in front is in no vault, or there is no note in front.
    pub folder: Option<String>,
    /// Every folder opened explicitly that the window still uses — the open
    /// folder, and any other one a tab is in. A root to `root::for_vault` as
    /// much as a folder holding `.obsidian/` is. Most recently opened first.
    pub roots: Vec<String>,
}

impl Session {
    /// The file to read before the window exists, for a launch that was not
    /// given one: the tab that was in front. Nothing for a draft — its text is
    /// in the draft folder, and the window reads that itself.
    pub fn front_file(&self) -> Option<PathBuf> {
        let index = self.active?;
        let path = self.tabs.get(index)?.path.as_ref()?;
        Some(PathBuf::from(path))
    }

    /// The folders opened explicitly, for the root rule to ask.
    pub fn opened(&self) -> Vec<PathBuf> {
        self.roots.iter().map(PathBuf::from).collect()
    }

    /// Opens a folder: it becomes the window's, and a root first in line.
    pub fn open_folder(&mut self, folder: &Path) {
        let spelled = folder.to_string_lossy().into_owned();
        self.roots
            .retain(|root| !root::same_file(Path::new(root), folder));
        self.roots.insert(0, spelled.clone());
        self.folder = Some(spelled);
    }

    /// Closes the window's folder. It stays a root while a tab is in it: a
    /// note open from it still means what it meant a moment ago.
    pub fn close_folder(&mut self) {
        self.folder = None;
    }

    /// Takes what the window says it has open, keeping the folders.
    ///
    /// The only moment a root is let go of. Opening or closing a folder could
    /// prune as well, but the tabs this side knows are the ones the window
    /// last wrote, a second or more behind it: a note opened from one folder
    /// just before another was opened would lose its root to a list that had
    /// not heard of it yet.
    pub fn take_window(&mut self, window: Session) {
        self.tabs = window.tabs;
        self.active = window.active;
        self.beside = window.beside;
        self.focused = window.focused;
        self.keep_used();
    }

    /// Lets go of every root the window no longer uses: one that is not the
    /// open folder and holds no tab. Without this the list would only grow,
    /// and a folder opened once a year ago would still decide where links in
    /// a note beside it lead.
    fn keep_used(&mut self) {
        let folder = self.folder.clone();
        let tabs: Vec<PathBuf> = self
            .tabs
            .iter()
            .filter_map(|tab| tab.path.as_deref().map(PathBuf::from))
            .collect();
        self.roots.retain(|root| {
            let root = Path::new(root);
            folder
                .as_deref()
                .is_some_and(|folder| root::same_file(Path::new(folder), root))
                || tabs.iter().any(|tab| root::is_within(tab, root))
        });
    }
}

/// The session as the core holds it between writes: read from disk the first
/// time anything asks, and written whole whenever either half changes.
///
/// Read lazily rather than at startup, because a launch with a file reads that
/// file and nothing else before the first frame (ADR 0001); the first question
/// about a root comes from the window, after it.
pub struct Kept {
    file: Option<PathBuf>,
    held: Mutex<Option<Session>>,
}

impl Kept {
    /// The session in the application's directory, or in memory only on a
    /// machine without one.
    pub fn new() -> Self {
        Self::at(file_path().ok())
    }

    pub fn at(file: Option<PathBuf>) -> Self {
        Self {
            file,
            held: Mutex::new(None),
        }
    }

    fn with<T>(&self, job: impl FnOnce(&mut Session) -> T) -> T {
        let mut held = self
            .held
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let session =
            held.get_or_insert_with(|| self.file.as_deref().map(load_from).unwrap_or_default());
        job(session)
    }

    /// Changes the session and writes it, under one lock so two changes
    /// cannot each write a file that lacks the other.
    fn change(&self, job: impl FnOnce(&mut Session)) -> Result<(), SessionError> {
        self.with(|session| {
            job(session);
            match &self.file {
                Some(file) => save_to(file, session),
                None => Ok(()),
            }
        })
    }

    /// The whole session, as the window restores it.
    pub fn session(&self) -> Session {
        self.with(|session| session.clone())
    }

    /// The folders opened explicitly.
    pub fn opened(&self) -> Vec<PathBuf> {
        self.with(|session| session.opened())
    }

    /// The vault a document belongs to, with the folders opened explicitly
    /// among the roots.
    pub fn vault_for(&self, document: &Path) -> Option<PathBuf> {
        root::for_vault(document, &self.opened())
    }

    /// The root a document's pictures and links are read from.
    pub fn root_for(&self, document: &Path) -> PathBuf {
        root::for_file(document, &self.opened())
    }

    /// The vault the window is looking at: the one the note in front is in,
    /// or the window's folder when that note is in none — or when there is no
    /// note in front at all. What the tree shows, and what going to a file,
    /// searching and the tags are about.
    pub fn in_front(&self, document: Option<&Path>) -> Option<PathBuf> {
        self.with(|session| {
            document
                .and_then(|document| root::for_vault(document, &session.opened()))
                .or_else(|| session.folder.as_deref().map(PathBuf::from))
        })
    }

    pub fn open_folder(&self, folder: &Path) -> Result<(), SessionError> {
        self.change(|session| session.open_folder(folder))
    }

    pub fn close_folder(&self) -> Result<(), SessionError> {
        self.change(Session::close_folder)
    }

    pub fn save_window(&self, window: Session) -> Result<(), SessionError> {
        self.change(|session| session.take_window(window))
    }
}

impl Default for Kept {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error(transparent)]
    Write(#[from] stored::WriteError),
    #[error("{0}")]
    Settings(#[from] crate::settings::SettingsError),
}

fn file_path() -> Result<PathBuf, SessionError> {
    Ok(crate::settings::directory()?.join("session.json"))
}

/// Reads the session. A missing file is a first run and an empty session; an
/// unreadable one is also an empty session, because a window that will not
/// open over a file of tab positions has its priorities backwards — but the
/// file is left where it is for anybody who wants to look.
pub fn load() -> Session {
    file_path().map(|path| load_from(&path)).unwrap_or_default()
}

fn load_from(path: &Path) -> Session {
    match stored::read(path, &FORMAT) {
        Ok(Found::Read(session)) => session,
        Ok(Found::Newer { value, .. }) => value.unwrap_or_default(),
        Ok(Found::Missing) | Err(_) => Session::default(),
    }
}

/// Writes the session whole.
///
/// Not over a session a newer scheda left: that window's tabs come back when
/// that version runs again, and this one starts from what it read.
fn save_to(path: &Path, session: &Session) -> Result<(), SessionError> {
    match stored::write(path, &FORMAT, session) {
        Ok(()) | Err(stored::WriteError::Newer { .. }) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_front_file_is_the_active_tab_when_it_has_one() {
        let session = Session {
            tabs: vec![
                SessionTab {
                    path: Some("/a.md".into()),
                    ..Default::default()
                },
                SessionTab {
                    draft: Some("1-0".into()),
                    ..Default::default()
                },
            ],
            active: Some(0),
            ..Default::default()
        };
        assert_eq!(session.front_file(), Some(PathBuf::from("/a.md")));

        // A draft in front has no file to read early; the window reads the
        // draft folder itself.
        let draft_in_front = Session {
            active: Some(1),
            ..session.clone()
        };
        assert_eq!(draft_in_front.front_file(), None);

        // An index that points past the list is not a panic at startup.
        let stale = Session {
            active: Some(9),
            ..session
        };
        assert_eq!(stale.front_file(), None);
    }

    #[test]
    fn a_session_round_trips_and_tolerates_what_it_does_not_know() {
        let session = Session {
            tabs: vec![SessionTab {
                path: Some("/a.md".into()),
                pinned: true,
                anchor: 3,
                head: 7,
                top: 1,
                ..Default::default()
            }],
            active: Some(0),
            beside: None,
            focused: 0,
            folder: Some("/notes".into()),
            roots: vec!["/notes".into()],
        };
        let text = serde_json::to_string(&session).expect("serialises");
        let back: Session = serde_json::from_str(&text).expect("parses");
        assert_eq!(back, session);

        // A newer version's field is ignored, a missing one takes its default.
        let newer: Session =
            serde_json::from_str(r#"{"tabs":[{"path":"/b.md","colour":"red"}],"active":0}"#)
                .expect("parses");
        assert_eq!(newer.tabs[0].path.as_deref(), Some("/b.md"));
        assert!(!newer.tabs[0].pinned);
    }

    #[test]
    fn a_session_from_before_formats_is_read_and_a_newer_one_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        std::fs::write(&path, r#"{"tabs":[{"path":"/a.md","head":4}],"active":0}"#).unwrap();
        let session = load_from(&path);
        assert_eq!(session.front_file(), Some(PathBuf::from("/a.md")));
        assert_eq!(session.tabs[0].head, 4);

        let newer = r#"{"format":3,"tabs":[{"path":"/b.md"}],"active":0,"windows":[]}"#;
        std::fs::write(&path, newer).unwrap();
        assert_eq!(load_from(&path).front_file(), Some(PathBuf::from("/b.md")));
        save_to(&path, &Session::default()).expect("a refused write is not an error");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), newer);
    }

    fn tab(path: &str) -> SessionTab {
        SessionTab {
            path: Some(path.into()),
            ..Default::default()
        }
    }

    fn window(paths: &[&str]) -> Session {
        Session {
            tabs: paths.iter().map(|path| tab(path)).collect(),
            active: Some(0),
            ..Default::default()
        }
    }

    #[test]
    fn a_folder_opened_again_moves_to_the_front_rather_than_in_twice() {
        let mut session = Session::default();
        session.open_folder(Path::new("/notes"));
        session.open_folder(Path::new("/work"));
        session.take_window(window(&["/notes/a.md"]));
        session.open_folder(Path::new("/notes"));
        assert_eq!(session.folder.as_deref(), Some("/notes"));
        assert_eq!(session.roots, vec!["/notes".to_string(), "/work".into()]);
    }

    #[test]
    fn a_root_stays_while_a_tab_is_in_it_and_goes_after() {
        let mut session = Session::default();
        session.open_folder(Path::new("/notes"));
        session.open_folder(Path::new("/work"));
        session.take_window(window(&["/notes/a.md", "/elsewhere/b.md"]));
        // `/notes` holds a tab, `/work` is the folder: both stay.
        assert_eq!(session.roots, vec!["/work".to_string(), "/notes".into()]);

        // The folder closed with a tab in it is still that tab's root.
        session.take_window(window(&["/notes/a.md", "/work/c.md"]));
        session.close_folder();
        assert_eq!(session.folder, None);
        assert_eq!(session.roots, vec!["/work".to_string(), "/notes".into()]);

        // And goes with the last tab in it.
        session.take_window(window(&["/elsewhere/b.md"]));
        assert!(session.roots.is_empty(), "{:?}", session.roots);
    }

    #[test]
    fn a_folder_whose_name_starts_another_does_not_hold_its_tabs() {
        let mut session = Session::default();
        session.open_folder(Path::new("/notes"));
        session.open_folder(Path::new("/work"));
        session.take_window(window(&["/notes-old/a.md"]));
        assert_eq!(session.roots, vec!["/work".to_string()]);
    }

    #[test]
    fn the_core_keeps_its_half_when_the_window_writes_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("session.json");
        let folder = dir.path().join("notes");
        let note = folder.join("a.md");
        let note_text = note.to_string_lossy().into_owned();

        let kept = Kept::at(Some(file.clone()));
        kept.open_folder(&folder).unwrap();
        // The window knows nothing of folders and says nothing about them.
        kept.save_window(window(&[&note_text])).unwrap();

        let again = Kept::at(Some(file.clone()));
        let session = again.session();
        assert_eq!(session.folder, Some(folder.to_string_lossy().into_owned()));
        assert_eq!(session.front_file(), Some(note.clone()));
        assert_eq!(again.vault_for(&note), Some(folder.clone()));
        assert_eq!(again.root_for(&note), folder);

        // Written in the format the file says it is in.
        let written = std::fs::read_to_string(&file).unwrap();
        assert!(written.starts_with("{\n  \"format\": 2,"), "{written}");
    }

    #[test]
    fn the_vault_in_front_falls_back_to_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("notes");
        let vault = dir.path().join("vault");
        std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        let kept = Kept::at(None);

        // Nothing open, nothing in front.
        assert_eq!(kept.in_front(None), None);
        assert_eq!(
            kept.in_front(Some(&vault.join("a.md"))),
            Some(vault.clone())
        );

        kept.open_folder(&folder).unwrap();
        assert_eq!(kept.in_front(None), Some(folder.clone()));
        // A lone note in front: the window is still looking at its folder.
        let lone = dir.path().join("desktop").join("b.md");
        assert_eq!(kept.in_front(Some(&lone)), Some(folder.clone()));
        // A note in a vault: the vault it is in.
        assert_eq!(kept.in_front(Some(&vault.join("a.md"))), Some(vault));

        kept.close_folder().unwrap();
        assert_eq!(kept.in_front(None), None);
    }
}

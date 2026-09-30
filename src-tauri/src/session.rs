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

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("the session file is not valid JSON: {0}")]
    Malformed(#[from] serde_json::Error),
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
    let Ok(path) = file_path() else {
        return Session::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes the session whole.
pub fn save(session: &Session) -> Result<(), SessionError> {
    let path = file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(session)?;
    crate::settings::write_atomically(&path, text.as_bytes())?;
    Ok(())
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
}

//! What scheda remembers between runs, and where it keeps it.
//!
//! Never in the folder you opened. The settings and the recent-files list live
//! in the application's own data directory, so a vault stays exactly as its
//! owner left it (ADR 0003) — no stray file to commit, sync or explain.
//!
//! The file is written whole on every change. It is a few hundred bytes and
//! changes when a person does something, so nothing here is worth the machinery
//! that would make partial writes safe.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// How many paths the recent list keeps.
///
/// Long enough to hold a working week of files, short enough that the list is
/// still something you can look at rather than search.
const RECENT_LIMIT: usize = 12;

/// The look of the editor, as far as the settings are concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    /// Follow the operating system, which is what a notepad should do unasked.
    #[default]
    System,
    Light,
    Dark,
}

/// Everything the application remembers.
///
/// Every field has a default, and unknown fields are ignored on read: a
/// settings file written by a newer version has to open in an older one without
/// taking the window with it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: Theme,
    /// Editor font size in pixels.
    pub font_size: u16,
    /// The width of the reading column, in `rem`. Zero means the full window.
    pub column_width: f32,
    /// Recently opened files, most recent first.
    pub recent: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            font_size: 15,
            column_width: 46.0,
            recent: Vec::new(),
        }
    }
}

impl Settings {
    /// Records a file as most recently opened, moving it up if it was already
    /// there rather than letting the list fill with the same path.
    pub fn remember(&mut self, path: &str) {
        self.recent.retain(|existing| existing != path);
        self.recent.insert(0, path.to_string());
        self.recent.truncate(RECENT_LIMIT);
    }

    /// Drops a path from the list — for a file that has gone.
    pub fn forget(&mut self, path: &str) {
        self.recent.retain(|existing| existing != path);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("the settings file is not valid JSON: {0}")]
    Malformed(#[from] serde_json::Error),
    #[error("this platform has no application data directory")]
    NoDataDirectory,
}

/// Where the settings file lives: `%APPDATA%\scheda` on Windows, the
/// XDG config directory elsewhere.
pub fn directory() -> Result<PathBuf, SettingsError> {
    dirs::config_dir()
        .map(|base| base.join("scheda"))
        .ok_or(SettingsError::NoDataDirectory)
}

fn file_path() -> Result<PathBuf, SettingsError> {
    Ok(directory()?.join("settings.json"))
}

/// Reads the settings, falling back to the defaults.
///
/// A missing file is the normal first run. A *corrupt* one is not silently
/// replaced: it is left on disk and reported, because the alternative is
/// throwing away a file someone may have been editing by hand.
pub fn load() -> Result<Settings, SettingsError> {
    let path = file_path()?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(error.into()),
    }
}

/// Writes the settings, creating the directory on first use.
pub fn save(settings: &Settings) -> Result<(), SettingsError> {
    let path = file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(settings)?;
    write_atomically(&path, text.as_bytes())?;
    Ok(())
}

/// Writes through a temporary file in the same directory, then renames.
///
/// A settings file truncated by a crash mid-write reads as corrupt on the next
/// launch, and the user loses their recent list to a power cut. The rename is
/// atomic on both platforms that matter.
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let settings = Settings::default();
        assert_eq!(settings.theme, Theme::System);
        assert!(settings.recent.is_empty());
        assert!(settings.font_size > 0);
    }

    #[test]
    fn remembering_moves_a_repeat_to_the_front() {
        let mut settings = Settings::default();
        settings.remember("/a.md");
        settings.remember("/b.md");
        settings.remember("/a.md");

        assert_eq!(settings.recent, vec!["/a.md", "/b.md"]);
    }

    #[test]
    fn the_recent_list_has_a_ceiling() {
        let mut settings = Settings::default();
        for index in 0..RECENT_LIMIT + 5 {
            settings.remember(&format!("/{index}.md"));
        }
        assert_eq!(settings.recent.len(), RECENT_LIMIT);
        // The newest survives, the oldest falls off.
        assert_eq!(settings.recent[0], format!("/{}.md", RECENT_LIMIT + 4));
    }

    #[test]
    fn forgetting_removes_only_that_path() {
        let mut settings = Settings::default();
        settings.remember("/a.md");
        settings.remember("/b.md");
        settings.forget("/a.md");

        assert_eq!(settings.recent, vec!["/b.md"]);
    }

    #[test]
    fn a_file_from_a_newer_version_still_opens() {
        // Unknown fields are ignored and missing ones take their defaults;
        // otherwise a settings file written by a newer scheda would take the
        // window down on an older one.
        let json = r#"{"theme":"dark","somethingNew":42}"#;
        let settings: Settings = serde_json::from_str(json).expect("should parse");
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.font_size, Settings::default().font_size);
    }

    #[test]
    fn settings_round_trip_through_json() {
        let mut settings = Settings {
            theme: Theme::Light,
            font_size: 18,
            ..Default::default()
        };
        settings.remember("/notes.md");

        let text = serde_json::to_string(&settings).expect("serialises");
        let back: Settings = serde_json::from_str(&text).expect("parses");

        assert_eq!(back.theme, Theme::Light);
        assert_eq!(back.font_size, 18);
        assert_eq!(back.recent, vec!["/notes.md"]);
    }
}

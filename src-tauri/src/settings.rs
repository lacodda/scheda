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
use std::collections::BTreeMap;
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
    /// Whether typing an opening bracket or quote inserts its closing partner.
    ///
    /// Off by default. In prose the guess is wrong more often than it is right
    /// — an apostrophe in "don't" is not an opening quote — and a notepad that
    /// types characters nobody asked for is worse than one that does not.
    pub close_brackets: bool,
    /// Whether the system spell checker underlines misspelt words.
    ///
    /// Off by default: a note full of code, paths and names is a note full of
    /// red lines, and a notepad should not greet its first file that way.
    pub spellcheck: bool,
    /// Whether a named file is written a moment after typing stops.
    ///
    /// Off by default: a notepad that writes to somebody's file without being
    /// told is a surprise the first time, and `Ctrl+S` is what every person who
    /// opens a `.md` file already knows.
    pub autosave: bool,
    /// Shortcuts the person changed, by command id. A command absent from the
    /// map keeps its default; an empty list means "no key at all". Only the
    /// changes are kept, so a default that moves in a later version reaches
    /// everybody who never touched it.
    pub keys: BTreeMap<String, Vec<String>>,
    /// The file a quick note is added to. `None` until the person picks one:
    /// writing somewhere they never chose is creating a file behind their back.
    pub quick_note_file: Option<String>,
    /// The system-wide shortcut that brings up the quick-note window, in the
    /// window's own key notation (`Win+Shift+N`). Empty turns it off.
    pub quick_note_key: String,
}

/// The shortcut a quick note starts with. `Win` rather than `Ctrl+Alt`: on a
/// keyboard where `AltGr` types letters, `AltGr` *is* `Ctrl+Alt`, and a
/// system-wide `Ctrl+Alt+N` would take `ń` away from every program at once.
pub const DEFAULT_QUICK_NOTE_KEY: &str = "Win+Shift+N";

/// The range a font size is held to. Below it the text is not readable, above
/// it a line holds three words.
const FONT_SIZES: std::ops::RangeInclusive<u16> = 10..=32;

/// The range a reading column is held to, in `rem`; zero is the full window.
const COLUMN_WIDTHS: std::ops::RangeInclusive<f32> = 24.0..=120.0;

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            font_size: 15,
            column_width: 46.0,
            recent: Vec::new(),
            close_brackets: false,
            spellcheck: false,
            autosave: false,
            keys: BTreeMap::new(),
            quick_note_file: None,
            quick_note_key: DEFAULT_QUICK_NOTE_KEY.to_string(),
        }
    }
}

/// A change to some of the settings, as the settings screen sends it.
///
/// Every field is optional and only the present ones are applied. The core does
/// the read-modify-write rather than the window writing the whole file back:
/// the recent list is written by every file that opens, and a window saving a
/// copy of the settings it read a minute ago would put that list back the way
/// it was.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub font_size: Option<u16>,
    pub column_width: Option<f32>,
    pub close_brackets: Option<bool>,
    pub spellcheck: Option<bool>,
    pub autosave: Option<bool>,
    /// Replaces the whole map: the screen always sends every change it holds.
    pub keys: Option<BTreeMap<String, Vec<String>>>,
    /// `Some(None)` clears the file; an absent field leaves it alone.
    #[serde(deserialize_with = "present")]
    pub quick_note_file: Option<Option<String>>,
    pub quick_note_key: Option<String>,
    /// `Some(true)` empties the recent list.
    pub clear_recent: Option<bool>,
}

/// Tells an explicit `null` apart from a missing field: the first clears the
/// setting, the second leaves it as it is.
fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

impl Settings {
    /// Applies a patch, holding every number to a range that still makes a
    /// usable window. A value outside it is brought to the nearest end rather
    /// than refused: the person dragged a control too far, not wrongly.
    pub fn apply(&mut self, patch: SettingsPatch) {
        if let Some(theme) = patch.theme {
            self.theme = theme;
        }
        if let Some(size) = patch.font_size {
            self.font_size = size.clamp(*FONT_SIZES.start(), *FONT_SIZES.end());
        }
        if let Some(width) = patch.column_width {
            self.column_width = if width.is_finite() && width > 0.0 {
                width.clamp(*COLUMN_WIDTHS.start(), *COLUMN_WIDTHS.end())
            } else {
                0.0
            };
        }
        if let Some(on) = patch.close_brackets {
            self.close_brackets = on;
        }
        if let Some(on) = patch.spellcheck {
            self.spellcheck = on;
        }
        if let Some(on) = patch.autosave {
            self.autosave = on;
        }
        if let Some(keys) = patch.keys {
            self.keys = keys;
        }
        if let Some(file) = patch.quick_note_file {
            self.quick_note_file = file.filter(|path| !path.trim().is_empty());
        }
        if let Some(key) = patch.quick_note_key {
            self.quick_note_key = key.trim().to_string();
        }
        if patch.clear_recent == Some(true) {
            self.recent.clear();
        }
    }

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

/// Reads the settings, changes them and writes them back, as one step.
///
/// Held under a lock: the recent list is written by every file that opens, the
/// settings screen writes whatever it changed, and two of those interleaved
/// would each write back a file that does not know about the other.
pub fn modify(change: impl FnOnce(&mut Settings)) -> Result<Settings, SettingsError> {
    static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _held = WRITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut current = load()?;
    change(&mut current);
    save(&current)?;
    Ok(current)
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
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
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
    fn a_patch_changes_only_what_it_names() {
        let mut settings = Settings::default();
        settings.remember("/kept.md");
        let patch: SettingsPatch =
            serde_json::from_str(r#"{"autosave":true,"theme":"dark"}"#).expect("parses");
        settings.apply(patch);

        assert!(settings.autosave);
        assert_eq!(settings.theme, Theme::Dark);
        // The recent list is the core's to write, and a patch that did not
        // name it leaves it exactly as it was.
        assert_eq!(settings.recent, vec!["/kept.md"]);
        assert_eq!(settings.font_size, Settings::default().font_size);
    }

    #[test]
    fn numbers_are_held_to_a_usable_window() {
        let mut settings = Settings::default();
        settings.apply(SettingsPatch {
            font_size: Some(400),
            column_width: Some(3.0),
            ..Default::default()
        });
        assert_eq!(settings.font_size, 32);
        assert_eq!(settings.column_width, 24.0);

        settings.apply(SettingsPatch {
            font_size: Some(1),
            column_width: Some(0.0),
            ..Default::default()
        });
        assert_eq!(settings.font_size, 10);
        // Zero is not too narrow: it is the full window.
        assert_eq!(settings.column_width, 0.0);
    }

    #[test]
    fn null_clears_the_quick_note_file_and_absence_keeps_it() {
        let mut settings = Settings::default();
        settings.apply(serde_json::from_str(r#"{"quick_note_file":"/inbox.md"}"#).expect("parses"));
        assert_eq!(settings.quick_note_file.as_deref(), Some("/inbox.md"));

        settings.apply(serde_json::from_str(r#"{"autosave":true}"#).expect("parses"));
        assert_eq!(settings.quick_note_file.as_deref(), Some("/inbox.md"));

        settings.apply(serde_json::from_str(r#"{"quick_note_file":null}"#).expect("parses"));
        assert_eq!(settings.quick_note_file, None);
    }

    #[test]
    fn clearing_the_recent_list_empties_it() {
        let mut settings = Settings::default();
        settings.remember("/a.md");
        settings.apply(SettingsPatch {
            clear_recent: Some(true),
            ..Default::default()
        });
        assert!(settings.recent.is_empty());
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

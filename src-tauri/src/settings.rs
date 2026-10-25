//! What scheda remembers between runs, and where it keeps it.
//!
//! Never in the folder you opened. The settings and the recent-files list live
//! in the application's own data directory, so a vault stays exactly as its
//! owner left it (ADR 0003) — no stray file to commit, sync or explain.
//!
//! The file is written whole on every change. It is a few hundred bytes and
//! changes when a person does something, so nothing here is worth the machinery
//! that would make partial writes safe.
//!
//! Its format is frozen and numbered (ADR 0016): reading and writing go through
//! `stored`, which brings an older file up to date and never writes over one a
//! newer scheda left.

use crate::stored::{self, Found, Kind};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The settings file's formats.
///
/// 0 is everything before formats were numbered (up to 0.14), with its fields
/// in snake case and a system-wide key recorded as `Shift+Win+N`; 1 spells the
/// fields the way the session and the index do, and every chord with `Win`
/// first, as the window writes it; 2 writes the window's keys in the line's
/// notation, dowel's (`Mod+Shift+P`, `Mod+{`), from 0.17.
pub const FORMAT: Kind = Kind {
    name: "settings",
    first: 0,
    current: 2,
    steps: &[to_format_1, to_format_2],
    pretty: true,
};

/// Format 0 to 1: the same fields in camel case, the same chords in one order.
fn to_format_1(fields: &mut Map<String, Value>) {
    const RENAMED: [(&str, &str); 5] = [
        ("font_size", "fontSize"),
        ("column_width", "columnWidth"),
        ("close_brackets", "closeBrackets"),
        ("quick_note_file", "quickNoteFile"),
        ("quick_note_key", "quickNoteKey"),
    ];
    for (old, new) in RENAMED {
        if let Some(value) = fields.remove(old) {
            fields.insert(new.to_string(), value);
        }
    }
    let reorder = |chord: &mut Value| {
        if let Value::String(text) = chord {
            *text = in_order(text);
        }
    };
    if let Some(key) = fields.get_mut("quickNoteKey") {
        reorder(key);
    }
    if let Some(Value::Object(keys)) = fields.get_mut("keys") {
        for list in keys.values_mut() {
            if let Value::Array(list) = list {
                list.iter_mut().for_each(reorder);
            }
        }
    }
}

/// A chord with its modifiers in the window's one order: `Win`, `Ctrl`,
/// `Alt`, `Shift`, then the key. Anything else is left where it stood.
fn in_order(chord: &str) -> String {
    let Some((modifiers, key)) = chord.rsplit_once('+') else {
        return chord.to_string();
    };
    let rank = |modifier: &str| {
        ["Win", "Ctrl", "Alt", "Shift"]
            .iter()
            .position(|known| *known == modifier)
            .unwrap_or(4)
    };
    let mut modifiers: Vec<&str> = modifiers.split('+').collect();
    modifiers.sort_by_key(|modifier| rank(modifier));
    modifiers.push(key);
    modifiers.join("+")
}

/// Format 1 to 2: the window's keys in dowel's notation.
///
/// Format 1 wrote `Ctrl` for the command key - Cmd on a Mac arrived as `Ctrl`
/// too - and punctuation by the key it is on, Shift and all. dowel writes
/// `Mod` for that key, and a character as the character typed, so Shift goes
/// into it: `Ctrl+Shift+[` is `Mod+{`. The system-wide quick-note key is not a
/// key of the window and keeps its own notation, `Win` included.
fn to_format_2(fields: &mut Map<String, Value>) {
    if let Some(Value::Object(keys)) = fields.get_mut("keys") {
        for list in keys.values_mut() {
            if let Value::Array(list) = list {
                // A chord holding `Win` never answered in the window - the
                // window read Win as Ctrl - and has no spelling in dowel's
                // notation, where the Windows key belongs to the system.
                list.retain_mut(|chord| match chord {
                    Value::String(text) => match in_line_notation(text) {
                        Some(written) => {
                            *text = written;
                            true
                        }
                        None => false,
                    },
                    _ => false,
                });
            }
        }
    }
}

/// What a US keyboard types on a punctuation key with Shift held, and on the
/// number row without a command modifier: the character dowel writes in place
/// of `Shift+` and the key.
const SHIFTED: [(&str, &str); 21] = [
    ("[", "{"),
    ("]", "}"),
    (";", ":"),
    ("'", "\""),
    (",", "<"),
    (".", ">"),
    ("/", "?"),
    ("\\", "|"),
    ("`", "~"),
    ("-", "_"),
    ("=", "+"),
    ("1", "!"),
    ("2", "@"),
    ("3", "#"),
    ("4", "$"),
    ("5", "%"),
    ("6", "^"),
    ("7", "&"),
    ("8", "*"),
    ("9", "("),
    ("0", ")"),
];

/// A format-1 chord of the window in dowel's notation, or `None` for one that
/// has no spelling there.
fn in_line_notation(chord: &str) -> Option<String> {
    let (modifiers, key) = match chord.rsplit_once('+') {
        // `Ctrl++` was never written - `=` is the key - but a key that is
        // itself `+` would split here the wrong way round.
        Some((modifiers, "")) => (modifiers.strip_suffix('+')?, "+"),
        Some((modifiers, key)) => (modifiers, key),
        None => ("", chord),
    };
    let held: Vec<&str> = modifiers
        .split('+')
        .filter(|part| !part.is_empty())
        .collect();
    if held.contains(&"Win") {
        return None;
    }
    let command = held.contains(&"Ctrl") || held.contains(&"Alt");
    let mut shift = held.contains(&"Shift");
    let mut key = match key {
        "Up" => "ArrowUp".to_string(),
        "Down" => "ArrowDown".to_string(),
        "Left" => "ArrowLeft".to_string(),
        "Right" => "ArrowRight".to_string(),
        other => other.to_string(),
    };
    // The number row under a command modifier is read by its place, Shift and
    // all; anywhere else a digit or a punctuation mark is the character typed.
    let digit = key.len() == 1 && key.as_bytes()[0].is_ascii_digit();
    if shift
        && !(digit && command)
        && let Some((_, typed)) = SHIFTED.iter().find(|(plain, _)| *plain == key)
    {
        key = (*typed).to_string();
        shift = false;
    }

    let mut parts: Vec<&str> = Vec::new();
    if held.contains(&"Ctrl") {
        parts.push("Mod");
    }
    if held.contains(&"Alt") {
        parts.push("Alt");
    }
    if shift {
        parts.push("Shift");
    }
    parts.push(&key);
    Some(parts.join("+"))
}

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
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
#[serde(default, rename_all = "camelCase")]
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
    #[error(transparent)]
    Read(#[from] stored::ReadError),
    #[error(transparent)]
    Write(#[from] stored::WriteError),
    #[error("this platform has no application data directory")]
    NoDataDirectory,
}

/// Where the settings file lives: `%APPDATA%\scheda` on Windows, the
/// XDG config directory elsewhere, or `SCHEDA_HOME` (see `home`).
pub fn directory() -> Result<PathBuf, SettingsError> {
    crate::home::config().ok_or(SettingsError::NoDataDirectory)
}

fn file_path() -> Result<PathBuf, SettingsError> {
    Ok(directory()?.join("settings.json"))
}

/// The settings while the file on disk belongs to a newer scheda. Changes are
/// made to this copy and last as long as the process: the newer file is not
/// this version's to write.
static HELD: Mutex<Option<(PathBuf, Settings)>> = Mutex::new(None);

fn held(path: &Path) -> Option<Settings> {
    let held = HELD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    held.as_ref()
        .filter(|(at, _)| at == path)
        .map(|(_, settings)| settings.clone())
}

fn hold(path: &Path, settings: Settings) {
    let mut held = HELD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *held = Some((path.to_path_buf(), settings));
}

/// Reads the settings, falling back to the defaults.
///
/// A missing file is the normal first run. A *corrupt* one is not silently
/// replaced: it is left on disk and reported, because the alternative is
/// throwing away a file someone may have been editing by hand.
pub fn load() -> Result<Settings, SettingsError> {
    load_from(&file_path()?)
}

fn load_from(path: &Path) -> Result<Settings, SettingsError> {
    if let Some(settings) = held(path) {
        return Ok(settings);
    }
    Ok(match stored::read(path, &FORMAT)? {
        Found::Missing => Settings::default(),
        Found::Read(settings) => settings,
        Found::Newer { value, .. } => value.unwrap_or_default(),
    })
}

/// Reads the settings, changes them and writes them back, as one step.
///
/// Held under a lock: the recent list is written by every file that opens, the
/// settings screen writes whatever it changed, and two of those interleaved
/// would each write back a file that does not know about the other.
pub fn modify(change: impl FnOnce(&mut Settings)) -> Result<Settings, SettingsError> {
    modify_at(&file_path()?, change)
}

fn modify_at(path: &Path, change: impl FnOnce(&mut Settings)) -> Result<Settings, SettingsError> {
    static WRITING: Mutex<()> = Mutex::new(());
    let _held = WRITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut current = load_from(path)?;
    change(&mut current);
    match stored::write(path, &FORMAT, &current) {
        Ok(()) => {}
        // The change still happens, for as long as this process runs; the
        // settings screen says it will not outlive it.
        Err(stored::WriteError::Newer { .. }) => hold(path, current.clone()),
        Err(error) => return Err(error.into()),
    }
    Ok(current)
}

/// The settings file as the settings screen describes it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    /// Where it is, for a person who wants to open it.
    pub path: String,
    /// The format of the file when a newer scheda wrote it. While this is
    /// set, changes apply to the window and are not saved.
    pub newer: Option<u32>,
}

pub fn status() -> Result<FileStatus, SettingsError> {
    status_of(&file_path()?)
}

fn status_of(path: &Path) -> Result<FileStatus, SettingsError> {
    let newer = match stored::read::<Settings>(path, &FORMAT) {
        Ok(Found::Newer { format, .. }) => Some(format),
        _ => None,
    };
    Ok(FileStatus {
        path: path.to_string_lossy().into_owned(),
        newer,
    })
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
        settings.apply(serde_json::from_str(r#"{"quickNoteFile":"/inbox.md"}"#).expect("parses"));
        assert_eq!(settings.quick_note_file.as_deref(), Some("/inbox.md"));

        settings.apply(serde_json::from_str(r#"{"autosave":true}"#).expect("parses"));
        assert_eq!(settings.quick_note_file.as_deref(), Some("/inbox.md"));

        settings.apply(serde_json::from_str(r#"{"quickNoteFile":null}"#).expect("parses"));
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
    fn a_file_from_before_formats_keeps_every_setting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"theme":"dark","font_size":18,"column_width":0.0,"close_brackets":true,
                "quick_note_file":"/inbox.md","quick_note_key":"","keys":{"file.save":[]}}"#,
        )
        .unwrap();

        let settings = load_from(&path).unwrap();
        assert_eq!(settings.font_size, 18);
        assert_eq!(settings.column_width, 0.0);
        assert!(settings.close_brackets);
        assert_eq!(settings.quick_note_file.as_deref(), Some("/inbox.md"));
        assert_eq!(settings.quick_note_key, "");
        assert_eq!(settings.keys["file.save"], Vec::<String>::new());
    }

    #[test]
    fn a_chord_from_before_formats_is_put_in_the_one_order() {
        assert_eq!(in_order("Shift+Win+N"), "Win+Shift+N");
        assert_eq!(in_order("Shift+Alt+Ctrl+P"), "Ctrl+Alt+Shift+P");
        assert_eq!(in_order("Ctrl+\\"), "Ctrl+\\");
        assert_eq!(in_order("F5"), "F5");
        assert_eq!(in_order(""), "");

        let mut fields = serde_json::from_str::<Map<String, Value>>(
            r#"{"quick_note_key":"Shift+Win+N","keys":{"file.save":["Shift+Ctrl+S","F2"]}}"#,
        )
        .unwrap();
        to_format_1(&mut fields);
        assert_eq!(fields["quickNoteKey"], "Win+Shift+N");
        assert_eq!(fields["keys"]["file.save"][0], "Ctrl+Shift+S");
        assert_eq!(fields["keys"]["file.save"][1], "F2");
    }

    #[test]
    fn a_window_key_is_written_in_the_line_notation() {
        // The table is shared with the window's tests (`src/commands.test.ts`),
        // which press each key and require dowel to read it as the same
        // string: a key moved by this step is the key the person pressed.
        let table: Vec<Value> =
            serde_json::from_str(include_str!("../tests/keys-1-to-2.json")).unwrap();
        assert!(table.len() > 20);
        for row in table {
            let (format_1, format_2) = (
                row["format1"].as_str().unwrap(),
                row["format2"].as_str().unwrap(),
            );
            assert_eq!(
                in_line_notation(format_1).as_deref(),
                Some(format_2),
                "{format_1}"
            );
        }
        // Keys the window never wrote, and a key it could not have answered.
        assert_eq!(in_line_notation("Shift+1").as_deref(), Some("!"));
        assert_eq!(in_line_notation("Escape").as_deref(), Some("Escape"));
        assert_eq!(in_line_notation("Win+Ctrl+N"), None);
    }

    #[test]
    fn the_step_to_format_2_moves_the_window_keys_and_leaves_the_system_key() {
        let mut fields = serde_json::from_str::<Map<String, Value>>(
            r#"{"format":1,"quickNoteKey":"Win+Shift+N","keys":{
                "file.save":["Ctrl+Alt+S","Win+Ctrl+S","F2"],"fold.section":["Ctrl+Shift+["],"tab.pin":[]}}"#,
        )
        .unwrap();
        to_format_2(&mut fields);
        assert_eq!(fields["quickNoteKey"], "Win+Shift+N");
        assert_eq!(
            fields["keys"]["file.save"],
            serde_json::json!(["Mod+Alt+S", "F2"])
        );
        assert_eq!(fields["keys"]["fold.section"], serde_json::json!(["Mod+{"]));
        assert_eq!(fields["keys"]["tab.pin"], serde_json::json!([]));
    }

    #[test]
    fn a_newer_file_is_used_and_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let newer = r#"{"format":9,"theme":"light","fontSize":20,"somethingNew":true}"#;
        std::fs::write(&path, newer).unwrap();

        assert_eq!(load_from(&path).unwrap().font_size, 20);
        assert_eq!(status_of(&path).unwrap().newer, Some(9));

        // A change is made and kept for the rest of the run...
        let changed = modify_at(&path, |settings| settings.font_size = 12).unwrap();
        assert_eq!(changed.font_size, 12);
        assert_eq!(load_from(&path).unwrap().font_size, 12);
        modify_at(&path, |settings| settings.remember("/a.md")).unwrap();
        let both = load_from(&path).unwrap();
        assert_eq!((both.font_size, both.recent.len()), (12, 1));

        // ...and the file is the newer version's, as it was.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), newer);
    }

    #[test]
    fn a_corrupt_file_is_reported_and_not_written_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ \"theme\": ").unwrap();

        assert!(load_from(&path).is_err());
        assert!(modify_at(&path, |settings| settings.autosave = true).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ \"theme\": ");
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

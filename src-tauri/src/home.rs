//! Where scheda keeps its own things: the platform's two directories, or one
//! named by `SCHEDA_HOME`.
//!
//! The settings, the session, the drafts and the waiting files go to the
//! configuration directory, which roams with a Windows profile; the index of
//! each vault goes to the local one, because it describes one machine's disk
//! (ADR 0003, ADR 0011). Every part of the core asks here, and nowhere else.
//!
//! `SCHEDA_HOME` puts both in one directory of the caller's. It exists for a
//! run that must not touch the scheda someone lives in: a check of a release
//! against a synthetic vault, the pictures for the README, a second scheda kept
//! apart from the first. Before it, every such run moved the real directories
//! aside and put them back, and a run that died in between left the person
//! without their settings and their drafts.

use std::ffi::OsString;
use std::path::PathBuf;

/// The variable that names a directory of the caller's.
pub const VARIABLE: &str = "SCHEDA_HOME";

/// The directory for the settings, the session, the drafts and the waiting
/// files: `%APPDATA%\scheda` on Windows, the XDG config directory elsewhere.
pub fn config() -> Option<PathBuf> {
    resolve(std::env::var_os(VARIABLE), dirs::config_dir())
}

/// The directory for what describes this machine's disk, the index:
/// `%LOCALAPPDATA%\scheda` on Windows, the XDG data directory elsewhere.
pub fn local() -> Option<PathBuf> {
    resolve(std::env::var_os(VARIABLE), dirs::data_local_dir())
}

/// `home` when it names a directory, else scheda's folder in the platform's.
/// An empty value is unset: `SCHEDA_HOME=` in a shell means "not this time",
/// and an empty path would put the files in whatever the working directory is.
fn resolve(home: Option<OsString>, platform: Option<PathBuf>) -> Option<PathBuf> {
    match home.filter(|value| !value.is_empty()) {
        Some(home) => Some(PathBuf::from(home)),
        None => platform.map(|base| base.join("scheda")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn the_platform_directories_by_default() {
        assert_eq!(
            resolve(None, Some(PathBuf::from("base"))),
            Some(Path::new("base").join("scheda"))
        );
        assert_eq!(resolve(None, None), None);
    }

    #[test]
    fn one_directory_of_the_callers_when_named() {
        assert_eq!(
            resolve(Some("elsewhere".into()), Some(PathBuf::from("base"))),
            Some(PathBuf::from("elsewhere"))
        );
        // Named even where the platform has no directory to offer.
        assert_eq!(
            resolve(Some("elsewhere".into()), None),
            Some(PathBuf::from("elsewhere"))
        );
    }

    #[test]
    fn an_empty_value_is_unset() {
        assert_eq!(
            resolve(Some(OsString::new()), Some(PathBuf::from("base"))),
            Some(Path::new("base").join("scheda"))
        );
    }

    /// The lines of a source file that ask `dirs` for a directory.
    fn askers(path: &Path) -> Vec<String> {
        let text = fs::read_to_string(path).expect("a readable source file");
        text.lines()
            .enumerate()
            .filter(|(_, line)| line.split("//").next().unwrap_or("").contains("dirs::"))
            .map(|(number, _)| format!("{} line {}", path.display(), number + 1))
            .collect()
    }

    #[test]
    fn nothing_else_asks_the_platform() {
        // A part of the core that asked `dirs` itself would write into the
        // real directories under `SCHEDA_HOME` - the one thing the variable
        // promises it does not.
        let mut others = Vec::new();
        let mut here = Vec::new();
        let mut folders = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(folder) = folders.pop() {
            for entry in fs::read_dir(&folder).expect("the core's sources") {
                let path = entry.expect("a source file").path();
                if path.is_dir() {
                    folders.push(path);
                } else if path.file_name().is_some_and(|name| name == "home.rs") {
                    here = askers(&path);
                } else if path.extension().is_some_and(|ext| ext == "rs") {
                    others.extend(askers(&path));
                }
            }
        }
        assert!(
            others.is_empty(),
            "these ask the platform for a directory rather than home.rs: {others:?}"
        );
        // The scan held to the two calls it must see: a reader that stopped
        // matching would pass every other file in the core.
        assert_eq!(here.len(), 2, "home.rs asks dirs in {here:?}");
    }
}

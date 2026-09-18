//! What the vault says about itself, read once.
//!
//! Obsidian keeps its answers in `.obsidian/app.json`, and scheda reads them
//! rather than inventing a second set (ADR 0003). A vault where a new link is
//! written `[[folder/note]]` in Obsidian and `[[note]]` in scheda is a vault two
//! programs disagree about, and the one who loses is the person who has to tidy
//! up after them.
//!
//! One module for the whole file rather than a reader per key. The first version
//! of this had `attachments` open `app.json` for `attachmentFolderPath` alone;
//! adding three more keys that way would have meant three opens, three sets of
//! defaults, and three places where a default could drift from Obsidian's. Here
//! there is one parse and one list of defaults, and the next key is a field
//! rather than a reader.
//!
//! Reading `.obsidian/` is allowed; writing it is not. Nothing here writes.

use std::path::{Path, PathBuf};

/// The file inside `.obsidian/` that holds these answers.
const APP_JSON: &str = "app.json";

/// How Obsidian writes the target of a new link.
///
/// The setting exists because a vault can be read by things other than
/// Obsidian, and different owners want different trade-offs: the shortest form
/// is the nicest to read and breaks when a second note takes the same name, and
/// the absolute form survives anything and is noisy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LinkFormat {
    /// `[[note]]` — the shortest path that still names one file. Obsidian's own
    /// default, hence ours.
    #[default]
    Shortest,
    /// `[[../notes/note]]` — relative to the note being written in.
    Relative,
    /// `[[folder/note]]` — from the vault root.
    Absolute,
}

/// Where a note created by a link to a missing name is put.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum NewFileLocation {
    /// The vault root. Obsidian's default.
    #[default]
    Root,
    /// Beside the note the link was written in.
    CurrentFolder,
    /// A named folder from the vault root.
    Folder(String),
}

/// Where attachments go for a given note.
///
/// Three forms, and Obsidian documents none of them; these are what a vault
/// actually contains:
///
/// - `"attachments"` — that folder, from the vault root.
/// - `"./attachments"` — a folder beside the note, created where the note is.
/// - `"/"` or absent — the vault root itself.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AttachmentFolder {
    /// A folder relative to the vault root.
    FromRoot(String),
    /// A folder relative to the note's own directory.
    BesideNote(String),
    /// The vault root itself.
    #[default]
    Root,
}

impl AttachmentFolder {
    /// The folder a note's attachments belong in, as a path.
    ///
    /// `document` is the note; `root` its vault, or its own directory when it
    /// is not in one. Nothing is created here — that is the caller's step, so
    /// that a failure to create is reported as the refusal it is.
    pub fn resolve(&self, root: &Path, document: &Path) -> PathBuf {
        let beside = document.parent().unwrap_or(root);
        match self {
            Self::Root => root.to_path_buf(),
            Self::FromRoot(relative) => root.join(relative),
            Self::BesideNote(relative) => beside.join(relative),
        }
    }
}

/// Everything scheda reads out of a vault's own configuration.
///
/// Every field has a default, and the defaults are *Obsidian's* rather than
/// convenient ones: a vault where nothing was configured must behave the same
/// in both programs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VaultConfig {
    pub link_format: LinkFormat,
    /// True when the vault is set to write `[markdown](links)` instead of
    /// `[[wikilinks]]`. scheda *reads* wikilinks either way — a vault that used
    /// to write them is full of them — but a link it writes itself follows the
    /// setting.
    pub markdown_links: bool,
    pub new_file_location: NewFileLocation,
    pub attachment_folder: AttachmentFolder,
}

/// Reads a vault's configuration, falling back to Obsidian's defaults.
///
/// Every failure lands on the defaults — a missing file, unreadable JSON, a
/// value of the wrong type — because a vault with no `app.json` is the ordinary
/// case and one with a broken `app.json` still has to open. Nothing here is
/// worth refusing a file over.
pub fn config_for(root: &Path) -> VaultConfig {
    let path = root.join(super::root::VAULT_MARKER).join(APP_JSON);
    let Ok(text) = std::fs::read_to_string(path) else {
        return VaultConfig::default();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return VaultConfig::default();
    };
    parse(&value)
}

/// Turns the parsed JSON into the answers scheda asks for.
///
/// Taken key by key rather than through `serde` derive: the values are not all
/// strings, an unknown string has to fall back rather than fail the whole file,
/// and `newLinkFormat` being `"shortest"` in a vault and absent in another must
/// reach the same place.
fn parse(value: &serde_json::Value) -> VaultConfig {
    VaultConfig {
        link_format: match value.get("newLinkFormat").and_then(|v| v.as_str()) {
            Some("relative") => LinkFormat::Relative,
            Some("absolute") => LinkFormat::Absolute,
            // Including `"shortest"`, an unknown word, and absent. An unknown
            // one is Obsidian gaining a format scheda has not heard of, and the
            // default is the honest guess.
            _ => LinkFormat::Shortest,
        },
        // Only `true` counts. Obsidian writes this key as a boolean, and a
        // string `"true"` from a hand-edited file is not one.
        markdown_links: value
            .get("useMarkdownLinks")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        new_file_location: match value.get("newFileLocation").and_then(|v| v.as_str()) {
            Some("current") => NewFileLocation::CurrentFolder,
            Some("folder") => value
                .get("newFileFolderPath")
                .and_then(|v| v.as_str())
                .map(clean_folder)
                .filter(|folder| !folder.is_empty())
                .map(NewFileLocation::Folder)
                // `"folder"` with no folder named is a vault mid-configuration.
                // The root is where Obsidian puts the note in that state.
                .unwrap_or(NewFileLocation::Root),
            _ => NewFileLocation::Root,
        },
        attachment_folder: attachment_folder(
            value.get("attachmentFolderPath").and_then(|v| v.as_str()),
        ),
    }
}

/// Turns the raw attachment setting into a folder rule.
fn attachment_folder(setting: Option<&str>) -> AttachmentFolder {
    let Some(raw) = setting else {
        return AttachmentFolder::Root;
    };
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "." || trimmed == "/" {
        return AttachmentFolder::Root;
    }
    if let Some(relative) = trimmed.strip_prefix("./") {
        // `./attachments` means "next to the note", which is a different folder
        // for every note — the distinction the whole enum exists for.
        return AttachmentFolder::BesideNote(relative.to_string());
    }
    AttachmentFolder::FromRoot(trimmed.trim_start_matches('/').to_string())
}

/// A folder path from the settings, as a relative path from the root.
fn clean_folder(raw: &str) -> String {
    raw.trim()
        .trim_end_matches('/')
        .trim_start_matches('/')
        .to_string()
}

impl VaultConfig {
    /// The folder a new note goes in, for a link written in `document`.
    pub fn new_note_folder(&self, root: &Path, document: &Path) -> PathBuf {
        match &self.new_file_location {
            NewFileLocation::Root => root.to_path_buf(),
            NewFileLocation::CurrentFolder => document.parent().unwrap_or(root).to_path_buf(),
            NewFileLocation::Folder(folder) => root.join(folder),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(json: &str) -> VaultConfig {
        parse(&serde_json::from_str(json).expect("test json parses"))
    }

    #[test]
    fn an_empty_config_is_obsidians_defaults() {
        // A vault where nothing was configured has to behave the same in both
        // programs, so the defaults are Obsidian's rather than convenient ones.
        let config = parsed("{}");
        assert_eq!(config.link_format, LinkFormat::Shortest);
        assert!(!config.markdown_links);
        assert_eq!(config.new_file_location, NewFileLocation::Root);
        assert_eq!(config.attachment_folder, AttachmentFolder::Root);
    }

    #[test]
    fn each_link_format_is_recognised() {
        assert_eq!(
            parsed(r#"{"newLinkFormat":"relative"}"#).link_format,
            LinkFormat::Relative
        );
        assert_eq!(
            parsed(r#"{"newLinkFormat":"absolute"}"#).link_format,
            LinkFormat::Absolute
        );
        assert_eq!(
            parsed(r#"{"newLinkFormat":"shortest"}"#).link_format,
            LinkFormat::Shortest
        );
    }

    #[test]
    fn a_format_we_have_not_heard_of_falls_back() {
        // Obsidian gaining a format scheda does not know is not a reason to
        // refuse the vault; the default is the honest guess.
        assert_eq!(
            parsed(r#"{"newLinkFormat":"whatever-comes-next"}"#).link_format,
            LinkFormat::Shortest
        );
        assert_eq!(
            parsed(r#"{"newLinkFormat":7}"#).link_format,
            LinkFormat::Shortest
        );
    }

    #[test]
    fn markdown_links_are_only_the_boolean() {
        assert!(parsed(r#"{"useMarkdownLinks":true}"#).markdown_links);
        assert!(!parsed(r#"{"useMarkdownLinks":false}"#).markdown_links);
        // A hand-edited file with a string in it is not a boolean.
        assert!(!parsed(r#"{"useMarkdownLinks":"true"}"#).markdown_links);
    }

    #[test]
    fn a_new_note_goes_where_the_vault_says() {
        assert_eq!(
            parsed(r#"{"newFileLocation":"current"}"#).new_file_location,
            NewFileLocation::CurrentFolder
        );
        assert_eq!(
            parsed(r#"{"newFileLocation":"folder","newFileFolderPath":"Inbox"}"#).new_file_location,
            NewFileLocation::Folder("Inbox".into())
        );
        assert_eq!(
            parsed(r#"{"newFileLocation":"root"}"#).new_file_location,
            NewFileLocation::Root
        );
    }

    #[test]
    fn folder_without_a_folder_named_is_the_root() {
        // A vault caught mid-configuration. The root is where Obsidian puts the
        // note in that state, so it is where scheda puts it too.
        assert_eq!(
            parsed(r#"{"newFileLocation":"folder"}"#).new_file_location,
            NewFileLocation::Root
        );
        assert_eq!(
            parsed(r#"{"newFileLocation":"folder","newFileFolderPath":"  "}"#).new_file_location,
            NewFileLocation::Root
        );
    }

    #[test]
    fn a_new_note_folder_resolves_against_the_document() {
        let root = Path::new("/vault");
        let note = Path::new("/vault/daily/today.md");

        let at_root = VaultConfig::default();
        assert_eq!(at_root.new_note_folder(root, note), root);

        let beside = VaultConfig {
            new_file_location: NewFileLocation::CurrentFolder,
            ..Default::default()
        };
        assert_eq!(
            beside.new_note_folder(root, note),
            Path::new("/vault/daily")
        );

        let named = VaultConfig {
            new_file_location: NewFileLocation::Folder("Inbox".into()),
            ..Default::default()
        };
        assert_eq!(named.new_note_folder(root, note), Path::new("/vault/Inbox"));
    }

    #[test]
    fn an_absent_attachment_setting_means_the_vault_root() {
        assert_eq!(attachment_folder(None), AttachmentFolder::Root);
        assert_eq!(attachment_folder(Some("/")), AttachmentFolder::Root);
        assert_eq!(attachment_folder(Some("")), AttachmentFolder::Root);
    }

    #[test]
    fn a_plain_name_is_a_folder_in_the_root() {
        assert_eq!(
            attachment_folder(Some("attachments")),
            AttachmentFolder::FromRoot("attachments".into())
        );
        assert_eq!(
            attachment_folder(Some("assets/images/")),
            AttachmentFolder::FromRoot("assets/images".into())
        );
    }

    #[test]
    fn a_dot_slash_means_beside_the_note() {
        // The distinction the enum exists for: this folder is a different
        // folder for every note, and treating it as one from the root would
        // pile every vault's pictures into a single `./attachments` at the top.
        assert_eq!(
            attachment_folder(Some("./attachments")),
            AttachmentFolder::BesideNote("attachments".into())
        );
    }

    #[test]
    fn resolving_attachments_puts_each_form_where_it_belongs() {
        let root = Path::new("/vault");
        let note = Path::new("/vault/daily/today.md");

        assert_eq!(AttachmentFolder::Root.resolve(root, note), root);
        assert_eq!(
            AttachmentFolder::FromRoot("assets".into()).resolve(root, note),
            Path::new("/vault/assets")
        );
        assert_eq!(
            AttachmentFolder::BesideNote("files".into()).resolve(root, note),
            Path::new("/vault/daily/files")
        );
    }

    #[test]
    fn the_whole_config_is_read_from_the_vaults_own_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates");
        std::fs::write(
            dir.path().join(".obsidian/app.json"),
            br#"{
                "attachmentFolderPath": "assets",
                "newLinkFormat": "absolute",
                "useMarkdownLinks": true,
                "newFileLocation": "current",
                "somethingElse": 1
            }"#,
        )
        .expect("writes");

        let config = config_for(dir.path());
        assert_eq!(
            config.attachment_folder,
            AttachmentFolder::FromRoot("assets".into())
        );
        assert_eq!(config.link_format, LinkFormat::Absolute);
        assert!(config.markdown_links);
        assert_eq!(config.new_file_location, NewFileLocation::CurrentFolder);
    }

    #[test]
    fn a_vault_without_a_readable_config_still_works() {
        // No file, unreadable JSON, a value of the wrong type — all of them
        // land on the defaults rather than refusing the vault.
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(config_for(dir.path()), VaultConfig::default());

        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates");
        std::fs::write(dir.path().join(".obsidian/app.json"), b"not json at all").expect("writes");
        assert_eq!(config_for(dir.path()), VaultConfig::default());

        std::fs::write(
            dir.path().join(".obsidian/app.json"),
            br#"{"attachmentFolderPath":42}"#,
        )
        .expect("writes");
        assert_eq!(config_for(dir.path()), VaultConfig::default());
    }
}

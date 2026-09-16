//! Where a pasted picture goes.
//!
//! Obsidian already answers this question for every vault, in
//! `.obsidian/app.json` under `attachmentFolderPath`, and scheda reads that
//! answer rather than inventing a second one. A vault where pictures land in
//! `assets/` in Obsidian and beside the note in scheda is a vault two programs
//! disagree about, and the one that loses is the person who has to tidy up.
//!
//! The setting has three forms, and Obsidian documents none of them; these are
//! what a vault actually contains:
//!
//! - `"attachments"` — that folder, from the vault root.
//! - `"./attachments"` — a folder beside the note, created where the note is.
//! - `"/"` or absent — the vault root itself.
//!
//! Reading `.obsidian/` is allowed; writing it is not (ADR 0003). Nothing here
//! writes.

use std::path::{Path, PathBuf};

/// Where attachments go for a given note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentFolder {
    /// A folder relative to the vault root.
    FromRoot(String),
    /// A folder relative to the note's own directory.
    BesideNote(String),
    /// The vault root itself.
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

/// Reads the vault's attachment setting, falling back to the root.
///
/// Every failure lands on the same answer — the root — because a vault with an
/// unreadable `app.json` still has to accept a pasted picture. The fallback is
/// Obsidian's own default, so the two programs agree even when nothing was
/// configured.
pub fn folder_for(root: &Path) -> AttachmentFolder {
    let path = root.join(".obsidian").join("app.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return AttachmentFolder::Root;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return AttachmentFolder::Root;
    };
    parse(value.get("attachmentFolderPath").and_then(|v| v.as_str()))
}

/// Turns the raw setting into a folder rule.
fn parse(setting: Option<&str>) -> AttachmentFolder {
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

/// The link to write in the document for a file at `target`.
///
/// Relative to the note, with forward slashes and spaces percent-encoded:
/// `![[...]]` is not used because wikilinks are v0.7, and a plain markdown link
/// is the form every reader of the vault already understands.
pub fn link_from(document: &Path, target: &Path) -> String {
    let base = document.parent().unwrap_or(document);
    let relative = relative_to(base, target);
    encode(&relative.to_string_lossy().replace('\\', "/"))
}

/// `target` expressed from `base`, with `..` for each level that has to be
/// climbed. Falls back to the absolute path when the two share no root at all
/// — different drives on Windows — because a wrong relative link is worse than
/// an honest absolute one.
fn relative_to(base: &Path, target: &Path) -> PathBuf {
    let mut base_parts = base.components().peekable();
    let mut target_parts = target.components().peekable();

    // Case-insensitively on Windows, where `C:\Notes` and `c:\notes` are one
    // folder and comparing them as strings would produce `..\..\..` for a file
    // sitting in the same directory.
    let same = |a: &std::path::Component, b: &std::path::Component| {
        #[cfg(windows)]
        {
            a.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
        }
        #[cfg(not(windows))]
        {
            a == b
        }
    };

    let mut shared = 0usize;
    while let (Some(a), Some(b)) = (base_parts.peek(), target_parts.peek()) {
        if !same(a, b) {
            break;
        }
        shared += 1;
        base_parts.next();
        target_parts.next();
    }

    if shared == 0 {
        return target.to_path_buf();
    }

    let mut out = PathBuf::new();
    for _ in base_parts {
        out.push("..");
    }
    for part in target_parts {
        out.push(part);
    }
    out
}

/// Percent-encodes the characters that break a markdown link.
///
/// Only those: a link full of `%D0%BF` for a note named in Cyrillic is legal
/// and unreadable, and the vault is read by a person as often as by a parser.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_setting_means_the_vault_root() {
        assert_eq!(parse(None), AttachmentFolder::Root);
        assert_eq!(parse(Some("/")), AttachmentFolder::Root);
        assert_eq!(parse(Some("")), AttachmentFolder::Root);
    }

    #[test]
    fn a_plain_name_is_a_folder_in_the_root() {
        assert_eq!(
            parse(Some("attachments")),
            AttachmentFolder::FromRoot("attachments".into())
        );
        assert_eq!(
            parse(Some("assets/images/")),
            AttachmentFolder::FromRoot("assets/images".into())
        );
    }

    #[test]
    fn a_dot_slash_means_beside_the_note() {
        // The distinction the enum exists for: this folder is a different
        // folder for every note, and treating it as one from the root would
        // pile every vault's pictures into a single `./attachments` at the top.
        assert_eq!(
            parse(Some("./attachments")),
            AttachmentFolder::BesideNote("attachments".into())
        );
    }

    #[test]
    fn resolving_puts_each_form_where_it_belongs() {
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
    fn the_setting_is_read_from_the_vaults_own_config() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates");
        std::fs::write(
            dir.path().join(".obsidian/app.json"),
            br#"{"attachmentFolderPath":"assets","otherThing":true}"#,
        )
        .expect("writes");

        assert_eq!(
            folder_for(dir.path()),
            AttachmentFolder::FromRoot("assets".into())
        );
    }

    #[test]
    fn a_vault_without_a_config_still_accepts_a_picture() {
        // No `.obsidian/app.json`, unreadable JSON, a setting of the wrong
        // type — all of them land on the root rather than refusing the paste.
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(folder_for(dir.path()), AttachmentFolder::Root);

        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates");
        std::fs::write(dir.path().join(".obsidian/app.json"), b"not json at all").expect("writes");
        assert_eq!(folder_for(dir.path()), AttachmentFolder::Root);

        std::fs::write(
            dir.path().join(".obsidian/app.json"),
            br#"{"attachmentFolderPath":42}"#,
        )
        .expect("writes");
        assert_eq!(folder_for(dir.path()), AttachmentFolder::Root);
    }

    #[test]
    fn a_link_is_relative_to_the_note() {
        let note = Path::new("/vault/daily/today.md");
        assert_eq!(
            link_from(note, Path::new("/vault/daily/shot.png")),
            "shot.png"
        );
        assert_eq!(
            link_from(note, Path::new("/vault/assets/shot.png")),
            "../assets/shot.png"
        );
        assert_eq!(
            link_from(note, Path::new("/vault/daily/files/shot.png")),
            "files/shot.png"
        );
    }

    #[test]
    fn a_space_in_a_name_is_encoded_and_a_letter_is_not() {
        // `Pasted image 20260916.png` is the ordinary case, and a raw space
        // ends the link early in every markdown parser. Cyrillic and accents
        // are left alone: they are legal and a person reads these links.
        let note = Path::new("/vault/note.md");
        assert_eq!(
            link_from(note, Path::new("/vault/Pasted image 1.png")),
            "Pasted%20image%201.png"
        );
        assert_eq!(
            link_from(note, Path::new("/vault/картинка.png")),
            "картинка.png"
        );
    }

    #[test]
    fn a_target_sharing_nothing_with_the_note_stays_absolute() {
        // Different drives on Windows: there is no relative path between them,
        // and inventing one produces a link to nowhere.
        let note = Path::new("C:/vault/note.md");
        let target = Path::new("D:/elsewhere/shot.png");
        assert_eq!(link_from(note, target), "D:/elsewhere/shot.png");
    }
}

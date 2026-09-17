//! Handing a note over to Obsidian.
//!
//! scheda reads Obsidian's conventions and never writes its folder; this is the
//! other half of that arrangement. The graph, the plugins, the daily note — all
//! of it is over there, and a button that opens the file you are looking at in
//! the program that has those is the honest shape of "we are not competing with
//! it". The button adds; it takes nothing away.
//!
//! `obsidian://open?vault=<name>&file=<path>` is the documented URL. The vault
//! is named rather than pathed because that is what Obsidian keys its vaults
//! by, and the file is given relative to the vault root without its extension —
//! Obsidian resolves it the way a wikilink resolves.

use std::path::Path;

/// Builds the URL that opens `document` in Obsidian, or `None` when the
/// document is not in a vault.
///
/// Not in a vault means Obsidian has nothing to open it *as*: a note on the
/// Desktop has no vault to name, and a URL with an invented one opens the wrong
/// window or no window. `None` is what hides the button.
pub fn open_url(root: &Path, document: &Path) -> Option<String> {
    let vault = root.file_name()?.to_string_lossy();
    let relative = document.strip_prefix(root).ok()?;

    // Forward slashes whatever the platform: this is a URL, and a backslash in
    // one is a character in a file name rather than a separator.
    let mut parts: Vec<String> = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect();

    // The extension comes off, the way a wikilink is written. Only `.md`:
    // Obsidian resolves an extensionless name as a note, so stripping `.png`
    // would ask it to open a note that does not exist instead of the picture.
    if let Some(last) = parts.last_mut() {
        if let Some(stem) = last.strip_suffix(".md") {
            *last = stem.to_string();
        }
    }

    Some(format!(
        "obsidian://open?vault={}&file={}",
        encode(&vault),
        encode(&parts.join("/"))
    ))
}

/// Percent-encodes everything that is not unreserved, plus `/` left alone.
///
/// Written here rather than taken from a crate: it is fifteen lines, it is the
/// only URL scheda builds, and the alternative is a dependency for one function
/// — which is the trade the line does not make.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn url(root: &str, document: &str) -> Option<String> {
        open_url(&PathBuf::from(root), &PathBuf::from(document))
    }

    #[test]
    fn a_note_at_the_root() {
        assert_eq!(
            url("/vault", "/vault/note.md").as_deref(),
            Some("obsidian://open?vault=vault&file=note")
        );
    }

    #[test]
    fn a_note_in_a_folder_uses_forward_slashes() {
        // A URL, not a path: a backslash in one is a character in a file name.
        assert_eq!(
            url("/vault", "/vault/projects/plan.md").as_deref(),
            Some("obsidian://open?vault=vault&file=projects/plan")
        );
    }

    #[test]
    fn the_markdown_extension_comes_off_and_others_stay() {
        // Obsidian resolves an extensionless name as a note. Stripping `.png`
        // would ask it for a note that does not exist rather than the picture.
        assert!(
            url("/vault", "/vault/shot.png")
                .unwrap()
                .ends_with("file=shot.png")
        );
    }

    #[test]
    fn spaces_and_other_characters_are_encoded() {
        let built = url("/my vault", "/my vault/a note & more.md").unwrap();
        assert_eq!(
            built,
            "obsidian://open?vault=my%20vault&file=a%20note%20%26%20more"
        );
    }

    #[test]
    fn non_ascii_survives_as_utf8() {
        // Vault names are whatever the owner called the folder.
        let built = url("/дневник", "/дневник/note.md").unwrap();
        assert!(built.starts_with("obsidian://open?vault=%D0%B4"));
    }

    #[test]
    fn a_document_outside_the_root_has_no_url() {
        // Nothing to name it by. A URL with an invented vault opens the wrong
        // window or no window at all.
        assert_eq!(url("/vault", "/elsewhere/note.md"), None);
    }
}

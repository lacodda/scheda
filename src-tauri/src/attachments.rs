//! Where a pasted picture goes.
//!
//! The vault's own answer to that question is read by `vault` — one module for
//! `.obsidian/app.json`, so the next setting is a field rather than a second
//! reader. What is left here is the other half: the link to write in the
//! document once the file has landed.

use std::path::{Path, PathBuf};

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

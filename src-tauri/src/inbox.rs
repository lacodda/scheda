//! Adding a quick note to the end of a file.
//!
//! The quick-note window is for the thought that arrives while somebody is in
//! another program: a key, a line, `Enter`, and they are back where they were.
//! What it writes is one list item at the end of a file they chose, stamped
//! with when it was written — the shape an inbox note in a vault already has,
//! so the entries read as the person's own list rather than a log.
//!
//! The file is appended to through the same reader and writer as any note it
//! could be (ADR 0002): its line endings, its byte-order mark and every byte
//! already in it come back exactly as they were, and only the new lines are
//! new. A file with no line break at its end gets one first, because an item
//! glued to the last word of somebody's paragraph is a changed paragraph.

use crate::document::{self, DocumentError, DocumentShape, LineEnding};
use std::path::Path;

/// The lines one quick note becomes: a list item with the stamp, and any
/// further lines of it indented under the item so they stay part of it.
///
/// `None` for a note with nothing in it but whitespace — an empty item in
/// somebody's inbox is a line they have to delete.
pub fn entry(text: &str, stamp: &str) -> Option<String> {
    let normalised = text.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalised.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut lines = trimmed.lines();
    let first = lines.next().unwrap_or_default().trim_end();
    let mut out = format!("- {stamp} {first}");
    for line in lines {
        out.push('\n');
        // A blank line inside the item stays blank rather than becoming two
        // spaces nobody can see: trailing whitespace is a diff with no content.
        if !line.trim().is_empty() {
            out.push_str("  ");
            out.push_str(line.trim_end());
        }
    }
    Some(out)
}

/// Appends a note to the file at `path`, creating the file when it does not
/// exist yet. Returns false when there was nothing to write.
pub fn append(path: &Path, text: &str, stamp: &str) -> Result<bool, DocumentError> {
    let Some(entry) = entry(text, stamp) else {
        return Ok(false);
    };
    let (mut body, shape) = match document::read(path) {
        Ok(existing) => (existing.text, existing.shape),
        Err(DocumentError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => (
            String::new(),
            DocumentShape {
                line_ending: LineEnding::Lf,
                bom: false,
                mixed_endings: None,
            },
        ),
        Err(error) => return Err(error),
    };
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str(&entry);
    body.push('\n');
    document::write(path, &body, &shape)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAMP: &str = "2026-09-30 14:05";

    #[test]
    fn a_note_is_one_stamped_item() {
        assert_eq!(
            entry("call the printer shop", STAMP).as_deref(),
            Some("- 2026-09-30 14:05 call the printer shop")
        );
    }

    #[test]
    fn further_lines_stay_inside_the_item() {
        assert_eq!(
            entry("first\r\nsecond  \n\nthird\n", STAMP).as_deref(),
            Some("- 2026-09-30 14:05 first\n  second\n\n  third")
        );
    }

    #[test]
    fn whitespace_is_not_a_note() {
        assert_eq!(entry("  \n\t ", STAMP), None);
    }

    fn appended(before: &[u8]) -> Vec<u8> {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("inbox.md");
        std::fs::write(&path, before).expect("writes");
        assert!(append(&path, "new", STAMP).expect("appends"));
        std::fs::read(&path).expect("reads")
    }

    #[test]
    fn every_byte_already_there_stays() {
        // CRLF with a BOM: the new line is CRLF too, and the BOM stays first.
        let before = b"\xEF\xBB\xBF# Inbox\r\n\r\n- old\r\n";
        let after = appended(before);
        assert!(after.starts_with(before));
        assert_eq!(&after[before.len()..], b"- 2026-09-30 14:05 new\r\n");
    }

    #[test]
    fn a_file_without_a_final_break_gets_one_before_the_item() {
        let after = appended(b"- old");
        assert_eq!(after, b"- old\n- 2026-09-30 14:05 new\n");
    }

    #[test]
    fn mixed_endings_keep_every_recorded_ending() {
        let before = b"a\r\nb\nc\r\n";
        let after = appended(before);
        assert!(after.starts_with(before));
    }

    #[test]
    fn a_missing_file_is_created() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("inbox.md");
        assert!(append(&path, "first", STAMP).expect("appends"));
        assert_eq!(
            std::fs::read(&path).expect("reads"),
            b"- 2026-09-30 14:05 first\n"
        );
    }

    #[test]
    fn nothing_to_write_leaves_the_file_alone() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("inbox.md");
        std::fs::write(&path, b"x").expect("writes");
        assert!(!append(&path, "   ", STAMP).expect("appends"));
        assert_eq!(std::fs::read(&path).expect("reads"), b"x");
    }
}

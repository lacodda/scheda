//! Replacing text across a vault: say what would change, then change exactly
//! that.
//!
//! The same shape as a rename (`rename.rs`), for the same reason — this writes
//! to files nobody opened. `plan` reads the notes and answers with every match,
//! each with the words around it and what it would become; nothing is written.
//! The window shows the list with a box beside each match, and `apply` receives
//! the plan back with only the ticked matches left in it.
//!
//! **Byte for byte outside the match.** Each note is read through `document`,
//! spliced, and written back through `document` with the shape it arrived with
//! — the same write the editor's save goes through. A match never spans a line
//! break (`search.rs` matches a line at a time) and a replacement may not
//! contain one, so the number of lines never changes; that is what keeps a note
//! with mixed line endings exactly as it was on every line the replacement did
//! not touch.
//!
//! **A note that moved on is left alone.** The plan carries the hash of each
//! note's bytes. A note whose hash differs at the moment of writing was changed
//! between the showing and the doing — by Obsidian, a sync client, or the
//! person — and splicing it at offsets computed against other bytes is how an
//! editor corrupts somebody's note. It is skipped and named in the answer.

use crate::document::{self, Document};
use crate::index;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// One match and what it would become.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// The 1-based line.
    pub line: usize,
    /// Where the match sits in the note's text, in bytes. Only meaningful
    /// against the bytes whose hash the file plan carries.
    pub from: usize,
    pub to: usize,
    /// The words before and after the match, for the preview.
    pub left: String,
    pub right: String,
    /// The text matched, and what it would become.
    pub found: String,
    pub replacement: String,
}

/// The changes to one note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlan {
    pub path: String,
    pub relative: String,
    /// SHA-256 of the bytes the plan was made against.
    pub hash: String,
    pub changes: Vec<Change>,
}

/// Everything a replacement would do, before any of it is done.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub files: Vec<FilePlan>,
    /// The number of changes, so the window can say it in a sentence.
    pub changes: usize,
    /// True when the plan stopped at [`MAX_CHANGES`]. The window says so, and
    /// the person runs it again for the rest.
    pub truncated: bool,
}

/// What a replacement did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// The notes written, by path.
    pub paths: Vec<String>,
    pub changes: usize,
    /// Notes left alone because they changed since the plan, by vault path.
    pub skipped: Vec<String>,
    #[serde(skip)]
    pub restore: Vec<Restore>,
}

/// One note as it was before the write, and the hash of what was written.
#[derive(Debug, Clone)]
pub struct Restore {
    pub path: PathBuf,
    pub before: Document,
    pub written: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ReplaceError {
    #[error("a replacement cannot add a line break: it would move every line below it")]
    LineBreak,
    #[error("“{0}” could not be written: {1}")]
    Write(String, String),
}

/// How many changes one plan lists. A replacement of thousands is a
/// replacement nobody reviews; the window says the plan was cut.
pub const MAX_CHANGES: usize = 5_000;

/// How many characters of context each side of a match gets in the preview.
const SIDE_CHARS: usize = 50;

/// What replacing every match of `matcher` in the notes `keys` names with
/// `replacement` would change. With `expand`, `$1` and `${name}` in the
/// replacement are the pattern's groups; without it the replacement is text.
pub fn plan(
    root: &Path,
    keys: &[String],
    matcher: &Regex,
    replacement: &str,
    expand: bool,
) -> Result<Plan, ReplaceError> {
    if replacement.contains('\n') {
        return Err(ReplaceError::LineBreak);
    }
    let mut out = Plan::default();

    'notes: for key in keys {
        let path = index::absolute(root, key);
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(doc) = document::decode(&bytes) else {
            continue;
        };
        let mut changes = Vec::new();
        let mut line_start = 0usize;
        for (index, line) in doc.text.split('\n').enumerate() {
            for captures in matcher.captures_iter(line) {
                let found = captures.get(0).expect("group 0 is the match");
                if found.start() == found.end() {
                    continue;
                }
                let mut becomes = String::new();
                if expand {
                    captures.expand(replacement, &mut becomes);
                } else {
                    becomes.push_str(replacement);
                }
                // A group can hold what the pattern matched, never a line break
                // (the line has none), but `$0` doubled is still one line; the
                // check is here because it is the promise, not because a case
                // is known to break it.
                if becomes.contains('\n') {
                    return Err(ReplaceError::LineBreak);
                }
                if out.changes == MAX_CHANGES {
                    out.truncated = true;
                    if !changes.is_empty() {
                        push_file(&mut out, &path, key, &bytes, changes);
                    }
                    break 'notes;
                }
                changes.push(Change {
                    line: index + 1,
                    from: line_start + found.start(),
                    to: line_start + found.end(),
                    left: tail_chars(&line[..found.start()], SIDE_CHARS),
                    right: head_chars(&line[found.end()..], SIDE_CHARS),
                    found: found.as_str().to_string(),
                    replacement: becomes,
                });
                out.changes += 1;
            }
            line_start += line.len() + 1;
        }
        if !changes.is_empty() {
            push_file(&mut out, &path, key, &bytes, changes);
        }
    }
    Ok(out)
}

fn push_file(out: &mut Plan, path: &Path, key: &str, bytes: &[u8], changes: Vec<Change>) {
    out.files.push(FilePlan {
        path: path.to_string_lossy().into_owned(),
        relative: key.to_string(),
        hash: digest(bytes),
        changes,
    });
}

/// Performs the changes a plan still holds — the window has taken out the ones
/// the person unticked.
///
/// A note that cannot be written stops the whole run with what has been done
/// so far kept for the undo: the files written before it are real, and an error
/// that forgot them would leave the person no way back.
pub fn apply(plan: &Plan) -> (Applied, Option<ReplaceError>) {
    let mut applied = Applied {
        paths: Vec::new(),
        changes: 0,
        skipped: Vec::new(),
        restore: Vec::new(),
    };

    for file in &plan.files {
        if file.changes.is_empty() {
            continue;
        }
        let path = PathBuf::from(&file.path);
        let Ok(bytes) = std::fs::read(&path) else {
            applied.skipped.push(file.relative.clone());
            continue;
        };
        if digest(&bytes) != file.hash {
            applied.skipped.push(file.relative.clone());
            continue;
        }
        let Ok(before) = document::decode(&bytes) else {
            applied.skipped.push(file.relative.clone());
            continue;
        };
        let Some(text) = splice(&before.text, &file.changes) else {
            applied.skipped.push(file.relative.clone());
            continue;
        };

        let written = document::encode(&text, &before.shape);
        if let Err(error) = std::fs::write(&path, &written) {
            return (
                applied,
                Some(ReplaceError::Write(
                    file.relative.clone(),
                    error.to_string(),
                )),
            );
        }
        applied.changes += file.changes.len();
        applied.paths.push(file.path.clone());
        applied.restore.push(Restore {
            path,
            before,
            written: digest(&written),
        });
    }
    (applied, None)
}

/// Puts back what an `apply` changed, note by note — but only a note that
/// still holds exactly what the replacement wrote. A note edited since then
/// holds somebody's newer writing, and restoring over it would lose that to
/// undo a replacement. Such notes are named, not touched.
pub fn undo(applied: &Applied) -> (Vec<String>, Option<ReplaceError>) {
    let mut kept = Vec::new();
    for file in &applied.restore {
        let current = std::fs::read(&file.path).map(|bytes| digest(&bytes));
        if current.ok().as_deref() != Some(file.written.as_str()) {
            kept.push(file.path.to_string_lossy().into_owned());
            continue;
        }
        if let Err(error) = document::write(&file.path, &file.before.text, &file.before.shape) {
            return (
                kept,
                Some(ReplaceError::Write(
                    file.path.to_string_lossy().into_owned(),
                    error.to_string(),
                )),
            );
        }
    }
    (kept, None)
}

/// The text with the changes made, back to front so an earlier splice does not
/// move a later one — or `None` when a range no longer holds what the plan
/// said, or two ranges overlap.
fn splice(text: &str, changes: &[Change]) -> Option<String> {
    let mut ordered: Vec<&Change> = changes.iter().collect();
    ordered.sort_by_key(|change| change.from);
    for pair in ordered.windows(2) {
        if pair[0].to > pair[1].from {
            return None;
        }
    }
    let mut out = text.to_string();
    for change in ordered.into_iter().rev() {
        if out.get(change.from..change.to) != Some(change.found.as_str()) {
            return None;
        }
        out.replace_range(change.from..change.to, &change.replacement);
    }
    Some(out)
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The last `n` characters of a text, with an ellipsis when it was cut.
fn tail_chars(text: &str, n: usize) -> String {
    let count = text.chars().count();
    if count <= n {
        return text.to_string();
    }
    let mut out = String::from("…");
    out.extend(text.chars().skip(count - n));
    out
}

/// The first `n` characters of a text, with an ellipsis when it was cut.
fn head_chars(text: &str, n: usize) -> String {
    if text.chars().count() <= n {
        return text.to_string();
    }
    let mut out: String = text.chars().take(n).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::{Query, matcher};

    fn regex(text: &str, as_regex: bool) -> Regex {
        matcher(&Query {
            text: text.into(),
            regex: as_regex,
            case_sensitive: true,
            ..Query::default()
        })
        .unwrap()
        .unwrap()
    }

    fn vault(files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (key, bytes) in files {
            std::fs::write(index::absolute(dir.path(), key), bytes).unwrap();
        }
        dir
    }

    fn keys(files: &[&str]) -> Vec<String> {
        files.iter().map(|key| key.to_string()).collect()
    }

    #[test]
    fn the_plan_writes_nothing() {
        let dir = vault(&[("a.md", b"old and old\n")]);
        let plan = plan(
            dir.path(),
            &keys(&["a.md"]),
            &regex("old", false),
            "new",
            false,
        )
        .unwrap();
        assert_eq!(plan.changes, 2);
        assert_eq!(
            std::fs::read(dir.path().join("a.md")).unwrap(),
            b"old and old\n"
        );
        let change = &plan.files[0].changes[1];
        assert_eq!(
            (
                change.left.as_str(),
                change.found.as_str(),
                change.right.as_str()
            ),
            ("old and ", "old", "")
        );
    }

    #[test]
    fn only_the_ticked_changes_are_made() {
        let dir = vault(&[("a.md", b"old and old\n")]);
        let mut plan = plan(
            dir.path(),
            &keys(&["a.md"]),
            &regex("old", false),
            "new",
            false,
        )
        .unwrap();
        plan.files[0].changes.remove(0);
        let (applied, error) = apply(&plan);
        assert!(error.is_none());
        assert_eq!(applied.changes, 1);
        assert_eq!(
            std::fs::read(dir.path().join("a.md")).unwrap(),
            b"old and new\n"
        );
    }

    #[test]
    fn every_byte_outside_the_match_survives() {
        // A BOM, CRLF and LF mixed line by line, no final newline, and
        // Cyrillic on the touched line — every shape the document layer keeps.
        let before = "\u{feff}первая old строка\r\nsecond\nthird old\r\nlast".as_bytes();
        let dir = vault(&[("a.md", before)]);
        let plan = plan(
            dir.path(),
            &keys(&["a.md"]),
            &regex("old", false),
            "NEW",
            false,
        )
        .unwrap();
        let (_, error) = apply(&plan);
        assert!(error.is_none());
        let after = std::fs::read(dir.path().join("a.md")).unwrap();
        assert_eq!(
            after,
            "\u{feff}первая NEW строка\r\nsecond\nthird NEW\r\nlast".as_bytes()
        );
    }

    #[test]
    fn groups_are_expanded_only_in_regex_mode() {
        let dir = vault(&[("a.md", b"v1.2\n"), ("b.md", b"v1.2\n")]);
        let pattern = regex(r"v(\d+)\.(\d+)", true);
        let expanded = plan(dir.path(), &keys(&["a.md"]), &pattern, "$2.$1", true).unwrap();
        apply(&expanded);
        let literal = plan(dir.path(), &keys(&["b.md"]), &pattern, "$2.$1", false).unwrap();
        apply(&literal);
        assert_eq!(std::fs::read(dir.path().join("a.md")).unwrap(), b"2.1\n");
        assert_eq!(std::fs::read(dir.path().join("b.md")).unwrap(), b"$2.$1\n");
    }

    #[test]
    fn a_line_break_in_the_replacement_is_refused() {
        let dir = vault(&[("a.md", b"old\n")]);
        let refused = plan(
            dir.path(),
            &keys(&["a.md"]),
            &regex("old", false),
            "a\nb",
            false,
        );
        assert!(matches!(refused, Err(ReplaceError::LineBreak)));
    }

    #[test]
    fn a_note_changed_since_the_plan_is_left_alone() {
        let dir = vault(&[("a.md", b"old\n"), ("b.md", b"old\n")]);
        let plan = plan(
            dir.path(),
            &keys(&["a.md", "b.md"]),
            &regex("old", false),
            "new",
            false,
        )
        .unwrap();
        // Same length, same offsets — only the hash can tell.
        std::fs::write(dir.path().join("a.md"), b"odd\n").unwrap();
        let (applied, _) = apply(&plan);
        assert_eq!(applied.skipped, vec!["a.md"]);
        assert_eq!(std::fs::read(dir.path().join("a.md")).unwrap(), b"odd\n");
        assert_eq!(std::fs::read(dir.path().join("b.md")).unwrap(), b"new\n");
    }

    #[test]
    fn undo_puts_the_bytes_back_but_not_over_newer_writing() {
        let dir = vault(&[("a.md", b"old\r\n"), ("b.md", b"old\n")]);
        let plan = plan(
            dir.path(),
            &keys(&["a.md", "b.md"]),
            &regex("old", false),
            "new",
            false,
        )
        .unwrap();
        let (applied, _) = apply(&plan);
        // Somebody writes in b after the replacement.
        std::fs::write(dir.path().join("b.md"), b"new and more\n").unwrap();

        let (kept, error) = undo(&applied);
        assert!(error.is_none());
        assert_eq!(std::fs::read(dir.path().join("a.md")).unwrap(), b"old\r\n");
        assert_eq!(
            std::fs::read(dir.path().join("b.md")).unwrap(),
            b"new and more\n"
        );
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn a_plan_stops_at_its_ceiling_and_says_so() {
        let text = "x ".repeat(MAX_CHANGES + 5);
        let dir = vault(&[("a.md", text.as_bytes())]);
        let plan = plan(dir.path(), &keys(&["a.md"]), &regex("x", false), "y", false).unwrap();
        assert!(plan.truncated);
        assert_eq!(plan.changes, MAX_CHANGES);
        assert_eq!(plan.files[0].changes.len(), MAX_CHANGES);
    }
}

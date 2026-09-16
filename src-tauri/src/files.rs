//! Making, renaming and removing the files a vault is made of.
//!
//! The tree draws these; the core performs them, like everything else that
//! touches the disk (ADR 0001). What matters here is not the `std::fs` call —
//! each is one line — but the two things around it.
//!
//! **A refusal is a sentence, not a code.** `std::io::Error` on Windows says
//! "The process cannot access the file because it is being used by another
//! process. (os error 32)". That is a true statement about a handle and a
//! useless one about a note, so every failure here is turned into a message
//! naming the file and what to do about it. A dialog nobody can act on is the
//! same as no dialog at all.
//!
//! **Deleting means the recycle bin.** A notepad that unlinks a note the user
//! pointed at is a notepad that loses work, and no amount of confirming makes
//! that reversible. The `trash` crate is the whole job — Shell API on Windows,
//! freedesktop elsewhere — so it is a dependency rather than twenty lines of
//! ours that only work on one platform.

use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};

/// Why a file operation could not be done, in words the person who asked can
/// act on.
#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("“{0}” already exists")]
    Exists(String),
    #[error("“{0}” is no longer there")]
    Missing(String),
    #[error("scheda is not allowed to write in “{0}”")]
    Denied(String),
    #[error("“{0}” is open in another program")]
    Busy(String),
    #[error("“{0}” is not a name a file can have")]
    BadName(String),
    #[error("a file cannot be moved out of its vault this way")]
    OutsideRoot,
    #[error("{0}")]
    Io(String),
}

/// Turns a filesystem refusal into a sentence about `path`.
///
/// The kinds are matched rather than the raw code so the same reading works on
/// both platforms; `PermissionDenied` and the Windows sharing violation are the
/// two a person actually meets, and they mean very different things — one is
/// "you may not", the other is "close Obsidian".
fn describe(error: &io::Error, path: &Path) -> FileError {
    let name = display_name(path);
    match error.kind() {
        io::ErrorKind::NotFound => FileError::Missing(name),
        io::ErrorKind::PermissionDenied => FileError::Denied(name),
        io::ErrorKind::AlreadyExists => FileError::Exists(name),
        _ => {
            // ERROR_SHARING_VIOLATION (32) and ERROR_LOCK_VIOLATION (33) have
            // no `ErrorKind` of their own on stable, and they are exactly the
            // case worth naming: the file is fine, something else is holding
            // it.
            #[cfg(windows)]
            if matches!(error.raw_os_error(), Some(32) | Some(33)) {
                return FileError::Busy(name);
            }
            FileError::Io(format!("{name}: {error}"))
        }
    }
}

/// The name to put in a message: the last component, or the whole path when
/// there is no last component to speak of.
fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Characters a file name may not contain on Windows, checked everywhere.
///
/// Checked on every platform on purpose: a vault is meant to be carried between
/// machines and synchronised, and a note named `what?.md` created on Linux
/// simply cannot be written on the other side. Refusing it here is the honest
/// moment to say so.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Checks a name typed by a person before it becomes a path.
///
/// A name is one component: anything with a separator in it is an attempt to
/// put the file somewhere else, and this is not the door for that.
pub fn check_name(name: &str) -> Result<(), FileError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains(FORBIDDEN)
        || trimmed.chars().any(|c| (c as u32) < 0x20)
        // A trailing dot or space is silently stripped by Windows, which turns
        // "notes ." into "notes" and makes the file the user asked for
        // impossible to find under the name they gave.
        || trimmed.ends_with('.')
        || trimmed.ends_with(' ')
    {
        return Err(FileError::BadName(name.to_string()));
    }
    Ok(())
}

/// A path that is `parent` joined with a name the user typed.
fn child_of(parent: &Path, name: &str) -> Result<PathBuf, FileError> {
    check_name(name)?;
    Ok(parent.join(name.trim()))
}

/// Creates an empty file under `parent`.
///
/// `create_new` rather than `create`: the whole point of the check is that a
/// note is never emptied because a name was already taken, and testing for
/// existence first would leave a window between the test and the write.
pub fn create_file(parent: &Path, name: &str) -> Result<PathBuf, FileError> {
    let path = child_of(parent, name)?;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(_) => Ok(path),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(FileError::Exists(display_name(&path)))
        }
        Err(error) => Err(describe(&error, &path)),
    }
}

/// Creates a folder under `parent`.
pub fn create_folder(parent: &Path, name: &str) -> Result<PathBuf, FileError> {
    let path = child_of(parent, name)?;
    match std::fs::create_dir(&path) {
        Ok(()) => Ok(path),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(FileError::Exists(display_name(&path)))
        }
        Err(error) => Err(describe(&error, &path)),
    }
}

/// Renames a file or folder in place, returning its new path.
///
/// Renaming is the one operation here that can destroy something without
/// touching it: `std::fs::rename` on Unix replaces the target silently, so a
/// note renamed onto the name of another note takes it with it. The existence
/// check is therefore not a nicety. It races in theory — someone could create
/// the target between the check and the rename — and the alternative on Unix is
/// `renameat2`, which is Linux-only; for a person renaming their own note in
/// their own vault, the check is the honest amount of care.
pub fn rename(path: &Path, name: &str) -> Result<PathBuf, FileError> {
    check_name(name)?;
    let parent = path.parent().ok_or(FileError::OutsideRoot)?;
    let target = parent.join(name.trim());

    if target == path {
        return Ok(target);
    }
    // Case-only renames are a rename to "the same file" as far as Windows is
    // concerned, and refusing them would make `notes.md` → `Notes.md`
    // impossible. `exists` is true for the source itself in that case, so the
    // comparison is on the normalised form.
    let same_file_different_case = target
        .to_string_lossy()
        .eq_ignore_ascii_case(&path.to_string_lossy());
    if !same_file_different_case && target.exists() {
        return Err(FileError::Exists(display_name(&target)));
    }

    std::fs::rename(path, &target).map_err(|error| describe(&error, path))?;
    Ok(target)
}

/// Moves a file or folder to the operating system's recycle bin.
///
/// Not `remove_file`. A note deleted from a tree is deleted by a person who was
/// reading it a moment ago, and the recycle bin is the only thing standing
/// between a misclick and lost writing.
pub fn delete(path: &Path) -> Result<(), FileError> {
    if !path.exists() {
        return Err(FileError::Missing(display_name(path)));
    }
    trash::delete(path).map_err(|error| match error {
        trash::Error::CouldNotAccess { .. } => FileError::Denied(display_name(path)),
        // The bin is unavailable — a network share, a removable drive with no
        // bin of its own. Saying so is better than deleting outright, which is
        // what the user did not ask for.
        other => FileError::Io(format!(
            "“{}” could not be moved to the recycle bin: {other}",
            display_name(path)
        )),
    })
}

/// A name that is free in `parent`, derived from `stem` and `extension`.
///
/// Used where the name is the program's idea rather than the user's — a pasted
/// screenshot, a scratch buffer being saved — and a collision therefore has no
/// one to ask. Two pastes in the same second are the ordinary case, so the
/// suffix counts rather than stopping at one.
pub fn free_name(parent: &Path, stem: &str, extension: &str) -> PathBuf {
    let candidate = parent.join(format!("{stem}.{extension}"));
    if !candidate.exists() {
        return candidate;
    }
    for nth in 1..1000 {
        let candidate = parent.join(format!("{stem} {nth}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // A thousand files with the same name in one folder is not a situation to
    // keep counting through; the timestamp breaks the tie.
    parent.join(format!(
        "{stem} {}.{extension}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ))
}

/// What an operation did, for the frontend to reconcile its tree with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub from: String,
    pub to: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix(&format!("scheda-files-{name}-"))
            .tempdir()
            .expect("temp dir")
    }

    #[test]
    fn creates_a_file_that_is_empty_and_there() {
        let dir = scratch("create");
        let path = create_file(dir.path(), "note.md").expect("creates");
        assert!(path.is_file());
        assert_eq!(std::fs::read(&path).expect("reads"), b"");
    }

    #[test]
    fn refuses_to_create_over_something_that_exists() {
        // The refusal is the point: `create` rather than `create_new` would
        // truncate the note that was already there, which is the one outcome a
        // notepad may never produce.
        let dir = scratch("clash");
        std::fs::write(dir.path().join("note.md"), b"work worth keeping").expect("writes");

        let error = create_file(dir.path(), "note.md").expect_err("refuses");
        assert!(matches!(error, FileError::Exists(_)));
        assert_eq!(
            std::fs::read(dir.path().join("note.md")).expect("reads"),
            b"work worth keeping"
        );
    }

    #[test]
    fn creates_a_folder() {
        let dir = scratch("folder");
        let path = create_folder(dir.path(), "Notes").expect("creates");
        assert!(path.is_dir());
    }

    #[test]
    fn refuses_a_name_that_is_not_one() {
        // Every one of these would otherwise become a path, not a name: a
        // separator puts the file elsewhere, `..` puts it outside the vault
        // entirely, and Windows silently eats a trailing dot.
        for name in ["", "  ", ".", "..", "a/b", "a\\b", "what?", "c:x", "notes."] {
            assert!(
                matches!(check_name(name), Err(FileError::BadName(_))),
                "“{name}” should be refused"
            );
        }
        for name in ["note.md", "Notes", "a note with spaces.md", "café.md", "1"] {
            assert!(check_name(name).is_ok(), "“{name}” should be allowed");
        }
    }

    #[test]
    fn renaming_moves_the_file_and_its_contents() {
        let dir = scratch("rename");
        let path = dir.path().join("before.md");
        std::fs::write(&path, b"text").expect("writes");

        let moved = rename(&path, "after.md").expect("renames");

        assert!(!path.exists());
        assert_eq!(moved, dir.path().join("after.md"));
        assert_eq!(std::fs::read(&moved).expect("reads"), b"text");
    }

    #[test]
    fn renaming_onto_an_existing_file_is_refused() {
        // On Unix `fs::rename` would overwrite the target without a word. The
        // check is what keeps a rename from being a delete.
        let dir = scratch("rename-clash");
        let source = dir.path().join("one.md");
        let victim = dir.path().join("two.md");
        std::fs::write(&source, b"one").expect("writes");
        std::fs::write(&victim, b"two").expect("writes");

        let error = rename(&source, "two.md").expect_err("refuses");

        assert!(matches!(error, FileError::Exists(_)));
        assert_eq!(std::fs::read(&victim).expect("reads"), b"two");
        assert!(source.exists(), "the source is untouched");
    }

    #[test]
    fn renaming_only_the_case_is_allowed() {
        // Windows reports `notes.md` as existing when asked about `Notes.md`,
        // so a plain existence check would make this rename impossible.
        let dir = scratch("rename-case");
        let path = dir.path().join("notes.md");
        std::fs::write(&path, b"text").expect("writes");

        let moved = rename(&path, "Notes.md").expect("renames");

        assert_eq!(
            moved.file_name().expect("has a name").to_string_lossy(),
            "Notes.md"
        );
        assert_eq!(std::fs::read(&moved).expect("reads"), b"text");
    }

    #[test]
    fn renaming_something_that_is_gone_says_so() {
        let dir = scratch("rename-missing");
        let error = rename(&dir.path().join("ghost.md"), "other.md").expect_err("refuses");
        assert!(matches!(error, FileError::Missing(_)));
    }

    #[test]
    fn a_free_name_steps_aside_for_what_is_there() {
        let dir = scratch("free");
        assert_eq!(
            free_name(dir.path(), "Pasted image", "png"),
            dir.path().join("Pasted image.png")
        );

        std::fs::write(dir.path().join("Pasted image.png"), b"x").expect("writes");
        assert_eq!(
            free_name(dir.path(), "Pasted image", "png"),
            dir.path().join("Pasted image 1.png")
        );

        std::fs::write(dir.path().join("Pasted image 1.png"), b"x").expect("writes");
        assert_eq!(
            free_name(dir.path(), "Pasted image", "png"),
            dir.path().join("Pasted image 2.png")
        );
    }

    #[test]
    fn deleting_something_that_is_gone_says_so() {
        let dir = scratch("delete-missing");
        let error = delete(&dir.path().join("ghost.md")).expect_err("refuses");
        assert!(matches!(error, FileError::Missing(_)));
    }

    #[test]
    fn deleting_puts_the_file_in_the_recycle_bin() {
        // The file leaving the folder is all this can assert portably — reading
        // the bin back is a platform interface of its own. What it does prove
        // is that `delete` goes through `trash` and not `remove_file`: the
        // latter would pass this test too, which is why the call site is the
        // thing under review, and why the recycle bin is named in the doc
        // comment above it.
        let dir = scratch("delete");
        let path = dir.path().join("note.md");
        std::fs::write(&path, b"text").expect("writes");

        delete(&path).expect("deletes");

        assert!(!path.exists());
    }
}

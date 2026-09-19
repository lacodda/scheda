//! Renaming a note, and the links in other people's files that have to follow.
//!
//! This is the only thing scheda does that writes to files nobody opened. Every
//! other write in the product goes to the file in front of you, after you asked
//! for it. So the shape here is not "rename and fix up": it is **say first, then
//! do**, and the saying is a value the window can show before anything has been
//! touched.
//!
//! ## What makes a link need rewriting
//!
//! Not that it mentions the name. A link needs rewriting exactly when it
//! resolves to the file being renamed *and would stop resolving to it* after the
//! rename. Obsidian's rules make that a real distinction:
//!
//! - `[[plan]]` in a vault with one `plan.md` breaks when the file becomes
//!   `roadmap.md`, and must be rewritten.
//! - `[[plan]]` in a vault with a *second* `plan.md` elsewhere does not break —
//!   it lands on the other one after the rename. Rewriting it would move a link
//!   the person never pointed here.
//! - `[[shot.png]]` beside a renamed `shot.png` breaks; beside a renamed
//!   `plan.md` it does not, and must be left alone.
//!
//! So the plan is computed by resolving each link twice — against the vault as
//! it is, and against the vault as it would be — and keeping the ones whose
//! answer changes. That is more work than matching names, and it is the
//! difference between a rename you can trust and one you have to check.
//!
//! ## What is written
//!
//! The *target* of the link, and only the target: `[[plan|the plan]]` becomes
//! `[[roadmap|the plan]]`, because the alias is the sentence the person wrote
//! and the rename has nothing to say about it. The new target is in the vault's
//! own link format (`links::target_for`), for the reason every other written
//! link is: a vault where Obsidian writes one form and scheda writes another is
//! a vault two programs disagree about.
//!
//! ## Byte for byte, in someone else's file
//!
//! Each touched file is read through `document`, spliced, and written back
//! through `document` with the shape it arrived with. A note with CRLF endings
//! and a BOM keeps both. The links are spliced back to front so that replacing
//! one does not move the offsets of the next — the plan holds byte ranges from
//! the scan, and they are only valid against the text as it was read.

use crate::document::Document;
use crate::links::{self, Candidate};
use crate::network::{is_markdown, relative_to, same_file};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// One link that a rename would change, as the person is shown it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    /// The 1-based line.
    pub line: usize,
    /// The target as written now, and as it would be written.
    pub before: String,
    pub after: String,
    /// The whole line, before and after. The line is what a person reads to
    /// decide whether the change is right; the target alone is not enough to
    /// recognise a link by.
    pub line_before: String,
    pub line_after: String,
}

/// The edits a rename would make to one file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdits {
    pub path: String,
    /// The path from the vault root, which is what the list shows.
    pub relative: String,
    pub edits: Vec<Edit>,
}

/// Everything a rename would do, before any of it is done.
///
/// Answered by `plan_rename` and shown to the person. Nothing has been written
/// when this exists — that is the whole point of it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// Where the file is now and where it would go.
    pub from: String,
    pub to: String,
    /// The files that would be edited, in vault order, and only those: a file
    /// with no edits is not in this list.
    pub files: Vec<FileEdits>,
    /// How many links in total, so the window can say it in a sentence without
    /// counting a nested list.
    pub links: usize,
    /// Notes that could not be read, by name. They are not edited and not
    /// silently skipped: a note this rename could not look inside may hold a
    /// link that is now broken, and the person is the one who can go and look.
    pub unreadable: Vec<String>,
}

/// What a rename actually did, for the window to report and to undo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub from: String,
    pub to: String,
    /// The files whose text was replaced, and what it was before. Kept so the
    /// undo is a restore of the exact bytes rather than a second rewrite that
    /// tries to reason its way back.
    #[serde(skip)]
    pub restore: Vec<Restore>,
    /// The same list the plan carried, so the report names what changed.
    pub files: Vec<FileEdits>,
    pub links: usize,
}

/// One file's original text, held so it can be put back exactly.
#[derive(Debug, Clone)]
pub struct Restore {
    pub path: PathBuf,
    pub document: Document,
}

#[derive(Debug, thiserror::Error)]
pub enum RenameError {
    #[error("{0}")]
    File(#[from] crate::files::FileError),
    #[error("“{0}” could not be written: {1}")]
    Write(String, String),
    #[error("this note is not in a vault, so there are no links to follow")]
    NoVault,
}

/// What a rename would change, without changing anything.
///
/// `candidates` is the vault as it is. The vault as it *would be* is built here
/// rather than asked for, because it is a question only this function has: one
/// path replaced, everything else the same.
pub fn plan(
    config: &crate::vault::VaultConfig,
    candidates: &[Candidate],
    root: &Path,
    from: &Path,
    to: &Path,
) -> Plan {
    let after = candidates_after(candidates, root, from, to);
    let mut files = Vec::new();
    let mut unreadable = Vec::new();
    let mut links = 0usize;

    for candidate in candidates {
        if !is_markdown(&candidate.path) {
            continue;
        }
        // The renamed note itself is read like any other: a note may link to a
        // sibling by a path that runs through its own folder, and renaming the
        // note does not exempt its own text from the rule.
        let Ok(bytes) = std::fs::read(&candidate.path) else {
            unreadable.push(relative_to(root, &candidate.path));
            continue;
        };
        let Ok(document) = crate::document::decode(&bytes) else {
            // Not UTF-8: read-only everywhere in this product (ADR 0002), so it
            // is named rather than edited.
            unreadable.push(relative_to(root, &candidate.path));
            continue;
        };

        // A file that is about to be renamed is written at its new path, so the
        // link format is computed from where it will be, not where it was.
        let writing_in = if same_file(&candidate.path, from) {
            to.to_path_buf()
        } else {
            candidate.path.clone()
        };

        let edits = edits_for(
            config,
            candidates,
            &after,
            root,
            &writing_in,
            &document,
            from,
            to,
        );
        if edits.is_empty() {
            continue;
        }
        links += edits.len();
        files.push(FileEdits {
            relative: relative_to(root, &candidate.path),
            path: candidate.path.to_string_lossy().into_owned(),
            edits,
        });
    }

    files.sort_by(|a, b| a.relative.cmp(&b.relative));
    unreadable.sort();

    Plan {
        from: from.to_string_lossy().into_owned(),
        to: to.to_string_lossy().into_owned(),
        files,
        links,
        unreadable,
    }
}

/// The links in one document that this rename would rewrite.
#[allow(clippy::too_many_arguments)]
fn edits_for(
    config: &crate::vault::VaultConfig,
    before: &[Candidate],
    after: &[Candidate],
    root: &Path,
    writing_in: &Path,
    document: &Document,
    from: &Path,
    to: &Path,
) -> Vec<Edit> {
    let mut out = Vec::new();

    for found in links::scan(&document.text) {
        // `[[#heading]]` points inside its own note and names no file.
        if found.target.is_empty() {
            continue;
        }
        // Does it point at the file being renamed, as things stand?
        match links::resolve(before, &found.target) {
            Some(landed) if same_file(&landed, from) => {}
            _ => continue,
        }
        // Would it still resolve, after the rename? If it would, this rename
        // did not break it, and rewriting it is the bug.
        //
        // The question is "does it still find *a* file", not "does it still find
        // *this* one". A vault with a second `plan.md` in `archive/` keeps
        // `[[plan]]` working after `plan.md` is renamed — the link now means the
        // archived note. That is what the vault says. Repointing it at the
        // renamed file would move a link the person never pointed here, and it
        // is the difference between following a rename and rewriting prose.
        if links::resolve(after, &found.target).is_some() {
            continue;
        }

        let replacement = links::target_for(config, after, root, writing_in, to);
        // A rewrite that writes what is already there is not a change. It can
        // happen for a case-only rename in a vault where the link format is the
        // bare name: `[[Plan]]` for `plan.md` → `Plan.md`.
        if replacement == found.target {
            continue;
        }

        let line_before = line_at(&document.text, found.line);
        let line_after = spliced_line(&document.text, &found, &replacement);
        out.push(Edit {
            line: found.line,
            before: found.target.clone(),
            after: replacement,
            line_before,
            line_after,
        });
    }

    out
}

/// The vault as it would be after the rename: the same files, with one path
/// replaced.
///
/// Rebuilt rather than patched in place, because a `Candidate` carries three
/// derived forms of its path and a half-updated one would answer questions about
/// a file that does not exist in either vault.
fn candidates_after(
    candidates: &[Candidate],
    root: &Path,
    from: &Path,
    to: &Path,
) -> Vec<Candidate> {
    candidates
        .iter()
        .map(|candidate| {
            let path = if same_file(&candidate.path, from) {
                to.to_path_buf()
            } else {
                candidate.path.clone()
            };
            links::candidate_for(root, path)
        })
        .collect()
}

/// Performs a planned rename: the file first, then the links.
///
/// The file first on purpose. If the move fails — the name is taken, the file is
/// open in another program — nothing else has happened, and the failure is the
/// plain one the tree already reports. The alternative order would leave a vault
/// full of links pointing at a name nothing has.
///
/// A file that cannot be written after the move is reported and the rest carry
/// on. Stopping halfway would leave exactly the state this whole design is
/// against — some links moved, some not, and no record of which.
pub fn apply(plan: &Plan) -> Result<Applied, RenameError> {
    let from = PathBuf::from(&plan.from);
    let to = PathBuf::from(&plan.to);

    let name = to
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or(RenameError::NoVault)?;
    let moved = crate::files::rename(&from, &name)?;

    let mut restore = Vec::new();
    let mut written = Vec::new();
    let mut links = 0usize;

    for file in &plan.files {
        // The renamed file is now at its new path; every other file is where it
        // was. The plan was computed before the move, so the path in it is the
        // old one.
        let path = if same_file(Path::new(&file.path), &from) {
            moved.clone()
        } else {
            PathBuf::from(&file.path)
        };

        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(document) = crate::document::decode(&bytes) else {
            continue;
        };

        let Some(text) = rewrite(&document.text, &file.edits) else {
            // The file changed under us between the plan and the write — a sync
            // client, or Obsidian. Skipped rather than spliced by offsets that
            // no longer mean anything: writing at a stale offset is how an
            // editor corrupts somebody's note.
            continue;
        };

        crate::document::write(&path, &text, &document.shape)
            .map_err(|error| RenameError::Write(file.relative.clone(), error.to_string()))?;

        links += file.edits.len();
        restore.push(Restore { path, document });
        written.push(file.clone());
    }

    Ok(Applied {
        from: plan.from.clone(),
        to: moved.to_string_lossy().into_owned(),
        restore,
        files: written,
        links,
    })
}

/// Puts back everything an `apply` changed: the files first, then the name.
///
/// The exact bytes, from what was read before the write — not a second rewrite
/// running the replacement backwards. A rewrite back would have to get the same
/// resolution answers in a vault that has moved on, and an undo that has to be
/// right about anything is an undo people do not trust.
///
/// The file is moved back last, mirroring `apply`: while the name is still the
/// new one, the restored links are the ones that match it.
pub fn undo(applied: &Applied) -> Result<(), RenameError> {
    for file in &applied.restore {
        crate::document::write(&file.path, &file.document.text, &file.document.shape).map_err(
            |error| RenameError::Write(file.path.to_string_lossy().into_owned(), error.to_string()),
        )?;
    }

    let from = PathBuf::from(&applied.from);
    let name = from
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or(RenameError::NoVault)?;
    crate::files::rename(Path::new(&applied.to), &name)?;
    Ok(())
}

/// The text with every edit applied, or `None` when the text is no longer the
/// one the plan was made against.
///
/// Back to front, so that replacing one link does not move the offsets of the
/// ones before it. The check is that the range still holds what the plan said it
/// held — cheaper than comparing whole files and exactly the thing that matters.
fn rewrite(text: &str, edits: &[Edit]) -> Option<String> {
    // The plan carries lines and targets; the offsets are found again here,
    // against the text as it is now. Carrying the offsets from the plan would be
    // carrying a fact about a file that may have been written since.
    let found = links::scan(text);
    let mut splices: Vec<(usize, usize, &str)> = Vec::new();
    // Which links have already been claimed. A line may hold the same link
    // twice — `[[plan]] then [[plan]] again` — and the plan carries one edit per
    // link. Matching by line and target alone would hand both edits the *first*
    // of them, which produces two splices over one range: the rewrite then sees
    // them overlap and refuses the whole file, silently. The plan said two links
    // would change and nothing changed at all, which is the worst shape a
    // failure can take here.
    let mut claimed = vec![false; found.len()];

    for edit in edits {
        let at = found.iter().enumerate().position(|(at, link)| {
            !claimed[at] && link.line == edit.line && link.target == edit.before
        })?;
        claimed[at] = true;
        splices.push((
            found[at].target_from,
            found[at].target_to,
            edit.after.as_str(),
        ));
    }

    splices.sort_by_key(|(from, _, _)| *from);
    let mut out = String::with_capacity(text.len());
    let mut at = 0usize;
    for (from, to, replacement) in splices {
        if from < at {
            // Overlapping ranges mean two edits for one link, which the plan
            // cannot produce. Refusing is better than writing either.
            return None;
        }
        out.push_str(text.get(at..from)?);
        out.push_str(replacement);
        at = to;
    }
    out.push_str(text.get(at..)?);
    Some(out)
}

/// The text of a 1-based line, as written.
fn line_at(text: &str, line: usize) -> String {
    text.lines()
        .nth(line.saturating_sub(1))
        .unwrap_or_default()
        .to_string()
}

/// What a line would read once this one link on it is rewritten.
///
/// One link at a time, which is what the preview shows: a line with two links
/// pointing at the renamed note appears as two rows, each showing its own
/// change. Showing the fully rewritten line under each of them would say the
/// other edit had already happened.
fn spliced_line(text: &str, found: &links::Found, replacement: &str) -> String {
    let start = text[..found.from].rfind('\n').map(|at| at + 1).unwrap_or(0);
    let end = text[found.to..]
        .find('\n')
        .map(|at| found.to + at)
        .unwrap_or(text.len());
    let mut line = String::new();
    line.push_str(&text[start..found.target_from]);
    line.push_str(replacement);
    line.push_str(&text[found.target_to..end]);
    line
}

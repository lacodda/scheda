//! The network a vault's notes make: what points at a note, and what points at
//! nothing at all.
//!
//! Both questions are answered by reading every note in the vault and scanning
//! it for wikilinks (`links::scan`). That is the honest shape of the question:
//! "what links here" cannot be answered from the note itself — the answer lives
//! in the other files, and only they know it.
//!
//! **Answered from the index.** v0.8 read every note on every ask, which on a
//! vault of six thousand notes was ~590 ms of disk each time the panel opened.
//! The index (`index.rs`) holds the same reading — the same `links::scan` — and
//! is reconciled against the disk on open and fed by the watcher, so the panel
//! now asks it instead of the files.
//!
//! **A link is a target, not a string.** Two notes may link to the same file by
//! different names — `[[plan]]` and `[[projects/plan]]` both land on one note —
//! so a backlink is counted by where the link *resolves*, through the same
//! `links::resolve` the click goes through. Matching the written text would show
//! a note half its backlinks and call the rest broken.

use crate::index::{self, LinkAt, Snapshot};
use crate::links::{self, Candidate};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// One link found in one note, as the panel shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// The file the link was written in.
    pub path: String,
    /// That file's path from the vault root, which is what the panel lists.
    pub relative: String,
    /// The 1-based line it is on.
    pub line: usize,
    /// The line's text, trimmed. What makes a backlink useful is the sentence
    /// around it: a list of file names says which notes mention this one, and a
    /// list of sentences says what they say about it.
    pub context: String,
    /// The target as written, so `[[plan]]` and `[[projects/plan]]` are
    /// distinguishable in a list where both resolve here.
    pub target: String,
}

/// A link in the open note that resolves to nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unresolved {
    pub target: String,
    pub line: usize,
    pub context: String,
}

/// What points at a note, and what the note points at in vain.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub backlinks: Vec<Reference>,
    pub unresolved: Vec<Unresolved>,
}

/// Every note in the vault that links to `note`, plus the links in `note`
/// itself that go nowhere.
///
/// Answered from the index (`index.rs`), which holds every note's links with
/// the line each is on. The resolving is still done here, at the moment of
/// asking, against the vault's files as they are now: where a link lands
/// depends on which other files exist, and that is exactly what an index of
/// what each note *says* cannot know.
pub fn around(root: &Path, candidates: &[Candidate], snapshot: &Snapshot, note: &Path) -> Network {
    let mut network = Network::default();

    for (relative, indexed) in &snapshot.notes {
        let path = index::absolute(root, relative);
        // A note does not link to itself in the backlink panel: the note is on
        // screen, and a row pointing at the thing you are reading is a row
        // nobody follows. Its own links are still read — for the unresolved
        // list, which is exactly about this note.
        let own = same_file(&path, note);

        for found in &indexed.links {
            if own {
                collect_unresolved(candidates, found, &mut network);
                continue;
            }
            // `[[#heading]]` points inside the note it is written in, so it is
            // never a link to another one.
            if found.target.is_empty() {
                continue;
            }
            let Some(landed) = links::resolve(candidates, &found.target) else {
                continue;
            };
            if !same_file(&landed, note) {
                continue;
            }
            network.backlinks.push(Reference {
                relative: relative.clone(),
                path: path.to_string_lossy().into_owned(),
                line: found.line,
                context: found.context.clone(),
                target: found.target.clone(),
            });
        }
    }

    // A stable order, so the panel does not reshuffle itself between two asks
    // that found the same things. By file, then down the file.
    network
        .backlinks
        .sort_by(|a, b| (&a.relative, a.line).cmp(&(&b.relative, b.line)));
    network.unresolved.sort_by_key(|link| link.line);
    network
}

/// The links of the open note that resolve to nothing.
fn collect_unresolved(candidates: &[Candidate], found: &LinkAt, network: &mut Network) {
    // A link into this note by heading alone has no file to find.
    if found.target.is_empty() {
        return;
    }
    if links::resolve(candidates, &found.target).is_some() {
        return;
    }
    // The same target written twice is one thing left to write, not two.
    if network
        .unresolved
        .iter()
        .any(|link| link.target == found.target)
    {
        return;
    }
    network.unresolved.push(Unresolved {
        target: found.target.clone(),
        line: found.line,
        context: found.context.clone(),
    });
}

/// Whether a path is a markdown note. Only notes are read: a link may point at a
/// picture, but a picture holds no links.
pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

/// The path from the vault root, with forward slashes.
pub fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Whether two paths name the same file.
///
/// Compared component by component rather than as two strings. The strings are
/// not comparable: a path built by joining — which is how a rename's destination
/// is built — carries the separator the join used, so `notes\plan.md` and
/// `notes/roadmap.md` can name files in the same folder and share no prefix as
/// text. Comparing components asks the question about the path rather than about
/// how it was spelled. (Found by a rename that planned nothing at all for a link
/// written as a path, while every one of its unit tests was green: the two
/// spellings met only where a `join` and a `read_dir` result were compared.)
///
/// Case-insensitively on Windows, where two spellings do name one file, and
/// exactly elsewhere — the same reasoning as the resolver's: a vault is carried
/// between a case-sensitive filesystem and a case-preserving one.
pub fn same_file(a: &Path, b: &Path) -> bool {
    let mut left = a.components();
    let mut right = b.components();
    loop {
        match (left.next(), right.next()) {
            (None, None) => return true,
            (Some(one), Some(other)) if part_matches(&one, &other) => {}
            _ => return false,
        }
    }
}

/// Whether two path components name the same thing.
fn part_matches(one: &std::path::Component<'_>, other: &std::path::Component<'_>) -> bool {
    #[cfg(windows)]
    {
        one.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&other.as_os_str().to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        one == other
    }
}

/// Every markdown note in the vault, as absolute paths.
pub fn notes_of(candidates: &[Candidate]) -> Vec<PathBuf> {
    candidates
        .iter()
        .map(|candidate| candidate.path.clone())
        .filter(|path| is_markdown(path))
        .collect()
}

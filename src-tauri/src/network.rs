//! The network a vault's notes make: what points at a note, and what points at
//! nothing at all.
//!
//! Both questions are answered by reading every note in the vault and scanning
//! it for wikilinks (`links::scan`). That is the honest shape of the question:
//! "what links here" cannot be answered from the note itself — the answer lives
//! in the other files, and only they know it.
//!
//! **Read, do not index.** A vault of a few thousand notes is a few megabytes of
//! markdown; reading it is tens of milliseconds, and the alternative is a stored
//! index that is a second truth about the vault and wrong every time Obsidian
//! writes a note while this window is closed. The panel asks when it is opened
//! and after the watcher says something changed, which is rarely, and the cost
//! is paid where the person asked for it rather than at startup (v0.9.0 is where
//! an index earns its keep, and it will be built on this reading rather than
//! instead of it).
//!
//! **A link is a target, not a string.** Two notes may link to the same file by
//! different names — `[[plan]]` and `[[projects/plan]]` both land on one note —
//! so a backlink is counted by where the link *resolves*, through the same
//! `links::resolve` the click goes through. Matching the written text would show
//! a note half its backlinks and call the rest broken.

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

/// How many notes are read before the answer is called good enough.
///
/// A ceiling rather than a promise of completeness, and it is high enough that
/// no vault a person edits by hand reaches it. It exists so that pointing scheda
/// at a folder of a hundred thousand generated files does not freeze the window:
/// a panel that is slow the first time teaches people not to open it.
const MAX_NOTES_READ: usize = 20_000;

/// Every note in the vault that links to `note`, plus the links in `note`
/// itself that go nowhere.
///
/// Both in one walk, because both need the same thing — every note's text — and
/// reading the vault twice to answer two questions asked at the same moment is
/// the round trip this product keeps refusing.
pub fn around(root: &Path, candidates: &[Candidate], note: &Path) -> Network {
    let mut network = Network::default();
    let mut read = 0usize;

    for candidate in candidates {
        if read >= MAX_NOTES_READ {
            break;
        }
        if !is_markdown(&candidate.path) {
            continue;
        }
        // A note does not link to itself in the backlink panel: the note is on
        // screen, and a row pointing at the thing you are reading is a row
        // nobody follows. Its own links are still read — for the unresolved
        // list, which is exactly about this note.
        let own = same_file(&candidate.path, note);

        let Ok(bytes) = std::fs::read(&candidate.path) else {
            continue;
        };
        // Through the document layer, so what is scanned is the text an editor
        // would show. A note that is not UTF-8 is skipped rather than guessed
        // at: it is read-only here anyway (ADR 0002).
        let Ok(document) = crate::document::decode(&bytes) else {
            continue;
        };
        read += 1;

        for found in links::scan(&document.text) {
            if own {
                collect_unresolved(candidates, &document.text, &found, &mut network);
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
                relative: relative_to(root, &candidate.path),
                path: candidate.path.to_string_lossy().into_owned(),
                line: found.line,
                context: line_at(&document.text, found.line),
                target: found.target,
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

/// The links of the open note that resolve to nothing, gathered as its own text
/// is scanned.
fn collect_unresolved(
    candidates: &[Candidate],
    text: &str,
    found: &links::Found,
    network: &mut Network,
) {
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
        context: line_at(text, found.line),
    });
}

/// The text of a 1-based line, trimmed, and cut if it is a paragraph rather than
/// a line.
fn line_at(text: &str, line: usize) -> String {
    const CONTEXT_CHARS: usize = 200;
    let raw = text.lines().nth(line.saturating_sub(1)).unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.chars().count() <= CONTEXT_CHARS {
        return trimmed.to_string();
    }
    // Cut by characters, not bytes: a note in Cyrillic would otherwise be cut to
    // half the length, and through the middle of a character at that.
    let mut out: String = trimmed.chars().take(CONTEXT_CHARS).collect();
    out.push('…');
    out
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

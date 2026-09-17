//! Going to a file by typing part of its name.
//!
//! The matching is here rather than in the window for the reason everything
//! else is: the list of files is the core's, and shipping a few thousand paths
//! across the boundary on every keystroke so the other side can filter them is
//! a round trip per character to answer a question the core could answer once.
//!
//! **Subsequence matching, scored.** Typing `rel` finds `release-notes.md`, and
//! also `Projects/rigger/plan.md` if the letters fall that way — but the first
//! is offered before the second, because the score prefers letters that start
//! words, letters that are close together, and matches in the name over matches
//! in the folders above it. That ordering is the whole feature: a list that
//! contains the file you want somewhere in it is not a way of going to a file.

use serde::Serialize;
use std::path::Path;

/// How many files come back. Long enough that the answer is almost always in
/// it, short enough that the window draws a list rather than a second tree.
const LIMIT: usize = 40;

/// One candidate: where it is, and what to show for it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    /// The file's own name, which is what the row leads with.
    pub name: String,
    /// The folders between the root and the file, already joined with `/` — the
    /// dimmer half of the row. Empty for a file at the root.
    pub folder: String,
    /// Which characters of `name` the query matched, as indices into its
    /// characters. The window draws these in bold; without them a fuzzy list is
    /// a list of files with no explanation of why they are in it.
    pub matched: Vec<usize>,
}

/// A file the picker may offer, flattened out of the tree.
pub struct Candidate {
    pub path: String,
    pub name: String,
    pub folder: String,
}

/// Flattens a tree into the files a picker offers.
///
/// Folders are not candidates: `Ctrl+P` opens a file, and a list where half the
/// rows do nothing when chosen is a list that has to be read twice.
pub fn candidates(root: &Path, entries: &[crate::tree::Entry]) -> Vec<Candidate> {
    let mut out = Vec::new();
    collect(root, entries, &mut out);
    out
}

fn collect(root: &Path, entries: &[crate::tree::Entry], out: &mut Vec<Candidate>) {
    for entry in entries {
        match &entry.children {
            Some(children) => collect(root, children, out),
            None => out.push(Candidate {
                folder: folder_of(root, &entry.path),
                name: entry.name.clone(),
                path: entry.path.clone(),
            }),
        }
    }
}

/// The folders between the root and a file, with forward slashes.
///
/// Forward slashes on every platform: this string is shown, not walked, and a
/// vault carried between machines should not read differently on each.
fn folder_of(root: &Path, path: &str) -> String {
    let path = Path::new(path);
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative
        .parent()
        .map(|parent| {
            parent
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// The best matches for `query`, best first.
///
/// An empty query answers with the first files in the vault rather than with
/// nothing: the picker opens before anything is typed, and an empty panel is a
/// worse answer than a place to start.
pub fn search(candidates: &[Candidate], query: &str) -> Vec<Hit> {
    let query = query.trim();
    if query.is_empty() {
        return candidates
            .iter()
            .take(LIMIT)
            .map(|candidate| Hit {
                path: candidate.path.clone(),
                name: candidate.name.clone(),
                folder: candidate.folder.clone(),
                matched: Vec::new(),
            })
            .collect();
    }

    let needle: Vec<char> = query.to_lowercase().chars().collect();
    let mut scored: Vec<(i32, usize, Hit)> = Vec::new();

    for (index, candidate) in candidates.iter().enumerate() {
        // The name first, because that is what people type. A file matched only
        // through its folders is still offered, but never ahead of one matched
        // by its own name — the penalty below is larger than any bonus the
        // scorer can hand out.
        let scored_hit = match score(&candidate.name, &needle) {
            Some((points, matched)) => Some((points, matched)),
            None => {
                let whole = format!("{}/{}", candidate.folder, candidate.name);
                score(&whole, &needle).map(|(points, _)| (points - FOLDER_ONLY_PENALTY, Vec::new()))
            }
        };
        let Some((points, matched)) = scored_hit else {
            continue;
        };
        scored.push((
            points,
            index,
            Hit {
                path: candidate.path.clone(),
                name: candidate.name.clone(),
                folder: candidate.folder.clone(),
                matched,
            },
        ));
    }

    // By score, then by the order the vault lists them. The tie-break is not
    // decoration: without it two files scoring the same swap places between
    // keystrokes, and a list that reorders under the cursor is a list you
    // cannot click.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    scored.truncate(LIMIT);
    scored.into_iter().map(|(_, _, hit)| hit).collect()
}

/// Taken off a file matched only through the folders above it, so that such a
/// file never outranks one matched by its own name however well the letters
/// happen to fall.
const FOLDER_ONLY_PENALTY: i32 = 10_000;

/// Scores `haystack` against an already-lowercased `needle`, or `None` when the
/// needle is not a subsequence of it.
///
/// Greedy left to right. A proper fuzzy matcher would try every alignment and
/// keep the best; this one takes the first, which differs only for queries
/// whose letters repeat, and costs a fraction of the time on a vault of
/// thousands of files being re-searched on every keystroke.
fn score(haystack: &str, needle: &[char]) -> Option<(i32, Vec<usize>)> {
    let hay: Vec<char> = haystack.chars().collect();
    let lower: Vec<char> = haystack.to_lowercase().chars().collect();
    // `to_lowercase` can lengthen a string — 'İ' becomes two characters — and
    // an index into one taken from the other would then point at the wrong
    // letter. On that rare file, match the original case exactly rather than
    // pointing at nothing.
    let lower = if lower.len() == hay.len() {
        lower
    } else {
        hay.clone()
    };

    let mut matched = Vec::with_capacity(needle.len());
    let mut at = 0usize;
    for &wanted in needle {
        let found = lower[at..].iter().position(|&c| c == wanted)? + at;
        matched.push(found);
        at = found + 1;
    }

    let mut points = 0i32;
    let mut previous: Option<usize> = None;
    for &index in &matched {
        // A letter that starts a word is what people type: `rn` for
        // `release-notes.md`. Worth more than anything else the scorer counts.
        if index == 0 || is_boundary(&hay, index) {
            points += 30;
        }
        match previous {
            // Adjacent letters mean the query is a piece of the name rather
            // than letters scattered through it.
            Some(before) if index == before + 1 => points += 20,
            Some(before) => points -= (index - before - 1).min(10) as i32,
            None => {}
        }
        previous = Some(index);
    }
    // A match that covers most of a short name beats the same letters lost in a
    // long one: typing `plan` should find `plan.md` before `planning-notes.md`.
    points -= hay.len() as i32 / 4;
    points += (needle.len() * 4) as i32;

    Some((points, matched))
}

/// Whether the character at `index` starts a word, by the conventions note
/// names actually use: after a separator, or a capital following a lowercase.
fn is_boundary(hay: &[char], index: usize) -> bool {
    let before = hay[index - 1];
    if before == ' '
        || before == '-'
        || before == '_'
        || before == '/'
        || before == '\\'
        || before == '.'
    {
        return true;
    }
    before.is_lowercase() && hay[index].is_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(folder: &str, name: &str) -> Candidate {
        Candidate {
            path: if folder.is_empty() {
                format!("/vault/{name}")
            } else {
                format!("/vault/{folder}/{name}")
            },
            name: name.to_string(),
            folder: folder.to_string(),
        }
    }

    fn names(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|hit| hit.name.as_str()).collect()
    }

    #[test]
    fn letters_need_not_be_adjacent() {
        let files = [candidate("", "release-notes.md")];
        assert_eq!(names(&search(&files, "rln")), ["release-notes.md"]);
    }

    #[test]
    fn letters_out_of_order_do_not_match() {
        // Subsequence, not "contains these letters": `nlr` is not a way anyone
        // types `release-notes`, and matching it would fill the list with files
        // that share an alphabet with the query.
        let files = [candidate("", "release-notes.md")];
        assert!(search(&files, "nlr").is_empty());
    }

    #[test]
    fn word_starts_come_first() {
        // `rn` is the initials of `release-notes.md` and an accident in
        // `random.md`. The initials win, and this is the ordering the whole
        // feature rests on.
        let files = [
            candidate("", "random.md"),
            candidate("", "release-notes.md"),
        ];
        assert_eq!(names(&search(&files, "rn"))[0], "release-notes.md");
    }

    #[test]
    fn a_shorter_name_wins_the_same_letters() {
        let files = [
            candidate("", "planning-notes-for-later.md"),
            candidate("", "plan.md"),
        ];
        assert_eq!(names(&search(&files, "plan"))[0], "plan.md");
    }

    #[test]
    fn a_name_match_beats_a_folder_match() {
        // Both contain the letters. One of them is called that, and that is the
        // file somebody typing `plan` is going to.
        let files = [
            candidate("plans", "everything-else.md"),
            candidate("archive", "plan.md"),
        ];
        assert_eq!(names(&search(&files, "plan"))[0], "plan.md");
    }

    #[test]
    fn a_folder_still_finds_a_file() {
        // Nothing in the name matches, so the path is tried. Typing the folder
        // you know it is in has to work, or the picker only finds what you can
        // already name.
        let files = [candidate("recipes", "soup.md"), candidate("", "note.md")];
        let hits = search(&files, "recipes");
        assert_eq!(names(&hits), ["soup.md"]);
        // Matched by the path, so nothing in the *name* is highlighted: bolding
        // letters the person did not type in the place they did not type them
        // is worse than bolding nothing.
        assert!(hits[0].matched.is_empty());
    }

    #[test]
    fn case_does_not_matter() {
        let files = [candidate("", "Release Notes.md")];
        assert_eq!(names(&search(&files, "release")), ["Release Notes.md"]);
    }

    #[test]
    fn the_matched_letters_come_back() {
        // The window bolds these. A fuzzy list without them is a list of files
        // with no account of why any of them is in it.
        let files = [candidate("", "notes.md")];
        let hits = search(&files, "nts");
        // n-o-t-e-s: the matcher takes the first `t` it meets, not the one a
        // reader might have had in mind. Greedy is the contract, and the bold
        // letters on screen have to be the ones it actually used.
        assert_eq!(hits[0].matched, [0, 2, 4]);
    }

    #[test]
    fn an_empty_query_offers_the_vault() {
        // The picker opens before anything is typed, and an empty panel is a
        // worse answer than a place to start.
        let files = [candidate("", "a.md"), candidate("", "b.md")];
        let hits = search(&files, "");
        assert_eq!(names(&hits), ["a.md", "b.md"]);
    }

    #[test]
    fn the_list_has_a_ceiling() {
        let files: Vec<Candidate> = (0..LIMIT * 3)
            .map(|n| candidate("", &format!("note-{n}.md")))
            .collect();
        assert_eq!(search(&files, "note").len(), LIMIT);
        assert_eq!(search(&files, "").len(), LIMIT);
    }

    #[test]
    fn equal_scores_keep_the_vaults_order() {
        // Two files that score the same must not swap places between
        // keystrokes: a list that reorders under the cursor cannot be clicked.
        let files = [candidate("", "aa-x.md"), candidate("", "aa-y.md")];
        let once = search(&files, "aa");
        let twice = search(&files, "aa");
        assert_eq!(names(&once), names(&twice));
        assert_eq!(names(&once), ["aa-x.md", "aa-y.md"]);
    }

    #[test]
    fn folders_are_not_offered() {
        // `Ctrl+P` opens a file. A list where half the rows do nothing when
        // chosen has to be read twice.
        let root = Path::new("/vault");
        let entries = vec![crate::tree::Entry {
            name: "notes".into(),
            path: "/vault/notes".into(),
            children: Some(vec![crate::tree::Entry {
                name: "one.md".into(),
                path: "/vault/notes/one.md".into(),
                children: None,
            }]),
        }];
        let found = candidates(root, &entries);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "one.md");
        assert_eq!(found[0].folder, "notes");
    }

    #[test]
    fn a_file_at_the_root_has_no_folder() {
        let root = Path::new("/vault");
        let entries = vec![crate::tree::Entry {
            name: "one.md".into(),
            path: "/vault/one.md".into(),
            children: None,
        }];
        assert_eq!(candidates(root, &entries)[0].folder, "");
    }
}

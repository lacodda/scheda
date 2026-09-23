//! Searching the text of every note in a vault.
//!
//! **Grep, not an index of words.** The index (`index.rs`) knows each note's
//! links, tags and fields; it does not hold the notes' text, and this does not
//! ask it to. A vault of six thousand notes is tens of megabytes of markdown —
//! holding that in memory for a notepad, or on disk as a second copy of the
//! vault, is the wrong trade when reading it back from the operating system's
//! cache across every core takes a fraction of a second. The index is used for
//! what it is good at: the list of notes, and narrowing it by tag or field
//! before a single file is opened.
//!
//! **One engine for every mode.** A plain search and a whole-word search are the
//! same regular expression with the text escaped, so there is one matcher and
//! one set of rules about what a match is. The engine is the `regex` crate,
//! which guarantees linear time: a pattern typed one character at a time cannot
//! be the one that hangs the window.
//!
//! **Line by line.** A match never spans a line break, because what the person
//! is shown is lines, what they navigate to is a line, and what a replacement
//! rewrites (`replace.rs`) must leave every other line byte for byte as it was.

use crate::index::{self, Snapshot};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// What to look for, and where.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    /// The text or the pattern. Empty means "every note the filters allow",
    /// which is how a person lists the notes carrying a tag.
    pub text: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    /// Only notes carrying this tag, or a tag nested under it — `projects`
    /// also finds `projects/scheda`, the way Obsidian's own tag search does.
    #[serde(default)]
    pub tag: Option<String>,
    /// Only notes whose front matter has this field…
    #[serde(default)]
    pub field: Option<String>,
    /// …with a value containing this, when given.
    #[serde(default)]
    pub value: Option<String>,
}

/// One line with a match in it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// The 1-based line.
    pub line: usize,
    /// Where the first match starts in the line, and how long it is — in UTF-16
    /// units, which is what the editor's positions count in.
    pub column: usize,
    pub length: usize,
    /// The line as shown: whole when it is short, a window around the first
    /// match when it is a paragraph.
    pub text: String,
    /// Every match inside `text`, as `[start, end)` in UTF-16 units.
    pub ranges: Vec<[usize; 2]>,
}

/// The matches in one note.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHits {
    pub path: String,
    pub relative: String,
    pub hits: Vec<Hit>,
    /// Matches in this note — not lines: a line with the word twice is two,
    /// and the count beside a note says how much a replacement would change.
    pub matches: usize,
}

/// What a search found.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub files: Vec<FileHits>,
    /// Matches in total — lines with several matches count each one.
    pub matches: usize,
    /// How many notes were searched, after the filters.
    pub notes: usize,
    /// True when the search stopped at [`MAX_MATCHES`] or a note at
    /// [`MAX_HITS_PER_FILE`]: the list is the first part of the answer, and the
    /// window says so rather than letting it pass for all of it.
    pub truncated: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("that is not a pattern this search understands: {0}")]
    Pattern(String),
}

/// Where a search stops listing. Far more than anybody reads; the ceiling is
/// for the one-letter search in a large vault, whose answer is the vault.
pub const MAX_MATCHES: usize = 5_000;

/// Where one note stops listing lines.
pub const MAX_HITS_PER_FILE: usize = 200;

/// How much of a long line is shown.
const WINDOW_CHARS: usize = 240;

/// How much of the window comes before the first match.
const LEAD_CHARS: usize = 60;

/// The matcher for a query, or `None` for an empty one.
pub fn matcher(query: &Query) -> Result<Option<Regex>, SearchError> {
    if query.text.is_empty() {
        return Ok(None);
    }
    let body = if query.regex {
        query.text.clone()
    } else {
        regex::escape(&query.text)
    };
    let pattern = if query.whole_word {
        format!(r"\b(?:{body})\b")
    } else {
        body
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!query.case_sensitive)
        // A pattern is matched a line at a time, so `^` and `$` mean the line.
        .multi_line(true)
        .build()
        .map(Some)
        .map_err(|error| SearchError::Pattern(error.to_string()))
}

/// The notes a query's filters allow, as keys of the index, in vault order.
///
/// Notes that are not UTF-8 are left out: they are read-only here (ADR 0002)
/// and a match found by guessing at their bytes is a match in text the note
/// does not contain.
pub fn notes_for(snapshot: &Snapshot, query: &Query) -> Vec<String> {
    let tag = query
        .tag
        .as_deref()
        .map(|tag| tag.trim().trim_start_matches('#').to_lowercase())
        .filter(|tag| !tag.is_empty());
    let field = query
        .field
        .as_deref()
        .map(str::trim)
        .filter(|field| !field.is_empty());
    let value = query
        .value
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());

    snapshot
        .notes
        .iter()
        .filter(|(_, note)| note.readable)
        .filter(|(_, note)| match &tag {
            None => true,
            Some(wanted) => note.tags.iter().any(|carried| {
                let carried = carried.name.to_lowercase();
                carried == *wanted
                    || carried
                        .strip_prefix(wanted.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
            }),
        })
        .filter(|(_, note)| match field {
            None => true,
            Some(field) => note.fields.get(field).is_some_and(|values| match &value {
                None => true,
                Some(wanted) => values
                    .iter()
                    .any(|value| value.to_lowercase().contains(wanted.as_str())),
            }),
        })
        .map(|(key, _)| key.clone())
        .collect()
}

/// Runs a search over the notes `keys` names.
///
/// Spread over the machine's cores, a slice of the notes each. `cancelled` is
/// asked between notes: the window searches as the person types, and a search
/// for "sch" still reading files when "scheda" has been typed is work nobody
/// will look at. A cancelled search answers `None`.
pub fn run(
    root: &Path,
    keys: &[String],
    matcher: Option<&Regex>,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Option<Found> {
    let Some(matcher) = matcher else {
        // No text: the answer is the notes themselves.
        return Some(Found {
            files: keys
                .iter()
                .map(|key| FileHits {
                    path: index::absolute(root, key).to_string_lossy().into_owned(),
                    relative: key.clone(),
                    hits: Vec::new(),
                    matches: 0,
                })
                .collect(),
            matches: 0,
            notes: keys.len(),
            truncated: false,
        });
    };

    let total = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);
    let stopped = AtomicBool::new(false);
    let workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .clamp(1, 8);

    let mut files: Vec<(usize, FileHits)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                let (total, truncated, stopped) = (&total, &truncated, &stopped);
                scope.spawn(move || {
                    let mut out = Vec::new();
                    for (position, key) in keys.iter().enumerate().skip(worker).step_by(workers) {
                        if stopped.load(Ordering::Relaxed) {
                            break;
                        }
                        if cancelled() {
                            stopped.store(true, Ordering::Relaxed);
                            break;
                        }
                        let path = index::absolute(root, key);
                        let Ok(document) = crate::document::read(&path) else {
                            continue;
                        };
                        let (hits, count, cut) = search_text(&document.text, matcher);
                        if hits.is_empty() {
                            continue;
                        }
                        if cut {
                            truncated.store(true, Ordering::Relaxed);
                        }
                        if total.fetch_add(count, Ordering::Relaxed) + count >= MAX_MATCHES {
                            truncated.store(true, Ordering::Relaxed);
                            stopped.store(true, Ordering::Relaxed);
                        }
                        out.push((
                            position,
                            FileHits {
                                path: path.to_string_lossy().into_owned(),
                                relative: key.clone(),
                                hits,
                                matches: count,
                            },
                        ));
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    });

    if cancelled() {
        return None;
    }
    // Vault order, whatever order the workers finished in: a list that
    // reshuffles between two identical searches looks like a different answer.
    files.sort_by_key(|(position, _)| *position);
    let matches = total.load(Ordering::Relaxed);
    Some(Found {
        files: files.into_iter().map(|(_, file)| file).collect(),
        matches,
        notes: keys.len(),
        truncated: truncated.load(Ordering::Relaxed),
    })
}

/// The lines of one text that match, how many matches there were in total, and
/// whether the note hit [`MAX_HITS_PER_FILE`].
pub fn search_text(text: &str, matcher: &Regex) -> (Vec<Hit>, usize, bool) {
    let mut hits = Vec::new();
    let mut count = 0usize;
    for (index, line) in text.split('\n').enumerate() {
        let spans: Vec<(usize, usize)> = matcher
            .find_iter(line)
            // An empty match — `^`, or `a*` — marks a place rather than text.
            // Listing every line of the vault for it answers nothing.
            .filter(|found| found.start() < found.end())
            .map(|found| (found.start(), found.end()))
            .collect();
        if spans.is_empty() {
            continue;
        }
        if hits.len() == MAX_HITS_PER_FILE {
            return (hits, count, true);
        }
        count += spans.len();
        hits.push(hit_for(index + 1, line, &spans));
    }
    (hits, count, false)
}

/// A line's hit: where its first match is, and the line cut to a window around
/// it with every match inside the window marked.
fn hit_for(line_number: usize, line: &str, spans: &[(usize, usize)]) -> Hit {
    let (first_from, first_to) = spans[0];
    let column = utf16_len(&line[..first_from]);
    let length = utf16_len(&line[first_from..first_to]);

    // The window, in bytes of `line`: whole when short, otherwise from a little
    // before the first match.
    let chars = line.chars().count();
    let (from, to, lead, tail) = if chars <= WINDOW_CHARS {
        (0, line.len(), false, false)
    } else {
        let before = line[..first_from].chars().count();
        let start_char = before.saturating_sub(LEAD_CHARS);
        let from = byte_at_char(line, start_char);
        let to = byte_at_char(line, start_char + WINDOW_CHARS);
        (from, to, from > 0, to < line.len())
    };

    let mut text = String::new();
    if lead {
        text.push('…');
    }
    let offset = utf16_len(&text);
    text.push_str(&line[from..to]);
    if tail {
        text.push('…');
    }

    let ranges = spans
        .iter()
        .filter(|(start, end)| *start >= from && *end <= to)
        .map(|(start, end)| {
            [
                offset + utf16_len(&line[from..*start]),
                offset + utf16_len(&line[from..*end]),
            ]
        })
        .collect();

    Hit {
        line: line_number,
        column,
        length,
        text,
        ranges,
    }
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// The byte offset of the `n`th character, or the end.
fn byte_at_char(text: &str, n: usize) -> usize {
    text.char_indices()
        .nth(n)
        .map(|(at, _)| at)
        .unwrap_or(text.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(text: &str) -> Query {
        Query {
            text: text.into(),
            ..Query::default()
        }
    }

    fn lines(text: &str, q: &Query) -> Vec<usize> {
        let matcher = matcher(q).unwrap().unwrap();
        search_text(text, &matcher)
            .0
            .iter()
            .map(|hit| hit.line)
            .collect()
    }

    #[test]
    fn a_plain_search_ignores_case_and_escapes_the_text() {
        let text = "Plan A\nno\nthe plan (draft)\n";
        assert_eq!(lines(text, &query("plan")), vec![1, 3]);
        // Parentheses are text, not a group.
        assert_eq!(lines(text, &query("(draft)")), vec![3]);
    }

    #[test]
    fn case_sensitive_means_it() {
        let q = Query {
            case_sensitive: true,
            ..query("Plan")
        };
        assert_eq!(lines("Plan\nplan\n", &q), vec![1]);
    }

    #[test]
    fn whole_word_leaves_a_longer_word_alone() {
        let q = Query {
            whole_word: true,
            ..query("plan")
        };
        assert_eq!(lines("plan\nplanning\nthe plan.\n", &q), vec![1, 3]);
    }

    #[test]
    fn whole_word_works_in_cyrillic() {
        let q = Query {
            whole_word: true,
            ..query("план")
        };
        assert_eq!(lines("план\nпланы\nнаш план.\n", &q), vec![1, 3]);
    }

    #[test]
    fn a_regex_is_a_regex() {
        let q = Query {
            regex: true,
            ..query(r"v\d+\.\d+")
        };
        assert_eq!(lines("v0.10 out\nversion\nv1.2\n", &q), vec![1, 3]);
    }

    #[test]
    fn a_broken_pattern_is_an_error_not_a_panic() {
        let q = Query {
            regex: true,
            ..query("(unclosed")
        };
        assert!(matcher(&q).is_err());
    }

    #[test]
    fn an_empty_match_finds_nothing() {
        let q = Query {
            regex: true,
            ..query("x*")
        };
        assert!(lines("abc\ndef\n", &q).is_empty());
    }

    #[test]
    fn columns_count_in_utf16_units() {
        // The editor's positions are UTF-16: an emoji is two units, a Cyrillic
        // letter is one. A column counted in bytes would land the cursor in
        // the wrong place on any line that is not ASCII.
        let matcher = matcher(&query("plan")).unwrap().unwrap();
        let (hits, _, _) = search_text("😀 план plan\n", &matcher);
        assert_eq!(hits[0].column, 8);
        assert_eq!(hits[0].length, 4);
        assert_eq!(hits[0].ranges, vec![[8, 12]]);
    }

    #[test]
    fn every_match_on_a_line_is_marked() {
        let matcher = matcher(&query("a")).unwrap().unwrap();
        let (hits, count, _) = search_text("a b a\n", &matcher);
        assert_eq!(hits.len(), 1);
        assert_eq!(count, 2);
        assert_eq!(hits[0].ranges, vec![[0, 1], [4, 5]]);
    }

    #[test]
    fn a_long_line_is_shown_as_a_window_around_the_match() {
        let line = format!("{}needle{}", "x".repeat(1000), "y".repeat(1000));
        let matcher = matcher(&query("needle")).unwrap().unwrap();
        let (hits, _, _) = search_text(&line, &matcher);
        let hit = &hits[0];
        assert!(hit.text.starts_with('…') && hit.text.ends_with('…'));
        assert!(hit.text.chars().count() <= WINDOW_CHARS + 2);
        let [start, end] = hit.ranges[0];
        let shown: Vec<u16> = hit.text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&shown[start..end]).unwrap(), "needle");
        // The column is still the column in the whole line.
        assert_eq!(hit.column, 1000);
    }

    #[test]
    fn a_note_stops_listing_at_its_ceiling() {
        let text = "hit\n".repeat(MAX_HITS_PER_FILE + 10);
        let matcher = matcher(&query("hit")).unwrap().unwrap();
        let (hits, _, cut) = search_text(&text, &matcher);
        assert_eq!(hits.len(), MAX_HITS_PER_FILE);
        assert!(cut);
    }

    fn snapshot() -> Snapshot {
        let mut snapshot = Snapshot::empty(Path::new("vault"));
        let notes = [
            ("a.md", "---\nstatus: draft\n---\n#projects/scheda\n"),
            ("b.md", "---\nstatus: done\n---\n#projects\n"),
            ("c.md", "#projectsx\n"),
        ];
        for (key, text) in notes {
            snapshot
                .notes
                .insert(key.into(), index::read_note(text.as_bytes(), 0, 0));
        }
        snapshot
    }

    #[test]
    fn a_tag_filter_takes_nested_tags_and_not_longer_names() {
        let q = Query {
            tag: Some("#Projects".into()),
            ..Query::default()
        };
        assert_eq!(notes_for(&snapshot(), &q), vec!["a.md", "b.md"]);
    }

    #[test]
    fn a_field_filter_takes_presence_or_a_value() {
        let present = Query {
            field: Some("status".into()),
            ..Query::default()
        };
        assert_eq!(notes_for(&snapshot(), &present), vec!["a.md", "b.md"]);
        let valued = Query {
            field: Some("status".into()),
            value: Some("DRAFT".into()),
            ..Query::default()
        };
        assert_eq!(notes_for(&snapshot(), &valued), vec!["a.md"]);
    }

    #[test]
    fn searching_a_vault_on_disk_keeps_vault_order_and_can_be_cancelled() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        let keys: Vec<String> = (0..40).map(|n| format!("n{n:02}.md")).collect();
        for key in &keys {
            std::fs::write(index::absolute(root, key), "one needle\n").unwrap();
        }
        let matcher = matcher(&query("needle")).unwrap();

        let found = run(root, &keys, matcher.as_ref(), &|| false).unwrap();
        let order: Vec<&str> = found.files.iter().map(|f| f.relative.as_str()).collect();
        assert_eq!(order, keys.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(found.matches, 40);
        assert!(found.files.iter().all(|file| file.matches == 1));

        assert!(run(root, &keys, matcher.as_ref(), &|| true).is_none());
    }
}

//! The tags a vault's notes carry, and which notes carry each one.
//!
//! Answered from the index (`index.rs`), which holds what `scan` below found
//! in every note and is kept current by reconciling on open and by the
//! watcher. The reading is still this file's: the index stores it, it does not
//! redo it.
//!
//! **Obsidian is the authority on what a tag is**, because scheda reads its
//! conventions rather than inventing its own (ADR 0002). That means two
//! sources, not one:
//!
//! - `#inline` in the body;
//! - `tags:` in the front matter, where the same note may write `tags: [a, b]`,
//!   `tags: a, b`, or a YAML list of `- a` lines, and where the `#` is usually
//!   absent. A note tagged only in its front matter is a note the panel must
//!   still find — leaving it out would make the panel confidently wrong about
//!   the vault rather than merely incomplete.
//!
//! What the reading has to get right is what makes a `#` *not* a tag, and every
//! case below is one a real vault contains:
//!
//! - a heading. `# Plan` is the most common `#` in any vault, and a heading
//!   that goes on to mention `#rust` would file the note under it. The rule is
//!   CommonMark's, which is what the editor's own parser applies: the hash and
//!   a space. `#Plan` is therefore a tag rather than a heading, in the editor
//!   and here alike — the panel and the text have to agree about what the note
//!   says;
//! - a code span and a fenced block, so a note about shell scripts does not
//!   file itself under `!/bin/bash`;
//! - a colour, because `#fff` in a note about design is not a tag. All-digits
//!   is excluded too, which is what `#2024` is;
//! - a `#` that follows a letter, so the fragment in `page.md#section` and the
//!   sharp in `C#` are left alone. Obsidian requires whitespace or a line start
//!   before the hash and so does this.

use crate::frontmatter;
use crate::index::{self, Snapshot};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

/// One note carrying one tag, as the panel lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tagged {
    /// The file the tag was written in.
    pub path: String,
    /// That file's path from the vault root, which is what the panel shows.
    pub relative: String,
    /// The 1-based line it is on, or none when the tag came from the front
    /// matter, which is a property of the note rather than of a line.
    pub line: Option<usize>,
    /// The line's text, trimmed. Empty for a front-matter tag: there is no
    /// sentence around it to show.
    pub context: String,
}

/// One tag and the notes that carry it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    /// The tag as written, without the `#`.
    pub name: String,
    /// How many notes carry it — not how many times it is written. A note that
    /// mentions the same tag in five paragraphs is one note about it.
    pub notes: usize,
    /// Where it is carried, ordered by path so the list is stable between
    /// readings of an unchanged vault.
    pub places: Vec<Tagged>,
}

/// Every tag in the vault, most-used first.
///
/// Answered from the index, which keeps each note's tags as `scan` found them.
/// Ties are broken by name so the order is total: a vault where nine tags are
/// used once each would otherwise shuffle between readings, and a panel that
/// reorders itself when nothing changed looks broken.
pub fn read(root: &Path, snapshot: &Snapshot) -> Vec<Tag> {
    let mut found: BTreeMap<String, Vec<Tagged>> = BTreeMap::new();

    for (relative, note) in &snapshot.notes {
        let path = index::absolute(root, relative)
            .to_string_lossy()
            .into_owned();
        for tag in &note.tags {
            found.entry(tag.name.clone()).or_default().push(Tagged {
                path: path.clone(),
                relative: relative.clone(),
                line: tag.line,
                context: tag.context.clone(),
            });
        }
    }

    let mut tags: Vec<Tag> = found
        .into_iter()
        .map(|(name, mut places)| {
            places.sort_by(|a, b| a.relative.cmp(&b.relative).then(a.line.cmp(&b.line)));
            // Counted by note rather than by mention: `notes` is how many files
            // are in `places` once each path is counted once.
            let mut paths: Vec<&str> = places.iter().map(|p| p.path.as_str()).collect();
            paths.sort_unstable();
            paths.dedup();
            Tag {
                name,
                notes: paths.len(),
                places,
            }
        })
        .collect();

    tags.sort_by(|a, b| b.notes.cmp(&a.notes).then(a.name.cmp(&b.name)));
    tags
}

/// Every tag in one note: its name, the line it is on, and that line's text.
///
/// Front-matter tags come back with no line, because they are a property of the
/// note rather than of a place in it.
pub fn scan(text: &str) -> Vec<(String, Option<usize>, String)> {
    let mut out = Vec::new();

    for name in front_matter_tags(text) {
        out.push((name, None, String::new()));
    }

    let body_from = frontmatter::end(text);
    let mut fenced = false;
    // The line number counts from the top of the file, not from the end of the
    // front matter: a person looking at line 12 in the panel has to find line 12
    // in the note.
    let first = 1 + text[..body_from].lines().count();

    for (offset, raw) in text[body_from..].lines().enumerate() {
        if is_fence(raw) {
            fenced = !fenced;
        } else if !fenced && !is_heading(raw) {
            let line = first + offset;
            for name in tags_in_line(raw) {
                out.push((name, Some(line), raw.trim().to_string()));
            }
        }
    }

    out
}

/// Whether a line opens or closes a fenced code block. The same rule
/// `links::scan` uses, and deliberately the same: two readings of one vault
/// that disagree about where the code is would put a tag in the panel that the
/// editor does not draw as one.
fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return false;
    }
    let trimmed = trimmed.trim_end_matches(['\r', ' ']);
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

/// Whether a line is an ATX heading.
///
/// The check is the hash *and* the space after it. `#tag` at the start of a line
/// is a tag and `# Heading` is a heading, and CommonMark is what says so: an ATX
/// heading requires whitespace after its hashes. Without that distinction a tag
/// on its own line — which is how a person files a note — would be read as a
/// heading and lost.
fn is_heading(line: &str) -> bool {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    (1..=6).contains(&hashes)
        && matches!(
            trimmed[hashes..].chars().next(),
            None | Some(' ') | Some('\t')
        )
}

/// The tags named in a `tags:` (or `tag:`) key of the front matter.
///
/// Obsidian accepts three spellings and a vault usually holds all three:
/// `tags: [a, b]`, `tags: a, b`, and a block of `- a` lines under a bare
/// `tags:`. The front matter reader hands back one value per list item and the
/// scalar whole, so a scalar is split on commas here — for this key only, since
/// a comma in a title is part of the title. The leading `#` is optional and
/// usually absent.
fn front_matter_tags(text: &str) -> Vec<String> {
    let fields = frontmatter::fields(text);
    let mut out = Vec::new();
    for key in ["tags", "tag"] {
        for value in fields.get(key).into_iter().flatten() {
            for part in value.split(',') {
                push_tag(&mut out, part);
            }
        }
    }
    out
}

/// Adds one front-matter value as a tag, if it is one.
fn push_tag(out: &mut Vec<String>, value: &str) {
    let name = value
        .trim()
        .trim_matches(['"', '\''])
        .trim_start_matches('#');
    if is_tag_name(name) {
        out.push(name.to_string());
    }
}

/// The tags written inline on one line, skipping code spans.
fn tags_in_line(line: &str) -> Vec<String> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut at = 0usize;

    while at < bytes.len() {
        match bytes[at] {
            // A code span runs to its closing backtick; a note about shell
            // scripts should not file itself under `!/bin/bash`. An unclosed
            // backtick closes at the end of the line rather than swallowing it,
            // which is what the editor draws too.
            b'`' => {
                at = line[at + 1..]
                    .find('`')
                    .map(|found| at + 1 + found + 1)
                    .unwrap_or(bytes.len());
            }
            b'#' => {
                // Obsidian requires a line start or whitespace before the hash,
                // which is what leaves `page.md#section` and `C#` alone.
                let preceded_ok = at == 0 || matches!(bytes[at - 1], b' ' | b'\t' | b'(' | b'[');
                let end = at
                    + 1
                    + line[at + 1..]
                        .find(|c: char| !is_tag_char(c))
                        .unwrap_or(line.len() - at - 1);
                let name = &line[at + 1..end];
                let next = line[end..].chars().next();
                if preceded_ok && is_tag_name(name) && !is_spreadsheet_error(name, next) {
                    out.push(name.to_string());
                }
                at = end.max(at + 1);
            }
            _ => at += 1,
        }
    }

    out
}

/// Whether a hash-word is a spreadsheet's error code rather than a tag.
///
/// `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?` and `#N/A` are what a note about
/// formulas is full of, and each of them fits the tag rules — a hash after a
/// space, then letters, digits and a slash. The shape tells them apart, not a
/// list of every code: capitals and digits closed by `!` or `?`, which is how a
/// spreadsheet writes its errors and how nobody writes a tag. A lowercase
/// `#urgent!` in a sentence is still a tag with an exclamation after it.
///
/// `N/A` is the one code without a closing mark, and it is named on its own:
/// read as a spreadsheet error or as "not applicable", it is not a tag either
/// way.
fn is_spreadsheet_error(name: &str, next: Option<char>) -> bool {
    if name == "N/A" {
        return true;
    }
    matches!(next, Some('!' | '?'))
        && name.chars().any(|c| c.is_ascii_uppercase())
        && name
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '/')
}

/// Whether a character may appear in a tag. Obsidian's set: letters, digits,
/// underscore, hyphen and `/` for nesting.
fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

/// Whether a string is a usable tag name.
///
/// Two exclusions beyond the character set, and both are things people write
/// after a hash without meaning a tag:
///
/// - all digits, which is a year — `#2024`;
/// - a hex colour, which is what a note about design is full of. `#fff` is
///   letters, so "must hold a non-digit" does not catch it; the shape does.
///   Three or six hex characters and nothing else is a colour, and `#abc` as a
///   tag is the price — a rule that has to guess picks the reading that is
///   overwhelmingly more common in the notes this panel reads.
fn is_tag_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().all(is_tag_char)
        && name.chars().any(|c| !c.is_ascii_digit())
        && !name.ends_with('/')
        && !is_hex_colour(name)
}

/// Whether a name is written exactly as a CSS hex colour.
fn is_hex_colour(name: &str) -> bool {
    matches!(name.len(), 3 | 6) && name.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(text: &str) -> Vec<String> {
        scan(text).into_iter().map(|(name, _, _)| name).collect()
    }

    #[test]
    fn finds_an_inline_tag() {
        assert_eq!(names("a note about #rust and more\n"), vec!["rust"]);
    }

    #[test]
    fn a_heading_is_not_a_tag() {
        // The most common `#` in any vault. Counting it would bury every real
        // tag under one called "Plan".
        assert_eq!(names("# Plan\n\ntext\n"), Vec::<String>::new());
        assert_eq!(names("### A deeper heading\n"), Vec::<String>::new());
    }

    #[test]
    fn a_heading_that_mentions_a_hash_word_keeps_it_out() {
        // The case `is_heading` is actually for, and the one that shows it is
        // not redundant. `# Plan` is excluded by the character set anyway — a
        // space is not a tag character — so a test written only that way passes
        // with the heading check deleted and proves nothing. A heading that
        // goes on to mention a hash-word is what needs the whole line skipped.
        assert_eq!(names("# Plan for #rust\n"), Vec::<String>::new());
        // And the same words without the heading still give a tag, so the rule
        // excludes headings rather than hash-words.
        assert_eq!(names("Plan for #rust\n"), vec!["rust"]);
    }

    #[test]
    fn a_hash_word_at_the_start_of_a_line_is_a_tag() {
        // `#Plan` is not an ATX heading — CommonMark requires the space, and
        // the editor's own parser (`@lezer/markdown`) draws it as paragraph
        // text. Obsidian reads it as a tag and so does this: the panel and the
        // text have to agree about what the note says.
        assert_eq!(names("#Plan\n\nbody\n"), vec!["Plan"]);
    }

    #[test]
    fn a_tag_on_its_own_line_is_still_a_tag() {
        // The distinction a heading is made by is the space after the hash, so
        // this must survive the heading check: it is how a person files a note.
        assert_eq!(names("#inbox\n"), vec!["inbox"]);
    }

    #[test]
    fn skips_a_code_span_and_a_fence() {
        assert_eq!(names("run `#!/bin/sh` first\n"), Vec::<String>::new());
        assert_eq!(
            names("```sh\n#!/bin/sh\necho hi\n```\n#real\n"),
            vec!["real"]
        );
    }

    #[test]
    fn leaves_a_fragment_and_a_sharp_alone() {
        // The hash has to follow whitespace or a line start.
        assert_eq!(names("see page.md#section\n"), Vec::<String>::new());
        assert_eq!(names("written in C# mostly\n"), Vec::<String>::new());
    }

    #[test]
    fn a_colour_is_not_a_tag() {
        assert_eq!(names("the accent is #fff today\n"), Vec::<String>::new());
        assert_eq!(names("the accent is #d9704a today\n"), Vec::<String>::new());
        assert_eq!(names("shipped in #2024 finally\n"), Vec::<String>::new());
        // But a tag that merely contains digits is one, and so is a word that
        // is hex-shaped at a length no colour is written at.
        assert_eq!(names("filed under #q4-2024 now\n"), vec!["q4-2024"]);
        assert_eq!(names("filed under #fffd now\n"), vec!["fffd"]);
    }

    #[test]
    fn reads_nested_tags() {
        assert_eq!(names("#projects/scheda is here\n"), vec!["projects/scheda"]);
        // A trailing slash is somebody typing, not a tag.
        assert_eq!(names("#projects/ is here\n"), Vec::<String>::new());
    }

    #[test]
    fn reads_front_matter_in_all_three_spellings() {
        assert_eq!(names("---\ntags: [a, b]\n---\nbody\n"), vec!["a", "b"]);
        assert_eq!(names("---\ntags: a, b\n---\nbody\n"), vec!["a", "b"]);
        assert_eq!(
            names("---\ntags:\n  - a\n  - b\n---\nbody\n"),
            vec!["a", "b"]
        );
        // The hash is optional there and usually absent; both are one tag.
        assert_eq!(names("---\ntags: [#a]\n---\nbody\n"), vec!["a"]);
    }

    #[test]
    fn a_front_matter_tag_has_no_line() {
        let found = scan("---\ntags: [a]\n---\n#b here\n");
        assert_eq!(found[0].1, None, "the front-matter tag is not on a line");
        assert_eq!(
            found[1].1,
            Some(4),
            "the inline tag is on the line it is on"
        );
    }

    #[test]
    fn the_next_key_ends_a_tag_block() {
        // Without this the title would be read as a tag.
        assert_eq!(
            names("---\ntags:\n  - a\ntitle: Something\n---\nbody\n"),
            vec!["a"]
        );
    }

    #[test]
    fn front_matter_is_not_scanned_as_body() {
        // The `---` opener and any other key are not lines to find tags on.
        assert_eq!(
            names("---\ntitle: A #hash in a title\n---\nbody\n"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn crlf_front_matter_with_multibyte_text_does_not_panic() {
        // The defect a real vault found after every other test passed, taken
        // from the note that found it: CRLF endings, a long folded description
        // in Cyrillic, the closing `---` about 1200 bytes in.
        //
        // The shape matters more than the content. `lines()` hands back a line
        // without its `\r`, so walking the text by `line.len() + 1` counts one
        // byte short on every CRLF line; the offset drifts by one per line
        // until it lands inside a multi-byte character and the slice panics.
        // A two-line front matter does not drift far enough to reach one, which
        // is why the first version of this test passed against the defect.
        let long_line = "  Ответы на комментарии от имени каналов, перевод и контекст.";
        let mut text = String::from("---\r\nname: atlas-comment-reply\r\ndescription: >\r\n");
        for _ in 0..12 {
            text.push_str(long_line);
            text.push_str("\r\n");
        }
        text.push_str("tags: [комментарии, youtube]\r\n---\r\nТекст #rust здесь.\r\n");

        assert_eq!(names(&text), vec!["комментарии", "youtube", "rust"]);
    }

    #[test]
    fn a_crlf_note_counts_its_lines_the_way_an_editor_does() {
        let found = scan("---\r\ntags: [a]\r\n---\r\nпервая\r\n#b тут\r\n");
        let inline = found.iter().find(|(name, _, _)| name == "b").unwrap();
        assert_eq!(inline.1, Some(5));
    }

    #[test]
    fn unterminated_front_matter_is_body() {
        // A note opening with `---` that never closes has no front matter, so
        // what follows is body and its tags count.
        assert_eq!(names("---\ntags: [a]\nbody #b\n"), vec!["b"]);
    }

    #[test]
    fn counts_the_line_from_the_top_of_the_file() {
        // A person reading "line 5" in the panel has to find line 5 in the note.
        let found = scan("---\ntags: [a]\n---\nfirst\n#b here\n");
        let inline = found.iter().find(|(name, _, _)| name == "b").unwrap();
        assert_eq!(inline.1, Some(5));
    }

    #[test]
    fn keeps_the_line_as_context() {
        let found = scan("  a note about #rust  \n");
        assert_eq!(found[0].2, "a note about #rust");
    }

    #[test]
    fn a_spreadsheet_error_is_not_a_tag() {
        // Taken from a real vault, where these sat above half the real tags.
        assert_eq!(
            names(
                "gives #DIV/0! or #REF! or #VALUE! or #NAME? or #N/A here
"
            ),
            Vec::<String>::new()
        );
        // The mark is what decides, not the word: without it `#REF` is a tag,
        // and a lowercase tag followed by an exclamation is still a tag.
        assert_eq!(
            names(
                "see #REF for that
"
            ),
            vec!["REF"]
        );
        assert_eq!(
            names(
                "this is #urgent! now
"
            ),
            vec!["urgent"]
        );
    }

    #[test]
    fn finds_every_tag_on_a_line() {
        assert_eq!(names("#a and #b and #c\n"), vec!["a", "b", "c"]);
    }
}

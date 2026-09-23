//! Reading a note for something other than editing it.
//!
//! Two questions the window asks about a file it is not showing: what headings
//! does it have, and how does it begin. Both are answered here rather than in the
//! window because answering either means reading a file, and reading files is the
//! core's (ADR 0001).
//!
//! Both are read from the text rather than from a parser, and that narrowing is
//! deliberate. The editor has a real markdown parser and uses it for everything
//! it draws; this is a file that is *not* open, and building a parse tree for a
//! hover card would be the expensive half of opening a note in order to answer a
//! question about its first line. What the reading has to get right instead is
//! the one case a regular expression gets wrong — fenced code — and that is what
//! the tests below hold.

/// The ATX headings of a markdown text, in order, without their hashes.
///
/// Read here rather than in the window because the window would have to read the
/// file to do it, and reading files is the core's (ADR 0001). Fenced code is
/// skipped: `# comment` inside a shell block is not a heading, and offering it
/// as one sends a link somewhere it cannot go.
pub fn headings_in(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut fence: Option<char> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        // A fence is three or more of the same character; the closing one has to
        // match the character that opened it, or ``` inside a ~~~ block would
        // end it.
        if let Some(marker) = trimmed.chars().next().filter(|c| *c == '`' || *c == '~')
            && trimmed.chars().take_while(|c| *c == marker).count() >= 3
        {
            match fence {
                Some(open) if open == marker => fence = None,
                None => fence = Some(marker),
                // A different fence character inside a block is content.
                Some(_) => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        // `#hashtag` is not a heading: ATX wants a space after the hashes.
        if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ') {
            let text = trimmed[hashes..].trim();
            // A trailing run of hashes is the closed form, `## Title ##`.
            let text = text.trim_end_matches('#').trim();
            if !text.is_empty() {
                out.push(text.to_string());
            }
        }
    }
    out
}

/// How much of a note the hover card carries.
///
/// Enough to recognise the note by, not enough to read it in: the card is a
/// shortcut for the person who can see it, and everything in it is also in the
/// note it points at.
const PEEK_CHARS: usize = 400;

/// The first characters of a note, with the front matter taken off.
pub fn opening_of(text: &str) -> String {
    let body = strip_front_matter(text);
    let mut out = String::new();
    // Trimmed at both ends. The leading whitespace is the blank line after the
    // front matter, and the trailing newline every text file ends with would
    // otherwise be a blank line at the bottom of a card that is a few lines tall.
    for character in body.trim().chars() {
        // Counted in characters, not bytes: the ceiling is about how much a card
        // holds, and a note in Cyrillic would otherwise be cut to half the length
        // — through the middle of a character, at that.
        if out.chars().count() >= PEEK_CHARS {
            out.push('…');
            break;
        }
        out.push(character);
    }
    out
}

/// The text after a `---` block at the very top, or the whole text when there is
/// none.
///
/// Only at the very top, and only for a bare `---`: the same rule the parser
/// uses, so the card and the editor agree about what is front matter.
fn strip_front_matter(text: &str) -> &str {
    let rest = match text.strip_prefix("---\n") {
        Some(rest) => rest,
        None => match text.strip_prefix("---\r\n") {
            Some(rest) => rest,
            None => return text,
        },
    };
    // The closing fence, at the start of a line.
    let mut at = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return &rest[at + line.len()..];
        }
        at += line.len();
    }
    // Unterminated: not front matter, so the text is its own opening.
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_come_back_without_their_hashes() {
        let text = "# One\n## Two\nbody\n### Three\n";
        assert_eq!(headings_in(text), ["One", "Two", "Three"]);
    }

    #[test]
    fn a_hash_inside_a_fence_is_not_a_heading() {
        // The case a regular expression gets wrong, and gets wrong often: shell
        // examples in a note are full of comments, and offering one as a heading
        // sends a link somewhere it cannot go.
        let text = "# Real\n```sh\n# not a heading\n```\n## Also real\n";
        assert_eq!(headings_in(text), ["Real", "Also real"]);
    }

    #[test]
    fn a_tilde_fence_is_a_fence_too() {
        let text = "~~~\n# inside\n~~~\n# outside\n";
        assert_eq!(headings_in(text), ["outside"]);
    }

    #[test]
    fn a_backtick_fence_inside_a_tilde_block_is_content() {
        // The closing fence has to match the character that opened it; otherwise
        // the backticks in the middle would end the block and the heading under
        // them would be offered as this note's.
        let text = "~~~\n```\n# inside\n~~~\n# outside\n";
        assert_eq!(headings_in(text), ["outside"]);
    }

    #[test]
    fn a_hashtag_is_not_a_heading() {
        // ATX wants a space after the hashes. `#project` in a note is a tag, and
        // Obsidian reads it as one.
        assert_eq!(headings_in("#project is a tag\n"), Vec::<String>::new());
    }

    #[test]
    fn seven_hashes_are_not_a_heading() {
        assert_eq!(headings_in("####### too deep\n"), Vec::<String>::new());
    }

    #[test]
    fn the_closed_form_loses_its_trailing_hashes() {
        assert_eq!(headings_in("## Title ##\n"), ["Title"]);
    }

    #[test]
    fn an_indented_heading_still_counts() {
        assert_eq!(headings_in("  # Indented\n"), ["Indented"]);
    }

    #[test]
    fn an_empty_heading_is_not_offered() {
        // Nothing to show in a list and nothing to scroll to.
        assert_eq!(headings_in("#\n## \n"), Vec::<String>::new());
    }

    #[test]
    fn the_opening_is_the_first_lines() {
        assert_eq!(
            opening_of("The first line.\nAnd a second."),
            "The first line.\nAnd a second."
        );
    }

    #[test]
    fn the_opening_leaves_the_front_matter_out() {
        // Front matter is the note's machinery, not its opening. A card showing
        // `tags: [a]` says nothing about what the note is about.
        let text = "---\ntags: [a]\n---\nThe real first line.\n";
        assert_eq!(opening_of(text), "The real first line.");
    }

    #[test]
    fn unterminated_front_matter_is_not_front_matter() {
        // The same rule the parser uses, so the card and the editor agree about
        // what front matter is. A note opening with `---` that never closes has
        // that line as its first line.
        let text = "---\nthis never closes\n";
        assert_eq!(opening_of(text), text.trim());
    }

    #[test]
    fn front_matter_with_windows_endings_still_comes_off() {
        let text = "---\r\ntags: [a]\r\n---\r\nBody.\r\n";
        assert_eq!(opening_of(text), "Body.");
    }

    #[test]
    fn a_long_note_is_cut_and_says_so() {
        let text = "x".repeat(PEEK_CHARS * 2);
        let opening = opening_of(&text);
        assert_eq!(opening.chars().count(), PEEK_CHARS + 1);
        assert!(opening.ends_with('…'));
    }

    #[test]
    fn a_short_note_is_not_cut() {
        let opening = opening_of("short");
        assert_eq!(opening, "short");
        assert!(!opening.ends_with('…'));
    }

    #[test]
    fn a_note_in_cyrillic_is_cut_by_characters() {
        // `PEEK_CHARS` *bytes* of Cyrillic is half as much text, and a cut by
        // bytes would also split a character in two and fill the card with
        // mojibake.
        let text = "я".repeat(PEEK_CHARS * 2);
        assert_eq!(opening_of(&text).chars().count(), PEEK_CHARS + 1);
    }
}

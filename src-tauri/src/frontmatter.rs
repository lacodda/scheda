//! The front matter of a note, read as far as a vault needs it read.
//!
//! Not a YAML parser, and deliberately not one. What a vault writes at the top
//! of its notes is a narrow dialect — `key: value`, `key: [a, b]`, and a key
//! followed by a block of `- item` lines — and those three shapes are all that
//! filtering a search by a field, or collecting a note's tags, has to see. A
//! YAML parser would also accept anchors, multi-document streams and typed
//! scalars, and then refuse a whole note over a stray colon in a title, which
//! is exactly the kind of note a person writes by hand.
//!
//! Only the top level is read. A nested map is a structure somebody built for a
//! plugin, and flattening it into `key: value` pairs would invent fields the
//! note does not have.

use std::collections::BTreeMap;

/// Where the body starts: after a closing `---`, or at the top when there is no
/// front matter. Only at the very top and only for a bare `---`, the same rule
/// `notes.rs` applies.
///
/// Walked with `split_inclusive` rather than `lines()`, and that is not a
/// preference. `lines()` hands back the line without its terminator and without
/// a `\r` before it, so adding `line.len() + 1` to walk the text counts one byte
/// short on every CRLF line. The offset then drifts into the middle of a
/// character and slicing panics — which is exactly what a real vault did on its
/// first note with Cyrillic front matter, after every unit test passed. Keeping
/// the terminator means the arithmetic is not arithmetic at all: each piece is
/// as long as it is.
pub fn end(text: &str) -> usize {
    let opened = if text.starts_with("---\n") {
        4
    } else if text.starts_with("---\r\n") {
        5
    } else {
        return 0;
    };

    let mut at = opened;
    for piece in text[opened..].split_inclusive('\n') {
        at += piece.len();
        if piece.trim_end() == "---" {
            return at;
        }
    }
    // Unterminated front matter is not front matter: the note is all body.
    0
}

/// The top-level fields of a note's front matter, each with its values.
///
/// A scalar is one value, written as it stands (quotes taken off); a flow list
/// `[a, b]` and a block of `- a` lines are one value per item. A key with no
/// value and no block under it is present with no values, because "this note
/// has a `draft:` field" is itself something a filter may ask about.
///
/// Keys are kept as written. Obsidian treats them case-sensitively, and so does
/// every plugin that reads them.
pub fn fields(text: &str) -> BTreeMap<String, Vec<String>> {
    let end = end(text);
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    if end == 0 {
        return out;
    }

    // What the indented lines below the current key are: a list of items
    // belonging to it, or prose that belongs to nobody.
    let mut block: Option<Under> = None;

    for line in text[..end].lines() {
        let trimmed = line.trim_end();
        if trimmed == "---" || trimmed.trim_start().starts_with('#') {
            continue;
        }

        if let Some(under) = &block {
            let item = trimmed.trim_start();
            let listed = match under {
                Under::List(key) => item
                    .strip_prefix("- ")
                    .or_else(|| (item == "-").then_some(""))
                    .map(|value| (key, value)),
                Under::Prose => None,
            };
            if let Some((key, value)) = listed {
                let value = unquote(value.trim());
                if !value.is_empty() {
                    out.entry(key.clone()).or_default().push(value.to_string());
                }
                continue;
            }
            // Indented and not an item is a nested map or a folded scalar under
            // the key — its continuation, not a key of its own.
            if trimmed.starts_with([' ', '\t']) || trimmed.is_empty() {
                continue;
            }
            block = None;
        }

        // A key starts in the first column. An indented `key:` belongs to a
        // nested map, which is a plugin's structure rather than a field.
        if trimmed.starts_with([' ', '\t']) {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = unquote(key.trim());
        if key.is_empty() {
            continue;
        }
        let value = value.trim();
        let values = out.entry(key.to_string()).or_default();

        if value.is_empty() {
            block = Some(Under::List(key.to_string()));
            continue;
        }
        // `>` and `|` open a folded or literal block: the text is below, and it
        // is prose rather than a value anybody filters by.
        if matches!(value, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            block = Some(Under::Prose);
            continue;
        }
        if let Some(inner) = value
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            for item in inner.split(',') {
                let item = unquote(item.trim());
                if !item.is_empty() {
                    values.push(item.to_string());
                }
            }
            continue;
        }
        values.push(unquote(value).to_string());
    }

    out
}

/// What the indented lines under a key are.
enum Under {
    /// `- item` lines, each a value of this key.
    List(String),
    /// A folded or literal scalar: text, not values.
    Prose,
}

/// A value without the quotes around it.
fn unquote(value: &str) -> &str {
    for quote in ['"', '\''] {
        if let Some(inner) = value
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
        {
            return inner;
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(text: &str, key: &str) -> Vec<String> {
        fields(text).remove(key).unwrap_or_default()
    }

    #[test]
    fn reads_a_scalar_a_flow_list_and_a_block_list() {
        let text =
            "---\nstatus: draft\ntags: [a, \"b\"]\naliases:\n  - One\n  - 'Two'\n---\nbody\n";
        assert_eq!(one(text, "status"), vec!["draft"]);
        assert_eq!(one(text, "tags"), vec!["a", "b"]);
        assert_eq!(one(text, "aliases"), vec!["One", "Two"]);
    }

    #[test]
    fn a_comma_in_a_scalar_is_part_of_it() {
        // A title is a sentence; only a flow list is split.
        let text = "---\ntitle: Hello, world\n---\n";
        assert_eq!(one(text, "title"), vec!["Hello, world"]);
    }

    #[test]
    fn a_colon_in_a_value_stays_in_the_value() {
        let text = "---\nsource: https://example.com/a\n---\n";
        assert_eq!(one(text, "source"), vec!["https://example.com/a"]);
    }

    #[test]
    fn an_empty_key_is_present_with_no_values() {
        let found = fields("---\ndraft:\nstatus: done\n---\n");
        assert_eq!(found.get("draft"), Some(&Vec::new()));
        assert_eq!(found.get("status"), Some(&vec!["done".to_string()]));
    }

    #[test]
    fn a_nested_map_is_not_flattened_into_fields() {
        let text = "---\nplugin:\n  mode: fast\n  level: 2\nstatus: done\n---\n";
        let found = fields(text);
        assert!(!found.contains_key("mode"));
        assert_eq!(found.get("plugin"), Some(&Vec::new()));
        assert_eq!(found.get("status"), Some(&vec!["done".to_string()]));
    }

    #[test]
    fn a_folded_scalar_is_not_a_list_of_values() {
        let text =
            "---\ndescription: >\n  A long line\n  - that looks like an item\nstatus: ok\n---\n";
        let found = fields(text);
        assert_eq!(found.get("status"), Some(&vec!["ok".to_string()]));
        // The folded text is prose. Only its key is kept.
        assert!(found.contains_key("description"));
    }

    #[test]
    fn no_front_matter_is_no_fields() {
        assert!(fields("# Heading\nstatus: draft\n").is_empty());
        assert!(fields("---\nstatus: draft\nnever closed\n").is_empty());
    }

    #[test]
    fn crlf_front_matter_reads_the_same() {
        let text = "---\r\nstatus: draft\r\ntags:\r\n  - a\r\n---\r\nbody\r\n";
        assert_eq!(one(text, "status"), vec!["draft"]);
        assert_eq!(one(text, "tags"), vec!["a"]);
    }

    #[test]
    fn the_end_is_after_the_closing_line() {
        assert_eq!(end("---\na: b\n---\nbody"), 13);
        assert_eq!(end("no front matter"), 0);
    }
}

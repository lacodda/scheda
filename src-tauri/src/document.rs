//! Reading and writing a text file without changing a byte we were not asked to
//! change.
//!
//! The editor works on a `String`, but a file on disk carries more than its
//! characters: a byte-order mark, one of three line-ending conventions (often
//! more than one in the same file), and a final newline that may or may not be
//! there. None of that survives a naive `read_to_string` / `write` round trip,
//! and losing it rewrites a file the user only looked at. So reading records
//! the shape alongside the text, and writing replays it.

use serde::{Deserialize, Serialize};
use std::path::Path;

const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// How a file terminates its lines. `Mixed` keeps the original endings verbatim
/// because there is no single answer to replay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
}

impl LineEnding {
    /// The sequence to write for a document that has one convention. `Mixed`
    /// has none, and its writer never asks.
    fn as_str(self) -> &'static str {
        match self {
            Self::Lf | Self::Mixed => "\n",
            Self::Crlf => "\r\n",
        }
    }
}

/// Everything about a file that is not its characters. Kept beside the text so
/// a save can reproduce the original bytes exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentShape {
    pub line_ending: LineEnding,
    pub bom: bool,
    /// Per-line endings, recorded only for a `Mixed` file: entry `i` is the
    /// ending that followed line `i`. Nothing else can reproduce those bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mixed_endings: Option<Vec<LineEnding>>,
}

/// A file read into memory: the text the editor edits, plus the shape a save
/// has to put back.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    /// Line endings normalised to `\n`; the shape remembers the originals.
    pub text: String,
    pub shape: DocumentShape,
}

#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    /// scheda only writes UTF-8. A file it cannot decode opens read-only rather
    /// than guessing an encoding and saving a different file back.
    #[error("this file is not valid UTF-8; scheda can open it read-only only")]
    NotUtf8,
}

/// Splits raw bytes into the editor's text and the shape needed to rebuild them.
pub fn decode(bytes: &[u8]) -> Result<Document, DocumentError> {
    let bom = bytes.starts_with(BOM);
    let body = if bom { &bytes[BOM.len()..] } else { bytes };
    let raw = std::str::from_utf8(body).map_err(|_| DocumentError::NotUtf8)?;

    let mut text = String::with_capacity(raw.len());
    let mut endings = Vec::new();
    let mut chars = raw.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '\r' => {
                if raw[i + 1..].starts_with('\n') {
                    chars.next();
                    endings.push(LineEnding::Crlf);
                } else {
                    // A lone CR is not a line ending we support; it is content,
                    // and content passes through untouched.
                    text.push('\r');
                    continue;
                }
                text.push('\n');
            }
            '\n' => {
                endings.push(LineEnding::Lf);
                text.push('\n');
            }
            _ => text.push(c),
        }
    }

    let line_ending = classify(&endings);
    let mixed_endings = (line_ending == LineEnding::Mixed).then_some(endings);

    Ok(Document {
        text,
        shape: DocumentShape {
            line_ending,
            bom,
            mixed_endings,
        },
    })
}

/// The dominant convention of a file, or `Mixed` when it has more than one.
/// A file with no line breaks at all is `Lf`: nothing to replay, and `Lf` is
/// what a new line in it will become.
fn classify(endings: &[LineEnding]) -> LineEnding {
    let mut seen: Option<LineEnding> = None;
    for &e in endings {
        match seen {
            None => seen = Some(e),
            Some(first) if first == e => {}
            Some(_) => return LineEnding::Mixed,
        }
    }
    seen.unwrap_or(LineEnding::Lf)
}

/// Rebuilds the on-disk bytes from edited text and the shape it was read with.
///
/// A `Mixed` file keeps its recorded endings for as many lines as still exist;
/// lines added past that point take the file's first ending, which is the least
/// surprising answer available.
pub fn encode(text: &str, shape: &DocumentShape) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 16);
    if shape.bom {
        out.extend_from_slice(BOM);
    }

    match (shape.line_ending, shape.mixed_endings.as_ref()) {
        (LineEnding::Mixed, Some(recorded)) => {
            let fallback = recorded.first().copied().unwrap_or(LineEnding::Lf);
            let mut nth = 0usize;
            for c in text.chars() {
                if c == '\n' {
                    let ending = recorded.get(nth).copied().unwrap_or(fallback);
                    out.extend_from_slice(ending.as_str().as_bytes());
                    nth += 1;
                } else {
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                }
            }
        }
        (ending, _) => {
            if ending == LineEnding::Crlf {
                for c in text.chars() {
                    if c == '\n' {
                        out.extend_from_slice(b"\r\n");
                    } else {
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                    }
                }
            } else {
                out.extend_from_slice(text.as_bytes());
            }
        }
    }

    out
}

/// Reads a file from disk into a document.
pub fn read(path: &Path) -> Result<Document, DocumentError> {
    decode(&std::fs::read(path)?)
}

/// Writes edited text back to disk in the shape the file was read with.
pub fn write(path: &Path, text: &str, shape: &DocumentShape) -> Result<(), DocumentError> {
    std::fs::write(path, encode(text, shape))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(bytes: &[u8]) {
        let doc = decode(bytes).expect("decodes");
        assert_eq!(encode(&doc.text, &doc.shape), bytes, "round trip");
    }

    #[test]
    fn lf_survives() {
        round_trip(b"# one\n\ntwo\n");
    }

    #[test]
    fn crlf_survives() {
        round_trip(b"# one\r\n\r\ntwo\r\n");
    }

    #[test]
    fn a_missing_trailing_newline_stays_missing() {
        round_trip(b"# one\ntwo");
        round_trip(b"# one\r\ntwo");
    }

    #[test]
    fn a_bom_survives() {
        round_trip(b"\xEF\xBB\xBF# one\ntwo\n");
        round_trip(b"\xEF\xBB\xBF# one\r\ntwo\r\n");
    }

    #[test]
    fn mixed_endings_survive_line_by_line() {
        let bytes = b"one\r\ntwo\nthree\nfour\r\n";
        let doc = decode(bytes).expect("decodes");
        assert_eq!(doc.shape.line_ending, LineEnding::Mixed);
        assert_eq!(encode(&doc.text, &doc.shape), bytes);
    }

    #[test]
    fn a_lone_cr_is_content_not_an_ending() {
        let bytes = b"one\rstill one\ntwo\n";
        let doc = decode(bytes).expect("decodes");
        assert_eq!(doc.shape.line_ending, LineEnding::Lf);
        assert!(doc.text.contains('\r'));
        assert_eq!(encode(&doc.text, &doc.shape), bytes);
    }

    #[test]
    fn an_empty_file_survives() {
        round_trip(b"");
        round_trip(b"\n");
        round_trip(b"\r\n");
    }

    #[test]
    fn a_file_without_breaks_defaults_to_lf() {
        let doc = decode(b"just one line").expect("decodes");
        assert_eq!(doc.shape.line_ending, LineEnding::Lf);
        assert!(doc.shape.mixed_endings.is_none());
    }

    #[test]
    fn a_new_line_in_a_crlf_file_becomes_crlf() {
        let doc = decode(b"one\r\ntwo\r\n").expect("decodes");
        assert_eq!(
            encode("one\ntwo\nthree\n", &doc.shape),
            b"one\r\ntwo\r\nthree\r\n"
        );
    }

    #[test]
    fn a_new_line_past_a_mixed_files_record_takes_the_first_ending() {
        // Recorded: CRLF, LF. A third break has no record, and the file's first
        // ending is the least surprising answer.
        let doc = decode(b"one\r\ntwo\nthree").expect("decodes");
        assert_eq!(
            encode("one\ntwo\nthree\nfour", &doc.shape),
            b"one\r\ntwo\nthree\r\nfour"
        );
    }

    #[test]
    fn multi_byte_characters_survive() {
        round_trip("# café 日本語 αβγ\n😀 emoji\r\n".as_bytes());
    }

    #[test]
    fn invalid_utf8_is_an_error() {
        assert!(matches!(decode(b"\x80"), Err(DocumentError::NotUtf8)));
    }
}

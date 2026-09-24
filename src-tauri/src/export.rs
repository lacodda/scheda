//! A note written out as one HTML file.
//!
//! The webview renders the page — it already has the parser and the diagrams —
//! and the core does the two things only the core may do: read the pictures the
//! note shows, and write the file. Both go through the same checks as
//! everything else that touches the disk (ADR 0004): a picture is read only
//! when its link resolves inside the note's root, and nothing is written but the
//! path the person chose in the save dialog.
//!
//! One file, not a file and a folder: the pictures travel inside it as data
//! URLs, so the page can be mailed, moved or opened years later without the
//! vault beside it.

use crate::root;
use std::path::Path;

/// The largest picture carried into a page. A photo straight off a camera is a
/// few megabytes; something much larger is a file that should be linked, not
/// swallowed, and leaving it out keeps the page openable.
const PICTURE_LIMIT: u64 = 25 * 1024 * 1024;

/// The media type a picture is carried with, by its extension. `None` for
/// anything that is not a picture a browser shows.
fn media_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

/// A picture a note links to, as a data URL — or `None` when the link leaves
/// the root, names something that is not a picture, or cannot be read.
pub fn inline_picture(document: &Path, link: &str) -> Option<String> {
    let root = root::for_file(document);
    let target = root::resolve_link(&root, document, link).ok()?;
    let media = media_type(&target)?;
    let size = std::fs::metadata(&target).ok()?.len();
    if size > PICTURE_LIMIT {
        return None;
    }
    let bytes = std::fs::read(&target).ok()?;
    Some(format!("data:{media};base64,{}", base64(&bytes)))
}

/// Writes the page, through a temporary file beside it so a failed write never
/// leaves half a page where a whole one was.
pub fn write_page(path: &Path, html: &str) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export.html".to_string());
    let temporary = path.with_file_name(format!(".{name}.scheda-tmp"));
    std::fs::write(&temporary, html.as_bytes())?;
    std::fs::rename(&temporary, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temporary);
    })
}

/// Standard base64 with padding. Twenty lines rather than a dependency for one
/// function.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18) as usize & 63] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_vectors() {
        // RFC 4648, section 10.
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), expected, "{input:?}");
        }
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
    }

    #[test]
    fn a_picture_inside_the_folder_comes_back_as_a_data_url() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("note.md");
        std::fs::write(&note, "![](dot.png)").unwrap();
        std::fs::write(dir.path().join("dot.png"), [0x89, b'P', b'N', b'G']).unwrap();
        assert_eq!(
            inline_picture(&note, "dot.png").as_deref(),
            Some("data:image/png;base64,iVBORw==")
        );
    }

    #[test]
    fn a_link_that_climbs_out_or_is_not_a_picture_gives_nothing() {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("notes");
        std::fs::create_dir(&inner).unwrap();
        let note = inner.join("note.md");
        std::fs::write(&note, "").unwrap();
        std::fs::write(outer.path().join("secret.png"), b"x").unwrap();
        std::fs::write(inner.join("text.txt"), b"x").unwrap();
        assert_eq!(inline_picture(&note, "../secret.png"), None);
        assert_eq!(inline_picture(&note, "text.txt"), None);
        assert_eq!(inline_picture(&note, "missing.png"), None);
    }

    #[test]
    fn the_page_is_written_whole_and_leaves_nothing_beside_it() {
        let dir = tempfile::tempdir().unwrap();
        let page = dir.path().join("note.html");
        write_page(&page, "<p>one page, über</p>").unwrap();
        assert_eq!(
            std::fs::read_to_string(&page).unwrap(),
            "<p>one page, über</p>"
        );
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(names.len(), 1);
    }
}

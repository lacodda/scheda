//! The byte-for-byte gate.
//!
//! Opening a file and saving it without an edit must produce the same bytes. It
//! is the promise scheda cannot break without quietly rewriting the files of
//! anyone who opens one to read it, so it is a test that runs on every build
//! rather than a habit of being careful. Every defect found in the wild gets a
//! file in the corpus, and the corpus only grows.

use scheda_lib::document;
use std::path::{Path, PathBuf};

fn corpus_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus")
}

fn corpus_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(corpus_dir())
        .expect("the corpus directory is missing")
        .map(|entry| entry.expect("unreadable corpus entry").path())
        .filter(|path| path.is_file())
        .collect();
    files.sort();
    assert!(!files.is_empty(), "the corpus is empty");
    files
}

/// Decode then encode, with no edit in between, reproduces the original bytes.
#[test]
fn corpus_round_trips_byte_for_byte() {
    for path in corpus_files() {
        let original = std::fs::read(&path).expect("unreadable corpus file");
        let doc = document::decode(&original)
            .unwrap_or_else(|e| panic!("{} failed to decode: {e}", path.display()));
        let rewritten = document::encode(&doc.text, &doc.shape);

        assert_eq!(
            rewritten,
            original,
            "{} did not round-trip byte for byte",
            path.display()
        );
    }
}

/// The same round trip through the disk, so a bug in the file layer cannot hide
/// behind a green in-memory test.
#[test]
fn corpus_round_trips_through_the_disk() {
    let scratch = tempfile::tempdir().expect("no temp dir");

    for path in corpus_files() {
        let original = std::fs::read(&path).expect("unreadable corpus file");
        let copy = scratch.path().join(path.file_name().expect("no file name"));
        std::fs::write(&copy, &original).expect("cannot write the copy");

        let doc = document::read(&copy).expect("cannot read the copy");
        document::write(&copy, &doc.text, &doc.shape).expect("cannot write back");

        assert_eq!(
            std::fs::read(&copy).expect("cannot re-read the copy"),
            original,
            "{} did not survive a disk round trip",
            path.display()
        );
    }
}

/// An edit in the middle of a file changes that text and nothing else: the
/// endings, the BOM and the trailing newline all come back as they were.
#[test]
fn an_edit_preserves_the_shape_around_it() {
    for path in corpus_files() {
        let original = std::fs::read(&path).expect("unreadable corpus file");
        let doc = document::decode(&original).expect("cannot decode");

        // Appending a line exercises the ending replay: a mixed file has to
        // pick something for the new break, and the shape has to survive it.
        let edited = format!("{}appended line\n", doc.text);
        let bytes = document::encode(&edited, &doc.shape);

        assert_eq!(
            bytes.starts_with(&[0xEF, 0xBB, 0xBF]),
            doc.shape.bom,
            "{} lost or gained a BOM on edit",
            path.display()
        );

        let back = document::decode(&bytes).expect("the edited file must decode");
        assert_eq!(
            back.text,
            edited,
            "{} did not survive decode after an edit",
            path.display()
        );
    }
}

/// A file that is not UTF-8 is refused rather than guessed at. Saving a guess
/// back would write a different file than the one that was opened.
#[test]
fn invalid_utf8_is_refused() {
    // A lone 0x80 continuation byte is valid in Latin-1 and impossible in UTF-8.
    let bytes = b"# heading\ninvalid: \x80\n";
    assert!(matches!(
        document::decode(bytes),
        Err(document::DocumentError::NotUtf8)
    ));
}

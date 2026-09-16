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

/// The manual gate: the same round trip over a real vault, named by the
/// environment rather than by the repository.
///
/// Ignored by default and never given a path in the source — the owner's vault,
/// its contents and where it lives are private (project rule), and a test that
/// hard-codes one is a test that leaks it. Run before a release with
///
/// ```text
/// SCHEDA_VAULT=<folder> cargo test --test round_trip -- --ignored --nocapture
/// ```
///
/// What reaches the journal is the count, not the paths.
#[test]
#[ignore = "needs a real vault; set SCHEDA_VAULT"]
fn a_real_vault_round_trips_byte_for_byte() {
    let Some(root) = std::env::var_os("SCHEDA_VAULT") else {
        panic!("set SCHEDA_VAULT to the folder to check");
    };

    let mut checked = 0usize;
    let mut refused = 0usize;
    let mut broken: Vec<PathBuf> = Vec::new();

    walk(Path::new(&root), &mut |path| {
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            return;
        }
        let Ok(original) = std::fs::read(path) else {
            return;
        };
        match document::decode(&original) {
            Ok(doc) => {
                checked += 1;
                if document::encode(&doc.text, &doc.shape) != original {
                    broken.push(path.to_path_buf());
                }
            }
            // Not a failure: a file that is not UTF-8 opens read-only by
            // design, and a vault may hold one.
            Err(_) => refused += 1,
        }
    });

    println!("checked {checked} markdown files; {refused} are not UTF-8 and open read-only");
    assert!(checked > 0, "no markdown files under SCHEDA_VAULT");
    assert!(
        broken.is_empty(),
        "{} files did not round-trip, first: {}",
        broken.len(),
        broken[0].display()
    );
}

/// Every file under `dir`, skipping hidden folders and the usual machinery —
/// the same set the tree shows.
fn walk(dir: &Path, visit: &mut impl FnMut(&Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => walk(&path, visit),
            Ok(kind) if kind.is_file() => visit(&path),
            _ => {}
        }
    }
}

//! The replacement's gate, on a copy of a real vault.
//!
//! The unit tests hold the byte-for-byte promise against notes somebody wrote
//! to exercise it. This holds it against a vault nobody designed: it copies the
//! folder, replaces a word across the copy, and checks that every note the plan
//! did not name is identical, that every note it did name differs only where
//! the plan said, and that undo puts every byte back.
//!
//!     cargo run --release --example replace_gate -- <folder> <word>
//!
//! The folder itself is only read. Everything is written in a copy under the
//! system's temporary directory, which is removed afterwards.

use scheda_lib::{index, replace, search};
use std::path::{Path, PathBuf};

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the copy's folder is made");
    for entry in std::fs::read_dir(from)
        .expect("the folder is read")
        .flatten()
    {
        let target = to.join(entry.file_name());
        let path = entry.path();
        if path.is_dir() {
            if entry.file_name() == ".git" {
                continue;
            }
            copy(&path, &target);
        } else if path.extension().is_some_and(|ext| ext == "md") {
            std::fs::copy(&path, &target).expect("a note is copied");
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(source), Some(word)) = (args.next().map(PathBuf::from), args.next()) else {
        eprintln!("usage: replace_gate <folder> <word>");
        std::process::exit(2);
    };
    // Always the word with a mark after it: that is what lets the check below
    // take the replacement back off and compare with the original bytes.
    let _ = args.next();
    let replacement = format!("{word}⁂");
    let root = std::env::temp_dir().join(format!("scheda-replace-gate-{}", std::process::id()));
    copy(&source, &root);

    let mut snapshot = index::Snapshot::empty(&root);
    index::reconcile(&mut snapshot, &root, 0);
    let before: Vec<(String, Vec<u8>)> = snapshot
        .notes
        .keys()
        .map(|key| {
            (
                key.clone(),
                std::fs::read(index::absolute(&root, key)).unwrap(),
            )
        })
        .collect();

    let query = search::Query {
        text: word.clone(),
        whole_word: true,
        // Case-sensitive, so every match is the word exactly as given and the
        // check below can take the mark back off. A case-insensitive run would
        // replace `План` with `план⁂`, which is the replacement doing what it
        // was asked, not a changed byte anywhere else.
        case_sensitive: true,
        ..search::Query::default()
    };
    let matcher = search::matcher(&query).unwrap().expect("a word was given");
    let keys = search::notes_for(&snapshot, &query);
    let plan = replace::plan(&root, &keys, &matcher, &replacement, false).expect("planned");
    let (applied, error) = replace::apply(&plan);
    assert!(error.is_none(), "{error:?}");
    println!(
        "{} notes, {} changes planned in {} notes, {} written, {} skipped",
        before.len(),
        plan.changes,
        plan.files.len(),
        applied.paths.len(),
        applied.skipped.len()
    );

    let planned: std::collections::BTreeMap<&str, &replace::FilePlan> = plan
        .files
        .iter()
        .map(|file| (file.relative.as_str(), file))
        .collect();
    let mut failures = 0;
    for (key, bytes) in &before {
        let now = std::fs::read(index::absolute(&root, key)).unwrap();
        match planned.get(key.as_str()) {
            None if now != *bytes => {
                println!("CHANGED WITHOUT A PLAN: {key}");
                failures += 1;
            }
            None => {}
            Some(file) => {
                // The replacement is the word with a mark after it, so taking
                // the mark off must give back the original bytes exactly —
                // line endings, BOM and all — and the length must have grown
                // by one mark per planned change and no more.
                let mark = replacement.strip_prefix(word.as_str()).unwrap_or("");
                let undone = String::from_utf8_lossy(&now).replace(&replacement, &word);
                let grown = now.len() - bytes.len();
                if undone.as_bytes() != bytes.as_slice() || grown != file.changes.len() * mark.len()
                {
                    println!("UNEXPECTED BYTES: {key}");
                    failures += 1;
                }
            }
        }
    }

    let (kept, error) = replace::undo(&applied);
    assert!(error.is_none() && kept.is_empty(), "{error:?} {kept:?}");
    for (key, bytes) in &before {
        if std::fs::read(index::absolute(&root, key)).unwrap() != *bytes {
            println!("NOT PUT BACK: {key}");
            failures += 1;
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    if failures > 0 {
        println!("{failures} failures");
        std::process::exit(1);
    }
    println!(
        "every unplanned note untouched, every planned one changed by exactly its matches, undo byte for byte"
    );
}

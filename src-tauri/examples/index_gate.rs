//! What the index, the tags panel and the vault search do on a real vault.
//!
//! The unit tests hold each rule against a line of text somebody wrote to
//! exercise it. What they cannot produce is a vault nobody designed: prose that
//! mentions a hash, a fenced block inside documentation, front matter written
//! three different ways across six thousand notes. So this reads a real folder
//! and prints what the window would get, with the time each step took, for a
//! person to look at.
//!
//!     cargo run --release --example index_gate -- <folder> [search text] [how-many]
//!
//! The vault is only read. The index is built into a temporary directory and
//! thrown away, so the measurement is a cold build and then a warm reopen —
//! the two cases the window meets.

use scheda_lib::{index, search, tags};
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(root) = args.next().map(PathBuf::from) else {
        eprintln!("usage: index_gate <folder> [search text] [how-many]");
        std::process::exit(2);
    };
    let text = args.next().unwrap_or_else(|| "the".into());
    let show: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(40);
    let store = std::env::temp_dir().join(format!("scheda-index-gate-{}", std::process::id()));

    let started = Instant::now();
    let mut snapshot = index::Snapshot::empty(&root);
    index::reconcile(&mut snapshot, &root, 0);
    let built = started.elapsed();
    index::save(&store, &snapshot).expect("the index is written");
    let size = std::fs::metadata(index::file_for(&store, &root))
        .map(|meta| meta.len())
        .unwrap_or(0);

    let started = Instant::now();
    let mut reopened = index::load(&store, &root).expect("the index is read back");
    let changed = index::reconcile(&mut reopened, &root, 0);
    let warm = started.elapsed();
    let _ = std::fs::remove_dir_all(&store);

    let unreadable = snapshot
        .notes
        .values()
        .filter(|note| !note.readable)
        .count();
    println!(
        "{} notes under {} ({} not UTF-8)",
        snapshot.notes.len(),
        root.display(),
        unreadable
    );
    println!(
        "cold build {} ms · stored {} KB · reopen and reconcile {} ms (changed: {})",
        built.as_millis(),
        size / 1024,
        warm.as_millis(),
        changed
    );
    assert_eq!(
        snapshot.notes, reopened.notes,
        "a reopened index must say what the built one said"
    );

    let started = Instant::now();
    let found = tags::read(&root, &snapshot);
    let places: usize = found.iter().map(|t| t.places.len()).sum();
    println!(
        "{} tags in {} places, answered in {} ms",
        found.len(),
        places,
        started.elapsed().as_millis()
    );

    let query = search::Query {
        text: text.clone(),
        whole_word: true,
        ..search::Query::default()
    };
    let matcher = search::matcher(&query).expect("the search text is a pattern");
    let keys = search::notes_for(&snapshot, &query);
    let started = Instant::now();
    let result = search::run(&root, &keys, matcher.as_ref(), &|| false).expect("not cancelled");
    println!(
        "search for “{text}”: {} matches in {} notes of {}, {} ms{}\n",
        result.matches,
        result.files.len(),
        result.notes,
        started.elapsed().as_millis(),
        if result.truncated { " (cut)" } else { "" }
    );

    for tag in found.iter().take(show) {
        println!("{:>5}  #{}", tag.notes, tag.name);
    }
    if found.len() > show {
        println!("... and {} more", found.len() - show);
    }
}

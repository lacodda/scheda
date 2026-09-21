//! What the tags panel would show for a real vault.
//!
//! The unit tests hold each rule against a line of text somebody wrote to
//! exercise it. What they cannot produce is a vault nobody designed: prose that
//! mentions a hash, a fenced block inside documentation, front matter written
//! three different ways across six thousand notes, a heading that happens to
//! contain a tag. So this reads a real folder and prints what the panel would
//! say, for a person to look at.
//!
//!     cargo run --release --example tags_gate -- <folder> [how-many]
//!
//! Nothing is written. The vault is only read.

use scheda_lib::{links, tags, tree};
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(root) = args.next().map(PathBuf::from) else {
        eprintln!("usage: tags_gate <folder> [how-many]");
        std::process::exit(2);
    };
    let show: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(40);

    let entries = tree::read(&root);
    let candidates = links::candidates(&root, &entries);
    println!("{} notes under {}", candidates.len(), root.display());

    let started = std::time::Instant::now();
    let found = tags::read(&root, &candidates);
    let took = started.elapsed();

    let places: usize = found.iter().map(|t| t.places.len()).sum();
    println!(
        "{} tags in {} places, read in {} ms\n",
        found.len(),
        places,
        took.as_millis()
    );

    for tag in found.iter().take(show) {
        println!("{:>5}  #{}", tag.notes, tag.name);
    }
    if found.len() > show {
        println!("... and {} more", found.len() - show);
    }
}

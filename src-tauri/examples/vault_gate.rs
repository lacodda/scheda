//! The manual byte-for-byte gate: run the real read/write path over a folder of
//! real files and report anything that does not come back identical.
//!
//! The corpus in `tests/` is synthetic and lives in a public repository, so it
//! can only hold the awkward shapes someone thought to write down. A vault of
//! actual notes is the other half of the check — and it stays out of the
//! repository entirely: this takes a path, reads it, and prints counts.
//!
//!     cargo run --release --example vault_gate -- <folder>

use std::path::{Path, PathBuf};

fn main() {
    let Some(root) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: vault_gate <folder>");
        std::process::exit(2);
    };

    let mut files = Vec::new();
    collect(&root, &mut files);
    files.sort();

    let mut checked = 0usize;
    let mut skipped_not_utf8 = 0usize;
    let mut failures = Vec::new();

    for path in &files {
        let Ok(original) = std::fs::read(path) else {
            continue;
        };
        match scheda_lib::document::decode(&original) {
            Ok(doc) => {
                checked += 1;
                let rewritten = scheda_lib::document::encode(&doc.text, &doc.shape);
                if rewritten != original {
                    // Report the shape and the first differing offset, never the
                    // contents: this runs over someone's private notes.
                    let at = rewritten
                        .iter()
                        .zip(original.iter())
                        .position(|(a, b)| a != b)
                        .unwrap_or_else(|| original.len().min(rewritten.len()));
                    failures.push(format!(
                        "{}: {} bytes in, {} out, first difference at {at} (endings {:?}, bom {})",
                        path.display(),
                        original.len(),
                        rewritten.len(),
                        doc.shape.line_ending,
                        doc.shape.bom
                    ));
                }
            }
            Err(_) => skipped_not_utf8 += 1,
        }
    }

    println!("checked {checked} files, {skipped_not_utf8} skipped as not UTF-8");
    if failures.is_empty() {
        println!("all of them round-tripped byte for byte");
    } else {
        println!("{} FAILED:", failures.len());
        for failure in &failures {
            println!("  {failure}");
        }
        std::process::exit(1);
    }
}

/// Every markdown file under `dir`, skipping the folders a vault keeps for
/// itself.
fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect(&path, out);
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push(path);
        }
    }
}

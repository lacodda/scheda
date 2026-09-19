//! The manual gate for the one thing scheda does that writes to files nobody
//! opened: rename a note, and check that *exactly* the listed files changed.
//!
//! The integration tests build small vaults and check the same promise. This
//! runs it against a real one — thousands of notes, real names, real links,
//! folders that were never designed to be test fixtures — because the failure
//! this guards against is the kind that only a real corpus produces: a note that
//! mentions the name in prose, a link inside a code fence in documentation, two
//! notes of the same name in different folders.
//!
//! It works on a **copy**, never on the vault itself. Renaming inside somebody's
//! notes to see whether the rename is safe is not a thing to do with the notes
//! you are trying to be careful about.
//!
//!     cargo run --release --example rename_gate -- <folder> [note-to-rename]
//!
//! With no note named, it picks the note the most links point at, which is the
//! one where the rewriting has the most to get wrong. It prints counts and
//! paths relative to the vault — never contents, since this runs over private
//! notes.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn main() {
    let mut args = std::env::args_os().skip(1);
    let Some(source) = args.next().map(PathBuf::from) else {
        eprintln!("usage: rename_gate <folder> [note-to-rename]");
        std::process::exit(2);
    };
    let chosen = args.next().map(PathBuf::from);

    // A copy, so the vault being checked is never the vault being written to.
    let temp = tempfile::Builder::new()
        .prefix("scheda-rename-gate-")
        .tempdir()
        .expect("a temporary folder");
    let root = temp.path().join("vault");
    eprintln!("copying the vault aside…");
    let copied = copy_tree(&source, &root);
    println!("copied {copied} files");

    let entries = scheda_lib::tree::read(&root);
    let candidates = scheda_lib::links::candidates(&root, &entries);
    let config = scheda_lib::vault::config_for(&root);

    let from = match chosen {
        Some(name) => root.join(name),
        None => match most_linked(&candidates) {
            Some(path) => path,
            None => {
                println!("no note in this vault is linked to — nothing to check");
                return;
            }
        },
    };
    if !from.is_file() {
        eprintln!("“{}” is not a file in the vault", from.display());
        std::process::exit(2);
    }

    // A name nothing in the vault can already be using, so the rename cannot
    // collide with a real note and the check is about the links alone.
    let extension = from
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "md".into());
    let to = from.with_file_name(format!("scheda-rename-gate-target.{extension}"));

    let before = snapshot(&root);
    println!(
        "renaming “{}” to “{}”",
        relative(&root, &from),
        relative(&root, &to)
    );

    let plan = scheda_lib::rename::plan(&config, &candidates, &root, &from, &to);
    println!(
        "the plan names {} link(s) in {} file(s); {} note(s) could not be read",
        plan.links,
        plan.files.len(),
        plan.unreadable.len()
    );
    for name in &plan.unreadable {
        println!("  unreadable: {name}");
    }

    // The dry run must not have touched anything. Checked rather than assumed:
    // it is the promise the whole dialog rests on.
    if snapshot(&root) != before {
        println!("FAILED: planning changed the vault");
        std::process::exit(1);
    }
    println!("planning changed nothing, as it must");

    let applied = match scheda_lib::rename::apply(&plan) {
        Ok(applied) => applied,
        Err(error) => {
            println!("FAILED: the rename itself refused: {error}");
            std::process::exit(1);
        }
    };
    println!(
        "the rename wrote {} link(s) in {} file(s)",
        applied.links,
        applied.files.len()
    );

    let after = snapshot(&root);
    let mut failures = Vec::new();

    // What the plan said it would touch, plus the renamed file's two names.
    let mut allowed: Vec<String> = plan
        .files
        .iter()
        .map(|file| relative(&root, Path::new(&file.path)))
        .collect();
    allowed.push(relative(&root, &from));
    allowed.push(relative(&root, &to));

    // Every file the plan did not name must be identical, byte for byte. This is
    // the whole gate.
    for (path, bytes) in &before {
        if allowed.contains(path) {
            continue;
        }
        match after.get(path) {
            Some(now) if now == bytes => {}
            Some(now) => failures.push(format!(
                "{path}: not in the plan but changed ({} bytes before, {} after)",
                bytes.len(),
                now.len()
            )),
            None => failures.push(format!("{path}: not in the plan but disappeared")),
        }
    }

    // And nothing appeared that was not asked for.
    for path in after.keys() {
        if !before.contains_key(path) && !allowed.contains(path) {
            failures.push(format!("{path}: appeared, and the plan never said it would"));
        }
    }

    // Every file the plan *did* name must differ from what it was — a plan that
    // lists a file and changes nothing in it is a plan that is lying about one
    // of the two.
    for file in &plan.files {
        let path = relative(&root, Path::new(&file.path));
        if path == relative(&root, &from) {
            continue;
        }
        match (before.get(&path), after.get(&path)) {
            (Some(was), Some(now)) if was == now => failures.push(format!(
                "{path}: the plan named {} edit(s) here and nothing changed",
                file.edits.len()
            )),
            _ => {}
        }
    }

    // And every touched file must still decode: a rewrite that produced bytes
    // the reader cannot read would be worse than one that did nothing.
    for file in &plan.files {
        let path = PathBuf::from(&file.path);
        let path = if path == from { to.clone() } else { path };
        let Ok(bytes) = std::fs::read(&path) else {
            failures.push(format!("{}: cannot be read back", relative(&root, &path)));
            continue;
        };
        if scheda_lib::document::decode(&bytes).is_err() {
            failures.push(format!(
                "{}: does not decode after the rewrite",
                relative(&root, &path)
            ));
        }
    }

    // Finally, undo has to put every byte back.
    if let Err(error) = scheda_lib::rename::undo(&applied) {
        failures.push(format!("undo refused: {error}"));
    } else if snapshot(&root) != before {
        failures.push("undo did not restore the vault byte for byte".to_string());
    } else {
        println!("undo restored every byte");
    }

    if failures.is_empty() {
        println!(
            "PASSED: {} file(s) checked, only the {} planned file(s) changed",
            before.len(),
            plan.files.len()
        );
    } else {
        println!("{} FAILED:", failures.len());
        for failure in &failures {
            println!("  {failure}");
        }
        std::process::exit(1);
    }
}

/// The note the most links in the vault point at — where a rename has the most
/// to get wrong.
fn most_linked(candidates: &[scheda_lib::links::Candidate]) -> Option<PathBuf> {
    let mut counts: BTreeMap<PathBuf, usize> = BTreeMap::new();
    for candidate in candidates {
        if candidate.path.extension().is_none_or(|e| e != "md") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&candidate.path) else {
            continue;
        };
        let Ok(document) = scheda_lib::document::decode(&bytes) else {
            continue;
        };
        for found in scheda_lib::links::scan(&document.text) {
            if found.target.is_empty() {
                continue;
            }
            if let Some(landed) = scheda_lib::links::resolve(candidates, &found.target) {
                *counts.entry(landed).or_default() += 1;
            }
        }
    }
    counts
        .into_iter()
        .max_by_key(|(path, count)| (*count, path.clone()))
        .map(|(path, _)| path)
}

/// Every file under `root`, by relative path, as raw bytes.
fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, out);
        } else if let Ok(bytes) = std::fs::read(&path) {
            out.insert(relative(root, &path), bytes);
        }
    }
}

/// Copies a folder, skipping the things a vault keeps for itself and the
/// heavyweight folders that are not notes.
fn copy_tree(from: &Path, to: &Path) -> usize {
    let mut copied = 0;
    std::fs::create_dir_all(to).expect("creates the copy");
    let Ok(entries) = std::fs::read_dir(from) else {
        return copied;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // `.git` and `.obsidian` are not notes; `.obsidian` is copied all the
        // same, because the link format is read from it and the gate would
        // otherwise check a rename under settings the vault does not have.
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let source = entry.path();
        let target = to.join(name.as_ref());
        if source.is_dir() {
            copied += copy_tree(&source, &target);
        } else if std::fs::copy(&source, &target).is_ok() {
            copied += 1;
        }
    }
    copied
}

/// The path from the vault root, with forward slashes.
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

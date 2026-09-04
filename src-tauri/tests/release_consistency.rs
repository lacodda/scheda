//! Guards the facts that must agree before a version is tagged.
//!
//! scheda states its version in three files — the crate manifest, the Tauri
//! config and `package.json` — and describes itself in two of them. Nothing
//! fails when one of the three is left behind: the build is green, the bundle
//! is produced, and the installer simply advertises a version that was never
//! released. The mismatch only becomes visible after the tag, which is the one
//! point where it cannot be taken back.
//!
//! So the agreement is a test, and the test runs in CI.

use std::fs;
use std::path::{Path, PathBuf};

/// The repository root: the crate lives one level down, in `src-tauri/`.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn read(path: impl AsRef<Path>) -> String {
    let path = repo_root().join(path);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// Extracts a top-level `key = "value"` from the `[package]` block.
///
/// Deliberately naive: reading only the first block is all these checks need,
/// and it avoids a TOML parser as a dev-dependency.
fn cargo_field(key: &str) -> String {
    let manifest = read("src-tauri/Cargo.toml");
    for line in manifest.lines() {
        let line = line.trim();
        // Stop at the next section: `version` also appears under [lib] and in
        // every dependency.
        if line.starts_with('[') && line != "[package]" {
            break;
        }
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        // Exact match, so `rust-version` cannot answer a lookup for `version`.
        if name.trim() != key {
            continue;
        }
        return value.trim().trim_matches('"').to_string();
    }
    panic!("`{key}` not found in the [package] block of src-tauri/Cargo.toml");
}

/// Extracts a `"key": "value"` from a JSON file, without a JSON dependency.
fn json_field(file: &str, key: &str) -> String {
    let text = read(file);
    let needle = format!("\"{key}\"");
    let start = text
        .find(&needle)
        .unwrap_or_else(|| panic!("`{key}` not found in {file}"));
    let after = &text[start + needle.len()..];
    let after = after.trim_start().trim_start_matches(':').trim_start();
    let after = after
        .strip_prefix('"')
        .unwrap_or_else(|| panic!("`{key}` in {file} is not a string"));
    after[..after.find('"').expect("unterminated string")].to_string()
}

#[test]
fn every_manifest_states_the_same_version() {
    let crate_version = cargo_field("version");
    let tauri_version = json_field("src-tauri/tauri.conf.json", "version");
    let npm_version = json_field("package.json", "version");

    assert_eq!(
        tauri_version, crate_version,
        "tauri.conf.json says {tauri_version} while Cargo.toml says {crate_version}; \
         the installer and the About box would disagree with the release"
    );
    assert_eq!(
        npm_version, crate_version,
        "package.json says {npm_version} while Cargo.toml says {crate_version}"
    );
}

#[test]
fn the_product_is_described_the_same_way_everywhere() {
    let crate_description = cargo_field("description");
    let npm_description = json_field("package.json", "description");

    assert_eq!(
        npm_description, crate_description,
        "the crate and package.json describe scheda differently; one of them is \
         a stale copy, and readers cannot tell which"
    );
}

#[test]
fn there_is_exactly_one_readme() {
    let readmes: Vec<_> = fs::read_dir(repo_root())
        .expect("cannot read the repository root")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.to_ascii_lowercase().starts_with("readme"))
        .collect();

    assert_eq!(
        readmes.len(),
        1,
        "the root holds {readmes:?}; one README is the single source, and a \
         second copy is the one that goes stale"
    );
}

#[test]
fn readme_links_are_absolute() {
    // Relative links work on GitHub and break everywhere the README is
    // re-rendered — crates.io, npm, the docs site. Images too: a relative
    // `src` shows a broken frame on every page but one.
    let readme = read("README.md");
    let mut offenders = Vec::new();

    for (number, line) in readme.lines().enumerate() {
        for marker in ["](", "src=\""] {
            let mut rest = line;
            while let Some(at) = rest.find(marker) {
                let target = &rest[at + marker.len()..];
                let end = target
                    .find(if marker == "](" { ')' } else { '"' })
                    .unwrap_or(target.len());
                let target = &target[..end];
                let local = !target.starts_with("http")
                    && !target.starts_with('#')
                    && !target.starts_with("mailto:");
                if local && !target.is_empty() {
                    offenders.push(format!("line {}: {target}", number + 1));
                }
                rest = &rest[at + marker.len()..];
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "the README has relative links, which break wherever it is re-rendered: {offenders:?}"
    );
}

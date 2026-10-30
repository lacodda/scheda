//! The formats that shipped, held against the code that reads and writes them.
//!
//! `tests/formats/<file>/<n>.json` is a sample of format `n` of each file, all
//! of them saying the same thing: the value [`settings`], [`session`] and
//! [`index`] build below. So every older sample has to read as that value —
//! which is the migration working — and the writer has to write the newest
//! sample — which is the format not having moved without its number moving.
//!
//! A sample is frozen once its format ships. `FROZEN` beside the samples holds
//! the hash of each one's meaning (its JSON, re-serialised with sorted keys,
//! so line endings and indentation do not count). Editing a sample to make a
//! test pass means editing that line too, in the same diff, where it shows.

use super::{Found, Kind, parse, render};
use crate::index::{self, LinkAt, Note, Snapshot, TagAt, Tombstone};
use crate::session::{self, Session, SessionTab};
use crate::settings::{self, Settings, Theme};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt::Debug;
use std::path::{Path, PathBuf};

fn samples() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("formats")
}

fn sample(name: &str, format: u32) -> Vec<u8> {
    let path = samples().join(name).join(format!("{format}.json"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn settings() -> Settings {
    Settings {
        theme: Theme::Dark,
        font_size: 17,
        column_width: 52.5,
        recent: vec!["/notes/plan.md".into(), "/notes/diary.md".into()],
        close_brackets: true,
        spellcheck: true,
        autosave: true,
        keys: BTreeMap::from([
            ("file.save".into(), vec!["Mod+Alt+S".into()]),
            ("tab.pin".into(), vec![]),
        ]),
        quick_note_file: Some("/notes/inbox.md".into()),
        quick_note_key: "Win+Alt+Q".into(),
    }
}

fn session() -> Session {
    Session {
        tabs: vec![
            SessionTab {
                path: Some("/notes/plan.md".into()),
                draft: None,
                pinned: true,
                anchor: 10,
                head: 14,
                top: 3,
            },
            SessionTab {
                path: None,
                draft: Some("1760000000000-0".into()),
                pinned: false,
                anchor: 0,
                head: 5,
                top: 0,
            },
        ],
        active: Some(1),
        beside: Some(0),
        focused: 1,
        // Empty, as every older sample has to read the same: no build before
        // format 2 could open a folder.
        folder: None,
        roots: vec![],
    }
}

fn index() -> Snapshot {
    let plan = Note {
        size: 120,
        modified: 1_760_000_000_123_456_789,
        hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into(),
        readable: true,
        headings: vec!["Plan".into()],
        links: vec![LinkAt {
            target: "diary".into(),
            line: 3,
            context: "see [[diary]]".into(),
        }],
        tags: vec![
            TagAt {
                name: "draft".into(),
                line: None,
                context: "tags: [draft]".into(),
            },
            TagAt {
                name: "work".into(),
                line: Some(4),
                context: "#work".into(),
            },
        ],
        fields: BTreeMap::from([("status".into(), vec!["draft".into()])]),
    };
    let scan = Note {
        size: 3,
        modified: 1_760_000_000_000_000_000,
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
        readable: false,
        headings: vec![],
        links: vec![],
        tags: vec![],
        fields: BTreeMap::new(),
    };
    Snapshot {
        root: "/vault".into(),
        notes: BTreeMap::from([("plan.md".into(), plan), ("scan.md".into(), scan)]),
        tombstones: BTreeMap::from([(
            "old.md".into(),
            Tombstone {
                hash: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae".into(),
                removed: 1_759_000_000_000,
            },
        )]),
    }
}

/// Every kind of file, with the value its samples say.
fn kinds() -> [(&'static Kind, &'static str); 3] {
    [
        (&settings::FORMAT, "settings"),
        (&session::FORMAT, "session"),
        (&index::FORMAT, "index"),
    ]
}

fn reads_as<T: DeserializeOwned + PartialEq + Debug>(kind: &Kind, dir: &str, expected: &T) {
    for format in kind.first..=kind.current {
        let found: Found<T> = parse(&sample(dir, format), kind)
            .unwrap_or_else(|error| panic!("{dir}/{format}.json: {error}"));
        match found {
            Found::Read(value) => assert_eq!(
                &value, expected,
                "{dir}/{format}.json reads as something else than the value its samples say"
            ),
            other => panic!("{dir}/{format}.json was not read: {other:?}"),
        }
    }
}

fn writes_as<T: Serialize>(kind: &Kind, dir: &str, value: &T) {
    let written: Value = serde_json::from_slice(&render(value, kind).unwrap()).unwrap();
    let frozen: Value = serde_json::from_slice(&sample(dir, kind.current)).unwrap();
    assert_eq!(
        written, frozen,
        "the {dir} file is written differently from format {}'s sample. A change \
         to what is stored is a new format: raise `current`, add a step and a \
         sample, and leave the old sample as it is (ADR 0016)",
        kind.current
    );
}

#[test]
fn every_older_sample_reads_as_the_newest() {
    reads_as(&settings::FORMAT, "settings", &settings());
    reads_as(&session::FORMAT, "session", &session());
    reads_as(&index::FORMAT, "index", &index());
}

#[test]
fn the_writer_writes_the_newest_sample() {
    writes_as(&settings::FORMAT, "settings", &settings());
    writes_as(&session::FORMAT, "session", &session());
    writes_as(&index::FORMAT, "index", &index());
}

#[test]
fn every_format_has_a_sample_and_a_step_and_nothing_else_does() {
    for (kind, dir) in kinds() {
        assert_eq!(
            kind.steps.len() as u32,
            kind.current - kind.first,
            "{dir}: one step between each pair of formats"
        );
        let mut found: Vec<String> = std::fs::read_dir(samples().join(dir))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        found.sort();
        let mut expected: Vec<String> = (kind.first..=kind.current)
            .map(|format| format!("{format}.json"))
            .collect();
        expected.sort();
        assert_eq!(
            found, expected,
            "{dir}: a sample of every format, and only those"
        );
    }
}

/// The hash of what a sample says, whatever its line endings and indentation.
fn meaning(bytes: &[u8]) -> String {
    let value: Value = serde_json::from_slice(bytes).unwrap();
    let canonical = serde_json::to_vec(&value).unwrap();
    Sha256::digest(&canonical)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn a_sample_that_shipped_is_not_edited() {
    let manifest = std::fs::read_to_string(samples().join("FROZEN")).unwrap();
    let listed: BTreeMap<String, String> = manifest
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .map(|line| {
            let (file, hash) = line.split_once(' ').expect("`<file> <hash>`");
            (file.to_string(), hash.trim().to_string())
        })
        .collect();

    let mut every = BTreeMap::new();
    for (kind, dir) in kinds() {
        for format in kind.first..=kind.current {
            every.insert(
                format!("{dir}/{format}.json"),
                meaning(&sample(dir, format)),
            );
        }
    }
    for (file, hash) in &every {
        assert_eq!(
            listed.get(file),
            Some(hash),
            "{file} is not the sample FROZEN lists. A shipped sample does not \
             change; a new one is added with the line `{file} {hash}`"
        );
    }
    assert_eq!(
        listed.keys().collect::<Vec<_>>(),
        every.keys().collect::<Vec<_>>(),
        "FROZEN lists a sample that is not there"
    );
}

#[test]
fn the_reference_page_gives_the_format_each_file_is_written_in() {
    let page = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../docs/src/content/docs/reference/what-scheda-keeps.md");
    let page = std::fs::read_to_string(&page).unwrap();
    for (kind, file) in [
        (&settings::FORMAT, "`settings.json`"),
        (&session::FORMAT, "`session.json`"),
        (&index::FORMAT, "`index/<name>.json`"),
    ] {
        let row = page
            .lines()
            .find(|line| line.starts_with(&format!("| {file} |")))
            .unwrap_or_else(|| panic!("the page has no row for {file}"));
        assert!(
            row.contains(&format!("| {} |", kind.current)),
            "the page's row for {file} does not say format {}: {row}",
            kind.current
        );
    }
}

#[test]
fn the_index_of_a_vault_is_kept_under_the_same_name() {
    // The name is the first sixteen hex digits of the root's SHA-256. Another
    // name would leave every vault's index behind, unread, at the next start.
    let name = index::file_for(Path::new("store"), Path::new("/vault"));
    assert_eq!(name, Path::new("store").join("27d33c883a0ee639.json"));
}

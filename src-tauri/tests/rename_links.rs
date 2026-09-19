//! Renaming a note and the links that follow it, against a real vault on disk.
//!
//! This is the one thing scheda does that writes to files nobody opened, so the
//! tests are about what it leaves *untouched* as much as what it changes. Every
//! one of them runs over a temporary vault with an `.obsidian/` in it, because
//! the link format is read from there and a test that invents the setting proves
//! nothing about a real vault.
//!
//! The promise being checked, in one sentence: after a rename, every file the
//! plan did not name is identical byte for byte, and every file it did name
//! differs only in the links it listed.

use scheda_lib::{document, links, network, rename, vault as vault_config};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A vault with the given files in it, and an `.obsidian/app.json` carrying the
/// link format.
fn vault(format: &str, files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("scheda-rename-")
        .tempdir()
        .expect("temp dir");
    std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates .obsidian");
    std::fs::write(
        dir.path().join(".obsidian/app.json"),
        format!(r#"{{"newLinkFormat":"{format}"}}"#),
    )
    .expect("writes app.json");

    for (path, text) in files {
        let full = dir.path().join(path);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).expect("creates the folder");
        }
        std::fs::write(&full, text).expect("writes the note");
    }
    dir
}

/// The vault's files as the resolver sees them.
fn candidates(root: &Path) -> Vec<links::Candidate> {
    links::candidates(root, &scheda_lib::tree::read(root))
}

/// Every file under `root`, by relative path, as raw bytes. The thing the
/// byte-for-byte promise is checked against.
fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    collect(root, root, &mut out);
    out
}

fn collect(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out);
        } else {
            let key = network::relative_to(root, &path);
            out.insert(key, std::fs::read(&path).expect("reads the file"));
        }
    }
}

/// Plans a rename of `path` to `name`, the way the command does.
fn plan_for(root: &Path, path: &Path, name: &str) -> rename::Plan {
    let config = vault_config::config_for(root);
    let to = path.parent().expect("a parent").join(name);
    rename::plan(&config, &candidates(root), root, path, &to)
}

/// The promise: nothing outside `touched` changed a byte.
fn only_these_changed(
    before: &BTreeMap<String, Vec<u8>>,
    after: &BTreeMap<String, Vec<u8>>,
    touched: &[&str],
) {
    for (path, bytes) in before {
        if touched.contains(&path.as_str()) {
            continue;
        }
        match after.get(path) {
            Some(now) => assert_eq!(
                now, bytes,
                "“{path}” was not in the plan and must be identical byte for byte"
            ),
            None => panic!("“{path}” was not in the plan and disappeared"),
        }
    }
}

#[test]
fn a_link_that_would_break_is_rewritten_and_nothing_else_is() {
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "# Plan\n\nthe plan itself\n"),
            ("notes/one.md", "see [[plan]] for the shape\n"),
            ("notes/two.md", "unrelated note, no links\n"),
        ],
    );
    let root = vault.path();
    let before = snapshot(root);

    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    assert_eq!(plan.links, 1, "one link points at the renamed note");
    assert_eq!(plan.files.len(), 1);
    assert_eq!(plan.files[0].relative, "notes/one.md");
    assert_eq!(plan.files[0].edits[0].before, "plan");
    assert_eq!(plan.files[0].edits[0].after, "roadmap");
    assert_eq!(plan.files[0].edits[0].line, 1);

    // The dry run wrote nothing. The whole point of showing it first.
    assert_eq!(snapshot(root), before, "planning does not touch the disk");

    let applied = rename::apply(&plan).expect("applies");
    assert_eq!(applied.links, 1);

    let after = snapshot(root);
    assert_eq!(
        std::fs::read_to_string(root.join("notes/one.md")).unwrap(),
        "see [[roadmap]] for the shape\n"
    );
    only_these_changed(&before, &after, &["notes/one.md", "plan.md"]);
    assert!(
        after.contains_key("roadmap.md"),
        "the file itself moved to the new name"
    );
}

#[test]
fn a_link_that_would_still_work_is_left_alone() {
    // The distinction that makes this trustworthy rather than a search and
    // replace. A second `plan.md` means `[[plan]]` keeps resolving after the
    // rename — to the other note — and rewriting it would move a link the
    // person never pointed here.
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "the one being renamed\n"),
            ("archive/plan.md", "another note of the same name\n"),
            ("notes/one.md", "see [[plan]]\n"),
        ],
    );
    let root = vault.path();
    let before = snapshot(root);

    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    assert_eq!(
        plan.links, 0,
        "the link still lands on a plan.md, so it is not this rename's business"
    );

    rename::apply(&plan).expect("applies");
    only_these_changed(&before, &snapshot(root), &["plan.md"]);
}

#[test]
fn an_alias_survives_the_rewrite() {
    // The alias is the sentence the person wrote. The rename has nothing to say
    // about it, and a rewrite that replaced the whole construction would eat it.
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "x\n"),
            ("one.md", "see [[plan|what we are doing]] today\n"),
        ],
    );
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    rename::apply(&plan).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "see [[roadmap|what we are doing]] today\n"
    );
}

#[test]
fn a_heading_survives_the_rewrite() {
    let vault = vault(
        "shortest",
        &[("plan.md", "x\n"), ("one.md", "see [[plan#Risks]]\n")],
    );
    let root = vault.path();
    rename::apply(&plan_for(root, &root.join("plan.md"), "roadmap.md")).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "see [[roadmap#Risks]]\n"
    );
}

#[test]
fn an_embed_is_rewritten_like_a_link() {
    let vault = vault(
        "shortest",
        &[
            ("shot.png", "not really a picture"),
            ("one.md", "![[shot.png]]\n"),
        ],
    );
    let root = vault.path();
    rename::apply(&plan_for(root, &root.join("shot.png"), "screen.png")).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "![[screen.png]]\n"
    );
}

#[test]
fn a_link_in_a_code_span_is_not_rewritten() {
    // The case that makes the scanner worth its weight: a note *about*
    // wikilinks. Rewriting the example would be rewriting prose.
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "x\n"),
            (
                "howto.md",
                "write `[[plan]]` to link, like this: [[plan]]\n",
            ),
        ],
    );
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    assert_eq!(plan.links, 1, "only the real link, not the example");

    rename::apply(&plan).expect("applies");
    assert_eq!(
        std::fs::read_to_string(root.join("howto.md")).unwrap(),
        "write `[[plan]]` to link, like this: [[roadmap]]\n",
        "the code span is untouched and the real link moved"
    );
}

#[test]
fn the_shape_of_a_touched_file_survives_exactly() {
    // CRLF and a BOM, in a file that is being written by this feature rather
    // than by a save. The byte-for-byte promise is not suspended because the
    // write came from a rename.
    let vault = vault("shortest", &[("plan.md", "x\n")]);
    let root = vault.path();
    let note = root.join("one.md");
    let original: Vec<u8> = {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"first line\r\nsee [[plan]] here\r\nlast line\r\n");
        bytes
    };
    std::fs::write(&note, &original).expect("writes the note");

    rename::apply(&plan_for(root, &root.join("plan.md"), "roadmap.md")).expect("applies");

    let now = std::fs::read(&note).expect("reads it back");
    assert_eq!(&now[..3], &[0xEF, 0xBB, 0xBF], "the BOM is still there");
    let text = String::from_utf8(now[3..].to_vec()).expect("utf-8");
    assert_eq!(
        text, "first line\r\nsee [[roadmap]] here\r\nlast line\r\n",
        "CRLF endings survived, and only the target changed"
    );
}

#[test]
fn a_note_without_a_trailing_newline_does_not_grow_one() {
    let vault = vault("shortest", &[("plan.md", "x\n")]);
    let root = vault.path();
    let note = root.join("one.md");
    std::fs::write(&note, "see [[plan]]").expect("writes");

    rename::apply(&plan_for(root, &root.join("plan.md"), "roadmap.md")).expect("applies");

    assert_eq!(
        std::fs::read_to_string(&note).unwrap(),
        "see [[roadmap]]",
        "no newline was invented"
    );
}

#[test]
fn undo_puts_every_byte_back() {
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "the plan\n"),
            (
                "notes/one.md",
                "see [[plan]]\r\nand again [[plan|here]]\r\n",
            ),
            ("notes/two.md", "[[plan#Risks]] too\n"),
        ],
    );
    let root = vault.path();
    let before = snapshot(root);

    let applied =
        rename::apply(&plan_for(root, &root.join("plan.md"), "roadmap.md")).expect("applies");
    assert_eq!(applied.links, 3);
    assert_ne!(snapshot(root), before, "something did happen");

    rename::undo(&applied).expect("undoes");
    assert_eq!(
        snapshot(root),
        before,
        "the vault is byte for byte what it was"
    );
}

#[test]
fn a_link_written_as_a_path_is_rewritten_as_one() {
    // With the absolute format the vault writes `[[folder/note]]`, and the
    // rewrite has to speak the vault's own dialect rather than scheda's.
    let vault = vault(
        "absolute",
        &[("notes/plan.md", "x\n"), ("one.md", "see [[notes/plan]]\n")],
    );
    let root = vault.path();
    rename::apply(&plan_for(root, &root.join("notes/plan.md"), "roadmap.md")).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "see [[notes/roadmap]]\n"
    );
}

#[test]
fn a_note_linking_to_itself_by_path_is_rewritten_too() {
    // The renamed note is read like any other. Its own text may point at it by a
    // path, and renaming it does not exempt it from the rule.
    let vault = vault(
        "absolute",
        &[("notes/plan.md", "this note is [[notes/plan]]\n")],
    );
    let root = vault.path();
    rename::apply(&plan_for(root, &root.join("notes/plan.md"), "roadmap.md")).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("notes/roadmap.md")).unwrap(),
        "this note is [[notes/roadmap]]\n"
    );
}

#[test]
fn two_links_on_one_line_are_both_rewritten() {
    // The splice is back to front for exactly this: replacing the first link
    // moves every offset after it.
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "x\n"),
            ("one.md", "[[plan]] then [[plan]] again\n"),
        ],
    );
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    assert_eq!(plan.links, 2);
    rename::apply(&plan).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "[[roadmap]] then [[roadmap]] again\n"
    );
}

#[test]
fn a_rewrite_at_a_multibyte_line_lands_on_the_right_bytes() {
    // The owner's vault is in Cyrillic. A splice by a character index rather
    // than a byte offset would cut a letter in half here.
    let vault = vault(
        "shortest",
        &[
            ("план.md", "x\n"),
            ("одна.md", "текст про [[план]] и ещё текст\n"),
        ],
    );
    let root = vault.path();
    rename::apply(&plan_for(root, &root.join("план.md"), "дорога.md")).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("одна.md")).unwrap(),
        "текст про [[дорога]] и ещё текст\n"
    );
}

#[test]
fn a_file_the_rename_could_not_read_is_named_rather_than_skipped() {
    // A note that is not UTF-8 is read-only in this product. It may hold a link
    // that is about to break, and the person is the one who can go and look.
    let vault = vault("shortest", &[("plan.md", "x\n"), ("one.md", "[[plan]]\n")]);
    let root = vault.path();
    std::fs::write(root.join("latin1.md"), [0xFF, 0xFE, b'a']).expect("writes");

    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    assert_eq!(plan.unreadable, vec!["latin1.md".to_string()]);
    assert_eq!(plan.links, 1, "the readable link is still planned");
}

#[test]
fn a_note_that_changed_since_the_plan_is_skipped_rather_than_spliced() {
    // The offsets in a plan describe the text it was made against. Writing at
    // them after somebody else has written to the file is how an editor
    // corrupts a note.
    let vault = vault(
        "shortest",
        &[("plan.md", "x\n"), ("one.md", "see [[plan]] here\n")],
    );
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");

    // Obsidian, or a sync client, between the showing and the doing.
    std::fs::write(root.join("one.md"), "somebody rewrote this entirely\n").expect("writes");

    let applied = rename::apply(&plan).expect("applies");
    assert_eq!(applied.links, 0, "the stale file was not written");
    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "somebody rewrote this entirely\n",
        "and it kept what the other program put there"
    );
}

#[test]
fn a_case_only_rename_moves_the_file_without_rewriting_a_thing() {
    // `[[plan]]` resolves case-insensitively, so it still works after
    // `plan.md` → `Plan.md`. Rewriting it would be a change nobody asked for.
    let vault = vault(
        "shortest",
        &[("plan.md", "x\n"), ("one.md", "see [[plan]]\n")],
    );
    let root = vault.path();
    let before = snapshot(root);

    let plan = plan_for(root, &root.join("plan.md"), "Plan.md");
    assert_eq!(plan.links, 0);
    rename::apply(&plan).expect("applies");

    only_these_changed(&before, &snapshot(root), &["plan.md", "Plan.md"]);
}

#[test]
fn renaming_a_picture_does_not_disturb_a_note_of_the_same_name() {
    // `[[plan]]` means the note and `[[plan.png]]` means the picture. Renaming
    // one must not touch the links to the other.
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "the note\n"),
            ("plan.png", "not really a picture"),
            ("one.md", "note [[plan]] and picture ![[plan.png]]\n"),
        ],
    );
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.png"), "screen.png");
    assert_eq!(plan.links, 1, "only the picture's link");
    rename::apply(&plan).expect("applies");

    assert_eq!(
        std::fs::read_to_string(root.join("one.md")).unwrap(),
        "note [[plan]] and picture ![[screen.png]]\n"
    );
}

#[test]
fn a_plan_with_nothing_in_it_still_moves_the_file() {
    let vault = vault("shortest", &[("plan.md", "alone in the vault\n")]);
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    assert_eq!(plan.links, 0);

    let applied = rename::apply(&plan).expect("applies");
    assert!(PathBuf::from(&applied.to).is_file());
    assert!(!root.join("plan.md").is_file());
}

#[test]
fn the_preview_shows_the_line_as_it_would_read() {
    // What the person approves is a line, not a target: the target alone is not
    // enough to recognise a link by.
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "x\n"),
            ("one.md", "before [[plan|the plan]] after\n"),
        ],
    );
    let root = vault.path();
    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    let edit = &plan.files[0].edits[0];

    assert_eq!(edit.line_before, "before [[plan|the plan]] after");
    assert_eq!(edit.line_after, "before [[roadmap|the plan]] after");
}

#[test]
fn backlinks_find_the_notes_that_point_here() {
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "the plan\n"),
            ("notes/one.md", "we follow [[plan]] closely\n"),
            ("notes/two.md", "nothing to do with it\n"),
            ("notes/three.md", "also [[plan|the plan]]\n"),
        ],
    );
    let root = vault.path();
    let found = network::around(root, &candidates(root), &root.join("plan.md"));

    let rows: Vec<_> = found
        .backlinks
        .iter()
        .map(|row| (row.relative.as_str(), row.line))
        .collect();
    assert_eq!(rows, vec![("notes/one.md", 1), ("notes/three.md", 1)]);
    assert_eq!(
        found.backlinks[0].context, "we follow [[plan]] closely",
        "the sentence around the link is what makes a backlink useful"
    );
}

#[test]
fn a_backlink_is_counted_by_where_it_lands_not_by_what_it_says() {
    // `[[plan]]` and `[[notes/plan]]` are the same link to the same note. A
    // panel that matched the written text would show half the backlinks.
    let vault = vault(
        "shortest",
        &[
            ("notes/plan.md", "the plan\n"),
            ("a.md", "[[plan]]\n"),
            ("b.md", "[[notes/plan]]\n"),
        ],
    );
    let root = vault.path();
    let found = network::around(root, &candidates(root), &root.join("notes/plan.md"));
    assert_eq!(found.backlinks.len(), 2);
}

#[test]
fn a_note_is_not_its_own_backlink() {
    let vault = vault("shortest", &[("plan.md", "this is [[plan]] itself\n")]);
    let root = vault.path();
    let found = network::around(root, &candidates(root), &root.join("plan.md"));
    assert!(found.backlinks.is_empty());
}

#[test]
fn unresolved_links_are_the_open_notes_own() {
    let vault = vault(
        "shortest",
        &[
            (
                "plan.md",
                "see [[missing]] and [[also-missing]] and [[here]]\n",
            ),
            ("here.md", "exists\n"),
            ("other.md", "[[another-missing]] but this is not our note\n"),
        ],
    );
    let root = vault.path();
    let found = network::around(root, &candidates(root), &root.join("plan.md"));

    let targets: Vec<_> = found
        .unresolved
        .iter()
        .map(|link| link.target.as_str())
        .collect();
    assert_eq!(targets, vec!["missing", "also-missing"]);
}

#[test]
fn the_same_missing_target_twice_is_one_note_left_to_write() {
    let vault = vault(
        "shortest",
        &[("plan.md", "[[missing]] here\nand [[missing]] again\n")],
    );
    let root = vault.path();
    let found = network::around(root, &candidates(root), &root.join("plan.md"));
    assert_eq!(found.unresolved.len(), 1);
}

#[test]
fn a_link_in_a_fence_is_neither_a_backlink_nor_a_hole() {
    let vault = vault(
        "shortest",
        &[
            ("plan.md", "```\n[[missing]]\n```\nnothing missing here\n"),
            ("one.md", "```\n[[plan]]\n```\n"),
        ],
    );
    let root = vault.path();
    let found = network::around(root, &candidates(root), &root.join("plan.md"));
    assert!(found.unresolved.is_empty(), "an example is not a hole");
    assert!(found.backlinks.is_empty(), "an example is not a backlink");
}

#[test]
fn every_file_round_trips_after_a_rename_over_the_corpus() {
    // The corpus holds the awkward shapes — BOMs, mixed endings, a lone CR, no
    // trailing newline. Running a rename across a vault made of them is the
    // byte-for-byte gate applied to this feature: the file the plan did not name
    // must come back identical, and the one it did must still decode.
    let corpus = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus");
    let vault = vault("shortest", &[("plan.md", "the target\n")]);
    let root = vault.path();

    let mut copied = Vec::new();
    for entry in std::fs::read_dir(&corpus)
        .expect("reads the corpus")
        .flatten()
    {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "md") {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            std::fs::copy(&path, root.join(&name)).expect("copies");
            copied.push(name);
        }
    }
    assert!(!copied.is_empty(), "the corpus is not empty");
    let before = snapshot(root);

    let plan = plan_for(root, &root.join("plan.md"), "roadmap.md");
    // The corpus is synthetic prose with no wikilinks in it, so nothing in it is
    // planned — which is the assertion, not an accident.
    assert_eq!(plan.links, 0);
    rename::apply(&plan).expect("applies");

    only_these_changed(&before, &snapshot(root), &["plan.md"]);

    // And every one of them still decodes to what it did.
    for name in &copied {
        let bytes = std::fs::read(root.join(name)).expect("reads");
        assert!(
            document::decode(&bytes).is_ok() || bytes.is_empty(),
            "“{name}” still decodes"
        );
    }
}

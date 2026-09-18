//! Wikilinks against a real vault on disk.
//!
//! The unit tests in `links` resolve against a hand-built list of candidates,
//! which is the right way to hold the *rules* — shortest path wins, a path
//! matches only at a boundary — but it means every one of them passes with a list
//! that a real directory walk would never produce. This is the other half: a
//! folder with an `.obsidian/` in it, walked by `tree`, flattened by `links`, and
//! resolved. If the two ever disagree about what a vault contains, it shows here.
//!
//! What it does not do is go through the Tauri commands: those need an app handle
//! and a window. Each command is a few lines over these functions, and the lines
//! worth testing are the ones underneath.

use scheda_lib::{document, links, root, tree, vault};
use std::path::{Path, PathBuf};

/// A vault on disk with the given files in it, and an `.obsidian/app.json`.
///
/// The files are created for real rather than declared, because the point of this
/// file is that the walk and the resolver see the same vault.
fn vault_with(files: &[(&str, &str)], config: &str) -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("scheda-links-")
        .tempdir()
        .expect("temp dir");
    std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates .obsidian");
    std::fs::write(dir.path().join(".obsidian/app.json"), config).expect("writes app.json");

    for (relative, contents) in files {
        let path = dir.path().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("creates the folder");
        }
        std::fs::write(&path, contents).expect("writes the note");
    }
    dir
}

/// The candidate list the resolver works from, built the way the command does.
fn candidates(root: &Path) -> Vec<links::Candidate> {
    links::candidates(root, &tree::read(root))
}

/// Where a target written in `document` leads, relative to the vault root.
fn resolved(root: &Path, target: &str) -> Option<String> {
    links::resolve(&candidates(root), target).map(|path| {
        path.strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/")
    })
}

#[test]
fn a_name_finds_a_note_the_walk_found() {
    // The whole arrangement in one test: the tree walked the vault, `links`
    // flattened what it found, and the resolver landed on the file. A mismatch in
    // how either side spells a path shows up right here.
    let vault = vault_with(&[("projects/deep/plan.md", "# Plan\n")], "{}");
    assert_eq!(
        resolved(vault.path(), "plan").as_deref(),
        Some("projects/deep/plan.md")
    );
}

#[test]
fn the_shallower_of_two_notes_of_one_name_wins() {
    let vault = vault_with(
        &[("archive/2024/plan.md", "old\n"), ("plan.md", "current\n")],
        "{}",
    );
    assert_eq!(resolved(vault.path(), "plan").as_deref(), Some("plan.md"));
}

#[test]
fn a_note_inside_the_vaults_own_state_is_not_a_target() {
    // `.obsidian/` is read for its conventions and never shown as content
    // (ADR 0003). The tree skips it, so a `[[workspace]]` in a note must not land
    // on Obsidian's own file — and this is the property that only a real walk can
    // show, since a hand-built candidate list would simply not contain it.
    let vault = vault_with(&[("note.md", "body\n")], "{}");
    std::fs::write(vault.path().join(".obsidian/workspace.md"), "internals\n")
        .expect("writes into .obsidian");

    assert_eq!(resolved(vault.path(), "workspace"), None);
}

#[test]
fn a_hidden_file_is_not_a_target() {
    let vault = vault_with(&[("note.md", "body\n")], "{}");
    std::fs::write(vault.path().join(".secret.md"), "hidden\n").expect("writes a hidden file");

    assert_eq!(resolved(vault.path(), ".secret"), None);
}

#[test]
fn a_picture_resolves_by_its_whole_name() {
    // What `![[shot.png]]` needs: a name with an extension is a name, and it is
    // found wherever the picture sits.
    let vault = vault_with(&[("assets/shot.png", "not really a png")], "{}");
    assert_eq!(
        resolved(vault.path(), "shot.png").as_deref(),
        Some("assets/shot.png")
    );
    // And the stem finds it too, when nothing else claims that name — Obsidian's
    // behaviour, and the reason a picture can be embedded as `![[shot]]`.
    assert_eq!(
        resolved(vault.path(), "shot").as_deref(),
        Some("assets/shot.png")
    );
}

#[test]
fn a_note_beats_a_picture_of_the_same_name() {
    // `[[shot]]` in a vault holding both means the note: that is what the assumed
    // `.md` is for, and it is the case the extension-optional rule exists to get
    // right rather than to blur.
    let vault = vault_with(
        &[("assets/shot.png", "bytes"), ("shot.md", "# Shot\n")],
        "{}",
    );
    assert_eq!(resolved(vault.path(), "shot").as_deref(), Some("shot.md"));
}

#[test]
fn a_note_beats_a_file_whose_path_sorts_first() {
    // The defect this test was written for. `a.md` and `a.js` are the same depth
    // and the same length, so the ranking fell through to the path — and picked
    // `a.js`, because `j` comes before `m`. Every unit test compared a note
    // against a note, so none of them saw it; it turned up on a probe against a
    // real vault.
    //
    // `.js` rather than `.png` on purpose: `a.png` is one character longer, so the
    // length key would have hidden the problem and the test would have passed for
    // the wrong reason.
    let vault = vault_with(&[("a.js", "code"), ("a.md", "note")], "{}");
    assert_eq!(resolved(vault.path(), "a").as_deref(), Some("a.md"));

    // And the other way round on disk, since the answer must not depend on the
    // order the directory was read in.
    let other = vault_with(&[("a.md", "note"), ("a.js", "code")], "{}");
    assert_eq!(resolved(other.path(), "a").as_deref(), Some("a.md"));
}

#[test]
fn a_note_is_not_preferred_when_the_target_named_an_extension() {
    // `[[a.js]]` asks for that file. Preferring the note here would answer a
    // question nobody asked.
    let vault = vault_with(&[("a.js", "code"), ("a.md", "note")], "{}");
    assert_eq!(resolved(vault.path(), "a.js").as_deref(), Some("a.js"));
}

#[test]
fn a_shallow_picture_still_loses_to_a_deep_note() {
    // The note key sits *ahead* of depth, which is the part that needed deciding:
    // a `[[plan]]` in a vault with `plan.png` at the top and `notes/plan.md` below
    // means the note, because the name was written without an extension.
    let vault = vault_with(
        &[("plan.png", "bytes"), ("notes/deep/plan.md", "note")],
        "{}",
    );
    assert_eq!(
        resolved(vault.path(), "plan").as_deref(),
        Some("notes/deep/plan.md")
    );
}

#[test]
fn a_link_written_back_follows_the_vaults_format() {
    // The setting is read from the vault's own file rather than invented, which is
    // the point: a vault where Obsidian writes `[[folder/note]]` and scheda writes
    // `[[note]]` is a vault two programs disagree about.
    let files = [("projects/plan.md", "# Plan\n"), ("daily/today.md", "\n")];
    let document = "daily/today.md";

    for (setting, expected) in [
        (r#"{"newLinkFormat":"shortest"}"#, "plan"),
        (r#"{"newLinkFormat":"absolute"}"#, "projects/plan"),
        (r#"{"newLinkFormat":"relative"}"#, "../projects/plan"),
    ] {
        let vault_dir = vault_with(&files, setting);
        let root = vault_dir.path();
        let config = vault::config_for(root);
        let written = links::target_for(
            &config,
            &candidates(root),
            root,
            &root.join(document),
            &root.join("projects/plan.md"),
        );
        assert_eq!(written, expected, "for {setting}");
    }
}

#[test]
fn the_shortest_format_writes_a_path_when_the_name_is_shared() {
    // Two notes called `plan`: the name alone would not be a link to either in
    // particular, so the whole path is written. Measured against a real vault
    // because the count of files sharing a name comes from the walk.
    let vault = vault_with(
        &[("projects/plan.md", "a\n"), ("archive/plan.md", "b\n")],
        "{}",
    );
    let root = vault.path();
    let written = links::target_for(
        &vault::config_for(root),
        &candidates(root),
        root,
        &root.join("note.md"),
        &root.join("archive/plan.md"),
    );
    assert_eq!(written, "archive/plan");
}

#[test]
fn a_missing_note_lands_where_the_vault_says_and_can_be_created() {
    // The sequence a person performs: follow a link to a note that is not there,
    // accept the offer, and find the file where the vault's own setting says it
    // should be.
    let vault = vault_with(&[("daily/today.md", "See [[the idea]]\n")], "{}");
    let root = vault.path();
    let document = root.join("daily/today.md");
    let config = vault::config_for(root);

    assert_eq!(resolved(root, "the idea"), None);

    let target = links::file_for_missing(&config, root, &document, "the idea")
        .expect("a name this vault can hold");
    assert_eq!(target, root.join("the idea.md"));

    std::fs::write(&target, "").expect("creates the note");
    // And now the link resolves — through a fresh walk, which is what the command
    // does after dropping the index.
    assert_eq!(resolved(root, "the idea").as_deref(), Some("the idea.md"));
}

#[test]
fn a_missing_note_goes_beside_this_one_when_the_vault_says_so() {
    let vault = vault_with(
        &[("daily/today.md", "\n")],
        r#"{"newFileLocation":"current"}"#,
    );
    let root = vault.path();
    let document = root.join("daily/today.md");

    let target = links::file_for_missing(&vault::config_for(root), root, &document, "tomorrow")
        .expect("a name this vault can hold");
    assert_eq!(target, root.join("daily/tomorrow.md"));
}

#[test]
fn a_missing_note_in_a_named_folder_goes_there() {
    let vault = vault_with(
        &[("daily/today.md", "\n")],
        r#"{"newFileLocation":"folder","newFileFolderPath":"Inbox"}"#,
    );
    let root = vault.path();
    let target = links::file_for_missing(
        &vault::config_for(root),
        root,
        &root.join("daily/today.md"),
        "an idea",
    )
    .expect("a name this vault can hold");
    assert_eq!(target, root.join("Inbox/an idea.md"));
}

#[test]
fn a_link_that_climbs_out_of_the_vault_creates_nothing() {
    // A note outside the vault is not a note this vault can hold, and a wikilink
    // is not the door for writing one. Held here as well as in the unit tests
    // because this is the path a real click takes.
    let vault = vault_with(&[("note.md", "\n")], "{}");
    let root = vault.path();
    let config = vault::config_for(root);
    let document = root.join("note.md");

    for target in ["../outside", "../../etc/passwd", "/absolute"] {
        assert_eq!(
            links::file_for_missing(&config, root, &document, target),
            None,
            "for {target}"
        );
    }
}

#[test]
fn the_headings_of_a_real_note_come_back() {
    // Read through the document layer, so what is parsed is what a save would have
    // produced rather than bytes this test invented.
    let vault = vault_with(
        &[(
            "plan.md",
            "---\ntags: [a]\n---\n\n# Plan\n\n```sh\n# not a heading\n```\n\n## Risks\n",
        )],
        "{}",
    );
    let text = document::read(&vault.path().join("plan.md"))
        .expect("reads")
        .text;

    assert_eq!(scheda_lib::notes::headings_in(&text), ["Plan", "Risks"]);
}

#[test]
fn the_opening_of_a_real_note_skips_its_front_matter() {
    let vault = vault_with(
        &[("plan.md", "---\ntags: [a]\n---\n\nThe first real line.\n")],
        "{}",
    );
    let text = document::read(&vault.path().join("plan.md"))
        .expect("reads")
        .text;

    assert_eq!(scheda_lib::notes::opening_of(&text), "The first real line.");
}

#[test]
fn a_note_outside_any_vault_has_no_vault_to_resolve_against() {
    // The ordinary case for a note on the Desktop, and the answer that keeps a
    // notepad a notepad: no vault, so no wikilink resolution and no tree
    // (decision 2026-09-05).
    let dir = tempfile::Builder::new()
        .prefix("scheda-lone-")
        .tempdir()
        .expect("temp dir");
    let note = dir.path().join("note.md");
    std::fs::write(&note, "See [[plan]]\n").expect("writes the note");

    assert_eq!(root::for_vault(&note), None);
}

#[test]
fn a_vault_with_a_broken_config_still_resolves_links() {
    // An unreadable `app.json` lands on Obsidian's defaults rather than refusing
    // the vault: the file is the user's, edited in another program, and a link
    // that stops working because of a stray comma is not an honest failure.
    let vault = vault_with(&[("plan.md", "# Plan\n")], "not json at all");
    let root = vault.path();

    assert_eq!(vault::config_for(root), vault::VaultConfig::default());
    assert_eq!(resolved(root, "plan").as_deref(), Some("plan.md"));
}

/// A vault of a thousand notes, to say out loud that the resolver is one pass
/// over a list rather than a walk per link.
#[test]
fn a_thousand_notes_resolve_from_one_walk() {
    let dir = tempfile::Builder::new()
        .prefix("scheda-many-")
        .tempdir()
        .expect("temp dir");
    std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates .obsidian");
    std::fs::write(dir.path().join(".obsidian/app.json"), "{}").expect("writes app.json");
    for index in 0..1000 {
        let folder = dir.path().join(format!("f{}", index % 20));
        std::fs::create_dir_all(&folder).expect("creates the folder");
        std::fs::write(folder.join(format!("note-{index}.md")), "body\n").expect("writes");
    }

    // One walk, one flatten, then every link answered from the same list — which
    // is the arrangement the cached index in the commands exists to preserve.
    let files: Vec<links::Candidate> = candidates(dir.path());
    assert_eq!(files.len(), 1000);

    let found: Vec<Option<PathBuf>> = (0..1000)
        .map(|index| links::resolve(&files, &format!("note-{index}")))
        .collect();
    assert!(found.iter().all(Option::is_some));
}

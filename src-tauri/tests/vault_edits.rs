//! Editing a vault's files, against a real one on disk.
//!
//! The unit tests in `files` and `attachments` each check one thing in
//! isolation; this is the sequence a person actually performs — make a note,
//! rename it, put a picture beside it, delete it — run against a folder with an
//! `.obsidian/` in it, because the attachment folder is read from there and a
//! test that invents the setting proves nothing about a real vault.
//!
//! What it does *not* do is go through the Tauri commands: those need an app
//! handle and a window. The commands are a line each over these functions, and
//! the line worth testing is the one underneath.

use scheda_lib::{attachments, document, files, root};
use std::path::{Path, PathBuf};

/// A vault with `.obsidian/app.json` in it, like the real thing.
fn vault(attachment_setting: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("scheda-vault-")
        .tempdir()
        .expect("temp dir");
    std::fs::create_dir_all(dir.path().join(".obsidian")).expect("creates .obsidian");
    let config = match attachment_setting {
        Some(value) => format!(r#"{{"attachmentFolderPath":"{value}"}}"#),
        None => "{}".to_string(),
    };
    std::fs::write(dir.path().join(".obsidian/app.json"), config).expect("writes app.json");
    dir
}

/// Where a picture pasted into `document` would go, and what it would be
/// called. The same two calls the `paste_image` command makes.
fn attachment_folder(document: &Path) -> PathBuf {
    let root = root::for_file(document);
    attachments::folder_for(&root).resolve(&root, document)
}

#[test]
fn a_note_is_made_renamed_and_removed() {
    let vault = vault(None);
    let notes = files::create_folder(vault.path(), "notes").expect("creates the folder");
    let note = files::create_file(&notes, "draft.md").expect("creates the note");

    // Written through the document layer, so what comes back is what a save
    // would have produced rather than bytes this test invented.
    let doc = document::decode(b"# A draft\r\n\r\nwith CRLF endings\r\n").expect("decodes");
    document::write(&note, &doc.text, &doc.shape).expect("writes");

    let renamed = files::rename(&note, "kept.md").expect("renames");
    assert!(!note.exists(), "the old name is gone");
    assert_eq!(
        renamed,
        notes.join("kept.md"),
        "the new path is under the same folder"
    );

    // The bytes survived the rename exactly — the same promise a save makes,
    // now across a move.
    assert_eq!(
        std::fs::read(&renamed).expect("reads"),
        b"# A draft\r\n\r\nwith CRLF endings\r\n"
    );

    files::delete(&renamed).expect("deletes");
    assert!(!renamed.exists(), "the note went to the recycle bin");
    assert!(notes.is_dir(), "its folder stayed");
}

#[test]
fn a_pasted_picture_lands_where_the_vault_says() {
    // `assets` from the root, which is the ordinary Obsidian setting.
    let vault = vault(Some("assets"));
    let notes = files::create_folder(vault.path(), "daily").expect("creates the folder");
    let note = files::create_file(&notes, "today.md").expect("creates the note");

    let folder = attachment_folder(&note);
    assert_eq!(
        folder,
        vault.path().join("assets"),
        "the picture belongs in the folder the vault names, not beside the note"
    );

    std::fs::create_dir_all(&folder).expect("creates the attachment folder");
    let target = files::free_name(&folder, "Pasted image 20260916120000", "png");
    std::fs::write(&target, b"\x89PNG\r\n\x1a\n").expect("writes the picture");

    // The link is relative to the note and climbs out of its folder, because
    // the picture is not in it.
    let link = attachments::link_from(&note, &target);
    assert_eq!(link, "../assets/Pasted%20image%2020260916120000.png");

    // And the link resolves back to the file, through the same code the picture
    // layer uses to display one. A link that is written but does not resolve is
    // a note with a broken image in it.
    let resolved = root::resolve_link(vault.path(), &note, &link).expect("resolves");
    assert_eq!(resolved, target);
}

#[test]
fn a_picture_beside_the_note_follows_the_dot_slash_setting() {
    // `./attachments` is a different folder for every note, which is the case
    // a single "attachments folder" implementation gets wrong.
    let vault = vault(Some("./attachments"));
    let notes = files::create_folder(vault.path(), "daily").expect("creates the folder");
    let note = files::create_file(&notes, "today.md").expect("creates the note");

    assert_eq!(attachment_folder(&note), notes.join("attachments"));

    let other = files::create_file(vault.path(), "loose.md").expect("creates the note");
    assert_eq!(
        attachment_folder(&other),
        vault.path().join("attachments"),
        "a note at the root gets its own folder, not the one beside another note"
    );
}

#[test]
fn a_file_outside_any_vault_still_takes_a_picture() {
    // A note on the Desktop has no `.obsidian/` above it. Its root is its own
    // folder, and a pasted picture lands beside it — the notepad case, which
    // must not refuse.
    let dir = tempfile::tempdir().expect("temp dir");
    let note = files::create_file(dir.path(), "loose.md").expect("creates the note");

    assert_eq!(attachment_folder(&note), dir.path());
}

#[test]
fn a_refusal_names_the_file_and_says_what_is_wrong() {
    // The whole point of the error type: a message a person can act on. The
    // wording is not asserted, but the file's name has to be in it — an error
    // that says "os error 80" and nothing else is the failure this replaced.
    let vault = vault(None);
    files::create_file(vault.path(), "taken.md").expect("creates the note");

    let error = files::create_file(vault.path(), "taken.md").expect_err("refuses");
    let message = error.to_string();
    assert!(
        message.contains("taken.md"),
        "the message does not name the file: {message}"
    );
    assert!(
        message.contains("exists"),
        "the message does not say what is wrong: {message}"
    );
}

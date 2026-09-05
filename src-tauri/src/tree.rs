//! The files in a root, as a tree.
//!
//! Read by the core rather than by the webview, like everything else that
//! touches the disk (ADR 0003, amended by ADR 0004 for pictures only). What
//! crosses the boundary is names and shapes — never a handle the frontend could
//! walk on its own.
//!
//! The walk is deliberately shallow-first and lazy about nothing: a vault of a
//! few thousand notes is read in one pass and sent whole, because the
//! alternative — a request per folder — turns opening a tree into a hundred
//! round trips. If that stops being true, the shape of the answer is what
//! changes, not who does the reading.

use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::path::Path;

/// Directories that are somebody else's business.
///
/// `.obsidian` is the vault's own state, read for its conventions and never
/// shown as content (ADR 0003). The rest are the usual machinery a notes folder
/// accumulates; showing them buries the notes.
const IGNORED: &[&str] = &[
    ".obsidian",
    ".git",
    ".trash",
    "node_modules",
    ".vscode",
    ".idea",
];

/// One entry in the tree.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Entry {
    /// The name as it appears in its folder.
    pub name: String,
    /// The full path, which is what the frontend hands back to open a file.
    pub path: String,
    /// Present for a directory, absent for a file. A directory with no readable
    /// contents still has an empty list, so "folder" and "file" never blur.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Entry>>,
}

/// How deep the walk goes.
///
/// Not a performance guard — a vault is not that deep — but a guard against a
/// symlink loop turning a tree read into a hang. Twenty levels is far past any
/// real notes folder.
const MAX_DEPTH: usize = 20;

/// Reads the tree under `root`.
///
/// Unreadable directories are skipped rather than failing the whole walk: one
/// folder with awkward permissions should not cost the tree.
pub fn read(root: &Path) -> Vec<Entry> {
    read_dir(root, 0)
}

fn read_dir(dir: &Path, depth: usize) -> Vec<Entry> {
    if depth >= MAX_DEPTH {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name) {
            continue;
        }
        let path = entry.path();
        // `file_type` rather than `metadata`: it does not follow symlinks, so a
        // link pointing at its own ancestor is reported as a link and skipped
        // rather than walked forever.
        let Ok(kind) = entry.file_type() else {
            continue;
        };

        if kind.is_dir() {
            out.push(Entry {
                name,
                path: path.to_string_lossy().into_owned(),
                children: Some(read_dir(&path, depth + 1)),
            });
        } else if kind.is_file() {
            out.push(Entry {
                name,
                path: path.to_string_lossy().into_owned(),
                children: None,
            });
        }
    }

    sort(&mut out);
    out
}

/// Hidden files and the directories nobody came here to read.
fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || IGNORED.contains(&name)
}

/// Folders first, then files, each alphabetically and case-insensitively.
///
/// Case-insensitively because a list where `Zebra.md` sorts before `apple.md`
/// reads as broken to everyone except a computer.
fn sort(entries: &mut [Entry]) {
    entries.sort_by(|a, b| match (a.children.is_some(), b.children.is_some()) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("scheda-tree-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn dir(&self, relative: &str) {
            fs::create_dir_all(self.0.join(relative)).expect("create dir");
        }

        fn file(&self, relative: &str) {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parent");
            }
            fs::write(&path, b"x").expect("write file");
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// The names at the top level, in the order the tree reports them.
    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_files_in_a_folder() {
        let temp = TempDir::new("flat");
        temp.file("one.md");
        temp.file("two.md");
        assert_eq!(names(&read(&temp.0)), ["one.md", "two.md"]);
    }

    #[test]
    fn puts_folders_before_files() {
        // The names are chosen so alphabetical order alone would put the files
        // first: with `aaa` as a folder and `zzz.md` as a file, sorting by name
        // and sorting by kind agree, and the test passes with the kind rule
        // removed entirely — which a mutation showed.
        let temp = TempDir::new("order");
        temp.file("aaa.md");
        temp.dir("zzz");
        temp.file("zzz/inside.md");
        temp.file("mmm.md");
        assert_eq!(names(&read(&temp.0)), ["zzz", "aaa.md", "mmm.md"]);
    }

    #[test]
    fn sorts_without_caring_about_case() {
        // A list where `Zebra` comes before `apple` reads as broken.
        let temp = TempDir::new("case");
        temp.file("Zebra.md");
        temp.file("apple.md");
        temp.file("Mango.md");
        assert_eq!(names(&read(&temp.0)), ["apple.md", "Mango.md", "Zebra.md"]);
    }

    #[test]
    fn nests_folders() {
        let temp = TempDir::new("nested");
        temp.file("notes/deep/one.md");
        let tree = read(&temp.0);
        let notes = &tree[0];
        assert_eq!(notes.name, "notes");
        let deep = &notes.children.as_ref().unwrap()[0];
        assert_eq!(deep.name, "deep");
        assert_eq!(names(deep.children.as_ref().unwrap()), ["one.md"]);
    }

    #[test]
    fn skips_the_vaults_own_state() {
        // `.obsidian` is read for its conventions and never shown as content.
        let temp = TempDir::new("obsidian");
        temp.file(".obsidian/workspace.json");
        temp.file("note.md");
        assert_eq!(names(&read(&temp.0)), ["note.md"]);
    }

    #[test]
    fn skips_the_usual_machinery() {
        let temp = TempDir::new("machinery");
        temp.file(".git/HEAD");
        temp.file("node_modules/thing/index.js");
        temp.file(".trash/deleted.md");
        temp.file("note.md");
        assert_eq!(names(&read(&temp.0)), ["note.md"]);
    }

    #[test]
    fn skips_hidden_files() {
        let temp = TempDir::new("hidden");
        temp.file(".env");
        temp.file("note.md");
        assert_eq!(names(&read(&temp.0)), ["note.md"]);
    }

    #[test]
    fn tells_an_empty_folder_from_a_file() {
        // A folder with nothing in it is still a folder, and the tree has to
        // say so or it draws as a file.
        let temp = TempDir::new("empty");
        temp.dir("empty-folder");
        temp.file("note.md");
        let tree = read(&temp.0);
        assert!(
            tree[0].children.is_some(),
            "a folder has children, even none"
        );
        assert!(tree[1].children.is_none(), "a file has none at all");
    }

    #[test]
    fn carries_the_full_path_of_each_entry() {
        // The path is what the frontend hands back to open a file, so it has to
        // be the real one rather than a name to be joined by the caller.
        let temp = TempDir::new("paths");
        temp.file("notes/one.md");
        let tree = read(&temp.0);
        let file = &tree[0].children.as_ref().unwrap()[0];
        // Joined a segment at a time. `join("notes/one.md")` keeps the forward
        // slash verbatim on Windows, so comparing against it fails against a
        // perfectly correct path — the first version of this test did.
        let expected = temp.0.join("notes").join("one.md");
        assert_eq!(file.path, expected.to_string_lossy());
    }

    #[test]
    fn answers_with_nothing_for_a_folder_that_is_not_there() {
        let temp = TempDir::new("missing");
        assert_eq!(read(&temp.0.join("no-such-folder")), Vec::new());
    }
}

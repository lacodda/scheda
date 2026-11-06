//! What a note used to say: its history in git.
//!
//! The repository is furca's to read (`furca-core`, in process, through
//! gitoxide), and only read: nothing here runs `git`, nothing here writes, and
//! nothing of scheda's reaches the repository (ADR 0023). The window asks by the
//! note's own path and is answered in text, like every other question it asks
//! the core (ADR 0001): a past version is decoded here, by the same rule that
//! reads a file off the disk.
//!
//! None of this happens before the panel is opened. The repository is opened
//! afresh for each question: the questions are a person clicking, a commit may
//! have been made since the last one, and an open repository held between them
//! would be one more thing to invalidate.

use std::path::{Component, Path};

use furca_core::{FileStatus, LineKind, Repository};
use serde::Serialize;

use crate::document;

/// How many changes a note lists. Enough to reach back as far as anybody reads a
/// list, with the walk still quick on a vault with years of commits behind it.
const LIMIT: usize = 200;

/// The unchanged lines shown around a change: enough to recognise the place.
const CONTEXT: u32 = 2;

/// How many lines of one change are drawn. A panel of a hundred thousand rows
/// would stop the window; a change that size is read by showing the version.
const MOST_LINES: usize = 2000;

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("{0}")]
    Git(#[from] furca_core::Error),
    #[error("This note is not in a git repository")]
    NoRepository,
    #[error("This version of the note is not in the repository")]
    NoVersion,
    #[error(transparent)]
    Document(#[from] document::DocumentError),
}

/// The changes a note has been through, newest first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub revisions: Vec<Revision>,
    /// Whether there is more behind the last one.
    pub truncated: bool,
}

/// One commit that changed the note.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// The commit, as a full hex id.
    pub commit: String,
    pub subject: String,
    pub author: String,
    /// When it was written, in seconds since the Unix epoch.
    pub seconds: i64,
    /// The note's path in this commit, from the root of the repository: what its
    /// text there is read by, since a rename is followed.
    pub path: String,
    pub status: FileStatus,
    /// Where the note was before, when this commit moved it.
    pub from: Option<String>,
}

/// What one commit did to the note.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub added: u32,
    pub removed: u32,
    /// False when a side is not text - a binary, a git LFS pointer - and there
    /// are no lines to show.
    pub text: bool,
    /// The places that changed, each with the lines around it.
    pub hunks: Vec<Vec<Line>>,
    /// Whether the change has more lines than `MOST_LINES`, and was cut there.
    pub cut: bool,
}

/// A line of a change.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: LineKind,
    pub text: String,
}

/// The repository a note is in, and the note's path inside it.
///
/// `None` when it is in none. Looked for by hand rather than read off the error
/// from opening one: that error says the same for no repository at all and for
/// one that is damaged, and only the first is an ordinary answer.
fn repository_of(document: &Path) -> Result<Option<(Repository, String)>, HistoryError> {
    let holds_one = document
        .ancestors()
        .skip(1)
        .find(|directory| directory.join(".git").exists());
    let Some(directory) = holds_one else {
        return Ok(None);
    };
    let repository = Repository::open(directory)?;
    let inside = repository.workdir().and_then(|root| inside(root, document));
    Ok(inside.map(|path| (repository, path)))
}

/// A path relative to the root of a working tree, the way git writes one.
///
/// By the text first, and through the file system when that does not reach:
/// the root comes back from git as git found it, and on Windows it can differ
/// from the note's path in case, or in a short name of a directory.
fn inside(root: &Path, document: &Path) -> Option<String> {
    let relative = match document.strip_prefix(root) {
        Ok(relative) => relative.to_path_buf(),
        Err(_) => document
            .canonicalize()
            .ok()?
            .strip_prefix(root.canonicalize().ok()?)
            .ok()?
            .to_path_buf(),
    };
    let parts = relative
        .components()
        .map(|part| match part {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    Some(parts.join("/"))
}

/// The changes a note has been through. `None` when it is in no repository; an
/// empty list when git has never heard of it.
pub fn of(document: &Path) -> Result<Option<History>, HistoryError> {
    let Some((repository, path)) = repository_of(document)? else {
        return Ok(None);
    };
    let log = repository.file_log(&path, LIMIT)?;
    Ok(Some(History {
        truncated: log.truncated,
        revisions: log
            .commits
            .into_iter()
            .map(|revision| Revision {
                commit: revision.commit.id,
                subject: revision.commit.subject,
                author: revision.commit.author.name,
                seconds: revision.commit.author.seconds,
                path: revision.path,
                status: revision.status,
                from: revision.from,
            })
            .collect(),
    }))
}

/// What the commit `commit` did to the note, which was at `path` then.
pub fn change(document: &Path, commit: &str, path: &str) -> Result<Change, HistoryError> {
    let (repository, _) = repository_of(document)?.ok_or(HistoryError::NoRepository)?;
    let changes = repository.changes(commit)?;
    // The log says this commit touched the note, and it reads the trees: a commit
    // that changed only the mode, or undid itself in a merge, has no lines here.
    let Some(file) = changes.files.iter().find(|file| file.path == path) else {
        return Ok(Change {
            text: true,
            ..Change::default()
        });
    };
    let Some(lines) = file.lines else {
        return Ok(Change::default());
    };

    let mut shown = 0;
    let mut cut = false;
    let mut hunks = Vec::new();
    for hunk in repository.diff(file)?.patch(CONTEXT).hunks {
        let room = MOST_LINES - shown;
        cut |= hunk.lines.len() > room;
        let taken: Vec<Line> = hunk
            .lines
            .into_iter()
            .take(room)
            .map(|line| Line {
                kind: line.kind,
                // A line of a CRLF file keeps its `\r` here, and it is not a
                // character anybody wants drawn.
                text: line.text.trim_end_matches('\r').to_owned(),
            })
            .collect();
        shown += taken.len();
        hunks.push(taken);
        if cut {
            break;
        }
    }
    Ok(Change {
        added: lines.added,
        removed: lines.removed,
        text: true,
        hunks,
        cut,
    })
}

/// The text of the note in the commit `commit`, where it was at `path`.
pub fn text_at(document: &Path, commit: &str, path: &str) -> Result<String, HistoryError> {
    let (repository, _) = repository_of(document)?.ok_or(HistoryError::NoRepository)?;
    let bytes = repository
        .file_at(commit, path)?
        .ok_or(HistoryError::NoVersion)?;
    Ok(document::decode(&bytes)?.text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use tempfile::TempDir;

    /// A real repository, made by the real git: furca-core has its own tests of
    /// how history is read, and what is held here is that a note's path gets it
    /// asked the right question and the answer comes back as the window wants it.
    struct Repo {
        directory: TempDir,
    }

    impl Repo {
        fn new() -> Self {
            let repo = Self {
                directory: TempDir::new().expect("a temporary directory"),
            };
            repo.git(&["init", "-q", "-b", "main"]);
            repo
        }

        fn git(&self, args: &[&str]) {
            let status = Command::new("git")
                .current_dir(self.directory.path())
                .args([
                    "-c",
                    "user.name=A Writer",
                    "-c",
                    "user.email=writer@example.com",
                    // The bytes a test wrote are the bytes it is asking about.
                    "-c",
                    "core.autocrlf=false",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?}");
        }

        fn path(&self, name: &str) -> PathBuf {
            self.directory.path().join(name)
        }

        fn commit(&self, name: &str, bytes: &[u8], subject: &str) {
            let path = self.path(name);
            std::fs::create_dir_all(path.parent().expect("a parent")).expect("the directory");
            std::fs::write(&path, bytes).expect("the file");
            self.git(&["add", "--all"]);
            self.git(&["commit", "-q", "-m", subject]);
        }
    }

    #[test]
    fn a_note_outside_any_repository_has_no_history_to_read() {
        let directory = TempDir::new().expect("a temporary directory");
        let note = directory.path().join("note.md");
        std::fs::write(&note, "text").expect("the file");
        assert!(of(&note).expect("an answer").is_none());
    }

    #[test]
    fn a_note_git_has_not_heard_of_has_no_changes_yet() {
        let repo = Repo::new();
        repo.commit("other.md", b"other", "the first");
        std::fs::write(repo.path("new.md"), "new").expect("the file");
        let history = of(&repo.path("new.md"))
            .expect("an answer")
            .expect("a repository");
        assert!(history.revisions.is_empty());
    }

    #[test]
    fn a_repository_with_no_commits_is_no_failure() {
        let repo = Repo::new();
        std::fs::write(repo.path("new.md"), "new").expect("the file");
        let history = of(&repo.path("new.md"))
            .expect("an answer")
            .expect("a repository");
        assert!(history.revisions.is_empty());
    }

    #[test]
    fn the_changes_of_a_note_come_newest_first_and_only_its_own() {
        let repo = Repo::new();
        repo.commit("notes/plan.md", b"one\n", "start the plan");
        repo.commit("notes/other.md", b"x\n", "another note");
        repo.commit("notes/plan.md", b"one\ntwo\n", "add a line");

        let history = of(&repo.path("notes/plan.md"))
            .expect("an answer")
            .expect("a repository");
        let subjects: Vec<&str> = history
            .revisions
            .iter()
            .map(|revision| revision.subject.as_str())
            .collect();
        assert_eq!(subjects, ["add a line", "start the plan"]);
        assert!(!history.truncated);
        assert_eq!(history.revisions[0].author, "A Writer");
        assert_eq!(history.revisions[0].status, FileStatus::Modified);
        assert_eq!(history.revisions[1].status, FileStatus::Added);
        // From the root of the repository with `/`, on every platform: that is
        // the path git knows it by, and what its text is read by.
        assert_eq!(history.revisions[0].path, "notes/plan.md");
    }

    #[test]
    fn a_name_outside_ascii_reaches_git_as_it_is() {
        let repo = Repo::new();
        repo.commit("naïve notes/déjà vu.md", b"one\n", "a named note");
        let history = of(&repo.path("naïve notes/déjà vu.md"))
            .expect("an answer")
            .expect("a repository");
        assert_eq!(history.revisions.len(), 1);
        assert_eq!(history.revisions[0].path, "naïve notes/déjà vu.md");
    }

    #[test]
    fn a_rename_is_followed_and_its_text_read_by_the_old_name() {
        let repo = Repo::new();
        repo.commit("old.md", b"a note that was moved\n", "write it");
        repo.git(&["mv", "old.md", "new.md"]);
        repo.git(&["commit", "-q", "-m", "move it"]);

        let note = repo.path("new.md");
        let history = of(&note).expect("an answer").expect("a repository");
        assert_eq!(history.revisions.len(), 2);
        assert_eq!(history.revisions[0].status, FileStatus::Renamed);
        assert_eq!(history.revisions[0].from.as_deref(), Some("old.md"));

        let first = &history.revisions[1];
        assert_eq!(first.path, "old.md");
        assert_eq!(
            text_at(&note, &first.commit, &first.path).expect("the text"),
            "a note that was moved\n"
        );
    }

    #[test]
    fn a_past_version_is_decoded_the_way_a_file_is_read() {
        // The window is handed text. A byte-order mark and CRLF are the shape of
        // a file, which a version on screen has no use for, and showing them
        // raw would be a second way of reading a file.
        let repo = Repo::new();
        repo.commit("note.md", b"\xEF\xBB\xBFone\r\ntwo\r\n", "write it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];
        assert_eq!(
            text_at(&note, &revision.commit, &revision.path).expect("the text"),
            "one\ntwo\n"
        );
    }

    #[test]
    fn a_past_version_that_is_not_utf8_is_refused_in_words() {
        let repo = Repo::new();
        repo.commit("note.md", b"caf\xE9\n", "write it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];
        assert!(matches!(
            text_at(&note, &revision.commit, &revision.path),
            Err(HistoryError::Document(_))
        ));
    }

    #[test]
    fn a_version_the_commit_does_not_have_is_said_so() {
        let repo = Repo::new();
        repo.commit("note.md", b"one\n", "write it");
        repo.git(&["rm", "-q", "note.md"]);
        repo.git(&["commit", "-q", "-m", "remove it"]);
        // The note is gone from the disk too, and its history still reads.
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        assert_eq!(history.revisions[0].status, FileStatus::Deleted);
        let removal = &history.revisions[0];
        assert!(matches!(
            text_at(&note, &removal.commit, &removal.path),
            Err(HistoryError::NoVersion)
        ));
    }

    #[test]
    fn a_change_says_which_lines_went_and_came_with_some_around_them() {
        let repo = Repo::new();
        repo.commit("note.md", b"a\nb\nc\nd\ne\nf\ng\n", "write it");
        repo.commit("note.md", b"a\nb\nc\nD\ne\nf\ng\nh\n", "change it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];

        let change = change(&note, &revision.commit, &revision.path).expect("the change");
        assert!(change.text);
        assert_eq!((change.added, change.removed), (2, 1));
        assert!(!change.cut);
        let lines: Vec<(LineKind, &str)> = change
            .hunks
            .iter()
            .flatten()
            .map(|line| (line.kind, line.text.as_str()))
            .collect();
        assert!(lines.contains(&(LineKind::Removed, "d")));
        assert!(lines.contains(&(LineKind::Added, "D")));
        assert!(lines.contains(&(LineKind::Added, "h")));
        // The context: the lines beside the change, and not the whole file.
        assert!(lines.contains(&(LineKind::Context, "c")));
        assert!(!lines.iter().any(|(_, text)| *text == "a"));
    }

    #[test]
    fn the_first_commit_of_a_note_is_all_additions() {
        let repo = Repo::new();
        repo.commit("note.md", b"one\ntwo\n", "write it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];
        let change = change(&note, &revision.commit, &revision.path).expect("the change");
        assert_eq!((change.added, change.removed), (2, 0));
    }

    #[test]
    fn a_line_of_a_crlf_note_comes_without_its_carriage_return() {
        let repo = Repo::new();
        repo.commit("note.md", b"one\r\n", "write it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];
        let change = change(&note, &revision.commit, &revision.path).expect("the change");
        assert_eq!(change.hunks[0][0].text, "one");
    }

    #[test]
    fn a_change_that_is_not_text_has_no_lines_and_says_so() {
        let repo = Repo::new();
        repo.commit("note.md", b"\x00\x01\x02binary\n", "write it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];
        let change = change(&note, &revision.commit, &revision.path).expect("the change");
        assert!(!change.text);
        assert!(change.hunks.is_empty());
    }

    #[test]
    fn a_change_too_long_to_draw_is_cut_and_says_so() {
        let repo = Repo::new();
        let long: String = (0..MOST_LINES + 50)
            .map(|n| format!("line {n}\n"))
            .collect();
        repo.commit("note.md", long.as_bytes(), "write it");
        let note = repo.path("note.md");
        let history = of(&note).expect("an answer").expect("a repository");
        let revision = &history.revisions[0];
        let change = change(&note, &revision.commit, &revision.path).expect("the change");
        assert!(change.cut);
        assert_eq!(change.hunks.iter().flatten().count(), MOST_LINES);
        assert_eq!(change.added as usize, MOST_LINES + 50);
    }

    #[test]
    fn a_list_too_long_says_there_is_more() {
        // Handed to git in one stream: a process per commit would make this the
        // slowest test in the gate, by far.
        let repo = Repo::new();
        let stream: String = (0..=LIMIT)
            .map(|n| {
                let text = format!("{n}\n");
                format!(
                    "commit refs/heads/main\n\
                     committer A Writer <writer@example.com> {} +0000\n\
                     data 7\nanother\n\
                     M 100644 inline note.md\n\
                     data {}\n{text}\n",
                    1_700_000_000 + n,
                    text.len(),
                )
            })
            .collect();
        let mut import = Command::new("git")
            .current_dir(repo.directory.path())
            .args(["fast-import", "--quiet"])
            .stdin(Stdio::piped())
            .spawn()
            .expect("git runs");
        import
            .stdin
            .take()
            .expect("its input")
            .write_all(stream.as_bytes())
            .expect("the stream");
        assert!(import.wait().expect("it ends").success());

        let history = of(&repo.path("note.md"))
            .expect("an answer")
            .expect("a repository");
        assert_eq!(history.revisions.len(), LIMIT);
        assert!(history.truncated);
    }

    #[test]
    fn asking_about_a_version_outside_any_repository_is_refused_in_words() {
        let directory = TempDir::new().expect("a temporary directory");
        let note = directory.path().join("note.md");
        assert!(matches!(
            text_at(&note, "HEAD", "note.md"),
            Err(HistoryError::NoRepository)
        ));
    }
}

//! `scheda --wait FILE`: the process stays alive until the tab is closed.
//!
//! This is what makes scheda usable as `$EDITOR`. A program that hands a file
//! to an editor — git writing a commit message, rigger editing a document —
//! spawns it and blocks. If the editor returns immediately, the caller reads
//! back the file it just wrote and carries on as though nothing was typed, so
//! "return when the user is done" is not a convenience here, it is the entire
//! contract.
//!
//! The awkward part is that scheda is a single-instance application. The window
//! that opens the file is usually *another process*, already running, and the
//! process that has to block is this one. So the two have to agree when the tab
//! closes, across a process boundary.
//!
//! **The waiting process never builds a window.** Given `--wait`, this process
//! spawns a second scheda without the flag — which either becomes the window or
//! hands its file to the window already running, and either way is none of our
//! business — and then does nothing but watch the sentinel.
//!
//! That split is not tidiness, it is the only arrangement that works. Measured:
//! `tauri-plugin-single-instance` ends a second launch by calling
//! `std::process::exit(0)` from inside its own setup. Nothing written after
//! `Builder::run` is reached, and no destructor runs, so a process that both
//! owns a window and waits cannot survive being the second one. A process that
//! only waits has nothing to exit out from under it.
//!
//! **A sentinel file, named after the document.** The waiting process creates a
//! file in scheda's own data directory whose name is derived from the absolute
//! path of the file being edited. The window deletes every sentinel for that
//! path when the tab closes; the waiter sees its file go and returns. No
//! socket, no named pipe, no port: those are three ways to need a permission, a
//! cleanup path and a platform branch each, for a signal that carries no data
//! and happens once.
//!
//! **Why the name is derived rather than passed.** The obvious design hands the
//! window a token. It cannot: `tauri-plugin-single-instance` forwards the
//! second process's `std::env::args()` verbatim, and a process cannot add an
//! argument to its own command line after it has started. So the two sides
//! compute the same name from the one thing that does cross — the path being
//! opened. Two processes waiting on the same file get the same prefix and
//! different suffixes, and closing the tab releases both, which is the right
//! answer: the file they were both waiting for has been edited.
//!
//! **The sentinel is not the vault's business.** It lives beside the settings,
//! never in the folder being edited (ADR 0003).

use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Where the sentinels live: `<settings dir>/waiting`.
///
/// A folder of their own rather than loose beside `settings.json`, so a stale
/// one left by a killed process is obvious rather than mixed in with the things
/// scheda actually keeps.
fn directory() -> io::Result<PathBuf> {
    let base = crate::settings::directory()
        .map_err(|error| io::Error::other(error.to_string()))?
        .join("waiting");
    std::fs::create_dir_all(&base)?;
    Ok(base)
}

/// How often the waiter looks at the sentinel.
///
/// Polling rather than watching: this is the one place where the dependency
/// would buy nothing. The waiter is a process doing nothing else, the answer is
/// needed within a human's reaction time, and a filesystem watcher for a single
/// file in a folder we own is more moving parts than a stat every fifth of a
/// second.
const POLL: Duration = Duration::from_millis(200);

/// A waiting process gives up after this long.
///
/// Not a timeout on how long someone may take to write — they may take an hour.
/// It is the guard against a window that died without deleting the sentinel:
/// without it the caller blocks forever, and a git commit that never returns is
/// worse than one that returns early.
const ABANDONED_AFTER: Duration = Duration::from_secs(60 * 60 * 12);

/// The name both sides compute for a document, so neither has to be told it.
///
/// A hash rather than the path itself: a path is not a file name — it has
/// separators in it, it can be longer than a name may be, and on Windows it
/// starts with a drive letter and a colon. What matters is only that the same
/// document gives the same prefix in both processes, and that two different
/// ones practically never do.
///
/// The constant and the mixing step are written out rather than depended on:
/// this is four lines, and nothing here needs a hash that stands up to an
/// adversary — only one that is the same on both sides of a process boundary.
fn prefix_for(document: &Path) -> String {
    // Case-folded and separator-normalised, because the same file reaches the
    // two processes spelled differently: the caller passes what was typed, and
    // the window compares against what the filesystem returned.
    let key: String = document
        .to_string_lossy()
        .to_lowercase()
        .chars()
        .map(|c| if c == '\\' { '/' } else { c })
        .collect();

    let mut hash: u64 = 0;
    for byte in key.bytes() {
        hash = (hash.rotate_left(5) ^ u64::from(byte)).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
    format!("{hash:016x}")
}

/// A sentinel: a file whose existence means "somebody is still waiting".
pub struct Sentinel {
    path: PathBuf,
}

impl Sentinel {
    /// Creates one for the document about to be edited.
    ///
    /// The name is the document's prefix plus this process and the moment. The
    /// prefix is what the window matches on; the rest keeps two waiters on one
    /// file from colliding, since a process id alone is reused by the operating
    /// system.
    pub fn create(document: &Path) -> io::Result<Self> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = directory()?.join(format!(
            "{}-{}-{stamp}",
            prefix_for(document),
            std::process::id()
        ));
        std::fs::write(&path, b"")?;
        Ok(Self { path })
    }

    /// Blocks until the window releases the sentinel, or until it is plainly
    /// never going to.
    ///
    /// Answers whether the wait ended the way it should: `true` when the
    /// sentinel was released, `false` when it was abandoned. The caller turns
    /// that into an exit code, and a caller like git reads a non-zero code as
    /// "the edit did not happen" — which is the truth when the window went away
    /// without closing the tab.
    pub fn block(&self) -> bool {
        let started = Instant::now();
        while self.path.exists() {
            if started.elapsed() > ABANDONED_AFTER {
                let _ = std::fs::remove_file(&self.path);
                return false;
            }
            std::thread::sleep(POLL);
        }
        true
    }
}

impl Drop for Sentinel {
    /// A sentinel outliving its process would be a file the window deletes on
    /// behalf of nobody. Cheap insurance against an early return anywhere above.
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Whether anybody is blocked on `document` right now.
///
/// The window asks this rather than being told. It has to: the process that is
/// waiting spawned a scheda *without* `--wait` — the flag would make that one
/// spawn a waiter of its own — so the command line the window sees says nothing
/// about a promise having been made. The sentinel on disk is the promise, and
/// looking for it is how the window finds out it has one to keep.
pub fn is_awaited(document: &Path) -> bool {
    let Ok(directory) = directory() else {
        return false;
    };
    let prefix = prefix_for(document);
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(&prefix))
    })
}

/// Releases every process waiting on `document` — the window's side of the
/// bargain, called when the tab closes.
///
/// Every, not one: two callers may be blocked on the same file, and the thing
/// they were both waiting for has happened. Answers how many were let go, which
/// is how the window knows whether this tab was ever somebody's `$EDITOR`.
///
/// Nothing from outside becomes a path here. The name is computed from the
/// document, the directory is scheda's own, and a file in it is removed only
/// when its name starts with the prefix this function derived.
pub fn release(document: &Path) -> io::Result<usize> {
    let directory = directory()?;
    let prefix = prefix_for(document);
    let mut released = 0;
    for entry in std::fs::read_dir(&directory)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(&prefix) {
            continue;
        }
        // A sentinel already gone is the outcome we wanted, not a failure: the
        // waiting process removes its own on the way out, and a tab may close
        // twice.
        match std::fs::remove_file(entry.path()) {
            Ok(()) => released += 1,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(released)
}

/// Runs the waiting half: start a scheda that is not waiting, then block.
///
/// Answers the exit code this process should end with. The spawned one is not
/// waited on — it may be about to hand its file to a window that has been open
/// for hours and exit immediately, or it may be the window itself and run until
/// somebody closes it. Neither is the question. The question is when the *tab*
/// closes, and the sentinel is what answers it.
pub fn run_as_waiter(document: &Path) -> i32 {
    let Ok(exe) = std::env::current_exe() else {
        eprintln!("scheda cannot find its own executable");
        return 1;
    };
    let Ok(sentinel) = Sentinel::create(document) else {
        eprintln!("scheda cannot record that you are waiting");
        return 1;
    };

    // Without `--wait`: the child opens the file and gets on with it. Passing
    // the flag on would make it spawn a waiter of its own, for ever.
    match std::process::Command::new(exe).arg(document).spawn() {
        Ok(_) => {}
        Err(error) => {
            eprintln!("scheda could not start: {error}");
            return 1;
        }
    }

    // The sentinel is dropped on the way out of this function, which removes it
    // — the right thing whether the wait ended or was abandoned.
    if sentinel.block() { 0 } else { 1 }
}

/// What the command line asked for.
#[derive(Debug, PartialEq, Eq)]
pub struct Invocation {
    /// The file to open, if one was named.
    pub file: Option<PathBuf>,
    /// Whether the process should live until the tab is closed.
    pub wait: bool,
}

/// Reads the arguments scheda understands.
///
/// Deliberately small: a notepad is not a program with a command line, and the
/// flags that exist are the ones another program needs in order to call it —
/// `--wait` for `$EDITOR`, and the registration flags the installer uses, which
/// are handled before this is ever reached.
///
/// `-w` as well as `--wait`, because that is the spelling every editor that
/// does this already uses, and `$EDITOR` strings get copied between tools.
pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Invocation {
    let mut file = None;
    let mut wait = false;
    for argument in args {
        match argument.as_str() {
            "--wait" | "-w" => wait = true,
            // A lone `--` ends the flags; what follows is a file even if it
            // starts with a dash. A note called `-w.md` is a real file name.
            "--" => continue,
            _ if file.is_none() => file = Some(PathBuf::from(argument)),
            _ => {}
        }
    }
    Invocation { file, wait }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_bare_file_is_not_a_wait() {
        let parsed = parse(args(&["note.md"]));
        assert_eq!(parsed.file, Some(PathBuf::from("note.md")));
        assert!(!parsed.wait);
    }

    #[test]
    fn the_flag_is_read_on_either_side_of_the_file() {
        assert!(parse(args(&["--wait", "note.md"])).wait);
        assert!(parse(args(&["note.md", "--wait"])).wait);
    }

    #[test]
    fn the_short_spelling_works() {
        // `$EDITOR` strings get copied between tools, and `-w` is what every
        // editor that does this already answers to.
        let parsed = parse(args(&["-w", "note.md"]));
        assert!(parsed.wait);
        assert_eq!(parsed.file, Some(PathBuf::from("note.md")));
    }

    #[test]
    fn nothing_at_all_opens_nothing() {
        let parsed = parse(args(&[]));
        assert_eq!(parsed.file, None);
        assert!(!parsed.wait);
    }

    #[test]
    fn a_second_path_is_ignored_rather_than_opened() {
        // One window, one handover. Opening several files from one invocation
        // would make `--wait` ambiguous about which tab it is waiting for.
        let parsed = parse(args(&["one.md", "two.md"]));
        assert_eq!(parsed.file, Some(PathBuf::from("one.md")));
    }

    #[test]
    fn a_sentinel_is_created_and_released() {
        let document = Path::new("/vault/note.md");
        let sentinel = Sentinel::create(document).expect("create");
        assert!(sentinel.path.exists());

        assert_eq!(release(document).expect("release"), 1);
        assert!(!sentinel.path.exists());
    }

    #[test]
    fn releasing_something_already_gone_is_fine() {
        // The waiting process removes its own sentinel on the way out, and a
        // tab may close twice. Neither is a failure — it is simply nobody left
        // to let go.
        let document = Path::new("/vault/twice.md");
        let _sentinel = Sentinel::create(document).expect("create");
        assert_eq!(release(document).expect("first"), 1);
        assert_eq!(release(document).expect("second"), 0);
    }

    #[test]
    fn the_window_can_tell_that_somebody_is_waiting() {
        // How the window learns it has a promise to keep: the process that made
        // it spawned a scheda without the flag, so the command line says
        // nothing. The sentinel is the only evidence.
        let document = Path::new("/vault/asked.md");
        assert!(!is_awaited(document), "nobody is waiting yet");

        let _sentinel = Sentinel::create(document).expect("create");
        assert!(is_awaited(document));

        release(document).expect("release");
        assert!(!is_awaited(document), "and nobody is waiting after");
    }

    #[test]
    fn releasing_one_document_leaves_another_waiting() {
        // The prefix is what keeps two waits apart. Without it, closing any tab
        // would return every caller blocked on any file.
        let mine = Path::new("/vault/mine.md");
        let theirs = Path::new("/vault/theirs.md");
        let ours = Sentinel::create(mine).expect("create");
        let others = Sentinel::create(theirs).expect("create");

        release(mine).expect("release");
        assert!(!ours.path.exists());
        assert!(others.path.exists(), "the other waiter is still waiting");
    }

    #[test]
    fn two_waiters_on_one_file_are_both_released() {
        // They were both waiting for this file to be edited, and it has been.
        let document = Path::new("/vault/shared.md");
        let first = Sentinel::create(document).expect("create");
        let second = Sentinel::create(document).expect("create");
        assert_ne!(first.path, second.path, "two waiters are two files");

        assert_eq!(release(document).expect("release"), 2);
        assert!(!first.path.exists());
        assert!(!second.path.exists());
    }

    #[test]
    fn the_same_file_spelled_differently_is_the_same_wait() {
        // The caller passes what was typed; the window compares against what
        // the filesystem returned. On Windows those differ in case and in
        // separator, and a wait that did not survive that would simply never
        // end.
        let typed = Path::new("C:/Vault/Note.md");
        let returned = Path::new(r"c:\vault\note.md");
        let sentinel = Sentinel::create(typed).expect("create");

        assert_eq!(release(returned).expect("release"), 1);
        assert!(!sentinel.path.exists());
    }

    #[test]
    fn a_dropped_sentinel_takes_its_file_with_it() {
        // A sentinel outliving its process is a file the window deletes on
        // behalf of nobody.
        let path = {
            let sentinel = Sentinel::create(Path::new("/vault/dropped.md")).expect("create");
            sentinel.path.clone()
        };
        assert!(!path.exists());
    }

    #[test]
    fn blocking_returns_once_the_sentinel_is_released() {
        let document = PathBuf::from("/vault/blocking.md");
        let sentinel = Sentinel::create(&document).expect("create");
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            release(&document).expect("release");
        });
        assert!(sentinel.block(), "the wait ended because the tab closed");
    }
}

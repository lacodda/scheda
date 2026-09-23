//! The vault's index: what every note is called, what it links to, which tags
//! and fields it carries, what its bytes hash to — and which notes went away.
//!
//! Kept on disk in scheda's own directory, keyed by the root, never in the vault
//! (ADR 0003). The format is ADR 0011 and carries its version from the first
//! file ever written.
//!
//! ## Why an index now, when v0.8 and v0.9 refused one
//!
//! The network and the tags panels read every note on every open, and on a
//! vault of six thousand notes that is ~590 ms, nearly all of it the disk —
//! the parsing is 50. The refusal was about a *second truth*: an index that is
//! wrong every time Obsidian writes a note while this window is closed. The
//! answer here is that the index is never trusted on its own word. When a vault
//! is opened it is **reconciled** against the disk — every note's size and
//! modification time are compared, and only a note whose stamp moved is read
//! again — and while the window is open the watcher feeds it. What is stored
//! is a cache of the reading, not a replacement for it: the same `links::scan`,
//! `tags::scan` and front-matter reader produce it, and deleting the file costs
//! one full reading and nothing else.
//!
//! ## Built behind the text
//!
//! Nothing here runs before the first frame. The index is opened when the
//! window points the watcher at a vault, which it does after the text is on
//! screen (ADR 0001), and it is built on a thread of its own. A question that
//! needs it — the tags, the backlinks, a search — waits for it; opening a file
//! never does.
//!
//! ## Tombstones
//!
//! A note that disappears leaves its path, its last hash and the moment it was
//! found gone. Without that, "this note was deleted" and "this note was never
//! here" are the same answer, and they are not the same answer to a sync
//! transport comparing two machines, or to a person asking where a note went.
//! A tombstone is dropped when a note appears at the same path again, and after
//! [`TOMBSTONE_DAYS`] days.

use crate::document;
use crate::frontmatter;
use crate::links;
use crate::network::relative_to;
use crate::notes;
use crate::tags;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The version of the stored format. Written into every file; a file carrying
/// another number is not read but rebuilt. Frozen at 1.0, after which a change
/// is a migration rather than a rebuild.
pub const FORMAT: u32 = 1;

/// How long a tombstone is kept.
///
/// Long enough to outlive a holiday away from one machine, which is the case a
/// sync transport has to answer "deleted or never here" for; short enough that a
/// vault reorganised every week does not carry the ghost of every old layout.
pub const TOMBSTONE_DAYS: u64 = 90;

/// How long a question waits for the index before answering without it.
///
/// A building index answers in about a second on a vault of thousands whose
/// files the system has cached — and in more than a minute on the same vault
/// read for the first time after a restart, with an antivirus opening every
/// file behind it (measured: 78 s for 5347 notes). The ceiling is above that,
/// and is for the index that never arrives — a folder on a network drive that
/// stopped answering — so a panel says "nothing" rather than spinning forever.
const WAIT: Duration = Duration::from_secs(300);

/// How much of a line is kept as the context of a link or a tag.
const CONTEXT_CHARS: usize = 200;

/// One note, as the index remembers it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    /// The size and modification time the reading was made from. A note whose
    /// stamp matches is not read again.
    pub size: u64,
    pub modified: u64,
    /// SHA-256 of the file's bytes, lowercase hex.
    pub hash: String,
    /// False when the bytes are not UTF-8. Such a note is listed and hashed but
    /// holds nothing else: it is read-only in scheda (ADR 0002), and guessing
    /// at its text would put words in the index the note does not contain.
    pub readable: bool,
    pub headings: Vec<String>,
    pub links: Vec<LinkAt>,
    pub tags: Vec<TagAt>,
    /// The front matter's top-level fields (`frontmatter::fields`).
    pub fields: BTreeMap<String, Vec<String>>,
}

/// A wikilink in a note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkAt {
    /// The target as written, without heading or alias. Empty for `[[#heading]]`.
    pub target: String,
    /// The 1-based line.
    pub line: usize,
    /// That line, trimmed and cut.
    pub context: String,
}

/// A tag in a note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAt {
    pub name: String,
    /// The 1-based line, or none for a tag from the front matter.
    pub line: Option<usize>,
    pub context: String,
}

/// A note that was there and is not any more.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    /// The hash of the last bytes the index saw.
    pub hash: String,
    /// When it was found gone, in milliseconds since the epoch.
    pub removed: u64,
}

/// The whole index of one vault — what is stored, and what is asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub format: u32,
    /// The root it indexes, so a file found under the wrong key is refused.
    pub root: String,
    /// Keyed by the path from the root, with forward slashes, case as written.
    pub notes: BTreeMap<String, Note>,
    pub tombstones: BTreeMap<String, Tombstone>,
}

impl Snapshot {
    pub fn empty(root: &Path) -> Self {
        Self {
            format: FORMAT,
            root: root.to_string_lossy().into_owned(),
            notes: BTreeMap::new(),
            tombstones: BTreeMap::new(),
        }
    }
}

/// Reads one note's bytes into what the index keeps about it.
pub fn read_note(bytes: &[u8], size: u64, modified: u64) -> Note {
    let hash = hex(&Sha256::digest(bytes));
    let Ok(document) = document::decode(bytes) else {
        return Note {
            size,
            modified,
            hash,
            readable: false,
            headings: Vec::new(),
            links: Vec::new(),
            tags: Vec::new(),
            fields: BTreeMap::new(),
        };
    };
    let text = &document.text;
    let lines: Vec<&str> = text.lines().collect();
    let context_of = |line: usize| cut(lines.get(line.saturating_sub(1)).copied().unwrap_or(""));

    Note {
        size,
        modified,
        hash,
        readable: true,
        headings: notes::headings_in(text),
        links: links::scan(text)
            .into_iter()
            .map(|found| LinkAt {
                context: context_of(found.line),
                target: found.target,
                line: found.line,
            })
            .collect(),
        tags: tags::scan(text)
            .into_iter()
            .map(|(name, line, context)| TagAt {
                name,
                line,
                context: cut(&context),
            })
            .collect(),
        fields: frontmatter::fields(text),
    }
}

/// A line trimmed and cut to what a panel row shows. Cut by characters, not
/// bytes: a note in Cyrillic would otherwise be cut to half the length, and
/// through the middle of a character at that.
pub fn cut(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= CONTEXT_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(CONTEXT_CHARS).collect();
    out.push('…');
    out
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// The path of a note from its key.
///
/// Built component by component: joining `folder/note.md` as one piece on
/// Windows would give `C:\vault\folder/note.md`, a spelling of the path that
/// compares unequal as text to the one the tree hands out.
pub fn absolute(root: &Path, relative: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for part in relative.split('/').filter(|part| !part.is_empty()) {
        out.push(part);
    }
    out
}

/// A file's size and modification time, the stamp a reading is kept against.
fn stamp(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    // Nanoseconds, not seconds: a note saved twice in one second by a sync
    // client and then by a person must not look unchanged the second time.
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since| u64::try_from(since.as_nanos()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    Some((meta.len(), modified))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Brings one note's entry up to date with the disk. True when anything
/// changed.
fn refresh_note(snapshot: &mut Snapshot, root: &Path, key: &str, now: u64) -> bool {
    let path = absolute(root, key);
    let Some((size, modified)) = stamp(&path) else {
        return bury(snapshot, key, now);
    };
    if let Some(known) = snapshot.notes.get(key)
        && known.size == size
        && known.modified == modified
    {
        return false;
    }
    let Ok(bytes) = std::fs::read(&path) else {
        // Present but unreadable right now — a sync client holding it open.
        // What the index knew stays; the next change will bring it back here.
        return false;
    };
    let note = read_note(&bytes, size, modified);
    snapshot.tombstones.remove(key);
    let changed = snapshot.notes.get(key) != Some(&note);
    snapshot.notes.insert(key.to_string(), note);
    changed
}

/// Moves a note to the tombstones. True when there was a note to move.
fn bury(snapshot: &mut Snapshot, key: &str, now: u64) -> bool {
    let Some(note) = snapshot.notes.remove(key) else {
        return false;
    };
    snapshot.tombstones.insert(
        key.to_string(),
        Tombstone {
            hash: note.hash,
            removed: now,
        },
    );
    true
}

/// Whether a path is a note the index keeps.
fn is_note(path: &Path) -> bool {
    crate::network::is_markdown(path)
}

/// Every note under `folder`, by the tree's own walk and its own exclusions.
fn notes_under(folder: &Path) -> Vec<PathBuf> {
    fn collect(entries: &[crate::tree::Entry], out: &mut Vec<PathBuf>) {
        for entry in entries {
            match &entry.children {
                Some(children) => collect(children, out),
                None => {
                    let path = PathBuf::from(&entry.path);
                    if is_note(&path) {
                        out.push(path);
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    collect(&crate::tree::read(folder), &mut out);
    out
}

/// Makes the snapshot agree with the disk under `root`: every note on disk is
/// present and current, every note in the snapshot that is gone is buried.
///
/// The cost is a directory walk and a `stat` per note; only a note whose stamp
/// moved is read. True when anything changed.
pub fn reconcile(snapshot: &mut Snapshot, root: &Path, now: u64) -> bool {
    let on_disk: Vec<String> = notes_under(root)
        .iter()
        .map(|path| relative_to(root, path))
        .collect();
    let mut changed = false;

    let present: std::collections::BTreeSet<&str> = on_disk.iter().map(String::as_str).collect();
    let gone: Vec<String> = snapshot
        .notes
        .keys()
        .filter(|key| !present.contains(key.as_str()))
        .cloned()
        .collect();
    for key in gone {
        changed |= bury(snapshot, &key, now);
    }
    // The stamps first, cheaply and in order; then the notes whose stamp moved
    // are read across the machine's cores. Reading is the whole cost of a first
    // build — six thousand files is seconds on one thread and a fraction of that
    // spread — and every note is read on its own, so nothing is shared but the
    // list.
    let stale: Vec<(&String, u64, u64)> = on_disk
        .iter()
        .filter_map(|key| {
            let (size, modified) = stamp(&absolute(root, key))?;
            let known = snapshot.notes.get(key);
            let current = known.is_some_and(|note| note.size == size && note.modified == modified);
            (!current).then_some((key, size, modified))
        })
        .collect();
    for (key, note) in read_in_parallel(root, &stale) {
        snapshot.tombstones.remove(key.as_str());
        if snapshot.notes.get(key.as_str()) != Some(&note) {
            snapshot.notes.insert(key.clone(), note);
            changed = true;
        }
    }
    changed |= prune(snapshot, now);
    changed
}

/// Reads and indexes the given notes on several threads. A note that cannot
/// be read right now is left out, and keeps whatever the index knew of it.
fn read_in_parallel(root: &Path, stale: &[(&String, u64, u64)]) -> Vec<(String, Note)> {
    let workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .clamp(1, 8);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    stale
                        .iter()
                        .skip(worker)
                        .step_by(workers)
                        .filter_map(|(key, size, modified)| {
                            let bytes = std::fs::read(absolute(root, key)).ok()?;
                            Some(((*key).clone(), read_note(&bytes, *size, *modified)))
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    })
}

/// Brings the entries for a set of changed paths up to date — files, folders,
/// or paths that are no longer there. True when anything changed.
///
/// What the watcher reports is a path, not a kind: a removed path may have been
/// a note or a folder full of them, and by the time it is reported there is
/// nothing on disk left to ask. So a gone path buries the note of that name and
/// every note under it as a folder.
pub fn refresh(snapshot: &mut Snapshot, root: &Path, paths: &[PathBuf], now: u64) -> bool {
    let mut changed = false;
    for path in paths {
        // Asked of the part below the root: a vault that itself lives inside a
        // folder called `node_modules` is still a vault.
        let Ok(inside) = path.strip_prefix(root) else {
            continue;
        };
        if crate::watch::is_ignored(inside) {
            continue;
        }
        let key = relative_to(root, path);
        if path.is_dir() {
            for note in notes_under(path) {
                changed |= refresh_note(snapshot, root, &relative_to(root, &note), now);
            }
            // A folder that came back under a name may have lost notes while
            // it was away; anything indexed under it that is not on disk goes.
            let prefix = format!("{key}/");
            let under: Vec<String> = snapshot
                .notes
                .keys()
                .filter(|known| known.starts_with(&prefix))
                .filter(|known| !absolute(root, known).is_file())
                .cloned()
                .collect();
            for gone in under {
                changed |= bury(snapshot, &gone, now);
            }
        } else if path.is_file() {
            if is_note(path) {
                changed |= refresh_note(snapshot, root, &key, now);
            }
        } else {
            changed |= bury(snapshot, &key, now);
            let prefix = format!("{key}/");
            let under: Vec<String> = snapshot
                .notes
                .keys()
                .filter(|known| known.starts_with(&prefix))
                .cloned()
                .collect();
            for gone in under {
                changed |= bury(snapshot, &gone, now);
            }
        }
    }
    changed
}

/// Drops tombstones older than [`TOMBSTONE_DAYS`].
fn prune(snapshot: &mut Snapshot, now: u64) -> bool {
    let horizon = now.saturating_sub(TOMBSTONE_DAYS * 24 * 60 * 60 * 1000);
    let before = snapshot.tombstones.len();
    snapshot
        .tombstones
        .retain(|_, grave| grave.removed >= horizon);
    snapshot.tombstones.len() != before
}

/// The file an index of `root` is stored in.
///
/// Named by a hash of the root rather than by the root itself: a path is not a
/// file name on every platform, and two vaults whose names differ only by a
/// character the filesystem refuses would otherwise share one file. On Windows
/// the root is lowercased first, because `C:\Notes` and `c:\notes` are one
/// folder there.
pub fn file_for(dir: &Path, root: &Path) -> PathBuf {
    let spelled = root.to_string_lossy();
    #[cfg(windows)]
    let spelled = spelled.to_lowercase();
    let digest = hex(&Sha256::digest(spelled.as_bytes()));
    dir.join(format!("{}.json", &digest[..16]))
}

/// Reads a stored index, or `None` when there is none to trust.
///
/// A file of another format, of another root, or one that does not parse is
/// not an error to show anybody: the index is a cache of a reading, and the
/// answer to a cache that cannot be used is to read again.
pub fn load(dir: &Path, root: &Path) -> Option<Snapshot> {
    let bytes = std::fs::read(file_for(dir, root)).ok()?;
    let snapshot: Snapshot = serde_json::from_slice(&bytes).ok()?;
    (snapshot.format == FORMAT && Path::new(&snapshot.root) == root).then_some(snapshot)
}

/// Writes an index through a temporary file and a rename, so a crash leaves
/// either the old file or the new one and never half of one.
pub fn save(dir: &Path, snapshot: &Snapshot) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let target = file_for(dir, Path::new(&snapshot.root));
    let temporary = target.with_extension("json.tmp");
    let bytes = serde_json::to_vec(snapshot).map_err(std::io::Error::other)?;
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, &target)
}

/// Where indexes live: `%LOCALAPPDATA%\scheda\index` on Windows, the XDG data
/// directory elsewhere. Local rather than roaming: an index is a reading of
/// one machine's disk, and carrying it to another would carry stamps that mean
/// nothing there.
pub fn directory() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join("scheda").join("index"))
}

/// The index the window is holding: one vault at a time, built behind the text
/// and fed by the watcher.
#[derive(Clone)]
pub struct NoteIndex {
    shared: Arc<Shared>,
    /// Where snapshots are stored; `None` keeps the index in memory only,
    /// which is what a machine without a data directory gets.
    dir: Option<PathBuf>,
}

struct Shared {
    state: Mutex<State>,
    built: Condvar,
}

#[derive(Default)]
struct State {
    root: Option<PathBuf>,
    /// Present once the build for `root` has finished.
    snapshot: Option<Snapshot>,
    /// Bumped by every `open`, so a build that finishes after the window moved
    /// on to another vault throws its result away instead of installing it.
    generation: u64,
    /// Paths the watcher reported while the build was running. Applied when it
    /// finishes: the build's walk may have passed them before they changed.
    pending: Vec<PathBuf>,
}

impl NoteIndex {
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State::default()),
                built: Condvar::new(),
            }),
            dir,
        }
    }

    /// Starts indexing `root`, unless it is already the vault being indexed.
    ///
    /// Returns at once; the build runs on its own thread.
    pub fn open(&self, root: &Path) {
        let generation = {
            let mut state = self.shared.state.lock().expect("index lock");
            if state.root.as_deref() == Some(root) {
                return;
            }
            state.root = Some(root.to_path_buf());
            state.snapshot = None;
            state.pending.clear();
            state.generation += 1;
            state.generation
        };

        let this = self.clone();
        let root = root.to_path_buf();
        std::thread::spawn(move || this.build(&root, generation));
    }

    fn build(&self, root: &Path, generation: u64) {
        let started = std::time::Instant::now();
        let mut snapshot = self
            .dir
            .as_deref()
            .and_then(|dir| load(dir, root))
            .unwrap_or_else(|| Snapshot::empty(root));
        let changed = reconcile(&mut snapshot, root, now_ms());
        crate::startup::log("index built", started.elapsed().as_secs_f64() * 1000.0);

        let mut state = self.shared.state.lock().expect("index lock");
        if state.generation != generation {
            return;
        }
        let pending = std::mem::take(&mut state.pending);
        let changed = refresh(&mut snapshot, root, &pending, now_ms()) || changed;
        if changed {
            self.store(&snapshot);
        }
        state.snapshot = Some(snapshot);
        self.shared.built.notify_all();
    }

    fn store(&self, snapshot: &Snapshot) {
        if let Some(dir) = &self.dir {
            // A snapshot that cannot be written is a slower next start, not a
            // failure anybody can act on: the index in memory is still right.
            let _ = save(dir, snapshot);
        }
    }

    /// Tells the index that these paths changed on disk.
    pub fn changed(&self, paths: &[PathBuf]) {
        let mut state = self.shared.state.lock().expect("index lock");
        let Some(root) = state.root.clone() else {
            return;
        };
        let Some(snapshot) = state.snapshot.as_mut() else {
            state.pending.extend(paths.iter().cloned());
            return;
        };
        if refresh(snapshot, &root, paths, now_ms()) {
            let snapshot = snapshot.clone();
            drop(state);
            self.store(&snapshot);
        }
    }

    /// Runs `job` against the index of `root`, opening it if it is not the one
    /// being held and waiting for the build if it is not finished.
    ///
    /// `None` only when the build did not finish within [`WAIT`].
    pub fn with<T>(&self, root: &Path, job: impl FnOnce(&Snapshot) -> T) -> Option<T> {
        self.open(root);
        let state = self.shared.state.lock().expect("index lock");
        let (state, _) = self
            .shared
            .built
            .wait_timeout_while(state, WAIT, |state| {
                state.root.as_deref() == Some(root) && state.snapshot.is_none()
            })
            .expect("index lock");
        if state.root.as_deref() != Some(root) {
            return None;
        }
        state.snapshot.as_ref().map(job)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, text: &str) -> PathBuf {
        let path = absolute(root, relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn a_note_is_read_into_links_tags_headings_and_fields() {
        let note = read_note(
            b"---\nstatus: draft\ntags: [a]\n---\n# Plan\nsee [[other]] and #b\n",
            0,
            0,
        );
        assert!(note.readable);
        assert_eq!(note.headings, vec!["Plan"]);
        assert_eq!(note.links.len(), 1);
        assert_eq!(note.links[0].target, "other");
        assert_eq!(note.links[0].line, 6);
        assert_eq!(note.links[0].context, "see [[other]] and #b");
        let names: Vec<&str> = note.tags.iter().map(|tag| tag.name.as_str()).collect();
        assert_eq!(names, vec!["a", "b"]);
        assert_eq!(note.fields.get("status"), Some(&vec!["draft".to_string()]));
    }

    #[test]
    fn the_hash_is_sha256_of_the_bytes() {
        let note = read_note(b"abc", 3, 0);
        assert_eq!(
            note.hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_note_that_is_not_utf8_is_hashed_but_not_read() {
        let note = read_note(b"\x80 [[link]]", 0, 0);
        assert!(!note.readable);
        assert!(note.links.is_empty());
        assert!(!note.hash.is_empty());
    }

    #[test]
    fn reconciling_finds_new_changed_and_gone_notes() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        write(root, "a.md", "[[b]]\n");
        write(root, "folder/b.md", "#tag\n");
        write(root, "picture.png", "not a note");
        let mut snapshot = Snapshot::empty(root);

        assert!(reconcile(&mut snapshot, root, 1));
        assert_eq!(
            snapshot.notes.keys().collect::<Vec<_>>(),
            vec!["a.md", "folder/b.md"]
        );

        // Nothing moved: nothing is read, nothing changes.
        assert!(!reconcile(&mut snapshot, root, 2));

        std::fs::remove_file(absolute(root, "a.md")).unwrap();
        write(root, "folder/b.md", "#other and more\n");
        assert!(reconcile(&mut snapshot, root, 3));
        assert_eq!(
            snapshot.notes.keys().collect::<Vec<_>>(),
            vec!["folder/b.md"]
        );
        assert_eq!(snapshot.notes["folder/b.md"].tags[0].name, "other");
        assert_eq!(snapshot.tombstones["a.md"].removed, 3);
    }

    #[test]
    fn a_note_written_while_the_window_was_closed_is_read_again() {
        // The case the earlier refusal of an index was about: the stored index
        // says one thing, Obsidian wrote another. Reconciling on open is what
        // makes the stored copy a cache rather than a second truth.
        let vault = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        let root = vault.path();
        write(root, "a.md", "#before\n");

        let mut snapshot = Snapshot::empty(root);
        reconcile(&mut snapshot, root, 1);
        save(store.path(), &snapshot).unwrap();

        // Different length, so the stamp moves even on a coarse clock.
        write(root, "a.md", "#after and then some\n");

        let mut loaded = load(store.path(), root).expect("stored index loads");
        assert_eq!(loaded.notes["a.md"].tags[0].name, "before");
        reconcile(&mut loaded, root, 2);
        assert_eq!(loaded.notes["a.md"].tags[0].name, "after");
    }

    #[test]
    fn a_tombstone_is_lifted_when_the_note_comes_back() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        let path = write(root, "a.md", "one\n");
        let mut snapshot = Snapshot::empty(root);
        reconcile(&mut snapshot, root, 1);

        std::fs::remove_file(&path).unwrap();
        refresh(&mut snapshot, root, std::slice::from_ref(&path), 2);
        assert!(snapshot.tombstones.contains_key("a.md"));

        write(root, "a.md", "two\n");
        refresh(&mut snapshot, root, std::slice::from_ref(&path), 3);
        assert!(snapshot.notes.contains_key("a.md"));
        assert!(!snapshot.tombstones.contains_key("a.md"));
    }

    #[test]
    fn a_removed_folder_buries_every_note_in_it() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        write(root, "keep.md", "k\n");
        write(root, "gone/one.md", "1\n");
        write(root, "gone/deeper/two.md", "2\n");
        let mut snapshot = Snapshot::empty(root);
        reconcile(&mut snapshot, root, 1);

        let folder = absolute(root, "gone");
        std::fs::remove_dir_all(&folder).unwrap();
        assert!(refresh(&mut snapshot, root, &[folder], 2));
        assert_eq!(snapshot.notes.keys().collect::<Vec<_>>(), vec!["keep.md"]);
        assert!(snapshot.tombstones.contains_key("gone/one.md"));
        assert!(snapshot.tombstones.contains_key("gone/deeper/two.md"));
    }

    #[test]
    fn an_added_folder_indexes_what_is_in_it() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        let mut snapshot = Snapshot::empty(root);
        reconcile(&mut snapshot, root, 1);

        write(root, "arrived/one.md", "#new\n");
        assert!(refresh(
            &mut snapshot,
            root,
            &[absolute(root, "arrived")],
            2
        ));
        assert!(snapshot.notes.contains_key("arrived/one.md"));
    }

    #[test]
    fn the_vaults_own_state_is_not_indexed() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        write(root, ".obsidian/notes.md", "#not-a-note\n");
        let mut snapshot = Snapshot::empty(root);
        reconcile(&mut snapshot, root, 1);
        assert!(snapshot.notes.is_empty());
        let reported = absolute(root, ".obsidian/notes.md");
        assert!(!refresh(&mut snapshot, root, &[reported], 2));
    }

    #[test]
    fn old_tombstones_are_dropped() {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        let mut snapshot = Snapshot::empty(root);
        let day = 24 * 60 * 60 * 1000;
        snapshot.tombstones.insert(
            "old.md".into(),
            Tombstone {
                hash: "x".into(),
                removed: 0,
            },
        );
        snapshot.tombstones.insert(
            "recent.md".into(),
            Tombstone {
                hash: "y".into(),
                removed: 80 * day,
            },
        );
        reconcile(&mut snapshot, root, (TOMBSTONE_DAYS + 1) * day);
        assert!(!snapshot.tombstones.contains_key("old.md"));
        assert!(snapshot.tombstones.contains_key("recent.md"));
    }

    #[test]
    fn a_stored_index_of_another_format_or_root_is_not_trusted() {
        let vault = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        let root = vault.path();

        let mut snapshot = Snapshot::empty(root);
        snapshot.format = FORMAT + 1;
        save(store.path(), &snapshot).unwrap();
        assert!(load(store.path(), root).is_none());

        // Written under this root's key, but claiming another root.
        let mut stranger = Snapshot::empty(root);
        stranger.root = "/somewhere/else".into();
        let bytes = serde_json::to_vec(&stranger).unwrap();
        std::fs::write(file_for(store.path(), root), bytes).unwrap();
        assert!(load(store.path(), root).is_none());
    }

    #[test]
    fn the_format_version_is_written_into_the_file() {
        let vault = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        save(store.path(), &Snapshot::empty(vault.path())).unwrap();
        let text = std::fs::read_to_string(file_for(store.path(), vault.path())).unwrap();
        assert!(text.contains(&format!("\"format\":{FORMAT}")));
    }

    #[test]
    fn the_index_waits_for_its_build_and_follows_changes() {
        let vault = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        let root = vault.path().to_path_buf();
        write(&root, "a.md", "#one\n");

        let index = NoteIndex::new(Some(store.path().to_path_buf()));
        let count = index.with(&root, |snapshot| snapshot.notes.len());
        assert_eq!(count, Some(1));
        // Built and stored.
        assert!(file_for(store.path(), &root).is_file());

        let added = write(&root, "b.md", "#two\n");
        index.changed(&[added]);
        let count = index.with(&root, |snapshot| snapshot.notes.len());
        assert_eq!(count, Some(2));
    }

    #[test]
    fn a_path_joined_from_a_key_is_spelled_like_a_walked_one() {
        let root = Path::new("vault");
        assert_eq!(
            absolute(root, "folder/note.md"),
            root.join("folder").join("note.md")
        );
    }
}

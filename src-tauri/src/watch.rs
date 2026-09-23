//! Watching the folder the window is looking at, so the tree and the open tabs
//! do not go stale the moment Obsidian or a sync client touches a file.
//!
//! One root at a time. The window shows one vault, and watching every root a
//! tab has ever belonged to would mean a handle per root and a stream of events
//! about files nobody can see. Switching to a tab in another vault swaps the
//! watch, which is one call and no bookkeeping.
//!
//! **Debounced, not raw.** Saving a file from another editor produces several
//! platform events — a create, a write, a rename of a temporary over the
//! original — and a window that reacted to each would re-read the tree three
//! times and ask "reload?" twice about one save. The debouncer collapses a
//! burst into what it was: one file changed.
//!
//! **What crosses the boundary is paths, not decisions.** The core says "these
//! files changed, these appeared, these are gone"; whether that means re-reading
//! a tab, redrawing a branch or asking the user is the window's business, and
//! the window is the only side that knows which tabs are dirty.

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// How long a burst of events is allowed to settle before the window hears
/// about it.
///
/// Long enough that one save from another editor arrives as one change rather
/// than three, short enough that a note edited in Obsidian is up to date in
/// scheda before you have finished switching windows. A sync client writing
/// forty files lands as one batch, which is the case the tree cares about.
const SETTLE: Duration = Duration::from_millis(300);

/// Directories whose contents are nobody's business, matched anywhere in the
/// path rather than only at the root.
///
/// The same list the tree hides, for the same reason plus a sharper one: `.git`
/// alone produces hundreds of events during an ordinary commit, and `.obsidian`
/// rewrites `workspace.json` every time a pane moves over there. A window that
/// redrew its tree for those would flicker for reasons nobody could see.
const IGNORED: &[&str] = &[
    ".obsidian",
    ".git",
    ".trash",
    "node_modules",
    ".vscode",
    ".idea",
];

/// What changed under the watched root, after a burst has settled.
///
/// Three lists rather than a stream of tagged events: the window asks a
/// different question of each — "does a tab show this?" of the changed, "has a
/// tab lost its file?" of the removed — and a tagged stream would be regrouped
/// on arrival anyway. Paths are absolute, the way everything else that crosses
/// the boundary is.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    /// Files whose contents were written by somebody else.
    pub changed: Vec<String>,
    /// Files and folders that appeared.
    pub added: Vec<String>,
    /// Files and folders that are no longer there.
    pub removed: Vec<String>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.added.is_empty() && self.removed.is_empty()
    }
}

/// The event the window listens for.
pub const CHANGED_EVENT: &str = "scheda://vault-changed";

/// The watch the window is holding, and what it is pointed at.
///
/// The debouncer stops when it is dropped, so replacing the value here is how a
/// watch moves to another root: there is no second call that could be forgotten
/// and leave two watchers running over the same folder.
#[derive(Default)]
pub struct Watch(Mutex<Option<Active>>);

struct Active {
    root: PathBuf,
    /// Held so the watcher thread stays alive, and dropped so it stops. Never
    /// read, which is the whole contract — hence the allow rather than an
    /// underscore that would hide what the field is for.
    #[allow(dead_code)]
    debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl Watch {
    /// Points the watch at `root`, replacing whatever it was watching.
    ///
    /// A root already being watched is left alone rather than torn down and
    /// rebuilt identically: switching between two tabs of the same vault is the
    /// common case, and it should cost nothing.
    pub fn point_at<F>(&self, root: &Path, on_change: F) -> notify::Result<()>
    where
        F: Fn(Changes) + Send + 'static,
    {
        let mut held = self.0.lock().expect("watch lock");
        if held.as_ref().is_some_and(|active| active.root == root) {
            return Ok(());
        }
        // Dropped before the new one is built: two watchers over overlapping
        // folders would each report the same write.
        *held = None;

        let mut debouncer = new_debouncer(SETTLE, None, move |result: DebounceEventResult| {
            // A watcher error is not a reason to tell the window a file
            // changed. The window keeps what it has, which is right: the
            // alternative is a spurious "reload?" caused by a full event queue.
            let Ok(events) = result else { return };
            let changes = classify(events.iter().map(|event| &event.event));
            if !changes.is_empty() {
                on_change(changes);
            }
        })?;
        debouncer.watch(root, RecursiveMode::Recursive)?;

        *held = Some(Active {
            root: root.to_path_buf(),
            debouncer,
        });
        Ok(())
    }

    /// Stops watching anything.
    pub fn stop(&self) {
        *self.0.lock().expect("watch lock") = None;
    }

    /// The root currently being watched.
    pub fn root(&self) -> Option<PathBuf> {
        self.0
            .lock()
            .expect("watch lock")
            .as_ref()
            .map(|active| active.root.clone())
    }
}

/// Sorts a settled burst of events into the three questions the window asks.
///
/// Deduplicated through sets: a burst about one file carries several events,
/// and a list naming the same note four times would have the window re-reading
/// it four times.
fn classify<'a>(events: impl Iterator<Item = &'a notify::Event>) -> Changes {
    use notify::EventKind;
    use notify::event::{ModifyKind, RenameMode};

    let mut changed = BTreeSet::new();
    let mut added = BTreeSet::new();
    let mut removed = BTreeSet::new();

    for event in events {
        let paths: Vec<&PathBuf> = event
            .paths
            .iter()
            .filter(|path| !is_ignored(path))
            .collect();
        if paths.is_empty() {
            continue;
        }

        match event.kind {
            EventKind::Create(_) => {
                for path in paths {
                    added.insert(path.clone());
                }
            }
            EventKind::Remove(_) => {
                for path in paths {
                    removed.insert(path.clone());
                }
            }
            // A rename carries both ends: the old name is gone and the new one
            // is here. Reported as such rather than as a change, because a tab
            // showing the old path has lost its file, not gained new text.
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if paths.len() == 2 => {
                removed.insert(paths[0].clone());
                added.insert(paths[1].clone());
            }
            // A one-sided rename is all some platforms give. Which side it is
            // depends on whether the path is still there, and the disk is the
            // only thing that knows.
            EventKind::Modify(ModifyKind::Name(_)) => {
                for path in paths {
                    if path.exists() {
                        added.insert(path.clone());
                    } else {
                        removed.insert(path.clone());
                    }
                }
            }
            EventKind::Modify(_) => {
                for path in paths {
                    changed.insert(path.clone());
                }
            }
            // `Any` is what a platform sends when it will not say more, and
            // `Access` carries the close-after-write that some editors are only
            // visible through. Both mean "look again", which is what the window
            // does with a change anyway.
            EventKind::Any | EventKind::Access(_) | EventKind::Other => {
                for path in paths {
                    if path.exists() {
                        changed.insert(path.clone());
                    } else {
                        removed.insert(path.clone());
                    }
                }
            }
        }
    }

    // A path on both lists is one of two things: a temporary an editor wrote
    // and renamed away, which was never there as far as anyone looking at the
    // window is concerned; or a save performed as remove-then-create, which is
    // a change rather than a pair of facts about what the vault contains. The
    // disk tells them apart.
    let churned: Vec<PathBuf> = added.intersection(&removed).cloned().collect();
    for path in churned {
        added.remove(&path);
        removed.remove(&path);
        if path.exists() {
            changed.insert(path);
        }
    }
    // Nothing is both changed and gone; the disk has the last word.
    for path in &removed {
        changed.remove(path);
    }

    Changes {
        changed: strings(changed),
        added: strings(added),
        removed: strings(removed),
    }
}

fn strings(paths: BTreeSet<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Whether any component of the path names a folder we do not report on.
pub fn is_ignored(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| IGNORED.contains(&name))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode};
    use notify::{Event, EventKind};

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        Event {
            kind,
            paths: paths.iter().map(PathBuf::from).collect(),
            attrs: Default::default(),
        }
    }

    /// A path under the temp directory that is guaranteed not to exist, for the
    /// cases whose answer depends on asking the disk.
    fn absent(name: &str) -> String {
        std::env::temp_dir()
            .join(format!("scheda-absent-{}-{name}", std::process::id()))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn a_write_is_a_change() {
        let events = [event(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &["/vault/note.md"],
        )];
        let changes = classify(events.iter());
        assert_eq!(changes.changed, ["/vault/note.md"]);
        assert!(changes.added.is_empty());
        assert!(changes.removed.is_empty());
    }

    #[test]
    fn one_file_written_four_times_is_reported_once() {
        // Why the burst goes through a set rather than a list: a save from
        // another editor arrives as several writes, and a window told four
        // times would re-read the file four times and ask four questions.
        let events: Vec<Event> = (0..4)
            .map(|_| {
                event(
                    EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                    &["/vault/note.md"],
                )
            })
            .collect();
        assert_eq!(classify(events.iter()).changed, ["/vault/note.md"]);
    }

    #[test]
    fn a_two_sided_rename_is_a_removal_and_an_arrival() {
        // Not a change: a tab showing the old path has lost its file rather
        // than gained new text, and those are different questions.
        let events = [event(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["/vault/old.md", "/vault/new.md"],
        )];
        let changes = classify(events.iter());
        assert_eq!(changes.removed, ["/vault/old.md"]);
        assert_eq!(changes.added, ["/vault/new.md"]);
        assert!(changes.changed.is_empty());
    }

    #[test]
    fn a_creation_is_an_arrival_and_a_deletion_is_a_removal() {
        let events = [
            event(EventKind::Create(CreateKind::File), &["/vault/new.md"]),
            event(EventKind::Remove(RemoveKind::File), &["/vault/gone.md"]),
        ];
        let changes = classify(events.iter());
        assert_eq!(changes.added, ["/vault/new.md"]);
        assert_eq!(changes.removed, ["/vault/gone.md"]);
    }

    #[test]
    fn the_vaults_own_state_is_not_reported() {
        // `.obsidian/workspace.json` is rewritten every time a pane moves over
        // there. A tree that redrew for it would flicker for reasons nobody
        // watching the window could see.
        let events = [
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &["/vault/.obsidian/workspace.json"],
            ),
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &["/vault/.git/index"],
            ),
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &["/vault/note.md"],
            ),
        ];
        assert_eq!(classify(events.iter()).changed, ["/vault/note.md"]);
    }

    #[test]
    fn a_nested_ignored_folder_is_ignored_too() {
        // Matched on any component rather than the first: a `.git` inside a
        // subfolder of the vault is still `.git`, and that is where one usually
        // is.
        let events = [event(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &["/vault/projects/thing/.git/HEAD"],
        )];
        assert!(classify(events.iter()).is_empty());
    }

    #[test]
    fn a_file_that_came_and_went_is_neither() {
        // The temporary an editor writes beside the file it is saving. It was
        // never there as far as the window is concerned, and reporting it would
        // put a row in the tree that vanishes on the next read.
        let temporary = absent("temporary.md");
        let events = [
            event(EventKind::Create(CreateKind::File), &[&temporary]),
            event(EventKind::Remove(RemoveKind::File), &[&temporary]),
        ];
        assert!(classify(events.iter()).is_empty());
    }

    #[test]
    fn a_save_written_as_remove_then_create_is_a_change() {
        // Some editors save by deleting the file and writing a new one under
        // the same name. That is one note with new text in it, not a note that
        // left the vault — and the tab showing it must be offered the new text
        // rather than told its file is gone.
        let real = std::env::temp_dir().join(format!("scheda-churn-{}.md", std::process::id()));
        std::fs::write(&real, b"x").expect("write");
        let name = real.to_string_lossy().into_owned();
        let events = [
            event(EventKind::Remove(RemoveKind::File), &[&name]),
            event(EventKind::Create(CreateKind::File), &[&name]),
        ];
        let changes = classify(events.iter());
        assert_eq!(changes.changed, [name]);
        assert!(changes.added.is_empty());
        assert!(changes.removed.is_empty());
        let _ = std::fs::remove_file(&real);
    }

    #[test]
    fn a_file_written_and_then_deleted_is_only_gone() {
        // The write happened, but the file is not there any more, and telling
        // the window to re-read it would be telling it to read nothing.
        let gone = absent("written-then-gone.md");
        let events = [
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &[&gone],
            ),
            event(EventKind::Remove(RemoveKind::File), &[&gone]),
        ];
        let changes = classify(events.iter());
        assert_eq!(changes.removed, [gone]);
        assert!(changes.changed.is_empty());
    }

    #[test]
    fn nothing_at_all_is_nothing_at_all() {
        let none: [Event; 0] = [];
        assert!(classify(none.iter()).is_empty());
    }

    #[test]
    fn a_watch_points_at_one_root_and_moves() {
        let first = std::env::temp_dir().join(format!("scheda-watch-a-{}", std::process::id()));
        let second = std::env::temp_dir().join(format!("scheda-watch-b-{}", std::process::id()));
        std::fs::create_dir_all(&first).expect("create");
        std::fs::create_dir_all(&second).expect("create");

        let watch = Watch::default();
        assert_eq!(watch.root(), None);
        watch.point_at(&first, |_| {}).expect("watch the first");
        assert_eq!(watch.root(), Some(first.clone()));
        watch.point_at(&second, |_| {}).expect("watch the second");
        assert_eq!(watch.root(), Some(second.clone()));
        watch.stop();
        assert_eq!(watch.root(), None);

        let _ = std::fs::remove_dir_all(&first);
        let _ = std::fs::remove_dir_all(&second);
    }
}

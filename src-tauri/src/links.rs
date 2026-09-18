//! Wikilinks: what `[[this]]` points at, and what to write for a new one.
//!
//! The resolving is here rather than in the window for the reason everything
//! else is. Obsidian resolves `[[note]]` against the *whole vault* — the target
//! is any file with that name, wherever it sits — so the answer needs the list
//! of files, and that list is the core's (`tree`, and the same one `quick`
//! searches). Sending a few thousand paths across the boundary so the other side
//! could match them would also put a second opinion in the window about what is
//! inside the root, and the second opinion is the one that gets it wrong.
//!
//! **Obsidian's rules, as a vault actually behaves:**
//!
//! - `[[note]]` matches a file called `note.md` anywhere. Several files can be
//!   called that; a note wins over anything else sharing the name, then the
//!   shortest path wins, and a tie is broken by the path so the same link always
//!   lands on the same file.
//! - `[[folder/note]]` is a path from the vault root, and also matches a file
//!   whose path merely *ends* that way — `[[b/c]]` finds `a/b/c.md`.
//! - The extension is optional and `.md` is assumed. `[[picture.png]]` names
//!   that file, because a name with an extension is a name — and when the target
//!   names an extension the preference for notes does not apply, since the target
//!   already said which file it wants.
//! - `[[note|shown]]` and `[[note#heading]]` — the alias and the heading belong
//!   to the link, not to the target, and come off before anything is looked up.
//! - Matching is case-insensitive: a vault is carried between a case-sensitive
//!   filesystem and a case-preserving one, and `[[Note]]` finding nothing on one
//!   machine and something on the other is the kind of break nobody can debug.

use std::path::{Component, Path, PathBuf};

/// The default extension for a target with none written.
const NOTE_EXTENSION: &str = "md";

/// A wikilink taken apart: what it points at, what it shows, where in it to go.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Target {
    /// The path or name before `#` and `|`, trimmed. Empty for `[[#heading]]`,
    /// which points into the note it is written in.
    pub path: String,
    /// The heading after `#`, if any. Not lowercased: it is matched against the
    /// headings of a note, and it is also shown when there is no alias.
    pub heading: Option<String>,
    /// The text after `|`, which is what the reader sees instead of the target.
    pub alias: Option<String>,
    /// True for `![[...]]` — the note or picture is to be shown here, not linked
    /// to. Set by the caller that saw the `!`, since the brackets are all this
    /// module is handed.
    pub embed: bool,
}

/// Takes apart what is between the brackets.
///
/// The order is `path#heading|alias`, and it is that order in Obsidian too: a
/// `#` inside the alias is part of the alias, and a `|` before the `#` makes the
/// rest of it alias as well. Splitting on `|` first is what gets both right.
pub fn parse_target(inner: &str) -> Target {
    let (before_alias, alias) = match inner.split_once('|') {
        Some((before, alias)) => (before, Some(alias.trim().to_string())),
        None => (inner, None),
    };
    let (path, heading) = match before_alias.split_once('#') {
        Some((path, heading)) => (path, Some(heading.trim().to_string())),
        None => (before_alias, None),
    };

    Target {
        path: path.trim().to_string(),
        // An empty heading is `[[note#]]`, which points at the note.
        heading: heading.filter(|h| !h.is_empty()),
        // An empty alias is `[[note|]]`. Obsidian shows the target for it, and
        // so an absent alias is the honest reading.
        alias: alias.filter(|a| !a.is_empty()),
        embed: false,
    }
}

/// What the reader should see for a link — the alias, else the target as
/// written.
///
/// The heading joins the name with a space around the hash rather than being
/// dropped: `[[plan#Risks]]` shown as `plan` loses the half of the link that
/// says where in the note it goes.
pub fn label_of(target: &Target) -> String {
    if let Some(alias) = &target.alias {
        return alias.clone();
    }
    // The leading folders come off: `[[projects/scheda/plan]]` reads as `plan`,
    // which is what Obsidian shows and what the sentence around it was written
    // to read as.
    let name = target
        .path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&target.path);
    match (&target.heading, name.is_empty()) {
        // `[[#Risks]]` — a link inside this note. The hash is the whole label.
        (Some(heading), true) => format!("#{heading}"),
        (Some(heading), false) => format!("{name} › {heading}"),
        (None, _) => name.to_string(),
    }
}

/// A file the resolver may land on, as flat as the picker's list.
///
/// Built from the same tree walk, and deliberately the same shape: one list of
/// the vault's files, used by the two features that need one.
pub struct Candidate {
    /// The absolute path, which is what a resolved link becomes.
    pub path: PathBuf,
    /// The path from the vault root with forward slashes, lowercased. The form
    /// every comparison here is made against, computed once rather than per
    /// link.
    pub relative_lower: String,
    /// The file's own name without its extension, lowercased — what `[[note]]`
    /// is matched against.
    pub stem_lower: String,
    /// The file's name with its extension, lowercased, for `[[picture.png]]`.
    pub name_lower: String,
}

/// Flattens a tree into the files a wikilink may resolve to.
pub fn candidates(root: &Path, entries: &[crate::tree::Entry]) -> Vec<Candidate> {
    let mut out = Vec::new();
    collect(root, entries, &mut out);
    out
}

fn collect(root: &Path, entries: &[crate::tree::Entry], out: &mut Vec<Candidate>) {
    for entry in entries {
        match &entry.children {
            Some(children) => collect(root, children, out),
            None => {
                let path = PathBuf::from(&entry.path);
                let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
                let relative_lower = slashed(&relative).to_lowercase();
                let name_lower = entry.name.to_lowercase();
                let stem_lower = path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().to_lowercase())
                    .unwrap_or_else(|| name_lower.clone());
                out.push(Candidate {
                    path,
                    relative_lower,
                    stem_lower,
                    name_lower,
                });
            }
        }
    }
}

/// A path with forward slashes, whatever the platform wrote it with.
///
/// Wikilinks use `/` on every platform — a vault carried between machines has
/// the same links in it — so this is the form all the comparing is done in.
fn slashed(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// The file a target names, or `None` when the vault holds no such file.
///
/// `None` is the ordinary answer for a link to a note that has not been written
/// yet; the caller offers to create it.
pub fn resolve(candidates: &[Candidate], target: &str) -> Option<PathBuf> {
    let wanted = target.trim().trim_start_matches("./");
    if wanted.is_empty() {
        return None;
    }
    // Forward slashes, lowercased, and `\` accepted because a link typed on
    // Windows sometimes has one in it.
    let wanted = wanted.replace('\\', "/").to_lowercase();

    // A name with a slash in it is a path; one without is a name to find
    // anywhere. The two are separate searches because `[[b/c]]` must not match
    // a file *called* `b/c` — no such name exists — while `[[note]]` must not be
    // confined to the root.
    let has_folders = wanted.contains('/');

    // A target with no extension of its own means a note, so a note outranks
    // anything else that shares the name. With one — `[[shot.png]]` — the target
    // named the file it wants and there is no note to prefer.
    let prefer_notes = Path::new(&wanted).extension().is_none();

    let mut best: Option<&Candidate> = None;
    for candidate in candidates {
        let matches = if has_folders {
            path_matches(candidate, &wanted)
        } else {
            name_matches(candidate, &wanted)
        };
        if !matches {
            continue;
        }
        // A note first, then the shortest path, then the lower path. Not
        // decoration: two notes of the same name in different folders are
        // ordinary in a vault, and a link that lands on a different one
        // depending on the order the directory happened to be read is a link
        // that cannot be trusted.
        best = match best {
            None => Some(candidate),
            Some(current) if better(candidate, current, prefer_notes) => Some(candidate),
            other => other,
        };
    }
    best.map(|candidate| candidate.path.clone())
}

/// Whether a candidate is a better answer than the one held.
///
/// Fewer folders first, then the shorter path, then alphabetically. The last is
/// what makes the answer the same on every run.
fn better(candidate: &Candidate, current: &Candidate, prefer_notes: bool) -> bool {
    // A note first, and ahead of depth rather than behind it.
    //
    // `[[a]]` in a vault holding `a.md` and `a.js` means the note: the written
    // target carries no extension, `.md` is the one that is assumed, and a file
    // that matched only because its stem happens to be `a` is the weaker answer
    // however its path sorts. Without this key the two are separated by path
    // length and then alphabetically — which picked `a.js`. Found by probing a
    // real vault after the unit tests were green, because every one of them
    // compared a note against a note.
    //
    // It does not apply when the target names an extension itself: `[[shot.png]]`
    // asks for that file, and there is no note to prefer.
    let rank = |c: &Candidate| u8::from(prefer_notes && !is_note(c));
    let depth = |c: &Candidate| c.relative_lower.matches('/').count();
    (
        rank(candidate),
        depth(candidate),
        candidate.relative_lower.len(),
        &candidate.relative_lower,
    ) < (
        rank(current),
        depth(current),
        current.relative_lower.len(),
        &current.relative_lower,
    )
}

/// Whether a candidate is a markdown note.
fn is_note(candidate: &Candidate) -> bool {
    candidate
        .name_lower
        .ends_with(&format!(".{NOTE_EXTENSION}"))
}

/// Whether `wanted` — a name with no folders — names this file.
fn name_matches(candidate: &Candidate, wanted: &str) -> bool {
    // With the extension written, the name is the whole name: `[[shot.png]]`.
    // Without, `.md` is assumed, which is why the stem is tried too.
    candidate.name_lower == wanted || candidate.stem_lower == wanted
}

/// Whether `wanted` — a path — names this file.
///
/// The path may be given from the root or from anywhere in the middle:
/// `[[b/c]]` finds `a/b/c.md`, which is Obsidian's behaviour and the reason a
/// link keeps working when its note is moved into a folder.
fn path_matches(candidate: &Candidate, wanted: &str) -> bool {
    let with_extension = format!("{wanted}.{NOTE_EXTENSION}");
    ends_at_boundary(&candidate.relative_lower, wanted)
        || ends_at_boundary(&candidate.relative_lower, &with_extension)
}

/// Whether `haystack` ends with `suffix` at a path boundary.
///
/// The boundary matters: without it `[[ans/plan]]` would match `plans/plan.md`
/// — the letters line up and the files have nothing to do with each other.
fn ends_at_boundary(haystack: &str, suffix: &str) -> bool {
    if haystack == suffix {
        return true;
    }
    haystack
        .strip_suffix(suffix)
        .is_some_and(|before| before.ends_with('/'))
}

/// The target to write for a link from `document` to `path`, in the vault's own
/// format.
///
/// Which format is the vault's answer, not scheda's (`vault::LinkFormat`): a
/// vault where Obsidian writes `[[folder/note]]` and scheda writes `[[note]]` is
/// a vault two programs disagree about.
pub fn target_for(
    config: &crate::vault::VaultConfig,
    candidates: &[Candidate],
    root: &Path,
    document: &Path,
    path: &Path,
) -> String {
    use crate::vault::LinkFormat;

    let relative = path.strip_prefix(root).unwrap_or(path).to_path_buf();
    let absolute = strip_note_extension(&slashed(&relative));

    match config.link_format {
        LinkFormat::Absolute => absolute,
        LinkFormat::Relative => {
            let from = document.parent().unwrap_or(root);
            let relative = relative_between(from, path);
            strip_note_extension(&slashed_keeping_climbs(&relative))
        }
        LinkFormat::Shortest => {
            // The name alone, unless the vault holds another file that the name
            // would also match — in which case the name is not a link to this
            // file, and the whole path is.
            //
            // The *name*, with only `.md` taken off it: `file_stem` would drop
            // `.png` too and ask the vault for a note called `shot`, which is the
            // same mistake as a link whose extension was assumed.
            let name = path
                .file_name()
                .map(|name| strip_note_extension(&name.to_string_lossy()))
                .unwrap_or_else(|| absolute.clone());
            let wanted = name.to_lowercase();
            let sharing = candidates
                .iter()
                .filter(|candidate| name_matches(candidate, &wanted))
                .count();
            if sharing <= 1 { name } else { absolute }
        }
    }
}

/// `path` written from `from`, with `..` for each level climbed.
fn relative_between(from: &Path, path: &Path) -> PathBuf {
    let mut from_parts = from.components().peekable();
    let mut to_parts = path.components().peekable();

    let same = |a: &Component, b: &Component| {
        #[cfg(windows)]
        {
            a.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
        }
        #[cfg(not(windows))]
        {
            a == b
        }
    };

    let mut shared = 0usize;
    while let (Some(a), Some(b)) = (from_parts.peek(), to_parts.peek()) {
        if !same(a, b) {
            break;
        }
        shared += 1;
        from_parts.next();
        to_parts.next();
    }
    if shared == 0 {
        return path.to_path_buf();
    }

    let mut out = PathBuf::new();
    for _ in from_parts {
        out.push("..");
    }
    for part in to_parts {
        out.push(part);
    }
    out
}

/// Like [`slashed`], but keeping the `..` a relative link needs.
fn slashed_keeping_climbs(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            Component::ParentDir => Some("..".to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Drops a trailing `.md`, since a wikilink to a note is written without it.
///
/// Only `.md`: `[[shot.png]]` keeps its extension, because dropping it would ask
/// the vault for a note called `shot` that does not exist.
fn strip_note_extension(path: &str) -> String {
    path.strip_suffix(&format!(".{NOTE_EXTENSION}"))
        .unwrap_or(path)
        .to_string()
}

/// The file name to create for a target that resolved to nothing.
///
/// The last component of the target, with `.md` unless it already carries an
/// extension. The folders in the target are honoured: `[[projects/new]]` in a
/// vault creates `projects/new.md`, not `new.md` in the new-note folder, because
/// the person said where.
pub fn file_for_missing(
    config: &crate::vault::VaultConfig,
    root: &Path,
    document: &Path,
    target: &str,
) -> Option<PathBuf> {
    let wanted = target.trim().trim_start_matches("./").replace('\\', "/");
    if wanted.is_empty() {
        return None;
    }
    // A target that climbs out of the vault is not a note this vault can hold.
    if wanted.starts_with('/') || wanted.split('/').any(|part| part == "..") {
        return None;
    }

    let (folders, name) = match wanted.rsplit_once('/') {
        Some((folders, name)) => (Some(folders), name),
        None => (None, wanted.as_str()),
    };
    if name.is_empty() {
        return None;
    }

    // Any component rejected by the file rules is rejected here rather than
    // reported by the filesystem later: `[[what?]]` cannot become a file on
    // Windows, and a vault is meant to be carried between machines.
    for part in wanted.split('/') {
        crate::files::check_name(part).ok()?;
    }

    let file_name = if Path::new(name).extension().is_some() {
        name.to_string()
    } else {
        format!("{name}.{NOTE_EXTENSION}")
    };

    // Folders in the target are from the vault root, the way a wikilink path is.
    // Only a bare name follows the vault's new-note setting: it is the case
    // where nobody said where to put it.
    let base = match folders {
        Some(folders) => root.join(folders),
        None => config.new_note_folder(root, document),
    };
    Some(base.join(file_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{LinkFormat, NewFileLocation, VaultConfig};

    fn target(inner: &str) -> Target {
        parse_target(inner)
    }

    #[test]
    fn a_plain_name_is_the_whole_target() {
        let parsed = target("note");
        assert_eq!(parsed.path, "note");
        assert_eq!(parsed.heading, None);
        assert_eq!(parsed.alias, None);
    }

    #[test]
    fn an_alias_and_a_heading_come_off() {
        let parsed = target("plan#Risks|what could go wrong");
        assert_eq!(parsed.path, "plan");
        assert_eq!(parsed.heading.as_deref(), Some("Risks"));
        assert_eq!(parsed.alias.as_deref(), Some("what could go wrong"));
    }

    #[test]
    fn a_hash_inside_an_alias_stays_in_it() {
        // The order is `path#heading|alias`, so the alias is split off first.
        // Splitting on `#` first would read `issue #4` as a heading and leave an
        // alias of `4`.
        let parsed = target("plan|issue #4");
        assert_eq!(parsed.path, "plan");
        assert_eq!(parsed.heading, None);
        assert_eq!(parsed.alias.as_deref(), Some("issue #4"));
    }

    #[test]
    fn a_heading_with_no_note_points_into_this_one() {
        let parsed = target("#Risks");
        assert_eq!(parsed.path, "");
        assert_eq!(parsed.heading.as_deref(), Some("Risks"));
    }

    #[test]
    fn empty_halves_are_not_halves() {
        // `[[note#]]` points at the note, and `[[note|]]` shows the target.
        assert_eq!(target("note#").heading, None);
        assert_eq!(target("note|").alias, None);
    }

    #[test]
    fn spaces_around_the_parts_are_trimmed() {
        let parsed = target(" plan # Risks | later ");
        assert_eq!(parsed.path, "plan");
        assert_eq!(parsed.heading.as_deref(), Some("Risks"));
        assert_eq!(parsed.alias.as_deref(), Some("later"));
    }

    #[test]
    fn the_label_is_the_alias_when_there_is_one() {
        assert_eq!(label_of(&target("plan|the plan")), "the plan");
    }

    #[test]
    fn the_label_drops_the_folders() {
        // `[[projects/scheda/plan]]` reads as `plan` in the sentence it is in,
        // which is what Obsidian shows too.
        assert_eq!(label_of(&target("projects/scheda/plan")), "plan");
    }

    #[test]
    fn the_label_keeps_the_heading() {
        // Showing `plan` for `[[plan#Risks]]` loses the half of the link that
        // says where in the note it goes.
        assert_eq!(label_of(&target("plan#Risks")), "plan › Risks");
        assert_eq!(label_of(&target("#Risks")), "#Risks");
    }

    /// A vault of the given relative paths, for the resolver.
    fn vault(paths: &[&str]) -> Vec<Candidate> {
        let root = Path::new("/vault");
        paths
            .iter()
            .map(|relative| {
                let path = root.join(relative);
                Candidate {
                    relative_lower: relative.replace('\\', "/").to_lowercase(),
                    name_lower: path
                        .file_name()
                        .expect("has a name")
                        .to_string_lossy()
                        .to_lowercase(),
                    stem_lower: path
                        .file_stem()
                        .expect("has a stem")
                        .to_string_lossy()
                        .to_lowercase(),
                    path,
                }
            })
            .collect()
    }

    fn resolved(paths: &[&str], target: &str) -> Option<String> {
        resolve(&vault(paths), target).map(|path| slashed(path.strip_prefix("/vault").unwrap()))
    }

    #[test]
    fn a_name_finds_a_note_anywhere_in_the_vault() {
        // The whole point of a wikilink: the target is a name, not a path.
        assert_eq!(
            resolved(&["projects/deep/plan.md"], "plan").as_deref(),
            Some("projects/deep/plan.md")
        );
    }

    #[test]
    fn the_extension_is_assumed_and_may_be_written() {
        assert_eq!(resolved(&["note.md"], "note").as_deref(), Some("note.md"));
        assert_eq!(
            resolved(&["note.md"], "note.md").as_deref(),
            Some("note.md")
        );
        // A name with an extension is a name: this is how a picture is linked.
        assert_eq!(
            resolved(&["shot.png"], "shot.png").as_deref(),
            Some("shot.png")
        );
    }

    #[test]
    fn a_picture_is_not_found_by_its_stem_alone_when_a_note_shares_it() {
        // `[[shot]]` in a vault holding `shot.md` and `shot.png` means the note:
        // that is what the assumed `.md` is for.
        let found = resolved(&["shot.png", "shot.md"], "shot");
        assert_eq!(found.as_deref(), Some("shot.md"));
    }

    #[test]
    fn the_shortest_path_wins_a_shared_name() {
        // Two notes of the same name in different folders is ordinary in a
        // vault, and Obsidian takes the shallower one.
        assert_eq!(
            resolved(&["archive/2024/plan.md", "plan.md"], "plan").as_deref(),
            Some("plan.md")
        );
        assert_eq!(
            resolved(&["a/b/c/plan.md", "a/plan.md"], "plan").as_deref(),
            Some("a/plan.md")
        );
    }

    #[test]
    fn a_tie_lands_on_the_same_file_every_time() {
        // Two notes at the same depth with the same name: the answer must not
        // depend on the order the directory happened to be read in. A link that
        // moves between runs cannot be trusted.
        let one = resolved(&["b/plan.md", "a/plan.md"], "plan");
        let two = resolved(&["a/plan.md", "b/plan.md"], "plan");
        assert_eq!(one, two);
        assert_eq!(one.as_deref(), Some("a/plan.md"));
    }

    #[test]
    fn a_path_is_matched_from_the_root_or_from_the_middle() {
        // `[[b/c]]` finding `a/b/c.md` is Obsidian's behaviour, and it is why a
        // link keeps working when its note is moved into a folder.
        assert_eq!(
            resolved(&["a/b/c.md"], "a/b/c").as_deref(),
            Some("a/b/c.md")
        );
        assert_eq!(resolved(&["a/b/c.md"], "b/c").as_deref(), Some("a/b/c.md"));
    }

    #[test]
    fn a_path_matches_only_at_a_boundary() {
        // Without the boundary check `[[ans/plan]]` matches `plans/plan.md`:
        // the letters line up and the two files have nothing to do with each
        // other.
        assert_eq!(resolved(&["plans/plan.md"], "ans/plan"), None);
        assert_eq!(
            resolved(&["plans/plan.md"], "plans/plan").as_deref(),
            Some("plans/plan.md")
        );
    }

    #[test]
    fn case_does_not_decide_whether_a_link_works() {
        // A vault is carried between a case-sensitive filesystem and a
        // case-preserving one. A link that resolves on one machine and not the
        // other is the kind of break nobody can debug.
        assert_eq!(resolved(&["Plan.md"], "plan").as_deref(), Some("Plan.md"));
        assert_eq!(
            resolved(&["Projects/Plan.md"], "projects/plan").as_deref(),
            Some("Projects/Plan.md")
        );
    }

    #[test]
    fn a_missing_note_resolves_to_nothing() {
        // The ordinary answer for a link written before its note. The caller
        // offers to create it.
        assert_eq!(resolved(&["other.md"], "plan"), None);
        assert_eq!(resolved(&[], ""), None);
    }

    #[test]
    fn a_backslash_in_a_typed_link_still_resolves() {
        // Typed on Windows, where the hand reaches for the other slash.
        assert_eq!(resolved(&["a/b.md"], "a\\b").as_deref(), Some("a/b.md"));
    }

    fn document() -> PathBuf {
        PathBuf::from("/vault/daily/today.md")
    }

    #[test]
    fn the_shortest_format_writes_the_name_alone() {
        let files = vault(&["projects/plan.md"]);
        let config = VaultConfig::default();
        assert_eq!(
            target_for(
                &config,
                &files,
                Path::new("/vault"),
                &document(),
                Path::new("/vault/projects/plan.md")
            ),
            "plan"
        );
    }

    #[test]
    fn the_shortest_format_falls_back_to_the_path_when_the_name_is_taken() {
        // The name alone would not be a link to *this* file — it would resolve
        // to whichever the rules pick — so the whole path is written.
        let files = vault(&["projects/plan.md", "archive/plan.md"]);
        let config = VaultConfig::default();
        assert_eq!(
            target_for(
                &config,
                &files,
                Path::new("/vault"),
                &document(),
                Path::new("/vault/archive/plan.md")
            ),
            "archive/plan"
        );
    }

    #[test]
    fn the_absolute_format_writes_from_the_root() {
        let files = vault(&["projects/plan.md"]);
        let config = VaultConfig {
            link_format: LinkFormat::Absolute,
            ..Default::default()
        };
        assert_eq!(
            target_for(
                &config,
                &files,
                Path::new("/vault"),
                &document(),
                Path::new("/vault/projects/plan.md")
            ),
            "projects/plan"
        );
    }

    #[test]
    fn the_relative_format_climbs_out_of_the_notes_folder() {
        let files = vault(&["projects/plan.md"]);
        let config = VaultConfig {
            link_format: LinkFormat::Relative,
            ..Default::default()
        };
        assert_eq!(
            target_for(
                &config,
                &files,
                Path::new("/vault"),
                &document(),
                Path::new("/vault/projects/plan.md")
            ),
            "../projects/plan"
        );
    }

    #[test]
    fn a_written_target_keeps_a_pictures_extension() {
        // Dropping `.png` would ask the vault for a note called `shot`.
        let files = vault(&["shot.png"]);
        let config = VaultConfig::default();
        assert_eq!(
            target_for(
                &config,
                &files,
                Path::new("/vault"),
                &document(),
                Path::new("/vault/shot.png")
            ),
            "shot.png"
        );
    }

    #[test]
    fn a_missing_bare_name_goes_where_the_vault_says() {
        let root = Path::new("/vault");
        let at_root = VaultConfig::default();
        assert_eq!(
            file_for_missing(&at_root, root, &document(), "plan"),
            Some(PathBuf::from("/vault/plan.md"))
        );

        let beside = VaultConfig {
            new_file_location: NewFileLocation::CurrentFolder,
            ..Default::default()
        };
        assert_eq!(
            file_for_missing(&beside, root, &document(), "plan"),
            Some(PathBuf::from("/vault/daily/plan.md"))
        );

        let named = VaultConfig {
            new_file_location: NewFileLocation::Folder("Inbox".into()),
            ..Default::default()
        };
        assert_eq!(
            file_for_missing(&named, root, &document(), "plan"),
            Some(PathBuf::from("/vault/Inbox/plan.md"))
        );
    }

    #[test]
    fn a_missing_target_with_folders_is_created_where_it_says() {
        // The person said where. The vault's new-note folder is for the case
        // where nobody did.
        let beside = VaultConfig {
            new_file_location: NewFileLocation::CurrentFolder,
            ..Default::default()
        };
        assert_eq!(
            file_for_missing(&beside, Path::new("/vault"), &document(), "projects/new"),
            Some(PathBuf::from("/vault/projects/new.md"))
        );
    }

    #[test]
    fn a_missing_target_that_climbs_out_is_refused() {
        // A note outside the vault is not a note this vault can hold, and a
        // wikilink is not the door for writing one.
        let config = VaultConfig::default();
        let root = Path::new("/vault");
        assert_eq!(
            file_for_missing(&config, root, &document(), "../outside"),
            None
        );
        assert_eq!(
            file_for_missing(&config, root, &document(), "/etc/passwd"),
            None
        );
        assert_eq!(file_for_missing(&config, root, &document(), "  "), None);
    }

    #[test]
    fn a_missing_target_with_an_impossible_name_is_refused() {
        // `[[what?]]` cannot become a file on Windows, and a vault is meant to
        // be carried between machines. Refusing here says so in words; the
        // filesystem would say it in an error code later.
        let config = VaultConfig::default();
        assert_eq!(
            file_for_missing(&config, Path::new("/vault"), &document(), "what?"),
            None
        );
    }

    #[test]
    fn a_missing_target_keeps_an_extension_it_was_given() {
        let config = VaultConfig::default();
        assert_eq!(
            file_for_missing(&config, Path::new("/vault"), &document(), "notes.txt"),
            Some(PathBuf::from("/vault/notes.txt"))
        );
    }
}

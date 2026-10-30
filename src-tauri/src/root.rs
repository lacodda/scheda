//! Where a document's world begins, and what may be read from it.
//!
//! One rule, stated once (ADR 0003): a document's root is its nearest ancestor
//! that is either a folder opened explicitly or a folder holding `.obsidian/`,
//! and its own folder if there is neither. Everything the vault side of scheda
//! needs — the tree, wikilinks, backlinks, search — derives from this, and so
//! does which directory the webview may read pictures from (ADR 0004).
//!
//! The folders opened explicitly are the window's, kept with its session
//! (`session.rs`), and every question here takes them as an argument rather
//! than reading them from somewhere: a caller that forgot them would answer
//! with the rule as it was before folders could be opened, and nothing would
//! say so.
//!
//! Resolving a link lives here too, rather than in the frontend, so that
//! "outside the root" is decided by the same code that decided where the root
//! is. A component checking paths on its own would be a second opinion, and
//! the second opinion is the one that gets it wrong.

use std::path::{Component, Path, PathBuf};

/// The marker Obsidian leaves in a vault. Read, never written.
pub const VAULT_MARKER: &str = ".obsidian";

/// The root for a document at `path`: its vault, or its own folder.
///
/// A path with no parent at all (which should not happen for a real file)
/// answers with itself, so callers never have to handle `None`.
pub fn for_file(path: &Path, opened: &[PathBuf]) -> PathBuf {
    for_vault(path, opened).unwrap_or_else(|| path.parent().unwrap_or(path).to_path_buf())
}

/// The vault a document belongs to, if it belongs to one: the nearest folder
/// above it that was opened explicitly or holds `.obsidian/`.
///
/// Distinct from [`for_file`], which always answers: this one says `None` for
/// a note with neither above it. That is what keeps a note on the Desktop a
/// note rather than a folder to browse (decision 2026-09-05) — unless the
/// Desktop was opened as a folder, which is somebody saying it is one.
///
/// Nearest wins whichever kind it is. A vault inside an opened folder is still
/// a vault: its notes were written for it, and their links mean what they mean
/// in it. A folder opened inside a vault is the part of it somebody asked for.
pub fn for_vault(path: &Path, opened: &[PathBuf]) -> Option<PathBuf> {
    let start = path.parent().unwrap_or(path);
    let mut current = Some(start);
    while let Some(dir) = current {
        if opened.iter().any(|root| same_file(root, dir)) || dir.join(VAULT_MARKER).is_dir() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

/// The Obsidian vault a document is in, whatever was opened around it.
///
/// For the one question only Obsidian can answer: whether it has a vault to
/// open the note in. A folder opened here is not one of Obsidian's.
pub fn for_obsidian(path: &Path) -> Option<PathBuf> {
    for_vault(path, &[])
}

/// Whether `path` lies inside `folder`, or is it.
pub fn is_within(path: &Path, folder: &Path) -> bool {
    let mut inner = path.components();
    for part in folder.components() {
        match inner.next() {
            Some(other) if part_matches(&part, &other) => {}
            _ => return false,
        }
    }
    true
}

/// A path that came from outside the window — a command line, a second
/// launch, a file dropped on it — as the window holds it.
///
/// Relative to the directory it was given in, which for a second launch is
/// that launch's and not this process's: `scheda notes.md` typed in another
/// terminal means the `notes.md` there. Made absolute by text rather than by
/// `canonicalize`, which on Windows answers with a `\\?\` prefix: a tab holding
/// `\\?\C:\vault\plan.md` is a tab the tree, the recent list and the vault's
/// index all take for another file than `C:\vault\plan.md` — which is what a
/// file double-clicked in Explorer while the window was open used to be.
pub fn from_outside(path: &Path, cwd: &Path) -> PathBuf {
    let path = without_verbatim(path);
    let joined = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    normalise(&joined)
}

/// `\\?\C:\notes` as `C:\notes`, and `\\?\UNC\server\share` as
/// `\\server\share`; anything else as it was.
fn without_verbatim(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        use std::path::Prefix;
        let mut parts = path.components();
        if let Some(Component::Prefix(prefix)) = parts.next() {
            let plain = match prefix.kind() {
                Prefix::VerbatimDisk(letter) => Some(format!("{}:", letter as char)),
                Prefix::VerbatimUNC(server, share) => Some(format!(
                    r"\\{}\{}",
                    server.to_string_lossy(),
                    share.to_string_lossy()
                )),
                _ => None,
            };
            if let Some(plain) = plain {
                let mut out = PathBuf::from(plain);
                for part in parts {
                    out.push(part.as_os_str());
                }
                return out;
            }
        }
    }
    path.to_path_buf()
}

/// Whether two paths name the same file, compared component by component.
///
/// `parent.join(name)` and a `read_dir` result can name files in the same
/// folder and share no prefix as text — `notes/roadmap.md` beside
/// `notes\plan.md`. Comparing components asks the question about the path
/// rather than about how it was spelled. (Found by a rename that planned
/// nothing at all for a link written as a path, while every one of its unit
/// tests was green: the two spellings met only where a `join` and a `read_dir`
/// result were compared.)
///
/// Case-insensitively on Windows, where two spellings do name one file, and
/// exactly elsewhere — the same reasoning as the resolver's: a vault is carried
/// between a case-sensitive filesystem and a case-preserving one.
pub fn same_file(a: &Path, b: &Path) -> bool {
    let mut left = a.components();
    let mut right = b.components();
    loop {
        match (left.next(), right.next()) {
            (None, None) => return true,
            (Some(one), Some(other)) if part_matches(&one, &other) => {}
            _ => return false,
        }
    }
}

/// Whether two path components name the same thing.
fn part_matches(one: &Component<'_>, other: &Component<'_>) -> bool {
    #[cfg(windows)]
    {
        one.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&other.as_os_str().to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        one == other
    }
}

/// Why a link could not become something the webview may load.
#[derive(Debug, PartialEq, Eq)]
pub enum LinkError {
    /// An absolute URL, or a scheme like `mailto:`. Not ours to resolve.
    NotLocal,
    /// The link climbs out of the root, or is absolute on this filesystem.
    OutsideRoot,
    /// Nothing is there.
    Missing,
}

/// Turns a link written in a document into a real path inside `root`.
///
/// The link is taken as relative to the *document*, the way every markdown
/// reader treats it, and then checked against the root — so `../assets/x.png`
/// works from a note in a subfolder, and `../../../../etc/passwd` does not work
/// from anywhere.
///
/// Percent-encoding is undone first: a link to `my file.png` is often written
/// `my%20file.png`, and a reader that does not decode it reports a missing file
/// that is plainly there.
pub fn resolve_link(root: &Path, document: &Path, link: &str) -> Result<PathBuf, LinkError> {
    let link = link.trim();
    if link.is_empty() {
        return Err(LinkError::NotLocal);
    }
    // A scheme means somebody else's business: http, https, mailto, data.
    // A Windows drive letter is not a scheme, hence the length test.
    if let Some(colon) = link.find(':')
        && colon > 1
    {
        return Err(LinkError::NotLocal);
    }
    // A fragment or query belongs to the link, not to the file name.
    let without_fragment = link.split(['#', '?']).next().unwrap_or(link);
    let decoded = percent_decode(without_fragment);
    let relative = Path::new(&decoded);

    // An absolute path in a note points at the machine, not at the vault.
    //
    // Belt and braces: joining an absolute path onto the base yields that same
    // absolute path, which the root check below would reject anyway — a
    // mutation confirmed the test still fails with both guards gone. It stays
    // because the intent should be readable without deriving it from `join`.
    if relative.is_absolute() {
        return Err(LinkError::OutsideRoot);
    }

    let base = document.parent().unwrap_or(root);
    let joined = base.join(relative);
    let normalised = normalise(&joined);

    // The comparison is on the normalised forms, so `..` has already been
    // resolved textually. Canonicalising instead would follow symlinks and
    // fail on a file that does not exist yet; this answers the question asked.
    let root_normalised = normalise(root);
    if !normalised.starts_with(&root_normalised) {
        return Err(LinkError::OutsideRoot);
    }
    if !normalised.is_file() {
        return Err(LinkError::Missing);
    }
    Ok(normalised)
}

/// Resolves `.` and `..` textually, without touching the filesystem.
///
/// `Path::canonicalize` is not used on purpose: it requires the file to exist,
/// follows symlinks, and on Windows returns a `\\?\` prefix that then fails to
/// compare against a path that has none.
fn normalise(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Undoes percent-encoding. Only `%XX` is meaningful here; anything else is
/// left as it was, because a stray `%` in a filename is legal.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A temporary directory that cleans up after itself, so the tests leave
    /// nothing behind on a developer's disk.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("scheda-root-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(&path).expect("create dir");
            path
        }

        fn file(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parent");
            }
            fs::write(&path, b"x").expect("write file");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_lone_file_roots_at_its_own_folder() {
        let temp = TempDir::new("lone");
        let note = temp.file("notes/one.md");
        assert_eq!(for_file(&note, &[]), normalise(&temp.0.join("notes")));
    }

    #[test]
    fn a_file_in_a_vault_roots_at_the_vault() {
        let temp = TempDir::new("vault");
        temp.dir("vault/.obsidian");
        let note = temp.file("vault/deep/deeper/one.md");
        assert_eq!(for_file(&note, &[]), temp.0.join("vault"));
    }

    #[test]
    fn the_nearest_vault_wins() {
        // A vault inside a vault is unusual but legal, and the answer has to be
        // the one the note is actually in.
        let temp = TempDir::new("nested");
        temp.dir("outer/.obsidian");
        temp.dir("outer/inner/.obsidian");
        let note = temp.file("outer/inner/one.md");
        assert_eq!(for_file(&note, &[]), temp.0.join("outer/inner"));
    }

    #[test]
    fn a_file_named_obsidian_is_not_a_vault() {
        // The marker is a directory. A note called `.obsidian` would otherwise
        // silently move the root.
        let temp = TempDir::new("notadir");
        temp.file("folder/.obsidian");
        let note = temp.file("folder/one.md");
        assert_eq!(for_file(&note, &[]), temp.0.join("folder"));
    }

    #[test]
    fn a_file_outside_a_vault_has_no_vault() {
        // What decides whether a window shows a tree. A note on the Desktop is
        // a note, not a folder to browse.
        let temp = TempDir::new("novault");
        let note = temp.file("loose/one.md");
        assert_eq!(for_vault(&note, &[]), None);
    }

    #[test]
    fn a_file_in_a_vault_finds_it() {
        let temp = TempDir::new("hasvault");
        temp.dir("vault/.obsidian");
        let note = temp.file("vault/deep/one.md");
        assert_eq!(for_vault(&note, &[]), Some(temp.0.join("vault")));
    }

    #[test]
    fn the_nearest_vault_wins_here_too() {
        let temp = TempDir::new("nestedvault");
        temp.dir("outer/.obsidian");
        temp.dir("outer/inner/.obsidian");
        let note = temp.file("outer/inner/one.md");
        assert_eq!(for_vault(&note, &[]), Some(temp.0.join("outer/inner")));
    }

    #[test]
    fn a_folder_opened_explicitly_is_the_root_of_what_is_in_it() {
        // ADR 0003's first half, which no build before 0.19 honoured: a folder
        // with no `.obsidian/` is a vault because somebody opened it as one.
        let temp = TempDir::new("opened");
        let note = temp.file("notes/deep/one.md");
        let opened = [temp.0.join("notes")];
        assert_eq!(for_vault(&note, &opened), Some(temp.0.join("notes")));
        assert_eq!(for_file(&note, &opened), temp.0.join("notes"));
        // A note beside the folder rather than in it is not in it.
        let beside = temp.file("other/two.md");
        assert_eq!(for_vault(&beside, &opened), None);
    }

    #[test]
    fn the_nearest_root_wins_whichever_kind_it_is() {
        let temp = TempDir::new("nearest");
        temp.dir("outer/vault/.obsidian");
        let in_vault = temp.file("outer/vault/one.md");
        let in_folder = temp.file("outer/two.md");
        let opened = [temp.0.join("outer")];
        // A vault inside an opened folder: its notes keep their vault.
        assert_eq!(
            for_vault(&in_vault, &opened),
            Some(temp.0.join("outer/vault"))
        );
        assert_eq!(for_vault(&in_folder, &opened), Some(temp.0.join("outer")));

        // A folder opened inside a vault: the part somebody asked for.
        let inner = temp.file("outer/vault/projects/plan.md");
        let opened = [temp.0.join("outer/vault/projects")];
        assert_eq!(
            for_vault(&inner, &opened),
            Some(temp.0.join("outer/vault/projects"))
        );
    }

    #[test]
    fn obsidian_is_asked_about_its_own_vaults_only() {
        let temp = TempDir::new("obsidianonly");
        temp.dir("vault/.obsidian");
        let in_vault = temp.file("vault/projects/plan.md");
        let loose = temp.file("loose/one.md");
        let opened = [temp.0.join("vault/projects"), temp.0.join("loose")];
        assert_eq!(for_obsidian(&in_vault), Some(temp.0.join("vault")));
        assert_eq!(for_obsidian(&loose), None);
        // The opened folders are the window's business, not Obsidian's.
        assert_eq!(for_vault(&loose, &opened), Some(temp.0.join("loose")));
    }

    #[cfg(windows)]
    #[test]
    fn an_opened_folder_is_found_whatever_case_it_was_typed_in() {
        let temp = TempDir::new("case");
        let note = temp.file("Notes/one.md");
        let typed = PathBuf::from(temp.0.join("NOTES").to_string_lossy().to_uppercase());
        assert_eq!(for_vault(&note, &[typed]), Some(temp.0.join("Notes")));
    }

    #[test]
    fn within_is_by_component_not_by_text() {
        let base = Path::new("/vault");
        assert!(is_within(Path::new("/vault/notes/one.md"), base));
        assert!(is_within(Path::new("/vault"), base));
        // A sibling whose name starts with the folder's is not inside it.
        assert!(!is_within(Path::new("/vault-old/one.md"), base));
        assert!(!is_within(Path::new("/"), base));
    }

    #[test]
    fn a_path_from_outside_is_made_absolute_where_it_was_given() {
        let cwd = std::env::temp_dir().join("scheda-cwd");
        assert_eq!(
            from_outside(Path::new("notes/one.md"), &cwd),
            cwd.join("notes").join("one.md")
        );
        assert_eq!(
            from_outside(Path::new("notes/../plan.md"), &cwd),
            cwd.join("plan.md")
        );
        let elsewhere = std::env::temp_dir().join("elsewhere").join("two.md");
        assert_eq!(from_outside(&elsewhere, &cwd), elsewhere);
    }

    #[cfg(windows)]
    #[test]
    fn a_path_from_outside_loses_the_verbatim_prefix() {
        // What `canonicalize` answers with on Windows, and what a second launch
        // used to hand the window.
        let cwd = Path::new(r"C:\anywhere");
        assert_eq!(
            from_outside(Path::new(r"\\?\C:\vault\plan.md"), cwd),
            PathBuf::from(r"C:\vault\plan.md")
        );
        assert_eq!(
            from_outside(Path::new(r"\\?\UNC\server\share\plan.md"), cwd),
            PathBuf::from(r"\\server\share\plan.md")
        );
        // And what it names is still there to be read.
        let canonical = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let plain = from_outside(&canonical, cwd);
        assert!(!plain.to_string_lossy().starts_with(r"\\?\"), "{plain:?}");
        assert!(plain.is_dir());
    }

    #[test]
    fn resolves_a_link_beside_the_document() {
        let temp = TempDir::new("beside");
        let note = temp.file("one.md");
        let image = temp.file("picture.png");
        assert_eq!(resolve_link(&temp.0, &note, "picture.png"), Ok(image));
    }

    #[test]
    fn resolves_a_link_through_a_subfolder() {
        let temp = TempDir::new("sub");
        let note = temp.file("one.md");
        let image = temp.file("assets/picture.png");
        assert_eq!(
            resolve_link(&temp.0, &note, "assets/picture.png"),
            Ok(image)
        );
    }

    #[test]
    fn resolves_a_link_that_climbs_but_stays_inside() {
        let temp = TempDir::new("climb");
        let note = temp.file("notes/one.md");
        let image = temp.file("assets/picture.png");
        assert_eq!(
            resolve_link(&temp.0, &note, "../assets/picture.png"),
            Ok(image)
        );
    }

    #[test]
    fn refuses_a_link_that_climbs_out_of_the_root() {
        // The check the whole scope depends on.
        let temp = TempDir::new("escape");
        let note = temp.file("vault/one.md");
        temp.file("secret.txt");
        assert_eq!(
            resolve_link(&temp.0.join("vault"), &note, "../secret.txt"),
            Err(LinkError::OutsideRoot)
        );
    }

    #[test]
    fn refuses_a_long_climb() {
        let temp = TempDir::new("longescape");
        let note = temp.file("vault/one.md");
        assert_eq!(
            resolve_link(&temp.0.join("vault"), &note, "../../../../../../etc/passwd"),
            Err(LinkError::OutsideRoot)
        );
    }

    #[test]
    fn refuses_an_absolute_path() {
        let temp = TempDir::new("absolute");
        let note = temp.file("one.md");
        let absolute = if cfg!(windows) {
            "C:/Windows/win.ini"
        } else {
            "/etc/passwd"
        };
        assert_eq!(
            resolve_link(&temp.0, &note, absolute),
            Err(LinkError::OutsideRoot)
        );
    }

    #[test]
    fn leaves_remote_links_alone() {
        let temp = TempDir::new("remote");
        let note = temp.file("one.md");
        for link in [
            "https://example.com/x.png",
            "http://example.com/x.png",
            "mailto:someone@example.com",
            "data:image/png;base64,AAAA",
        ] {
            assert_eq!(
                resolve_link(&temp.0, &note, link),
                Err(LinkError::NotLocal),
                "{link}"
            );
        }
    }

    #[test]
    fn reports_a_missing_file_as_missing() {
        // Distinct from OutsideRoot on purpose: one is a typo, the other is an
        // attempt, and the difference matters when reporting it.
        let temp = TempDir::new("missing");
        let note = temp.file("one.md");
        assert_eq!(
            resolve_link(&temp.0, &note, "nothing-here.png"),
            Err(LinkError::Missing)
        );
    }

    #[test]
    fn decodes_percent_escapes_in_a_name() {
        let temp = TempDir::new("encoded");
        let note = temp.file("one.md");
        let image = temp.file("my picture.png");
        assert_eq!(resolve_link(&temp.0, &note, "my%20picture.png"), Ok(image));
    }

    #[test]
    fn ignores_a_fragment_after_the_name() {
        let temp = TempDir::new("fragment");
        let note = temp.file("one.md");
        let image = temp.file("picture.png");
        assert_eq!(resolve_link(&temp.0, &note, "picture.png#top"), Ok(image));
    }
}

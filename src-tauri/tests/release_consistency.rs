//! Guards the facts that must agree before a version is tagged.
//!
//! What every product of the line has to agree on - one version in every
//! manifest, one description, one README with absolute links, a documentation
//! site that knows where it lives - is held by `lyrn check`, in the gate and in
//! the shopfronts workflow. A copy of those rules here would be a second
//! opinion that drifts from the first.
//!
//! What is left is scheda's own: the commands its installers are run with, the
//! bundles the release carries for them, and the editor package that goes out
//! with each release and reaches no registry. Nothing fails when one of these
//! is left behind either: the build is green, and the installer answers 404
//! after the tag, which is the one point where it cannot be taken back.

use std::fs;
use std::path::{Path, PathBuf};

/// The repository root: the crate lives one level down, in `src-tauri/`.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn read(path: impl AsRef<Path>) -> String {
    let path = repo_root().join(path);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

#[test]
fn the_editor_packages_readme_links_are_absolute() {
    // The README of the repository is `lyrn check`'s. The editor package's is
    // the page shown wherever the tarball is unpacked and read, away from the
    // repository - where a relative link, or a picture's relative `src`, points
    // at nothing. So it is held to the same rule here.
    let offenders = relative_links("packages/editor/README.md");

    assert!(
        offenders.is_empty(),
        "the editor package's README has relative links, which break wherever \
         it is read outside the repository: {offenders:?}"
    );
}

/// The links in a markdown file that point at something relative to it.
fn relative_links(file: &str) -> Vec<String> {
    let readme = read(file);
    let mut offenders = Vec::new();

    for (number, line) in readme.lines().enumerate() {
        for marker in ["](", "src=\""] {
            let mut rest = line;
            while let Some(at) = rest.find(marker) {
                let target = &rest[at + marker.len()..];
                let end = target
                    .find(if marker == "](" { ')' } else { '"' })
                    .unwrap_or(target.len());
                let target = &target[..end];
                let local = !target.starts_with("http")
                    && !target.starts_with('#')
                    && !target.starts_with("mailto:");
                if local && !target.is_empty() {
                    offenders.push(format!("{file} line {}: {target}", number + 1));
                }
                rest = &rest[at + marker.len()..];
            }
        }
    }
    offenders
}

/// The one-line command an installer's header says to run it with: the line
/// after `installer for …:`, without the comment marker.
fn install_command(file: &str) -> String {
    let script = read(file);
    let mut lines = script.lines();
    lines
        .find(|line| line.contains("installer for"))
        .and_then(|_| lines.next())
        .map(|line| line.trim_start_matches('#').trim().to_string())
        .unwrap_or_else(|| panic!("{file} has no `installer for …:` header naming its command"))
}

#[test]
fn scheda_is_installed_by_the_scripts_and_only_by_them() {
    // Installing is one command per platform (ADR 0015). The README and the
    // getting-started page are where a person copies it from, so both carry
    // exactly the commands the scripts themselves say they are run with - and
    // neither offers a second way in that the scripts know nothing about.
    let commands = [
        install_command("tools/install.ps1"),
        install_command("tools/install.sh"),
    ];
    assert!(commands[0].starts_with("irm https://raw.githubusercontent.com/lacodda/scheda/main/"));
    assert!(
        commands[1]
            .starts_with("curl -fsSL https://raw.githubusercontent.com/lacodda/scheda/main/")
    );

    for page in ["README.md", "docs/src/content/docs/getting-started.md"] {
        let text = read(page);
        for command in &commands {
            assert!(
                text.contains(command.as_str()),
                "{page} does not show `{command}`"
            );
        }
        for other in [
            ".msi",
            ".dmg",
            ".deb",
            ".rpm",
            "npm install",
            "releases page",
        ] {
            // `pnpm install` in a build-from-source block is not npm.
            let offered = text
                .match_indices(other)
                .any(|(at, _)| !text[..at].ends_with('p'));
            assert!(
                !offered,
                "{page} mentions `{other}`, a way to install that the scripts are not"
            );
        }
    }
}

#[test]
fn the_release_carries_what_the_scripts_download() {
    // The release is built with exactly the bundles the installers fetch; one
    // dropped from the build is an installer that answers 404, and one added
    // beside them is a second installer nobody maintains.
    let config = read("src-tauri/tauri.conf.json");
    assert!(
        config.contains(r#""targets": ["nsis", "app", "appimage"]"#),
        "tauri.conf.json bundles something other than the installers' nsis, app and appimage"
    );

    let windows = read("tools/install.ps1");
    assert!(windows.contains("scheda_${version}_x64-setup.exe"));
    let unix = read("tools/install.sh");
    assert!(unix.contains("scheda_${VERSION}_aarch64.app.tar.gz"));
    assert!(unix.contains("scheda_${VERSION}_amd64.AppImage"));

    // The program's archive is packed by the release workflow rather than by
    // Tauri, so nothing above would notice it going: an install apart would
    // answer 404, and the release could not be proven.
    let target = "x86_64-pc-windows-msvc";
    assert!(windows.contains(&format!("$target = \"{target}\"")));
    assert!(windows.contains("scheda-$tag-$target.zip"));
    let workflow = read(".github/workflows/release.yml");
    assert!(workflow.contains("scheda-${tag}-${{ matrix.target }}.zip"));
    assert!(workflow.contains(&format!("target: {target}")));

    // What `furca release verify` holds the page to is what the scripts fetch.
    let release = read("release.toml");
    for asset in [
        "\"scheda_{version}_x64-setup.exe\"",
        "\"scheda-{tag}-x86_64-pc-windows-msvc.zip\"",
        "\"scheda_{version}_aarch64.app.tar.gz\"",
        "\"scheda_{version}_amd64.AppImage\"",
        "\"lacodda-scheda-editor-{version}.tgz\"",
    ] {
        assert!(
            release.contains(asset),
            "release.toml does not list {asset}"
        );
    }
}

#[test]
fn a_scratch_install_leaves_the_path_alone() {
    // `furca release verify --install` installs into a temporary directory. A
    // PATH entry made on the way would outlive the directory, in the registry of
    // whoever checked a release. So the flag is read before any edit of it.
    let windows = read("tools/install.ps1");
    let asked = windows
        .find("if (-not $env:SCHEDA_NO_PATH)")
        .expect("the flag");
    let edited = windows.find("HKCU:\\Environment").expect("the edit");
    assert!(
        asked < edited,
        "install.ps1 edits the PATH before it reads the flag"
    );

    let unix = read("tools/install.sh");
    let asked = unix
        .find("if [ -z \"${SCHEDA_NO_PATH:-}\" ]")
        .expect("the flag");
    let hint = unix.find("to your PATH").expect("the note");
    assert!(
        asked < hint,
        "install.sh talks about the PATH before it reads the flag"
    );
}

#[test]
fn the_windows_installer_closes_no_window() {
    // The release's own installer, run silently, shuts down whatever holds the
    // file it replaces, and a window may hold unsaved text. The program steps
    // aside first (ADR 0022).
    let windows = read("tools/install.ps1");
    let aside = windows
        .find("Move-Item $installed $aside")
        .expect("the step aside");
    let setup = windows
        .find("Start-Process -FilePath $setup")
        .expect("the setup");
    assert!(
        aside < setup,
        "install.ps1 runs the setup before the program steps aside"
    );
}

#[test]
fn the_unix_installer_redirects_windows_shells() {
    // Git Bash on Windows runs install.sh happily; without its own arm the
    // script answers "no build for MINGW64_NT", which reads as "unsupported"
    // although the Windows build is one command away.
    let installer = read("tools/install.sh");
    for shell in ["MINGW*", "MSYS*", "CYGWIN*"] {
        assert!(
            installer.contains(shell),
            "install.sh does not recognise {shell}"
        );
    }
    // The script names the repository once, as $REPO.
    let spelled = installer.replace("$REPO", "lacodda/scheda");
    assert!(
        spelled.contains(&install_command("tools/install.ps1")),
        "install.sh does not hand Windows shells the PowerShell command"
    );
}

#[test]
fn the_editor_package_reaches_no_registry() {
    // The package is attached to each release and installed from there by URL
    // (ADR 0015). `private` is what makes a publish to npm refuse outright, so
    // nothing can send it there by accident - a workflow included.
    let manifest = read("packages/editor/package.json");
    assert!(
        manifest.contains(r#""private": true"#),
        "packages/editor/package.json is not private, so it can be published to a registry"
    );
    assert!(!manifest.contains("publishConfig"));

    let workflows = repo_root().join(".github/workflows");
    for entry in fs::read_dir(&workflows).expect("cannot read the workflows") {
        let path = entry.expect("a workflow").path();
        let text = fs::read_to_string(&path).expect("a readable workflow");
        assert!(
            !text.contains("npm publish") && !text.contains("pnpm publish"),
            "{} publishes to a registry",
            path.display()
        );
    }
}

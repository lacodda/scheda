//! Every window call the webview makes must be allowed by the capability file.
//!
//! scheda draws its own title bar, so moving, resizing, maximising and closing
//! the window are all calls from the webview into the core. Each one is denied
//! unless `capabilities/default.json` names it. Nothing catches a missing
//! permission before the user clicks: the build is green, the button renders,
//! the type checker is happy — and the click is refused at runtime with
//! `Command plugin:window|close not allowed by ACL`.
//!
//! It has now happened twice. `destroy` was missing in v0.2.0 and the window
//! could not be closed; `close` was missing in v0.2.2, when the title bar's own
//! close button started asking the window to close rather than destroying it.
//! Both were found by the owner, in the running app, after a release.
//!
//! So the agreement between the two files is a test. It reads the frontend
//! sources for the window calls they make and requires a matching
//! `core:window:allow-<call>` in the capability file.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// The repository root: the crate lives one level down, in `src-tauri/`.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

/// Calls on the window object that are events or plain reads, not commands
/// gated by the access-control list. Listing them here rather than guessing
/// keeps an unknown call loud: a new name is assumed to need a permission.
const NOT_A_COMMAND: &[&str] = &["onCloseRequested", "onResized", "onMoved", "listen", "once"];

/// The permission name for a call, following Tauri's own convention:
/// `toggleMaximize` is granted by `core:window:allow-toggle-maximize`.
fn permission_for(call: &str) -> String {
    let mut kebab = String::new();
    for ch in call.chars() {
        if ch.is_ascii_uppercase() {
            kebab.push('-');
            kebab.push(ch.to_ascii_lowercase());
        } else {
            kebab.push(ch);
        }
    }
    format!("core:window:allow-{kebab}")
}

/// Collects `.ts` and `.tsx` sources under `src/`, skipping tests: a call in a
/// test never reaches the real window.
fn frontend_sources(dir: &Path, into: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
    {
        let path = entry.expect("readable directory entry").path();
        if path.is_dir() {
            frontend_sources(&path, into);
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.contains(".test.") {
            continue;
        }
        if name.ends_with(".ts") || name.ends_with(".tsx") {
            into.push(path);
        }
    }
}

/// Reads the identifier that begins `text`, or an empty string.
fn identifier(text: &str) -> String {
    text.chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect()
}

/// Finds every window command called in one source file.
///
/// Two spellings reach the same window, and both have to be seen. The direct
/// chain `getCurrentWindow().close()`, and the handle held in a local first —
/// `const window = getCurrentWindow()` followed by `window.isMaximized()`,
/// which is how the title bar reads the maximised state. A scanner that knew
/// only the chain would call that file clean.
fn calls_in(text: &str, into: &mut BTreeSet<String>) {
    const FACTORY: &str = "getCurrentWindow()";

    for (offset, _) in text.match_indices(FACTORY) {
        let after = &text[offset + FACTORY.len()..];
        if let Some(rest) = after.strip_prefix('.') {
            let call = identifier(rest);
            if !call.is_empty() && !NOT_A_COMMAND.contains(&call.as_str()) {
                into.insert(call);
            }
            continue;
        }
        // Not a chain, so the handle is being bound to a name: walk back over
        // `const <name> = ` and take the name.
        let before = text[..offset].trim_end();
        let Some(before) = before.strip_suffix('=') else {
            continue;
        };
        let name: String = before
            .trim_end()
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if name.is_empty() {
            continue;
        }
        // Only to the end of the block the binding lives in. The title bar
        // names its handle `window`, which is also the browser's own global:
        // scanning the whole file for `window.` would read `addEventListener`
        // as a window command and fail on a permission that does not exist.
        for call in calls_on(&text[offset..], &name) {
            into.insert(call);
        }
    }
}

/// Calls on `name` from `text` up to the end of the block it was bound in.
fn calls_on(text: &str, name: &str) -> BTreeSet<String> {
    let mut depth = 0i32;
    let mut end = text.len();
    for (offset, ch) in text.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth < 0 {
                    end = offset;
                    break;
                }
            }
            _ => {}
        }
    }
    let scope = &text[..end];

    let needle = format!("{name}.");
    let mut calls = BTreeSet::new();
    for (offset, _) in scope.match_indices(&needle) {
        // A bare name only, so `myWindow.` cannot answer for `window.`.
        let preceding = scope[..offset].chars().next_back();
        if preceding.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') {
            continue;
        }
        let call = identifier(&scope[offset + needle.len()..]);
        if !call.is_empty() && !NOT_A_COMMAND.contains(&call.as_str()) {
            calls.insert(call);
        }
    }
    calls
}

/// Every window command the frontend calls, however it spells the call.
fn window_calls() -> BTreeSet<String> {
    let mut files = Vec::new();
    frontend_sources(&repo_root().join("src"), &mut files);
    assert!(!files.is_empty(), "no frontend sources found under src/");

    let mut calls = BTreeSet::new();
    for file in files {
        let text = fs::read_to_string(&file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        calls_in(&text, &mut calls);
    }
    calls
}

/// The permissions granted by the capability file, read as plain text: the
/// list is a flat array of strings, and a JSON parser is not worth a
/// dev-dependency here.
fn granted_permissions() -> BTreeSet<String> {
    let path = repo_root().join("src-tauri/capabilities/default.json");
    let text =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let (_, after) = text
        .split_once("\"permissions\"")
        .expect("capabilities/default.json has a `permissions` list");
    let list = after
        .split_once(']')
        .expect("the `permissions` list is closed")
        .0;
    list.split(',')
        .map(|item| item.trim().trim_matches(|c| c == '"' || c == '[').trim())
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

#[test]
fn every_window_call_is_allowed_by_the_capability_file() {
    let granted = granted_permissions();
    let mut missing = Vec::new();
    for call in window_calls() {
        let permission = permission_for(&call);
        if !granted.contains(&permission) {
            missing.push(format!(
                "getCurrentWindow().{call}() needs \"{permission}\""
            ));
        }
    }
    assert!(
        missing.is_empty(),
        "the webview calls window commands the capability file does not allow.\n\
         Each of these is refused at runtime with `not allowed by ACL`:\n  {}\n\
         Add them to src-tauri/capabilities/default.json.",
        missing.join("\n  ")
    );
}

#[test]
fn the_calls_the_title_bar_makes_are_seen() {
    // Guards the scanner itself. If it stopped finding calls — a renamed
    // import, a changed spelling — the check above would pass on an empty set
    // and go on passing while permissions went missing. These four are the
    // window buttons and the drag; they cannot disappear while scheda draws
    // its own title bar.
    let calls = window_calls();
    // `isMaximized` is here on purpose: the title bar calls it on a handle it
    // bound first, so it is only seen by the second half of the scanner.
    for expected in [
        "close",
        "minimize",
        "toggleMaximize",
        "startDragging",
        "isMaximized",
    ] {
        assert!(
            calls.contains(expected),
            "the scanner no longer sees getCurrentWindow().{expected}() — it found {calls:?}"
        );
    }
}

#[test]
fn permission_names_follow_the_tauri_convention() {
    assert_eq!(permission_for("close"), "core:window:allow-close");
    assert_eq!(
        permission_for("toggleMaximize"),
        "core:window:allow-toggle-maximize"
    );
    assert_eq!(
        permission_for("startResizeDragging"),
        "core:window:allow-start-resize-dragging"
    );
}

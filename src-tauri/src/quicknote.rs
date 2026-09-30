//! The quick note: a small window over whatever program is in front, summoned
//! by a system-wide key, that adds one line to a chosen file and goes away.
//!
//! The window is made the first time the key is pressed and hidden rather than
//! closed after that. Making it at startup would put a second webview in front
//! of the first frame of the main window, which is the one thing the order of
//! operations exists to prevent (ADR 0001); making it anew on every press would
//! be a webview start per thought.
//!
//! It lives only as long as scheda does. A notepad that stays resident after
//! its window is closed so that a key keeps working is a background service,
//! and that is not a decision a settings toggle should make for somebody.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// The window's label, and the name its capability file grants to.
pub const LABEL: &str = "quick";

/// What the key is, and whether the system gave it to us.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Status {
    /// The key as the settings hold it; empty when it is turned off.
    pub key: String,
    pub registered: bool,
    /// Why the system refused it — most often, because another program holds
    /// the same key. Shown on the settings screen, where it can be changed.
    pub error: Option<String>,
}

/// The key currently held, so a change can let the old one go first.
#[derive(Default)]
pub struct Held {
    shortcut: Mutex<Option<Shortcut>>,
    status: Mutex<Status>,
}

/// The window's key notation turned into the one the system-wide hook reads.
/// They differ only in what they call the Windows key.
pub fn accelerator(key: &str) -> String {
    key.split('+')
        .map(|part| match part.trim() {
            "Win" | "Meta" => "Super",
            other => other,
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Takes the key the settings name, releasing the one held before. Called at
/// startup and every time the setting changes.
pub fn register(app: &AppHandle, key: &str) -> Status {
    let held = app.state::<Held>();
    let shortcuts = app.global_shortcut();
    if let Some(previous) = held.shortcut.lock().expect("shortcut lock").take() {
        let _ = shortcuts.unregister(previous);
    }

    let key = key.trim().to_string();
    let status = if key.is_empty() {
        Status {
            key,
            registered: false,
            error: None,
        }
    } else {
        match accelerator(&key).parse::<Shortcut>() {
            Err(error) => Status {
                key,
                registered: false,
                error: Some(format!("not a key scheda can register: {error}")),
            },
            Ok(shortcut) => match shortcuts.register(shortcut) {
                Ok(()) => {
                    *held.shortcut.lock().expect("shortcut lock") = Some(shortcut);
                    Status {
                        key,
                        registered: true,
                        error: None,
                    }
                }
                Err(error) => Status {
                    key,
                    registered: false,
                    error: Some(format!("the system refused it: {error}")),
                },
            },
        }
    };
    *held.status.lock().expect("status lock") = status.clone();
    status
}

pub fn status(app: &AppHandle) -> Status {
    app.state::<Held>()
        .status
        .lock()
        .expect("status lock")
        .clone()
}

/// Brings the window up, making it the first time.
pub fn show(app: &AppHandle) -> tauri::Result<()> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick.html".into()))
            .title("Quick note")
            .inner_size(560.0, 168.0)
            .resizable(false)
            .decorations(false)
            .shadow(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build()?,
    };
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_windows_key_is_called_super_for_the_hook() {
        assert_eq!(accelerator("Win+Shift+N"), "Super+Shift+N");
        assert_eq!(accelerator("Ctrl+Alt+Space"), "Ctrl+Alt+Space");
        // Every key the window can record parses on the other side.
        for key in [
            "Win+Shift+N",
            "Ctrl+Shift+Space",
            "Alt+`",
            "Ctrl+\\",
            "Win+F9",
        ] {
            assert!(accelerator(key).parse::<Shortcut>().is_ok(), "{key}");
        }
    }
}

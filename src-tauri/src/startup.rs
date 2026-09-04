//! Cold start, measured rather than argued about.
//!
//! The promise of scheda is that the text is on screen before you notice the
//! window, and the plan puts a hard threshold on it. A threshold nobody
//! measures is a wish, so the process clock starts on the first line of `main`
//! and the frontend reports back the moment it painted the first character.
//!
//! `SCHEDA_STARTUP_LOG` turns that into output. On Windows a release build is a
//! GUI subsystem binary with no console attached, so `stdout` goes nowhere and
//! a measurement read from it would be a measurement of nothing: set the
//! variable to a path and the timings are appended to that file instead.

use std::io::Write;
use std::sync::OnceLock;
use std::time::Instant;

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Marks the earliest instant the core can observe. Called first thing in
/// `main`, before a window, a plugin or a runtime exists.
pub fn mark_process_start() {
    let _ = PROCESS_START.set(Instant::now());
}

/// Milliseconds since [`mark_process_start`].
pub fn elapsed_ms() -> f64 {
    PROCESS_START
        .get()
        .map(|start| start.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Where the timings go, if anywhere. `1` (or any non-path value) means stdout,
/// which is useful in a dev build; a path means that file, which is the only
/// thing that works for a released Windows build.
fn destination() -> Option<std::ffi::OsString> {
    std::env::var_os("SCHEDA_STARTUP_LOG")
}

/// Writes one timing line when logging is on. Silent otherwise: a released
/// build has no business writing anything on every launch.
pub fn log(stage: &str, ms: f64) {
    let Some(target) = destination() else { return };
    let line = format!("scheda startup: {stage} {ms:.1} ms\n");

    let path = std::path::Path::new(&target);
    // A bare `1` is not a path anyone means to write to; treat only something
    // that looks like a file as one.
    if path.extension().is_some() {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = file.write_all(line.as_bytes());
        }
        return;
    }

    print!("{line}");
}

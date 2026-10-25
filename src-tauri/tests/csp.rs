//! The window's content security policy lets Tauri's own IPC protocol through.
//!
//! Every command the webview sends the core travels over a custom protocol,
//! `ipc://localhost` (`http://ipc.localhost` on Windows). With nothing but
//! `default-src 'self'` the policy refused it, the webview said so once in its
//! console - "IPC custom protocol failed, Tauri will now use the postMessage
//! interface instead" - and every command went the slow way from then on.
//! Nothing else noticed: the commands still answered, only later. furca found
//! it in its console, and scheda had the same line.
//!
//! So the policy is read here, directive by directive.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

/// The window's policy, as a map from directive to its sources.
fn policy() -> BTreeMap<String, Vec<String>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let config: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("tauri.conf.json"))
            .expect("tauri.conf.json is JSON");
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("tauri.conf.json states a content security policy");
    csp.split(';')
        .filter_map(|directive| {
            let mut words = directive.split_whitespace();
            let name = words.next()?.to_string();
            Some((name, words.map(str::to_string).collect()))
        })
        .collect()
}

#[test]
fn the_ipc_protocol_is_allowed_on_every_platform() {
    let policy = policy();
    let connect = policy.get("connect-src").expect(
        "no connect-src: the IPC protocol falls back to default-src 'self', which refuses it",
    );
    for source in ["ipc:", "http://ipc.localhost"] {
        assert!(
            connect.iter().any(|s| s == source),
            "connect-src does not allow {source}, so commands fall back to postMessage there"
        );
    }
}

#[test]
fn everything_else_stays_with_the_window() {
    let policy = policy();
    assert_eq!(policy["default-src"], ["'self'"]);
    // Pictures come through the scoped asset protocol and nowhere else (ADR 0004).
    assert_eq!(
        policy["img-src"],
        ["'self'", "asset:", "http://asset.localhost"]
    );
    // The connection allowed for the IPC is that and nothing more: a wider one
    // would let a note's content reach the network.
    assert_eq!(policy["connect-src"], ["ipc:", "http://ipc.localhost"]);
}

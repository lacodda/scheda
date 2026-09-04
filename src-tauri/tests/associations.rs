//! The registration has one property that matters more than the rest: it
//! offers scheda for markdown without taking the type away from anyone.
//!
//! That is easy to get wrong and invisible when you do — the app appears in
//! "Open with", everything looks right, and meanwhile the editor the user had
//! chosen has quietly lost the association. So the test registers for real,
//! against the live registry, and checks what happened to a neighbour.
//!
//! Windows only: there is nothing to register anywhere else.
#![cfg(windows)]

use scheda_lib::associations;
use std::path::PathBuf;
use windows_registry::CURRENT_USER;

/// A ProgID no real application uses, standing in for the editor that was
/// already registered for `.md` on the user's machine.
const NEIGHBOUR: &str = "scheda.test.neighbour";

const OUR_PROGID: &str = "lacodda.scheda.markdown";

/// Puts a neighbour entry into `.md`'s handler list, as another editor would.
fn add_neighbour() {
    CURRENT_USER
        .create(r"Software\Classes\.md\OpenWithProgids")
        .expect("cannot open the handler list")
        .set_string(NEIGHBOUR, "")
        .expect("cannot add the neighbour");
}

fn neighbour_is_present() -> bool {
    CURRENT_USER
        .open(r"Software\Classes\.md\OpenWithProgids")
        .is_ok_and(|key| key.get_type(NEIGHBOUR).is_ok())
}

fn remove_neighbour() {
    if let Ok(key) = CURRENT_USER
        .options()
        .read()
        .write()
        .open(r"Software\Classes\.md\OpenWithProgids")
    {
        let _ = key.remove_value(NEIGHBOUR);
    }
}

/// Whether the extension key claims a type outright, which is the thing this
/// registration must never do.
fn claimed_type(extension: &str) -> Option<String> {
    CURRENT_USER
        .open(format!(r"Software\Classes\.{extension}"))
        .ok()
        .and_then(|key| key.get_string("").ok())
        .filter(|value| !value.is_empty())
}

/// The whole lifecycle in one test.
///
/// These share one global resource — the user's registry — so splitting them
/// into separate `#[test]` functions would let cargo run them concurrently and
/// have one's cleanup undo another's setup.
#[test]
fn registration_offers_the_type_without_seizing_it() {
    let exe = PathBuf::from(r"C:\nonexistent\scheda.exe");

    let claimed_before: Vec<_> = associations::EXTENSIONS
        .iter()
        .filter_map(|extension| claimed_type(extension).map(|value| (*extension, value)))
        .collect();

    add_neighbour();
    associations::register(&exe).expect("registration failed");

    // The offer is there.
    let handlers = CURRENT_USER
        .open(r"Software\Classes\.md\OpenWithProgids")
        .expect("the handler list is missing");
    assert!(
        handlers.get_type(OUR_PROGID).is_ok(),
        "scheda did not appear in the handler list for .md"
    );

    // And so is everyone else's.
    assert!(
        neighbour_is_present(),
        "registering took another editor out of the handler list for .md"
    );

    // Nothing was claimed that was not claimed before.
    for extension in associations::EXTENSIONS {
        let after = claimed_type(extension);
        let before = claimed_before
            .iter()
            .find(|(name, _)| *name == extension)
            .map(|(_, value)| value.clone());
        assert_eq!(
            after, before,
            ".{extension} changed its claimed type; registering must offer, not seize"
        );
    }

    // The application entry and the capabilities are what put scheda in the
    // "Open with" list and in Settings.
    assert!(
        CURRENT_USER
            .open(r"Software\Classes\Applications\scheda.exe")
            .is_ok(),
        "the application entry is missing, so Open with has nothing to list"
    );
    assert_eq!(
        CURRENT_USER
            .open(r"Software\RegisteredApplications")
            .and_then(|key| key.get_string("scheda"))
            .as_deref()
            .ok(),
        Some(r"Software\lacodda\scheda\Capabilities"),
        "scheda is not announced to the default-apps UI"
    );

    // Removal takes ours away and leaves the neighbour alone.
    associations::unregister().expect("unregistration failed");

    let handlers = CURRENT_USER.open(r"Software\Classes\.md\OpenWithProgids");
    if let Ok(handlers) = handlers {
        assert!(
            handlers.get_type(OUR_PROGID).is_err(),
            "unregistering left scheda in the handler list"
        );
    }
    assert!(
        neighbour_is_present(),
        "unregistering took another editor out of the handler list"
    );
    assert!(
        CURRENT_USER
            .open(r"Software\Classes\Applications\scheda.exe")
            .is_err(),
        "unregistering left the application entry behind"
    );

    remove_neighbour();
}

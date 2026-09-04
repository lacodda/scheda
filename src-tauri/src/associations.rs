//! Telling Windows that scheda can open markdown, and taking it back.
//!
//! Everything here writes under `HKEY_CURRENT_USER`, so it needs no
//! administrator and touches nothing another account depends on.
//!
//! Windows deliberately does not let a program make itself the default handler
//! for a file type — that setting belongs to the user, and the API to force it
//! has been closed since Windows 8. What an installer *can* do is register the
//! application properly, so scheda appears in "Open with" and in Settings'
//! default-apps list; picking it there is one click and it sticks.
//!
//! The distinction that matters here is offering a type versus seizing it.
//! Writing an extension key's default value claims the type outright, taking
//! `.md` away from whichever editor the user had chosen — which is what the
//! NSIS template's own `APP_ASSOCIATE` macro does, and why scheda registers its
//! types from here instead of through `fileAssociations`.

use std::path::Path;
use windows_registry::CURRENT_USER;
use windows_result::Error as RegistryError;

/// The ProgID scheda registers its file types under. The vendor prefix is what
/// keeps ProgIDs from colliding across applications that share a name.
const PROGID: &str = "lacodda.scheda.markdown";

/// Where "Open with" and the default-apps page read the application from.
const APPLICATION_KEY: &str = r"Software\Classes\Applications\scheda.exe";

/// The capabilities entry that puts scheda in Settings > Default apps.
const CAPABILITIES_KEY: &str = r"Software\lacodda\scheda\Capabilities";

/// The extensions scheda offers to open.
///
/// `.txt` is deliberately absent: scheda is a markdown notepad, and claiming
/// plain text as well would take a type the user very likely has pointed
/// somewhere on purpose.
pub const EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// What Explorer shows in the Type column.
const TYPE_NAME: &str = "Markdown document";

#[derive(Debug, thiserror::Error)]
pub enum AssociationError {
    #[error("{context}: {source}")]
    Registry {
        context: String,
        source: RegistryError,
    },
    /// Removal collects every failure rather than stopping at the first: a
    /// half-removed registration is worse than a reported error.
    #[error("some registry entries could not be removed:\n  {0}")]
    Incomplete(String),
}

fn wrap(context: impl Into<String>) -> impl FnOnce(RegistryError) -> AssociationError {
    move |source| AssociationError::Registry {
        context: context.into(),
        source,
    }
}

/// Write every registry key the shell reads.
pub fn register(exe: &Path) -> Result<(), AssociationError> {
    let exe = exe.to_string_lossy().to_string();
    let open_command = format!("\"{exe}\" \"%1\"");

    // The ProgID: what a file of this type is, and how to open it.
    let progid = CURRENT_USER
        .create(format!(r"Software\Classes\{PROGID}"))
        .map_err(wrap("creating the ProgID key"))?;
    progid
        .set_string("", TYPE_NAME)
        .map_err(wrap("the type name"))?;
    progid
        .set_string("FriendlyTypeName", TYPE_NAME)
        .map_err(wrap("the friendly type name"))?;
    CURRENT_USER
        .create(format!(r"Software\Classes\{PROGID}\DefaultIcon"))
        .map_err(wrap("creating the icon key"))?
        .set_string("", format!("\"{exe}\",0"))
        .map_err(wrap("the document icon"))?;
    CURRENT_USER
        .create(format!(r"Software\Classes\{PROGID}\shell\open\command"))
        .map_err(wrap("creating the open command key"))?
        .set_string("", &open_command)
        .map_err(wrap("the open command"))?;

    // The application entry: this is what "Open with" lists.
    let application = CURRENT_USER
        .create(APPLICATION_KEY)
        .map_err(wrap("creating the application key"))?;
    application
        .set_string("FriendlyAppName", "scheda")
        .map_err(wrap("the application name"))?;
    CURRENT_USER
        .create(format!(r"{APPLICATION_KEY}\shell\open\command"))
        .map_err(wrap("creating the application open command"))?
        .set_string("", &open_command)
        .map_err(wrap("the application open command"))?;

    // Capabilities: what puts scheda in Settings > Default apps.
    let capabilities = CURRENT_USER
        .create(CAPABILITIES_KEY)
        .map_err(wrap("creating the capabilities key"))?;
    capabilities
        .set_string("ApplicationName", "scheda")
        .map_err(wrap("the capability name"))?;
    capabilities
        .set_string(
            "ApplicationDescription",
            "A markdown notepad that turns into a vault when there is a folder around it.",
        )
        .map_err(wrap("the capability description"))?;

    let associations = CURRENT_USER
        .create(format!(r"{CAPABILITIES_KEY}\FileAssociations"))
        .map_err(wrap("creating the file associations key"))?;
    let supported = CURRENT_USER
        .create(format!(r"{APPLICATION_KEY}\SupportedTypes"))
        .map_err(wrap("creating the supported types key"))?;

    for extension in EXTENSIONS {
        let dotted = format!(".{extension}");

        // Offer the type without seizing it: `OpenWithProgids` adds an entry to
        // the "Open with" list, whereas writing the key's default value would
        // claim the type outright and take it from another editor.
        CURRENT_USER
            .create(format!(r"Software\Classes\{dotted}\OpenWithProgids"))
            .map_err(wrap(format!("registering {dotted}")))?
            .set_string(PROGID, "")
            .map_err(wrap(format!("offering {dotted}")))?;

        associations
            .set_string(&dotted, PROGID)
            .map_err(wrap(format!("associating {dotted}")))?;
        // An empty string is the documented value here; the name is the point.
        supported
            .set_string(&dotted, "")
            .map_err(wrap(format!("supporting {dotted}")))?;
    }

    // Registering under this key is what makes Windows show the capabilities
    // above in the default-apps UI.
    CURRENT_USER
        .create(r"Software\RegisteredApplications")
        .map_err(wrap("opening the registered applications key"))?
        .set_string("scheda", CAPABILITIES_KEY)
        .map_err(wrap("registering the application"))?;

    notify_shell();
    Ok(())
}

/// Undo everything [`register`] wrote.
pub fn unregister() -> Result<(), AssociationError> {
    let mut failures = Vec::new();

    for extension in EXTENSIONS {
        let path = format!(r"Software\Classes\.{extension}\OpenWithProgids");
        // Removing a value needs write access; the plain `open` is read-only,
        // and asking for less than the operation needs fails with a bare
        // "access denied" that reads like a permissions problem.
        let Ok(key) = CURRENT_USER.options().read().write().open(&path) else {
            continue;
        };
        // A value that was never written is not a failure to report. Only our
        // own entry is touched — the neighbours in this key belong to other
        // editors, and removing the key itself would take them with it.
        if key.get_type(PROGID).is_ok() {
            if let Err(error) = key.remove_value(PROGID) {
                failures.push(format!("{path}: {error}"));
            }
        }
    }

    let trees = [
        format!(r"Software\Classes\{PROGID}"),
        APPLICATION_KEY.to_string(),
        r"Software\lacodda\scheda".to_string(),
    ];
    for tree in trees {
        if CURRENT_USER.open(&tree).is_ok() {
            if let Err(error) = CURRENT_USER.remove_tree(&tree) {
                failures.push(format!("{tree}: {error}"));
            }
        }
    }

    if let Ok(registered) = CURRENT_USER
        .options()
        .read()
        .write()
        .open(r"Software\RegisteredApplications")
    {
        if registered.get_string("scheda").is_ok() {
            if let Err(error) = registered.remove_value("scheda") {
                failures.push(format!("RegisteredApplications: {error}"));
            }
        }
    }

    notify_shell();

    if failures.is_empty() {
        Ok(())
    } else {
        Err(AssociationError::Incomplete(failures.join("\n  ")))
    }
}

/// Tell Explorer the associations changed, so a new entry shows up without a
/// sign-out. Best-effort courtesy: nothing here is wrong if it does not arrive.
fn notify_shell() {
    use windows::Win32::UI::Shell::{SHCNE_ASSOCCHANGED, SHCNF_IDLIST, SHChangeNotify};

    // Safe: the two pointers are null, which SHChangeNotify documents as "no
    // specific item" for SHCNE_ASSOCCHANGED. Nothing is read back.
    #[allow(unsafe_code)]
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
}

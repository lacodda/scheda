//! The files scheda keeps in its own directories, and how a file written by
//! another version of scheda is read.
//!
//! Three files are JSON and change shape as scheda grows: the settings, the
//! session and the index of each vault. Each carries the number of its format,
//! written first, and is read and written here and nowhere else (ADR 0016).
//!
//! - **An older file is brought up to date** a step at a time, `n` to `n + 1`,
//!   on the JSON itself before it becomes a struct. A file with no number was
//!   written before formats were numbered, and is format 0.
//! - **A newer file is never written over.** It is read as far as this build
//!   understands it, and every later write to it is refused here, by the one
//!   function that writes. A person who went back to an older release finds
//!   their newer files as they left them when they come forward again.
//! - **A migrated file leaves a copy** of what it started as beside it, under
//!   its format number (`settings.0.json`), the first time it is written in
//!   the new format. A step that turned out wrong then costs a rename, not the
//!   person's settings.
//!
//! Every format that shipped has a sample in `tests/formats`, and the tests at
//! the bottom of this file hold each one: older samples migrate to what the
//! current one says, the writer's output is the current sample, and a sample
//! that shipped cannot be edited without the manifest beside it saying so.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

/// One step of a migration: turns the fields of format `n` into those of
/// format `n + 1`. It works on the JSON, because the struct that read format
/// `n` no longer exists in the build that runs it.
pub type Step = fn(&mut Map<String, Value>);

/// What one kind of file is, as far as its formats go.
pub struct Kind {
    /// What the file is called in a message.
    pub name: &'static str,
    /// The oldest format this build can read. A file of an older one is not
    /// understood at all.
    pub first: u32,
    /// The format this build writes.
    pub current: u32,
    /// `steps[i]` takes format `first + i` to `first + i + 1`; there is one
    /// for every format between `first` and `current`.
    pub steps: &'static [Step],
    /// Indented for a person to read and edit, or packed for a file only
    /// scheda reads.
    pub pretty: bool,
}

/// What was on disk.
#[derive(Debug, PartialEq)]
pub enum Found<T> {
    /// Nothing: the first run.
    Missing,
    /// A file of this build's format, or one brought up to it.
    Read(T),
    /// A file written by a newer scheda. `value` is what this build makes of
    /// it, when it makes anything; the file itself is not to be written over.
    Newer { format: u32, value: Option<T> },
}

#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("the {name} file is not valid JSON: {source}")]
    Malformed {
        name: &'static str,
        source: serde_json::Error,
    },
    #[error("the {name} file is in format {format}, older than any this version reads")]
    TooOld { name: &'static str, format: u32 },
}

#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("the {name} file was written by a newer scheda (format {format}) and is left as it is")]
    Newer { name: &'static str, format: u32 },
}

/// Only the number, for a look at a file without reading the rest into
/// anything.
#[derive(Deserialize)]
struct Probe {
    format: Option<u32>,
}

/// A value with its format number written first.
#[derive(Serialize)]
struct Stamped<'a, T> {
    format: u32,
    #[serde(flatten)]
    value: &'a T,
}

/// A byte-order mark is not JSON, and Notepad on an older Windows puts one at
/// the front of every file it saves — and the settings are meant to be edited
/// by hand.
fn without_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)
}

/// The format number when it is the first thing in the file, as everything
/// this module writes has it; `None` when the file does not start that way.
///
/// The index of a large vault is tens of megabytes and is written after every
/// change the watcher reports. Asking it for its number by parsing all of it
/// would cost more than the write.
fn format_at_front(bytes: &[u8]) -> Option<u32> {
    let rest = without_bom(bytes).trim_ascii_start().strip_prefix(b"{")?;
    let rest = rest.trim_ascii_start().strip_prefix(b"\"format\"")?;
    let rest = rest.trim_ascii_start().strip_prefix(b":")?;
    let rest = rest.trim_ascii_start();
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    if digits == 0 || digits > 9 {
        return None;
    }
    // A number has to end where a number ends; `"format": 1x` is not one.
    match rest.get(digits) {
        Some(b',' | b'}' | b' ' | b'\t' | b'\r' | b'\n') => {}
        _ => return None,
    }
    std::str::from_utf8(&rest[..digits]).ok()?.parse().ok()
}

/// The format of a file's bytes. A file with no number is format 0.
fn format_of(bytes: &[u8], kind: &Kind) -> Result<u32, ReadError> {
    if let Some(format) = format_at_front(bytes) {
        return Ok(format);
    }
    let probe: Probe =
        serde_json::from_slice(without_bom(bytes)).map_err(|source| ReadError::Malformed {
            name: kind.name,
            source,
        })?;
    Ok(probe.format.unwrap_or(0))
}

/// The format of the file at `path`, or `None` when there is no file or it
/// does not parse. Reads the first bytes and stops there when the number is in
/// them, which it is in every file this module wrote.
fn format_on_disk(path: &Path, kind: &Kind) -> std::io::Result<Option<u32>> {
    use std::io::Read as _;
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::with_capacity(64);
    (&mut file).take(64).read_to_end(&mut bytes)?;
    if let Some(format) = format_at_front(&bytes) {
        return Ok(Some(format));
    }
    file.read_to_end(&mut bytes)?;
    Ok(format_of(&bytes, kind).ok())
}

/// A step for a format that only gained its number: format 0 of a file that
/// was already in the shape its format 1 froze.
pub fn numbered(_fields: &mut Map<String, Value>) {}

/// Reads a file of `kind`, bringing an older format up to this build's.
pub fn read<T: DeserializeOwned>(path: &Path, kind: &Kind) -> Result<Found<T>, ReadError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Found::Missing),
        Err(error) => return Err(error.into()),
    };
    parse(&bytes, kind)
}

/// Reads the bytes of a file of `kind`; [`read`] without the disk.
pub fn parse<T: DeserializeOwned>(bytes: &[u8], kind: &Kind) -> Result<Found<T>, ReadError> {
    let bytes = without_bom(bytes);
    let malformed = |source| ReadError::Malformed {
        name: kind.name,
        source,
    };
    let format = format_of(bytes, kind)?;

    if format > kind.current {
        // Read as this build reads its own, which ignores fields it does not
        // know. What it cannot read at all is nothing, not an error: the file
        // is fine, this build is the one that is behind.
        let value = serde_json::from_slice(bytes).ok();
        return Ok(Found::Newer { format, value });
    }
    if format == kind.current {
        // The usual case, and the one a large index takes: straight into the
        // struct, which ignores the number, without a tree of values between.
        return serde_json::from_slice(bytes)
            .map(Found::Read)
            .map_err(malformed);
    }
    if format < kind.first {
        return Err(ReadError::TooOld {
            name: kind.name,
            format,
        });
    }

    let value: Value = serde_json::from_slice(bytes).map_err(malformed)?;
    let Value::Object(mut fields) = value else {
        return Err(malformed(serde::de::Error::custom("expected an object")));
    };
    for from in format..kind.current {
        let step = kind.steps[(from - kind.first) as usize];
        step(&mut fields);
    }
    fields.remove("format");
    serde_json::from_value(Value::Object(fields))
        .map(Found::Read)
        .map_err(malformed)
}

/// The bytes of a value of `kind` in this build's format, as [`write`] puts
/// them on disk.
pub fn render<T: Serialize>(value: &T, kind: &Kind) -> Result<Vec<u8>, serde_json::Error> {
    let stamped = Stamped {
        format: kind.current,
        value,
    };
    if kind.pretty {
        serde_json::to_vec_pretty(&stamped)
    } else {
        serde_json::to_vec(&stamped)
    }
}

/// Where a file of format `format` is kept once it has been migrated away
/// from: `settings.json` → `settings.0.json`.
pub fn kept_copy(path: &Path, format: u32) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!("{stem}.{format}.json"))
}

/// Writes a value of `kind` to `path`, whole and atomically.
///
/// Refuses when the file there was written by a newer scheda. When it was
/// written by an older one, a copy of it is kept first, unless one of that
/// format is already there — the first migration's copy is the one worth
/// keeping. A file that does not parse is written over: it was not readable
/// either, and the reader has already said so.
pub fn write<T: Serialize>(path: &Path, kind: &Kind, value: &T) -> Result<(), WriteError> {
    if let Some(format) = format_on_disk(path, kind)? {
        if format > kind.current {
            return Err(WriteError::Newer {
                name: kind.name,
                format,
            });
        }
        if format < kind.current {
            let copy = kept_copy(path, format);
            if !copy.exists() {
                std::fs::copy(path, &copy)?;
            }
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = render(value, kind)?;
    // Through a temporary file in the same directory, then a rename: a file
    // cut short by a crash mid-write reads as corrupt on the next launch, and
    // the rename is atomic on every platform scheda runs on.
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod frozen;

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    #[serde(default, rename_all = "camelCase")]
    struct Sample {
        font_size: u32,
        name: String,
    }

    fn rename_font_size(fields: &mut Map<String, Value>) {
        if let Some(value) = fields.remove("font_size") {
            fields.insert("fontSize".into(), value);
        }
    }

    const SAMPLE: Kind = Kind {
        name: "sample",
        first: 0,
        current: 1,
        steps: &[rename_font_size],
        pretty: true,
    };

    #[test]
    fn the_number_is_found_at_the_front_without_reading_the_rest() {
        assert_eq!(format_at_front(br#"{"format":12,"x":1}"#), Some(12));
        assert_eq!(format_at_front(b"{\n  \"format\": 3\n}"), Some(3));
        assert_eq!(format_at_front(b"\xEF\xBB\xBF{\"format\":1}"), Some(1));
        // Not at the front, or not a number: the full reading decides.
        assert_eq!(format_at_front(br#"{"x":1,"format":2}"#), None);
        assert_eq!(format_at_front(br#"{"format":"2"}"#), None);
        assert_eq!(format_at_front(br#"{"format":2x}"#), None);
        assert_eq!(format_at_front(br#"{"formats":2}"#), None);
    }

    #[test]
    fn a_file_with_no_number_is_format_zero_and_is_migrated() {
        let found: Found<Sample> = parse(br#"{"font_size":17,"name":"a"}"#, &SAMPLE).unwrap();
        assert_eq!(
            found,
            Found::Read(Sample {
                font_size: 17,
                name: "a".into()
            })
        );
    }

    #[test]
    fn a_number_that_is_not_at_the_front_still_counts() {
        let found: Found<Sample> = parse(br#"{"fontSize":9,"format":1}"#, &SAMPLE).unwrap();
        assert_eq!(
            found,
            Found::Read(Sample {
                font_size: 9,
                ..Default::default()
            })
        );
    }

    #[test]
    fn a_newer_file_is_read_as_far_as_it_is_understood() {
        let found: Found<Sample> =
            parse(br#"{"format":7,"fontSize":20,"colour":"red"}"#, &SAMPLE).unwrap();
        assert_eq!(
            found,
            Found::Newer {
                format: 7,
                value: Some(Sample {
                    font_size: 20,
                    ..Default::default()
                })
            }
        );
        // A newer file this build cannot read at all is still not an error.
        let found: Found<Sample> = parse(br#"{"format":7,"fontSize":"big"}"#, &SAMPLE).unwrap();
        assert_eq!(
            found,
            Found::Newer {
                format: 7,
                value: None
            }
        );
    }

    #[test]
    fn a_format_older_than_the_first_is_refused() {
        let kind = Kind { first: 1, ..SAMPLE };
        let result = parse::<Sample>(br#"{"fontSize":1}"#, &kind);
        assert!(matches!(result, Err(ReadError::TooOld { format: 0, .. })));
    }

    #[test]
    fn the_number_is_written_first() {
        let bytes = render(
            &Sample {
                font_size: 3,
                name: "b".into(),
            },
            &SAMPLE,
        )
        .unwrap();
        assert_eq!(format_at_front(&bytes), Some(1));
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("{\n  \"format\": 1,\n  \"fontSize\": 3"));
    }

    #[test]
    fn a_newer_file_is_never_written_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.json");
        let newer = br#"{"format":2,"fontSize":30,"colour":"red"}"#;
        std::fs::write(&path, newer).unwrap();

        let result = write(&path, &SAMPLE, &Sample::default());
        assert!(matches!(result, Err(WriteError::Newer { format: 2, .. })));
        assert_eq!(std::fs::read(&path).unwrap(), newer);
    }

    #[test]
    fn a_migrated_file_keeps_a_copy_of_what_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.json");
        let old = br#"{"font_size":17}"#;
        std::fs::write(&path, old).unwrap();

        let Found::Read(value) = read::<Sample>(&path, &SAMPLE).unwrap() else {
            panic!("an old file reads");
        };
        write(&path, &SAMPLE, &value).unwrap();
        assert_eq!(std::fs::read(kept_copy(&path, 0)).unwrap(), old);

        // Written again, now in the current format: the copy stays the one
        // from before the migration.
        write(&path, &SAMPLE, &Sample::default()).unwrap();
        assert_eq!(std::fs::read(kept_copy(&path, 0)).unwrap(), old);
        assert_eq!(dir.path().join("sample.0.json"), kept_copy(&path, 0));
    }

    #[test]
    fn a_missing_file_is_missing_and_a_broken_one_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.json");
        assert_eq!(read::<Sample>(&path, &SAMPLE).unwrap(), Found::Missing);

        std::fs::write(&path, b"{ not json").unwrap();
        assert!(matches!(
            read::<Sample>(&path, &SAMPLE),
            Err(ReadError::Malformed { .. })
        ));
        // A broken file is written over: it was not readable anyway.
        write(&path, &SAMPLE, &Sample::default()).unwrap();
        assert!(matches!(
            read::<Sample>(&path, &SAMPLE).unwrap(),
            Found::Read(_)
        ));
    }
}

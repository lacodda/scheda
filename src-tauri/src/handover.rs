//! What a second launch hands the running window, held until the window hears.
//!
//! A second launch with a file passes it to the window that is already open
//! (ADR 0001: one window, tabs). The core reads the file and tells the window
//! with an event - but the part of the window that listens is the shell, which
//! loads after the first character is painted, on purpose. An event sent before
//! it listens reaches nobody. Two files selected in Explorer and opened with
//! `Enter` start two processes at once, and the second file was simply never
//! opened: no tab, no error.
//!
//! So nothing is sent until the window says it is listening. Until then each
//! handover waits here; the window, having started to listen, takes what has
//! waited, and everything after is sent as it comes. One lock decides for each
//! handover whether it waits or goes, so none is lost between the two and none
//! arrives twice.

use std::sync::Mutex;

/// The handovers a window has not heard yet, or nothing once it listens.
pub struct Mailbox<T>(Mutex<Option<Vec<T>>>);

impl<T> Default for Mailbox<T> {
    fn default() -> Self {
        Self(Mutex::new(Some(Vec::new())))
    }
}

impl<T> Mailbox<T> {
    /// Keeps `item` for the window if it is not listening yet; hands it back to
    /// be sent now if it is.
    pub fn offer(&self, item: T) -> Option<T> {
        let mut waiting = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match waiting.as_mut() {
            Some(queue) => {
                queue.push(item);
                None
            }
            None => Some(item),
        }
    }

    /// The window listens from now on: what waited, in the order it came.
    /// Asked again - a reloaded page - it answers with nothing, since
    /// everything since went out as it came.
    pub fn listening(&self) -> Vec<T> {
        let mut waiting = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        waiting.take().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_comes_before_the_window_listens_waits() {
        let mailbox = Mailbox::default();
        assert_eq!(mailbox.offer("first"), None);
        assert_eq!(mailbox.offer("second"), None);
        assert_eq!(mailbox.listening(), vec!["first", "second"]);
    }

    #[test]
    fn what_comes_after_goes_at_once() {
        let mailbox = Mailbox::default();
        assert!(mailbox.listening().is_empty());
        assert_eq!(mailbox.offer("late"), Some("late"));
    }

    #[test]
    fn nothing_arrives_twice() {
        let mailbox = Mailbox::default();
        mailbox.offer("held");
        assert_eq!(mailbox.listening(), vec!["held"]);
        // A reloaded page asks again: what it was given is not given again.
        assert!(mailbox.listening().is_empty());
        assert_eq!(mailbox.offer("next"), Some("next"));
    }

    #[test]
    fn none_is_lost_while_both_sides_race() {
        // Launches arriving on one thread while the window starts to listen on
        // another: every item is either taken from the box or handed back.
        let mailbox = std::sync::Arc::new(Mailbox::default());
        let sender = {
            let mailbox = mailbox.clone();
            std::thread::spawn(move || {
                (0..1000)
                    .filter_map(|n| mailbox.offer(n))
                    .collect::<Vec<_>>()
            })
        };
        std::thread::yield_now();
        let waited = mailbox.listening();
        let sent = sender.join().expect("the sending thread");
        let mut all: Vec<_> = waited.into_iter().chain(sent).collect();
        all.sort_unstable();
        assert_eq!(all, (0..1000).collect::<Vec<_>>());
    }
}

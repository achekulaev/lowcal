//! Reusable “quiet period” detection for [`tokio::sync::broadcast`] receivers.

use std::time::{Duration, Instant};

use tokio::sync::broadcast;
use tokio::sync::broadcast::error::TryRecvError;

/// Normal completion of [`wait_until_broadcast_receiver_idle`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BroadcastIdleOutcome {
    /// No new messages for `idle` (see `must_receive_before_idle` for when the clock starts).
    Stabilized,
    /// `max_wait` elapsed before the quiet period was observed.
    MaxWaitElapsed {
        /// Whether at least one message was ever received (or resumed after `Lagged`).
        received_any_message: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BroadcastIdleWaitError {
    /// All senders have been dropped.
    ChannelClosed,
}

/// Polls `receiver` until either the channel has been **quiet** for `idle`, or `max_wait` passes.
///
/// **Quiet** means `try_recv` returned [`TryRecvError::Empty`] and the chosen idle clock has moved
/// past `idle` without a new message resetting it.
///
/// - The idle clock is reset on every successfully received message and on every [`TryRecvError::Lagged`]
///   (treat skipped messages as recent activity).
/// - If `must_receive_before_idle` is `false` (default for “any quiet window”): the clock starts at
///   function entry, so “no messages for `idle`” includes the case where **nothing** is ever sent
///   (useful when the producer may already be done).
/// - If `must_receive_before_idle` is `true`: quiet is only evaluated **after** at least one message
///   (or lag). Until then, only `max_wait` can end the wait.
///
/// Sleeps ~10 ms between empty polls to avoid busy-waiting.
pub fn wait_until_broadcast_receiver_idle<T: Clone>(
    receiver: &mut broadcast::Receiver<T>,
    idle: Duration,
    max_wait: Duration,
    must_receive_before_idle: bool,
) -> Result<BroadcastIdleOutcome, BroadcastIdleWaitError> {
    let deadline = Instant::now() + max_wait;
    let mut last_activity = Instant::now();
    let mut received_any = false;

    loop {
        if Instant::now() >= deadline {
            return Ok(BroadcastIdleOutcome::MaxWaitElapsed {
                received_any_message: received_any,
            });
        }

        match receiver.try_recv() {
            Ok(_msg) => {
                received_any = true;
                last_activity = Instant::now();
            }
            Err(TryRecvError::Empty) => {
                let can_check_idle = !must_receive_before_idle || received_any;
                if can_check_idle && last_activity.elapsed() >= idle {
                    return Ok(BroadcastIdleOutcome::Stabilized);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(TryRecvError::Lagged(_)) => {
                received_any = true;
                last_activity = Instant::now();
            }
            Err(TryRecvError::Closed) => return Err(BroadcastIdleWaitError::ChannelClosed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_after_subscription_without_messages() {
        let (tx, mut rx) = broadcast::channel::<u32>(16);
        drop(tx);
        let r = wait_until_broadcast_receiver_idle(&mut rx, Duration::from_millis(30), Duration::from_secs(2), false);
        assert_eq!(r, Err(BroadcastIdleWaitError::ChannelClosed));
    }

    #[test]
    fn idle_after_last_message() {
        let (tx, mut rx) = broadcast::channel::<u32>(16);
        tx.send(1).unwrap();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            drop(tx);
        });
        let r = wait_until_broadcast_receiver_idle(&mut rx, Duration::from_millis(40), Duration::from_secs(2), false);
        assert_eq!(r.unwrap(), BroadcastIdleOutcome::Stabilized);
    }
}

//! Sticky target admission and sampled-interval lifetime, shared by local and remote playback.

use std::time::{Duration, Instant};

use holtburger_common::Guid;

/// Retail target lease (`StickyManager::StickTo`, acclient.c:371536-371561).
const STICKY_TARGET_LIFETIME: Duration = Duration::from_secs(1);

/// One explicitly admitted target, independent of animation visibility or snapshot rereads.
#[derive(Debug, Clone, Copy)]
struct StickyTarget {
    /// Object whose current geometry the movement adapter must sample.
    guid: Guid,
    /// Monotonic expiry; capped simulation time must not prolong the command.
    expires_at: Instant,
}

/// Active command and completed-interval sample have different retirement boundaries.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct StickyMotion {
    /// Command eligible to contribute to the next positive-duration interval.
    active: Option<StickyTarget>,
    /// Target that contributed to the last admitted interval, including an action's final one.
    sampled: Option<Guid>,
}

impl StickyMotion {
    /// Replacement command admission renews or cancels once, even if playback is unchanged.
    pub fn admit(&mut self, target: Option<Guid>, now: Instant) {
        self.active = target
            .filter(|guid| !guid.is_null())
            .map(|guid| StickyTarget {
                guid,
                expires_at: now + STICKY_TARGET_LIFETIME,
            });
        self.sampled = None;
    }

    /// Sample before authored advancement; zero-time support selection does not enter here.
    pub fn begin_interval(&mut self, now: Instant) {
        if self.active.is_some_and(|target| now > target.expires_at) {
            self.active = None;
        }
        self.sampled = self.active.map(|target| target.guid);
    }

    /// Retail action completion unsticks (CMotionInterp::MotionDone, acclient.c:329942-329961).
    /// The interval that completed the action still owns its already-sampled target.
    pub fn complete_action(&mut self) {
        self.active = None;
    }

    /// Physical preparation consumes the same target throughout the admitted interval.
    pub fn sampled_target(self) -> Option<Guid> {
        self.sampled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_renews_but_sampling_does_not_extend_the_lease() {
        let now = Instant::now();
        let target = Guid(1);
        let mut sticky = StickyMotion::default();
        sticky.admit(Some(target), now);
        sticky.begin_interval(now + STICKY_TARGET_LIFETIME);
        assert_eq!(sticky.sampled_target(), Some(target));
        sticky.begin_interval(now + STICKY_TARGET_LIFETIME + Duration::from_nanos(1));
        assert_eq!(sticky.sampled_target(), None);
        sticky.admit(Some(target), now + STICKY_TARGET_LIFETIME);
        sticky.begin_interval(now + STICKY_TARGET_LIFETIME * 2);
        assert_eq!(sticky.sampled_target(), Some(target));
        sticky.admit(None, now + STICKY_TARGET_LIFETIME * 2);
        assert_eq!(sticky.sampled_target(), None);
    }

    #[test]
    fn action_completion_preserves_only_its_final_interval() {
        let now = Instant::now();
        let mut sticky = StickyMotion::default();
        sticky.admit(Some(Guid(1)), now);
        sticky.begin_interval(now);
        sticky.complete_action();
        assert_eq!(sticky.sampled_target(), Some(Guid(1)));
        sticky.begin_interval(now);
        assert_eq!(sticky.sampled_target(), None);
        sticky.admit(Some(Guid(2)), now);
        sticky.begin_interval(now);
        assert_eq!(sticky.sampled_target(), Some(Guid(2)));
    }
}

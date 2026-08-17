//! Minimal directional collision-report lifetimes owned by the physical scene.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use anyhow::{Result, ensure};

use super::SpatialBodyId;

/// Retail's strict object-contact expiry interval.
pub const COLLISION_REPORT_EXPIRY: Duration = Duration::from_secs(1);

/// Consumer-facing classification of one confirmed contact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CollisionReportClassification {
    /// Ordinary directional body contact.
    Object,
    /// Contact reported through the environment callback family.
    Environment,
}

/// Physical source named by one directional report lifetime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CollisionReportSource {
    /// Terrain, an EnvCell surface, or placed static geometry with no dynamic body identity.
    StaticEnvironment,
    /// One dynamic body, retaining its identity even when its state selects environment reporting.
    DynamicBody {
        /// Canonical source-neutral peer identity.
        peer: SpatialBodyId,
        /// Object or environment reporting selected by the peer's complete state.
        classification: CollisionReportClassification,
    },
}

/// Stable identity of one directional collision-report lifetime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CollisionReportContact {
    /// Body whose interested composition receives the outcome.
    pub recipient: SpatialBodyId,
    /// Static environment or dynamic peer responsible for the contact.
    pub source: CollisionReportSource,
}

/// Lifecycle edge emitted from committed physical state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CollisionReportPhase {
    /// First confirmed touch after no retained lifetime existed.
    Started,
    /// Natural expiry or an explicit invalidating transition.
    Ended,
}

/// One source-neutral committed collision-report edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CollisionReportOutcome {
    /// Directional contact whose lifetime changed.
    pub contact: CollisionReportContact,
    /// Start or end edge; refreshes intentionally emit nothing.
    pub phase: CollisionReportPhase,
}

/// One exact narrow-phase observation prepared before its owning body transaction commits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CollisionReportTouch {
    pub(crate) contact: CollisionReportContact,
    pub(crate) source_is_ethereal: bool,
}

#[derive(Debug, Clone, Copy)]
struct ActiveCollisionReport {
    touched_at: Instant,
    source_is_ethereal: bool,
}

/// Only the active records required to distinguish start, refresh, and end.
#[derive(Debug, Clone, Default)]
pub(crate) struct CollisionReportLifetimes {
    active: BTreeMap<CollisionReportContact, ActiveCollisionReport>,
}

impl CollisionReportLifetimes {
    /// Computes first-touch edges without mutating state, so a consumer may veto the body commit.
    pub(crate) fn preview_touches(
        &self,
        touches: &[CollisionReportTouch],
        now: Instant,
    ) -> Result<Vec<CollisionReportOutcome>> {
        let touches = canonical_touches(touches);
        for contact in touches.keys() {
            if let Some(active) = self.active.get(contact) {
                ensure!(
                    now >= active.touched_at,
                    "collision-report clock moved backward for {contact:?}"
                );
            }
        }
        Ok(touches
            .keys()
            .filter(|contact| !self.active.contains_key(contact))
            .copied()
            .map(|contact| CollisionReportOutcome {
                contact,
                phase: CollisionReportPhase::Started,
            })
            .collect())
    }

    /// Commits observations already validated by `preview_touches`.
    pub(crate) fn commit_touches(&mut self, touches: &[CollisionReportTouch], now: Instant) {
        for (contact, source_is_ethereal) in canonical_touches(touches) {
            self.active.insert(
                contact,
                ActiveCollisionReport {
                    touched_at: now,
                    source_is_ethereal,
                },
            );
        }
    }

    /// Expires untouched lifetimes after every directional body attempt in a collection epoch.
    pub(crate) fn expire(&mut self, now: Instant) -> Result<Vec<CollisionReportOutcome>> {
        for (contact, active) in &self.active {
            ensure!(
                now >= active.touched_at,
                "collision-report clock moved backward for {contact:?}"
            );
        }
        let ended = self
            .active
            .iter()
            .filter_map(|(contact, active)| {
                let elapsed = now.duration_since(active.touched_at);
                (elapsed > COLLISION_REPORT_EXPIRY
                    || (active.source_is_ethereal && !elapsed.is_zero()))
                .then_some(*contact)
            })
            .collect::<Vec<_>>();
        Ok(self.end_contacts(&ended))
    }

    /// Ends every direction whose recipient or dynamic source is the named body.
    pub(crate) fn force_end_for_body(
        &mut self,
        body_id: SpatialBodyId,
    ) -> Vec<CollisionReportOutcome> {
        let ended = self
            .active
            .keys()
            .filter(|contact| {
                contact.recipient == body_id
                    || matches!(
                        contact.source,
                        CollisionReportSource::DynamicBody { peer, .. } if peer == body_id
                    )
            })
            .copied()
            .collect::<Vec<_>>();
        self.end_contacts(&ended)
    }

    /// Ends only lifetimes delivered to the named directional recipient.
    pub(crate) fn force_end_for_recipient(
        &mut self,
        body_id: SpatialBodyId,
    ) -> Vec<CollisionReportOutcome> {
        let ended = self
            .active
            .keys()
            .filter(|contact| contact.recipient == body_id)
            .copied()
            .collect::<Vec<_>>();
        self.end_contacts(&ended)
    }

    /// Ends selected directional records after a state/geometry replacement invalidates them.
    pub(crate) fn force_end_where(
        &mut self,
        mut invalid: impl FnMut(CollisionReportContact) -> bool,
    ) -> Vec<CollisionReportOutcome> {
        let ended = self
            .active
            .keys()
            .copied()
            .filter(|contact| invalid(*contact))
            .collect::<Vec<_>>();
        self.end_contacts(&ended)
    }

    fn end_contacts(&mut self, contacts: &[CollisionReportContact]) -> Vec<CollisionReportOutcome> {
        contacts
            .iter()
            .filter_map(|contact| {
                self.active.remove(contact).map(|_| CollisionReportOutcome {
                    contact: *contact,
                    phase: CollisionReportPhase::Ended,
                })
            })
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn active_len(&self) -> usize {
        self.active.len()
    }
}

fn canonical_touches(touches: &[CollisionReportTouch]) -> BTreeMap<CollisionReportContact, bool> {
    let mut canonical = BTreeMap::new();
    for touch in touches {
        canonical
            .entry(touch.contact)
            .and_modify(|ethereal| *ethereal |= touch.source_is_ethereal)
            .or_insert(touch.source_is_ethereal);
    }
    canonical
}

// RETAIL DIVERGENCE: `acclient.c:308446-308480` and `:308481-308560` retain balanced
// object-report edges but collapse environment reporting to a start-only boolean. Reproducing that
// split would leave source-neutral consumers unable to balance environment-classified lifetimes;
// the Phase R0 census found 4,497 templates with `ReportCollisionsAsEnvironment`. Holtburger keeps
// the peer identity and emits the same balanced start/end lifecycle for both classifications.

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;

    fn body(value: u32) -> SpatialBodyId {
        SpatialBodyId::Entity(Guid(value))
    }

    fn touch(recipient: u32, peer: u32, source_is_ethereal: bool) -> CollisionReportTouch {
        CollisionReportTouch {
            contact: CollisionReportContact {
                recipient: body(recipient),
                source: CollisionReportSource::DynamicBody {
                    peer: body(peer),
                    classification: CollisionReportClassification::Object,
                },
            },
            source_is_ethereal,
        }
    }

    #[test]
    fn first_touch_starts_refresh_is_silent_and_strict_timeout_ends() {
        let start = Instant::now();
        let mut reports = CollisionReportLifetimes::default();
        let touch = touch(1, 2, false);

        assert_eq!(
            reports.preview_touches(&[touch], start).unwrap(),
            vec![CollisionReportOutcome {
                contact: touch.contact,
                phase: CollisionReportPhase::Started,
            }]
        );
        reports.commit_touches(&[touch], start);
        assert!(
            reports
                .preview_touches(&[touch], start + Duration::from_secs(1))
                .unwrap()
                .is_empty()
        );
        reports.commit_touches(&[touch], start + Duration::from_secs(1));
        assert!(
            reports
                .expire(start + Duration::from_secs(2))
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            reports
                .expire(start + Duration::from_secs(2) + Duration::from_nanos(1))
                .unwrap(),
            vec![CollisionReportOutcome {
                contact: touch.contact,
                phase: CollisionReportPhase::Ended,
            }]
        );
    }

    #[test]
    fn ethereal_source_ends_after_first_positive_unrefreshed_interval() {
        let start = Instant::now();
        let mut reports = CollisionReportLifetimes::default();
        let touch = touch(1, 2, true);
        reports.commit_touches(&[touch], start);

        assert!(reports.expire(start).unwrap().is_empty());
        assert_eq!(
            reports.expire(start + Duration::from_nanos(1)).unwrap()[0].phase,
            CollisionReportPhase::Ended
        );
    }

    #[test]
    fn forced_body_end_clears_recipient_and_source_directions() {
        let now = Instant::now();
        let mut reports = CollisionReportLifetimes::default();
        let touches = [touch(1, 2, false), touch(2, 1, false), touch(3, 4, false)];
        reports.commit_touches(&touches, now);

        let ended = reports.force_end_for_body(body(1));
        assert_eq!(ended.len(), 2);
        assert_eq!(reports.active_len(), 1);
    }
}

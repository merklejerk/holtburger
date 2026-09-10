//! Client-owned publication policy over accepted world facts.

use std::time::{Duration, Instant};

use holtburger_common::{Guid, position::WorldPosition};
use holtburger_world::{ContactState, SpatialBodyId, SupportSource, WorldState};

/// Maximum time between routine position reports, including stationary keepalives.
pub(super) const POSITION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
/// Travel budget: leaves 3 m before indoor damping, before tick/latency costs.
/// Validated against the fast hallway replay and delayed-confirmation fixtures.
pub(super) const POSITION_TRAVEL_BUDGET_METRES: f32 = 2.0;

/// Contact transitions and support-body identity, independent of geometry proof revisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PositionSupport {
    /// No solved contact fact is available yet.
    Unknown,
    /// No retained supporting contact.
    Airborne,
    /// None denotes support without a known entity, including static world geometry.
    Grounded(Option<SpatialBodyId>),
    /// A non-walkable contact is distinct from both standing and airborne movement.
    Sliding(Option<SpatialBodyId>),
}

/// Movement sequences that make positions incomparable across discontinuities/control epochs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PositionEpoch {
    /// Local body identity.
    player: Guid,
    /// Server object-instance generation.
    instance: u16,
    /// Server teleport epoch.
    teleport: u16,
    /// Server forced-placement epoch.
    force_position: u16,
    /// Server movement-control epoch.
    server_control: u16,
}

/// One coherent snapshot taken at the position-bearing packet's construction boundary.
#[derive(Debug, Clone, Copy)]
pub(super) struct PositionSample {
    /// Accepted body-reference placement carried by the packet.
    pub(super) pose: WorldPosition,
    /// Epoch of this accepted placement.
    epoch: PositionEpoch,
    /// Stable contact classification used to decide whether another report is needed.
    support: PositionSupport,
}

impl PositionSample {
    pub(super) fn capture(world: &WorldState) -> Option<Self> {
        let pose = world.local_player_runtime_pose()?;
        if world.player.guid == Guid::NULL || pose.landblock_id == Guid::NULL {
            return None;
        }
        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(world.player.guid));
        let entity_support = body
            .and_then(|body| body.physical.as_ref())
            .and_then(|physical| physical.response.ground().contact_plane())
            .and_then(|support| match support.source {
                SupportSource::World(_) => None,
                SupportSource::Entity(id) => Some(id),
            });
        let support = match body.map_or(ContactState::Unknown, |body| body.contact) {
            ContactState::Unknown => PositionSupport::Unknown,
            ContactState::Airborne => PositionSupport::Airborne,
            ContactState::Grounded => PositionSupport::Grounded(entity_support),
            ContactState::Sliding => PositionSupport::Sliding(entity_support),
        };
        Some(Self {
            pose,
            support,
            epoch: PositionEpoch {
                player: world.player.guid,
                instance: world.player.instance_sequence,
                teleport: world.player.teleport_sequence,
                force_position: world.player.force_position_sequence,
                server_control: world.player.server_control_sequence,
            },
        })
    }
}

/// The first satisfied trigger, consumed by publication diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PositionPublicationReason {
    /// No report exists for the current epoch.
    Initial,
    /// Accepted cell differs from the published cell.
    Cell,
    /// Contact state or supporting entity changed.
    Support,
    /// Accepted travel consumed the publication budget.
    Distance,
    /// The maximum report interval elapsed.
    Heartbeat,
}

/// Last successful publication and subsequent observed travel share one lifetime.
struct PublishedPosition {
    /// Facts accompanying the last successfully submitted report.
    sample: PositionSample,
    /// Submission time for the heartbeat deadline.
    sent_at: Instant,
    /// Last sampled pose, so retries and backtracking count travel correctly.
    observed_pose: WorldPosition,
    /// Accepted tick displacements accumulated since submission.
    travelled: f32,
}

/// No network or simulation ownership; only MovementSystem mutates this policy state.
///
/// RETAIL DIVERGENCE: `ShouldSendPositionEvent` checks cell/contact-plane changes and a
/// one-second interval (acclient.c:682586-682608). We retain cell changes, compare contact
/// state/support-body identity instead of plane coefficients, and bound accepted travel.
/// Removing the distance trigger restores measured throttling in the delayed-confirmation
/// flat-cell fixture; proof/triangle churn must not manufacture support events. Scope:
/// the reported 0x001e hallway in both directions and synthetic contact/cadence fixtures;
/// no full-content census or complete retail scheduling equivalence is claimed.
#[derive(Default)]
pub(super) struct PositionPublication {
    /// Absent until a valid report succeeds in the current world epoch.
    published: Option<PublishedPosition>,
}

impl PositionPublication {
    /// Observe each accepted tick once. Failed sends leave the last publication intact;
    /// observing the same pose again does not count its travel twice.
    pub(super) fn observe(
        &mut self,
        sample: PositionSample,
        now: Instant,
    ) -> Option<PositionPublicationReason> {
        let Some(published) = self.published.as_mut() else {
            return Some(PositionPublicationReason::Initial);
        };
        if published.sample.epoch != sample.epoch {
            self.published = None;
            return Some(PositionPublicationReason::Initial);
        }
        // Sum accepted tick displacements, not the distance from the last sent pose:
        // backtracking still counts, while blocked drive and retained velocity do not.
        published.travelled += published.observed_pose.distance_to(&sample.pose);
        published.observed_pose = sample.pose;
        if published.sample.pose.landblock_id != sample.pose.landblock_id {
            Some(PositionPublicationReason::Cell)
        } else if published.sample.support != sample.support {
            Some(PositionPublicationReason::Support)
        } else if published.travelled >= POSITION_TRAVEL_BUDGET_METRES {
            Some(PositionPublicationReason::Distance)
        } else if now.duration_since(published.sent_at) >= POSITION_HEARTBEAT_INTERVAL {
            Some(PositionPublicationReason::Heartbeat)
        } else {
            None
        }
    }

    /// Call only after a position/contact-bearing message is successfully submitted.
    pub(super) fn record(&mut self, sample: PositionSample, now: Instant) {
        self.published = Some(PublishedPosition {
            sample,
            sent_at: now,
            observed_pose: sample.pose,
            travelled: 0.0,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_world::MOBILE_CONTACT_TICK_SECONDS;
    use holtburger_world::spatial::PoseReconciliationState;

    fn sample() -> PositionSample {
        PositionSample {
            pose: WorldPosition {
                landblock_id: Guid(0x001e_0122),
                ..WorldPosition::default()
            },
            epoch: PositionEpoch {
                player: Guid(1),
                instance: 0,
                teleport: 0,
                force_position: 0,
                server_control: 0,
            },
            support: PositionSupport::Grounded(None),
        }
    }

    #[test]
    fn captured_support_ignores_world_proof_revisions_but_retains_platform_identity() {
        let mut world = WorldState::synthetic();
        let guid = Guid(1);
        world.player.guid = guid;
        let mut body = holtburger_world::SpatialBody::new(
            SpatialBodyId::LocalPlayer(guid),
            sample().pose,
            Instant::now(),
        );
        let profile =
            crate::retail_player_grounded_profile(holtburger_world::EdgeProtection::Creature)
                .unwrap();
        body.physical = Some(holtburger_world::PhysicalBodyState::new(
            profile.definition,
            holtburger_world::PhysicalCollisionFilter::ALL,
            profile.response_policy,
            Some(sample().pose.landblock_id),
        ));
        body.contact = ContactState::Grounded;
        let mut collision = holtburger_world::CollisionScene::new();
        let owner = Guid(0x001e_ffff);
        let mut proofs = Vec::new();
        for _ in 0..2 {
            collision
                .insert(holtburger_content::LandblockCollisionAsset {
                    landblock_id: owner.0,
                    terrain: holtburger_content::TerrainCollisionSurface::empty(),
                    static_geometry: holtburger_content::LandblockColliders::new(
                        Vec::new(),
                        Vec::new(),
                    ),
                })
                .unwrap();
            proofs.push(collision.owner_proof(owner).unwrap());
        }
        assert_ne!(proofs[0], proofs[1]);
        for source in [
            SupportSource::World(proofs[0]),
            SupportSource::World(proofs[1]),
            SupportSource::Entity(SpatialBodyId::Entity(Guid(2))),
        ] {
            let physical = body.physical.as_mut().unwrap();
            physical.response = holtburger_world::PhysicalBodyResponseState::Grounded {
                cell: Some(sample().pose.landblock_id),
                ground: holtburger_world::GroundState::Supported(holtburger_world::GroundSupport {
                    normal: Vector3::new(0.0, 0.0, 1.0),
                    feature: holtburger_world::SupportFeature::Surface,
                    source,
                }),
                stationary_fall_frames: 0,
            };
            world.scene.register_body(body.clone());
            let expected = match source {
                SupportSource::World(_) => PositionSupport::Grounded(None),
                SupportSource::Entity(id) => PositionSupport::Grounded(Some(id)),
            };
            assert_eq!(PositionSample::capture(&world).unwrap().support, expected);
        }
    }

    #[test]
    fn distance_counts_backtracking_and_does_not_consume_a_failed_publication() {
        let now = Instant::now();
        let mut policy = PositionPublication::default();
        let start = sample();
        policy.record(start, now);
        let mut current = start;
        current.pose.coords.x += POSITION_TRAVEL_BUDGET_METRES * 0.6;
        assert_eq!(policy.observe(current, now), None);
        assert_eq!(
            policy.observe(start, now),
            Some(PositionPublicationReason::Distance)
        );
        // The caller's send failed: another observation must still request publication,
        // but must not recount the same displacement.
        let distance = policy.published.as_ref().unwrap().travelled;
        assert_eq!(
            policy.observe(start, now),
            Some(PositionPublicationReason::Distance)
        );
        assert_eq!(policy.published.as_ref().unwrap().travelled, distance);
        policy.record(start, now);
        assert_eq!(policy.observe(start, now), None);
    }

    #[test]
    fn cell_and_support_transitions_preempt_the_heartbeat() {
        let now = Instant::now();
        let base = sample();
        let mut policy = PositionPublication::default();
        for support in [
            PositionSupport::Airborne,
            PositionSupport::Sliding(None),
            PositionSupport::Grounded(Some(SpatialBodyId::Entity(Guid(2)))),
            PositionSupport::Grounded(Some(SpatialBodyId::Entity(Guid(3)))),
            PositionSupport::Grounded(None),
        ] {
            let previous = policy.published.as_ref().map_or(base, |p| p.sample);
            policy.record(previous, now);
            let next = PositionSample {
                support,
                ..previous
            };
            assert_eq!(
                policy.observe(next, now),
                Some(PositionPublicationReason::Support)
            );
            policy.record(next, now);
            assert_eq!(policy.observe(next, now), None);
        }
        let mut next = base;
        next.pose.landblock_id = Guid(0x001e_0123);
        assert_eq!(
            policy.observe(next, now),
            Some(PositionPublicationReason::Cell)
        );
    }

    #[test]
    fn stationary_reports_are_bounded_and_epoch_changes_discard_travel() {
        let now = Instant::now();
        let base = sample();
        let mut policy = PositionPublication::default();
        assert_eq!(
            policy.observe(base, now),
            Some(PositionPublicationReason::Initial)
        );
        policy.record(base, now);
        assert_eq!(
            policy.observe(base, now + POSITION_HEARTBEAT_INTERVAL / 2),
            None
        );
        assert_eq!(
            policy.observe(base, now + POSITION_HEARTBEAT_INTERVAL),
            Some(PositionPublicationReason::Heartbeat)
        );
        for epoch in [
            PositionEpoch {
                teleport: 1,
                ..base.epoch
            },
            PositionEpoch {
                force_position: 1,
                ..base.epoch
            },
            PositionEpoch {
                instance: 1,
                ..base.epoch
            },
            PositionEpoch {
                server_control: 1,
                ..base.epoch
            },
            PositionEpoch {
                player: Guid(2),
                ..base.epoch
            },
        ] {
            policy.record(base, now);
            let next = PositionSample {
                epoch,
                pose: WorldPosition {
                    coords: Vector3::new(1000.0, 0.0, 0.0),
                    ..base.pose
                },
                ..base
            };
            assert_eq!(
                policy.observe(next, now),
                Some(PositionPublicationReason::Initial)
            );
            policy.record(next, now);
            assert_eq!(policy.observe(next, now), None);
        }
    }

    /// Runs the real confirmation constraint with delayed echoes of published poses.
    fn replay(speed: f32, distance_trigger: bool, confirmations: bool) -> (usize, f32) {
        let now = Instant::now();
        let tick = MOBILE_CONTACT_TICK_SECONDS;
        let mut current = sample();
        let mut reconciliation = PoseReconciliationState::default();
        reconciliation.confirm(current.pose, current.pose);
        let mut policy = PositionPublication::default();
        policy.record(current, now);
        let mut echoes = std::collections::VecDeque::new();
        let mut sends = 0;
        let mut minimum_scale = 1.0_f32;
        for index in 1..=300 {
            let time = now + Duration::from_secs_f32(tick) * index;
            while let Some(&(arrival, pose)) = echoes.front() {
                if arrival > time {
                    break;
                }
                echoes.pop_front();
                reconciliation.confirm(pose, current.pose);
            }
            let requested = Vector3::new(0.0, speed * tick, 0.0);
            let accepted = reconciliation
                .compose_translation(current.pose, ContactState::Grounded, requested, tick)
                .translation;
            minimum_scale = minimum_scale.min(accepted.y / requested.y);
            current.pose.coords = current.pose.coords + accepted;
            let reason = policy.observe(current, time);
            if reason.is_some()
                && (distance_trigger || reason == Some(PositionPublicationReason::Heartbeat))
            {
                policy.record(current, time);
                sends += 1;
                if confirmations {
                    // Keep network delay independent of the simulation tick rate.
                    echoes.push_back((time + Duration::from_millis(100), current.pose));
                }
            }
        }
        (sends, minimum_scale)
    }

    #[test]
    fn distance_publication_prevents_healthy_fast_run_throttling_but_not_missing_confirmation_throttling()
     {
        let (fast_sends, fast_scale) = replay(18.0, true, true);
        let (slow_sends, slow_scale) = replay(6.0, true, true);
        let (heartbeat_sends, heartbeat_scale) = replay(18.0, false, true);
        assert_eq!(fast_scale, 1.0);
        assert_eq!(slow_scale, 1.0);
        assert!(fast_sends > slow_sends && slow_sends > heartbeat_sends);
        assert!(heartbeat_scale < 0.6);
        let (_, missing_scale) = replay(18.0, true, false);
        assert!(missing_scale < 0.01);
    }
}

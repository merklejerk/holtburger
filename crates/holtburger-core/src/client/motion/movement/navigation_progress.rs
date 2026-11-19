//! Intent-owned interpolation; only a containing endpoint may become a canonical world pose.

use anyhow::{Result, ensure};
use holtburger_common::{Quaternion, RigidTransform, Vector3, position::WorldPosition};
use holtburger_world::motion::DirectedMotionTravel;
use holtburger_world::{CollisionScene, PointPlacement};

use crate::client::movement_types::AutonomousDriveIntent;

/// Uncommitted progress through known voids, rebased whenever canonical placement changes.
/// This state never supplies world queries, packet positions, or arrival checks.
#[derive(Default)]
pub(super) struct NavigationProgress {
    interval: Option<NavigationInterval>,
}

struct NavigationInterval {
    /// Last pose returned for canonical commitment; detects corrections independently of input.
    committed: WorldPosition,
    /// Current interpolation sample, which may lie outside all known cells.
    candidate: WorldPosition,
}

/// Exactly one translation owner: target-directed budget or authored relative displacement.
enum NavigationDisplacement {
    Target {
        travel: DirectedMotionTravel,
        /// Authored displacement supplies both its travel budget and a direction at coincidence.
        authored_delta: Vector3,
    },
    Relative(Vector3),
    /// Rate-limited pursuit with authored setup clearance, sampled before the physical collection.
    Sticky {
        target: holtburger_world::StickyBodyTarget,
        interval: f32,
    },
}

impl NavigationProgress {
    pub fn reset(&mut self) {
        self.interval = None;
    }

    /// Consumes only this tick's admitted travel budget. Missing/ambiguous geometry holds progress;
    /// known outside samples advance the intent but never become committed positions.
    pub fn advance(
        &mut self,
        scene: &CollisionScene,
        committed: WorldPosition,
        intent: AutonomousDriveIntent,
        admitted_fraction: f32,
    ) -> Result<Option<WorldPosition>> {
        ensure!(
            intent.desired_world_delta.length().is_finite(),
            "navigation displacement must have finite length"
        );
        ensure!(
            intent.desired_heading.is_none_or(f32::is_finite),
            "navigation heading must be finite"
        );
        ensure!(
            (0.0..=1.0).contains(&admitted_fraction),
            "navigation admitted fraction must be between zero and one"
        );
        let displacement = match intent.target_hint {
            Some(target) => NavigationDisplacement::Target {
                travel: DirectedMotionTravel {
                    target,
                    moving_away: false,
                },
                authored_delta: intent.desired_world_delta * admitted_fraction,
            },
            None => {
                NavigationDisplacement::Relative(intent.desired_world_delta * admitted_fraction)
            }
        };
        let rotation = intent
            .desired_heading
            .map_or(committed.rotation, Quaternion::from_heading);
        self.advance_displacement(scene, committed, displacement, rotation)
    }

    /// Uses the already admitted authored tick once. A server travel node supplies direction;
    /// manual/gesture motion keeps its relative root displacement without a second integrator.
    pub fn advance_authored(
        &mut self,
        scene: &CollisionScene,
        committed: WorldPosition,
        offset: RigidTransform,
        scale: f32,
        travel: Option<DirectedMotionTravel>,
    ) -> Result<Option<WorldPosition>> {
        let world_delta = committed.rotation.rotate_vector(offset.translation * scale);
        ensure!(
            world_delta.length().is_finite(),
            "navigation displacement must have finite length"
        );
        let displacement = match travel {
            Some(travel) => NavigationDisplacement::Target {
                travel,
                authored_delta: world_delta,
            },
            None => NavigationDisplacement::Relative(world_delta),
        };
        self.advance_displacement(
            scene,
            committed,
            displacement,
            committed.rotation.multiply(&offset.rotation),
        )
    }

    /// Sticky pursuit owns its translation budget independently of the playing attack's root.
    pub fn advance_sticky(
        &mut self,
        scene: &CollisionScene,
        committed: WorldPosition,
        target: holtburger_world::StickyBodyTarget,
        interval: std::time::Duration,
    ) -> Result<Option<WorldPosition>> {
        ensure!(
            target.heading.is_finite(),
            "navigation sticky heading must be finite"
        );
        self.advance_displacement(
            scene,
            committed,
            NavigationDisplacement::Sticky {
                target,
                interval: interval.as_secs_f32(),
            },
            Quaternion::from_heading(target.heading),
        )
    }

    fn advance_displacement(
        &mut self,
        scene: &CollisionScene,
        committed: WorldPosition,
        displacement: NavigationDisplacement,
        rotation: Quaternion,
    ) -> Result<Option<WorldPosition>> {
        let interval = self.interval.get_or_insert(NavigationInterval {
            committed,
            candidate: committed,
        });
        if interval.committed.landblock_id != committed.landblock_id
            || interval.committed.coords != committed.coords
        {
            interval.committed = committed;
            interval.candidate = committed;
        }
        let mut next = interval.candidate;
        next.rotation = rotation;
        let (delta, target_hint) = match displacement {
            NavigationDisplacement::Target {
                travel,
                authored_delta,
            } => {
                let target = travel.target;
                ensure!(
                    target.landblock_id != holtburger_common::Guid::NULL,
                    "navigation destination must have a cell identity"
                );
                ensure!(
                    target.coords.length().is_finite(),
                    "navigation destination must have finite coordinates"
                );
                let remaining = target.global_coords() - next.global_coords();
                let distance = remaining.length();
                let budget = authored_delta.length();
                let delta = if distance > 0.0 {
                    let travel_distance = if travel.moving_away {
                        -budget
                    } else {
                        budget.min(distance)
                    };
                    remaining * (travel_distance / distance)
                } else if travel.moving_away {
                    // The command already chose a heading at coincidence. Retain that authored
                    // direction rather than normalizing a zero target offset and stalling.
                    authored_delta
                } else {
                    Vector3::zero()
                };
                (delta, (!travel.moving_away).then_some(target))
            }
            NavigationDisplacement::Relative(delta) => (delta, None),
            NavigationDisplacement::Sticky { target, interval } => (
                target.spatial_displacement(next, interval)?,
                Some(target.position),
            ),
        };
        next.coords = next.coords + delta;
        let accepted = match scene.point_placement(next)? {
            PointPlacement::Unique(pose) => Some(pose),
            PointPlacement::Overlapping { candidates } => candidates
                .iter()
                .find(|pose| pose.landblock_id == committed.landblock_id)
                .or_else(|| {
                    target_hint.and_then(|target| {
                        candidates
                            .iter()
                            .find(|pose| pose.landblock_id == target.landblock_id)
                    })
                })
                .copied(),
            PointPlacement::Outside => {
                interval.candidate = next;
                None
            }
            PointPlacement::Unavailable { .. } => None,
        };
        if let Some(pose) = accepted {
            interval.committed = pose;
            interval.candidate = pose;
        }
        Ok(accepted)
    }
}

#[cfg(test)]
mod tests;

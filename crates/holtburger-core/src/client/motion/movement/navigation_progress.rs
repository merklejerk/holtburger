//! Intent-owned interpolation; only a containing endpoint may become a canonical world pose.

use anyhow::{Result, ensure};
use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3, position::WorldPosition};
use holtburger_world::motion::DirectedMotionTravel;
use holtburger_world::{CollisionScene, PointPlacement};

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
        let accepted = match resolve_navigation_placement(scene, committed, next, target_hint)? {
            NavigationPlacementResolution::Accepted(pose) => {
                interval.committed = pose;
                interval.candidate = pose;
                Some(pose)
            }
            NavigationPlacementResolution::Outside => {
                interval.candidate = next;
                None
            }
            NavigationPlacementResolution::Unavailable => None,
        };
        Ok(accepted)
    }
}

enum NavigationPlacementResolution {
    Accepted(WorldPosition),
    Outside,
    Unavailable,
}

/// True for an actual interior EnvCell ID (excludes both outdoor cells and `0xFFFF` owner frames).
fn is_indoor_cell(landblock_id: Guid) -> bool {
    let low = landblock_id.0 & 0xffff;
    low >= 0x0100 && low != 0xffff
}

/// Resolves a navigation step against resident cell volumes:
/// - Prefers `target_hint` over `committed` on overlapping cell boundaries.
/// - Enters an indoor target cell once XY enters its horizontal footprint even if linear 3D
///   interpolation is still slightly below the indoor floor plane.
fn resolve_navigation_placement(
    scene: &CollisionScene,
    committed: WorldPosition,
    next: WorldPosition,
    target_hint: Option<WorldPosition>,
) -> Result<NavigationPlacementResolution> {
    let initial = scene.point_placement(next)?;
    let (resolved, was_outside) = match initial {
        PointPlacement::Unique(pose) => (Some(pose), false),
        PointPlacement::Overlapping { candidates } => (
            target_hint
                .and_then(|target| {
                    candidates
                        .iter()
                        .find(|pose| pose.landblock_id == target.landblock_id)
                })
                .or_else(|| {
                    candidates
                        .iter()
                        .find(|pose| pose.landblock_id == committed.landblock_id)
                })
                .copied(),
            false,
        ),
        PointPlacement::Outside => (None, true),
        PointPlacement::Unavailable { .. } => (None, false),
    };

    // When approaching an indoor cell from outdoors (or across an elevation step), linear 3D
    // interpolation often stops below the room's floor plane and falls back to an outdoor cell
    // inside the building foundation. Once XY enters the target cell's volume at target Z, step
    // cleanly onto the indoor cell elevation.
    let resolved = if let Some(target) = target_hint.filter(|t| is_indoor_cell(t.landblock_id))
        && resolved.is_none_or(|pose| !is_indoor_cell(pose.landblock_id))
        && let Some(indoor) = probe_indoor_target_entry(scene, next, target)?
    {
        Some(indoor)
    } else {
        resolved
    };

    Ok(match resolved {
        Some(pose) => NavigationPlacementResolution::Accepted(pose),
        None if was_outside => NavigationPlacementResolution::Outside,
        None => NavigationPlacementResolution::Unavailable,
    })
}

fn probe_indoor_target_entry(
    scene: &CollisionScene,
    next: WorldPosition,
    target: WorldPosition,
) -> Result<Option<WorldPosition>> {
    let target_owner = Guid((target.landblock_id.0 & 0xffff_0000) | 0xffff);
    let Ok(mut probe) = next.reanchor_to_landblock_owner(target_owner) else {
        return Ok(None);
    };
    probe.coords.z = target.coords.z;
    probe.rotation = next.rotation;
    match scene.point_placement(probe)? {
        PointPlacement::Unique(pose) if pose.landblock_id == target.landblock_id => Ok(Some(pose)),
        PointPlacement::Overlapping { candidates } => Ok(candidates
            .into_iter()
            .find(|pose| pose.landblock_id == target.landblock_id)),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests;

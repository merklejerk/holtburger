//! TUI-specific spatial hacks for geometry-blind local movement.
//!
//! The terminal client does not consume cell/environment geometry, so it cannot
//! reproduce the retail client's local collision and slope/stair resolution.
//! That means the normal planar movement model is insufficient for frontend
//! automation when a target is reachable only by changing Z.
//!
//! `TuiSpatialPhysics` is an intentional cheat layer that rewrites the local
//! player's runtime solve toward the active navigation target in full 3D while
//! navigation automation is active. It exists only to make the TUI's local
//! runtime body follow the same broad path the real client would have achieved
//! through local collision resolution plus `AutonomousPosition` updates.
//!
//! This module is not authoritative gameplay physics, and it should not be used
//! as a model for shared client/world behavior.

use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_world::{
    BasicSpatialPhysics, ContactState, SpatialPhysics, SpatialScene, SpatialSolveBatch,
    SpatialSolveRequest,
};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TuiSpatialHackConfig {
    /// When active navigation is being cheated in 3D, keep the local runtime
    /// body grounded so downstream movement handling behaves like the TUI is
    /// still doing ordinary on-ground travel.
    pub force_grounded: bool,
}

impl Default for TuiSpatialHackConfig {
    fn default() -> Self {
        Self {
            force_grounded: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct TuiSpatialHackState {
    /// The local player currently eligible for TUI-specific runtime-body hacks.
    local_player_guid: Option<Guid>,
    /// The active TUI-only dishonest steering directive. `None` means runtime
    /// movement should remain whatever the underlying solver produced.
    navigation_directive: Option<TuiNavigationDirective>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TuiNavigationDirective {
    pub target_pose: WorldPosition,
    pub world_speed_mps: f32,
}

#[derive(Debug, Clone, Default)]
/// Shared TUI-only state used to feed active navigation target information into
/// the dishonest spatial solver.
pub struct TuiSpatialHackHandle {
    state: Arc<Mutex<TuiSpatialHackState>>,
}

impl TuiSpatialHackHandle {
    /// Updates the currently active local player and dishonest steering
    /// directive for the TUI spatial hack. When `navigation_directive` is
    /// `None`, the hack is considered inactive.
    pub fn set_navigation_directive(
        &self,
        local_player_guid: Option<Guid>,
        navigation_directive: Option<TuiNavigationDirective>,
    ) {
        let mut state = self
            .state
            .lock()
            .expect("tui spatial hack state lock poisoned");
        state.local_player_guid = local_player_guid;
        state.navigation_directive = navigation_directive;
    }

    fn snapshot(&self) -> TuiSpatialHackState {
        *self
            .state
            .lock()
            .expect("tui spatial hack state lock poisoned")
    }
}

/// TUI-only `SpatialPhysics` decorator that intentionally lies about local
/// runtime-body movement.
///
/// The wrapped solver still determines the baseline kinematic step. When the
/// TUI publishes an active dishonest navigation directive for the local player,
/// this decorator can advance the runtime body toward that target in full 3D
/// even if the baseline solve itself had no useful motion.
pub struct TuiSpatialPhysics {
    base: Arc<dyn SpatialPhysics>,
    config: TuiSpatialHackConfig,
    hacks: TuiSpatialHackHandle,
}

impl TuiSpatialPhysics {
    /// Builds a `TuiSpatialPhysics` instance with an internal hack-state handle.
    pub fn new(base: Arc<dyn SpatialPhysics>, config: TuiSpatialHackConfig) -> Self {
        Self::with_handle(base, config, TuiSpatialHackHandle::default())
    }

    /// Builds a `TuiSpatialPhysics` instance that shares hack-state with an
    /// external owner such as the TUI game page.
    pub fn with_handle(
        base: Arc<dyn SpatialPhysics>,
        config: TuiSpatialHackConfig,
        hacks: TuiSpatialHackHandle,
    ) -> Self {
        Self {
            base,
            config,
            hacks,
        }
    }

    /// Returns the shared hack-state handle so TUI navigation code can publish
    /// the active local steering directive that should receive dishonest 3D
    /// runtime-body movement.
    pub fn hack_handle(&self) -> TuiSpatialHackHandle {
        self.hacks.clone()
    }

    /// Reprojects a solved step toward the active navigation target in full 3D,
    /// borrowing either the baseline solve's planar movement budget or the
    /// dishonest world-speed budget for the tick.
    fn target_directed_pose(
        &self,
        start_pose: WorldPosition,
        solved_pose: WorldPosition,
        solved_velocity: Vector3,
        dt_secs: f32,
        directive: TuiNavigationDirective,
    ) -> Option<(WorldPosition, Vector3)> {
        if dt_secs <= f32::EPSILON {
            return None;
        }

        let start_global = start_pose.global_coords();
        let solved_global = solved_pose.global_coords();
        let target_global = directive.target_pose.global_coords();
        let delta = target_global - start_global;
        let distance = delta.length();
        if distance <= f32::EPSILON {
            return None;
        }

        let planar_delta = Vector3::new(delta.x, delta.y, 0.0);
        let planar_distance = planar_delta.length();
        let solved_planar_step = Vector3::new(
            solved_global.x - start_global.x,
            solved_global.y - start_global.y,
            0.0,
        )
        .length();
        let solved_planar_speed = Vector3::new(solved_velocity.x, solved_velocity.y, 0.0).length();
        let baseline_planar_budget = solved_planar_step.max(solved_planar_speed * dt_secs);
        let fallback_planar_budget = directive.world_speed_mps.max(0.0) * dt_secs;
        let using_fallback_budget = baseline_planar_budget <= f32::EPSILON;

        let step_scale = if using_fallback_budget {
            if fallback_planar_budget <= f32::EPSILON {
                return None;
            }
            if planar_distance <= f32::EPSILON {
                (fallback_planar_budget / distance).min(1.0)
            } else {
                (fallback_planar_budget / planar_distance).min(1.0)
            }
        } else if planar_distance <= f32::EPSILON {
            1.0
        } else {
            (baseline_planar_budget / planar_distance).min(1.0)
        };

        let next_global = start_global + (delta * step_scale);
        // Indoor cheating intentionally snaps intermediate poses into the
        // target's landblock/cell frame. The TUI does not have topology data,
        // and this hack exists to bias the local runtime body toward where the
        // target actually lives rather than preserving the starting cell.
        let projection_anchor = if start_pose.is_indoors() || directive.target_pose.is_indoors() {
            directive.target_pose
        } else {
            start_pose
        };
        let next_pose = if step_scale >= 1.0 - 1e-6 {
            WorldPosition {
                rotation: solved_pose.rotation,
                ..directive.target_pose
            }
        } else {
            world_position_from_global_coords(projection_anchor, next_global, solved_pose.rotation)
        };
        let next_velocity = if using_fallback_budget || step_scale >= 1.0 - 1e-6 {
            (next_global - start_global) / dt_secs
        } else {
            Vector3::new(solved_velocity.x, solved_velocity.y, 0.0)
        };

        Some((next_pose, next_velocity))
    }
}

/// Rebuilds a `WorldPosition` from global coordinates while preserving the
/// original low-word cell portion of the landblock id.
fn world_position_from_global_coords(
    template: WorldPosition,
    global_coords: Vector3,
    rotation: Quaternion,
) -> WorldPosition {
    if template.is_indoors() {
        // Indoor positions cannot be reconstructed from global landblock math
        // the way outdoor positions can. Keep the chosen template cell and
        // only translate its local coordinates by the solved global delta.
        let start_global = template.global_coords();
        return WorldPosition {
            landblock_id: template.landblock_id,
            coords: template.coords + (global_coords - start_global),
            rotation,
        };
    }

    let landblock_x =
        (global_coords.x.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let landblock_y =
        (global_coords.y.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let low_word = template.landblock_id.0 & 0xFFFF;

    WorldPosition {
        landblock_id: Guid((landblock_x << 24) | (landblock_y << 16) | low_word),
        coords: Vector3::new(
            global_coords.x.rem_euclid(METERS_PER_LANDBLOCK),
            global_coords.y.rem_euclid(METERS_PER_LANDBLOCK),
            global_coords.z,
        ),
        rotation,
    }
}

impl Default for TuiSpatialPhysics {
    fn default() -> Self {
        Self::new(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig::default(),
        )
    }
}

impl SpatialPhysics for TuiSpatialPhysics {
    fn solve(&self, request: &SpatialSolveRequest, scene: &mut SpatialScene) -> SpatialSolveBatch {
        let mut batch = self.base.solve(request, scene);

        let hacks = self.hacks.snapshot();
        for solved in &mut batch.solved {
            if Some(solved.actor_id) != hacks.local_player_guid {
                continue;
            }

            // Only the actively navigated local player gets the dishonest 3D
            // steering and optional grounded-contact override.
            let has_active_navigation = hacks.navigation_directive.is_some();

            if let Some(directive) = hacks.navigation_directive
                && let Some(actor) = request.actors.iter().find(|actor| actor.actor_id == solved.actor_id)
                && let Some((pose, velocity)) = self.target_directed_pose(
                    actor.pose,
                    solved.pose,
                    solved.velocity,
                    request.dt.as_secs_f32(),
                    directive,
                )
            {
                solved.pose = pose;
                solved.velocity = velocity;
            }

            if self.config.force_grounded && has_active_navigation {
                solved.contact = ContactState::Grounded;
            }
        }

        batch
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_world::{SolveActorInput, SpatialScene};
    use smallvec::smallvec;
    use std::time::Duration;

    #[test]
    fn tui_spatial_physics_moves_local_player_toward_navigation_target_in_3d() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let hacks = TuiSpatialHackHandle::default();
        hacks.set_navigation_directive(
            Some(Guid(0x5000_0001)),
            Some(TuiNavigationDirective {
                target_pose: WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 38.0, 39.0),
                    rotation: Quaternion::identity(),
                },
                world_speed_mps: 18.0,
            }),
        );
        let physics = TuiSpatialPhysics::with_handle(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig { force_grounded: true },
            hacks,
        );
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(500),
            actors: smallvec![SolveActorInput {
                actor_id: Guid(0x5000_0001),
                pose: WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 20.0, 30.0),
                    rotation: Quaternion::identity(),
                },
                velocity: Vector3::new(0.0, 18.0, 0.0),
                omega: Vector3::zero(),
            }],
        };

        let batch = physics.solve(&request, &mut scene);

        assert_eq!(batch.solved.len(), 1);
        assert_eq!(batch.solved[0].pose.coords.x, 10.0);
        assert!((batch.solved[0].pose.coords.y - 29.0).abs() < 1e-5);
        assert!(batch.solved[0].pose.coords.z > 30.0 && batch.solved[0].pose.coords.z < 39.0);
        assert!((batch.solved[0].velocity.y - 18.0).abs() < 1e-5);
        assert_eq!(batch.solved[0].velocity.z, 0.0);
        assert_eq!(batch.solved[0].contact, ContactState::Grounded);
    }

    #[test]
    fn tui_spatial_physics_can_finish_vertical_cheat_once_planar_budget_reaches_target() {
        let physics = TuiSpatialPhysics::default();

        let projected = physics
            .target_directed_pose(
                WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 20.0, 30.0),
                    rotation: Quaternion::identity(),
                },
                WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 29.0, 30.0),
                    rotation: Quaternion::identity(),
                },
                Vector3::new(0.0, 18.0, 0.0),
                0.5,
                TuiNavigationDirective {
                    target_pose: WorldPosition {
                        landblock_id: Guid(0x1234_0000),
                        coords: Vector3::new(10.0, 29.0, 39.0),
                        rotation: Quaternion::identity(),
                    },
                    world_speed_mps: 18.0,
                },
            )
            .expect("planar budget should allow snapping to elevated target");

        assert_eq!(projected.0.coords, Vector3::new(10.0, 29.0, 39.0));
    }

    #[test]
    fn tui_spatial_physics_only_mutates_local_player_in_multi_actor_batches() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let hacks = TuiSpatialHackHandle::default();
        hacks.set_navigation_directive(
            Some(Guid(0x5000_0001)),
            Some(TuiNavigationDirective {
                target_pose: WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 29.0, 39.0),
                    rotation: Quaternion::identity(),
                },
                world_speed_mps: 18.0,
            }),
        );
        let physics = TuiSpatialPhysics::with_handle(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig { force_grounded: true },
            hacks,
        );
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(500),
            actors: smallvec![
                SolveActorInput {
                    actor_id: Guid(0x5000_0001),
                    pose: WorldPosition {
                        landblock_id: Guid(0x1234_0000),
                        coords: Vector3::new(10.0, 20.0, 30.0),
                        rotation: Quaternion::identity(),
                    },
                    velocity: Vector3::new(0.0, 18.0, 0.0),
                    omega: Vector3::zero(),
                },
                SolveActorInput {
                    actor_id: Guid(0x5000_0002),
                    pose: WorldPosition {
                        landblock_id: Guid(0x1234_0000),
                        coords: Vector3::new(11.0, 21.0, 31.0),
                        rotation: Quaternion::identity(),
                    },
                    velocity: Vector3::zero(),
                    omega: Vector3::zero(),
                }
            ],
        };

        let batch = physics.solve(&request, &mut scene);

        assert_eq!(batch.solved.len(), 2);
        assert!(batch.solved[0].pose.coords.z > 30.0);
        assert_eq!(batch.solved[0].contact, ContactState::Grounded);
        assert_eq!(batch.solved[1].pose.coords.z, 31.0);
        assert_eq!(batch.solved[1].contact, ContactState::Unknown);
    }

    #[test]
    fn tui_spatial_physics_leaves_planar_motion_when_no_navigation_target_is_set() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let hacks = TuiSpatialHackHandle::default();
        hacks.set_navigation_directive(Some(Guid(0x5000_0001)), None);
        let physics = TuiSpatialPhysics::with_handle(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig { force_grounded: true },
            hacks,
        );
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(500),
            actors: smallvec![SolveActorInput {
                actor_id: Guid(0x5000_0001),
                pose: WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 20.0, 30.0),
                    rotation: Quaternion::identity(),
                },
                velocity: Vector3::new(0.0, 18.0, 0.0),
                omega: Vector3::zero(),
            }],
        };

        let batch = physics.solve(&request, &mut scene);

        assert_eq!(batch.solved.len(), 1);
        assert_eq!(batch.solved[0].pose.coords.y, 29.0);
        assert_eq!(batch.solved[0].pose.coords.z, 30.0);
        assert_eq!(batch.solved[0].contact, ContactState::Unknown);
    }

    #[test]
    fn tui_spatial_physics_keeps_indoor_landblock_stable() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let hacks = TuiSpatialHackHandle::default();
        hacks.set_navigation_directive(
            Some(Guid(0x5000_0001)),
            Some(TuiNavigationDirective {
                target_pose: WorldPosition {
                    landblock_id: Guid(0x016C_0171),
                    coords: Vector3::new(12.0, -40.0, 0.004999995),
                    rotation: Quaternion::identity(),
                },
                world_speed_mps: 4.5147824,
            }),
        );
        let physics = TuiSpatialPhysics::with_handle(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig { force_grounded: true },
            hacks,
        );
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(200),
            actors: smallvec![SolveActorInput {
                actor_id: Guid(0x5000_0001),
                pose: WorldPosition {
                    landblock_id: Guid(0x016C_0171),
                    coords: Vector3::new(14.753336, -54.60388, 0.004999995),
                    rotation: Quaternion::identity(),
                },
                velocity: Vector3::new(3.9111443, -2.2550743, 0.0),
                omega: Vector3::zero(),
            }],
        };

        let batch = physics.solve(&request, &mut scene);

        assert_eq!(batch.solved.len(), 1);
        assert_eq!(batch.solved[0].pose.landblock_id, Guid(0x016C_0171));
        assert!(batch.solved[0].pose.coords.y < 0.0);
    }

    #[test]
    fn tui_spatial_physics_anchors_cross_landblock_indoor_targets_to_target_cell() {
        let physics = TuiSpatialPhysics::default();

        let projected = physics.target_directed_pose(
            WorldPosition {
                landblock_id: Guid(0x016C_0171),
                coords: Vector3::new(14.753336, -54.60388, 0.004999995),
                rotation: Quaternion::identity(),
            },
            WorldPosition {
                landblock_id: Guid(0x016C_0171),
                coords: Vector3::new(14.753336, -54.60388, 0.004999995),
                rotation: Quaternion::identity(),
            },
            Vector3::new(3.9111443, -2.2550743, 0.0),
            0.2,
            TuiNavigationDirective {
                target_pose: WorldPosition {
                    landblock_id: Guid(0x016B_0171),
                    coords: Vector3::new(18.742691, 135.1211, 0.004999995),
                    rotation: Quaternion::identity(),
                },
                world_speed_mps: 4.5147824,
            },
        )
        .expect("cross-cell indoor cheat should still project a pose");

        assert_eq!(projected.0.landblock_id, Guid(0x016B_0171));
        assert_ne!(projected.0.coords, Vector3::new(18.742691, 135.1211, 0.004999995));
        assert!(projected.1.length() > 0.0);
    }
}

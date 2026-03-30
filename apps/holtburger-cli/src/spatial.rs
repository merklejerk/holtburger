use holtburger_common::position::{METERS_PER_LANDBLOCK, WorldPosition};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_world::{
    BasicSpatialPhysics, ContactState, SpatialPhysics, SpatialScene, SpatialSolveBatch,
    SpatialSolveRequest,
};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TuiSpatialHackConfig {
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
    local_player_guid: Option<Guid>,
    navigation_target_pose: Option<WorldPosition>,
}

#[derive(Debug, Clone, Default)]
pub struct TuiSpatialHackHandle {
    state: Arc<Mutex<TuiSpatialHackState>>,
}

impl TuiSpatialHackHandle {
    pub fn set_navigation_target(
        &self,
        local_player_guid: Option<Guid>,
        navigation_target_pose: Option<WorldPosition>,
    ) {
        let mut state = self
            .state
            .lock()
            .expect("tui spatial hack state lock poisoned");
        state.local_player_guid = local_player_guid;
        state.navigation_target_pose = navigation_target_pose;
    }

    fn snapshot(&self) -> TuiSpatialHackState {
        *self
            .state
            .lock()
            .expect("tui spatial hack state lock poisoned")
    }
}

pub struct TuiSpatialPhysics {
    base: Arc<dyn SpatialPhysics>,
    config: TuiSpatialHackConfig,
    hacks: TuiSpatialHackHandle,
}

impl TuiSpatialPhysics {
    pub fn new(base: Arc<dyn SpatialPhysics>, config: TuiSpatialHackConfig) -> Self {
        Self::with_handle(base, config, TuiSpatialHackHandle::default())
    }

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

    pub fn hack_handle(&self) -> TuiSpatialHackHandle {
        self.hacks.clone()
    }

    fn target_directed_pose(
        &self,
        start_pose: WorldPosition,
        solved_pose: WorldPosition,
        velocity: Vector3,
        dt_secs: f32,
        target_pose: WorldPosition,
    ) -> Option<(WorldPosition, Vector3)> {
        let speed_mps = velocity.length();
        if dt_secs <= f32::EPSILON || speed_mps <= f32::EPSILON {
            return None;
        }

        let start_global = start_pose.global_coords();
        let target_global = target_pose.global_coords();
        let delta = target_global - start_global;
        let distance = delta.length();
        if distance <= f32::EPSILON {
            return None;
        }

        let max_step = speed_mps * dt_secs;
        let step_scale = (max_step / distance).min(1.0);
        let next_global = start_global + (delta * step_scale);
        let next_pose = if step_scale >= 1.0 - 1e-6 {
            WorldPosition {
                rotation: solved_pose.rotation,
                ..target_pose
            }
        } else {
            world_position_from_global_coords(start_pose, next_global, solved_pose.rotation)
        };
        let next_velocity = (next_global - start_global) / dt_secs;

        Some((next_pose, next_velocity))
    }
}

fn world_position_from_global_coords(
    template: WorldPosition,
    global_coords: Vector3,
    rotation: Quaternion,
) -> WorldPosition {
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

            let has_active_navigation = hacks.navigation_target_pose.is_some();

            if let Some(target_pose) = hacks.navigation_target_pose
                && let Some(actor) = request.actors.iter().find(|actor| actor.actor_id == solved.actor_id)
                && let Some((pose, velocity)) = self.target_directed_pose(
                    actor.pose,
                    solved.pose,
                    actor.velocity,
                    request.dt.as_secs_f32(),
                    target_pose,
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
        hacks.set_navigation_target(
            Some(Guid(0x5000_0001)),
            Some(WorldPosition {
                landblock_id: Guid(0x1234_0000),
                coords: Vector3::new(10.0, 29.0, 39.0),
                rotation: Quaternion::identity(),
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
        assert!(batch.solved[0].pose.coords.y > 20.0 && batch.solved[0].pose.coords.y < 29.0);
        assert!(batch.solved[0].pose.coords.z > 30.0 && batch.solved[0].pose.coords.z < 39.0);
        assert!(batch.solved[0].velocity.z > 0.0);
        assert_eq!(batch.solved[0].contact, ContactState::Grounded);
    }

    #[test]
    fn tui_spatial_physics_only_mutates_local_player_in_multi_actor_batches() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let hacks = TuiSpatialHackHandle::default();
        hacks.set_navigation_target(
            Some(Guid(0x5000_0001)),
            Some(WorldPosition {
                landblock_id: Guid(0x1234_0000),
                coords: Vector3::new(10.0, 29.0, 39.0),
                rotation: Quaternion::identity(),
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
        hacks.set_navigation_target(Some(Guid(0x5000_0001)), None);
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
}

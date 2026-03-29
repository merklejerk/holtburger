use holtburger_world::{
    BasicSpatialPhysics, ContactState, SpatialPhysics, SpatialScene, SpatialSolveBatch,
    SpatialSolveRequest,
};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TuiSpatialHackConfig {
    pub local_z_offset: f32,
    pub force_grounded: bool,
}

impl Default for TuiSpatialHackConfig {
    fn default() -> Self {
        Self {
            local_z_offset: 0.0,
            force_grounded: true,
        }
    }
}

pub struct TuiSpatialPhysics {
    base: Arc<dyn SpatialPhysics>,
    config: TuiSpatialHackConfig,
}

impl TuiSpatialPhysics {
    pub fn new(base: Arc<dyn SpatialPhysics>, config: TuiSpatialHackConfig) -> Self {
        Self { base, config }
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

        if request.actors.len() != 1 {
            return batch;
        }

        for solved in &mut batch.solved {
            solved.pose.coords.z += self.config.local_z_offset;
            if self.config.force_grounded {
                solved.contact = ContactState::Grounded;
            }
        }

        batch
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_world::{SolveActorInput, SpatialScene};
    use smallvec::smallvec;
    use std::time::Duration;

    #[test]
    fn tui_spatial_physics_forces_grounded_and_applies_z_offset_for_single_actor() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let physics = TuiSpatialPhysics::new(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig {
                local_z_offset: 3.5,
                force_grounded: true,
            },
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
        assert_eq!(batch.solved[0].pose.coords.y, 29.0);
        assert_eq!(batch.solved[0].pose.coords.z, 33.5);
        assert_eq!(batch.solved[0].contact, ContactState::Grounded);
    }

    #[test]
    fn tui_spatial_physics_does_not_mutate_multi_actor_batches() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(BasicSpatialPhysics));
        let physics = TuiSpatialPhysics::new(
            Arc::new(BasicSpatialPhysics),
            TuiSpatialHackConfig {
                local_z_offset: 3.5,
                force_grounded: true,
            },
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
                    velocity: Vector3::zero(),
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
        assert_eq!(batch.solved[0].pose.coords.z, 30.0);
        assert_eq!(batch.solved[0].contact, ContactState::Unknown);
        assert_eq!(batch.solved[1].pose.coords.z, 31.0);
        assert_eq!(batch.solved[1].contact, ContactState::Unknown);
    }
}

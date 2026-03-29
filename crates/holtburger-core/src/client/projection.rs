//! Thin client-view spatial bridge over scene-owned runtime sampling.
//!
//! Runtime interpolation, dead reckoning, and suspension now live in `holtburger-world`
//! [`SpatialScene`](holtburger_world::SpatialScene) bodies. Consumers still feed
//! [`ClientViewEvent`] deltas into a [`ClientViewSpatialBridge`], but the bridge only updates and
//! reads scene-owned sampling state rather than maintaining a second predictive cache.
//!
//! Typical render-loop usage:
//!
//! ```rust,ignore
//! use std::time::Instant;
//! use holtburger_core::client::projection::{ClientViewSpatialBridge, ProjectionConfig};
//! use holtburger_core::client::types::ClientViewEvent;
//! use holtburger_world::SpatialScene;
//!
//! struct SceneFrame {
//!     spatial_bridge: ClientViewSpatialBridge,
//!     scene: SpatialScene,
//! }
//!
//! impl SceneFrame {
//!     fn on_view_event(&mut self, event: &ClientViewEvent) {
//!         self.spatial_bridge
//!             .handle_view_event(&mut self.scene, event, Instant::now());
//!     }
//!
//!     fn render(&mut self, now: Instant) {
//!         self.spatial_bridge.tick(&mut self.scene, now);
//!
//!         for entity in self.spatial_bridge.iter_projected_entities(&self.scene) {
//!             self.update_scene_node(entity.guid, entity.projected_pose);
//!         }
//!     }
//!
//!     fn update_scene_node(
//!         &mut self,
//!         guid: holtburger_common::Guid,
//!         pose: holtburger_common::position::WorldPosition,
//!     ) {
//!         let _ = (guid, pose);
//!     }
//! }
//!
//! let spatial_bridge = ClientViewSpatialBridge::new(ProjectionConfig::default());
//! let _scene = spatial_bridge.new_scene();
//! ```

use crate::client::types::ClientViewEvent;
use holtburger_common::position::WorldPosition;
use holtburger_common::Guid;
use holtburger_world::{
    NoopSpatialPhysics, SpatialBodyId, SpatialEntitySample, SpatialProjectedEntityState,
    SpatialSampleMode, SpatialSamplingConfig, SpatialScene,
};
use std::sync::Arc;
use std::time::Instant;

#[cfg(test)]
use holtburger_common::math::Quaternion;
#[cfg(test)]
use holtburger_common::Vector3;
#[cfg(test)]
use holtburger_world::entity::Entity;
#[cfg(test)]
use holtburger_world::entity::EntityMotionSnapshot;
#[cfg(test)]
use std::time::Duration;

pub type ProjectionMode = SpatialSampleMode;
pub type ProjectedEntityState = SpatialProjectedEntityState;
pub type EntitySpatialSample = SpatialEntitySample;

pub type ProjectionConfig = SpatialSamplingConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientViewSpatialBridge {
    config: ProjectionConfig,
}

impl Default for ClientViewSpatialBridge {
    fn default() -> Self {
        Self::new(ProjectionConfig::default())
    }
}

impl ClientViewSpatialBridge {
    pub fn new(config: ProjectionConfig) -> Self {
        Self { config }
    }

    pub fn new_scene(&self) -> SpatialScene {
        let mut scene = SpatialScene::new_with_physics(Arc::new(NoopSpatialPhysics));
        scene.body_sampling_config = self.config;
        scene
    }

    fn sync_scene_config(&self, scene: &mut SpatialScene) {
        scene.body_sampling_config = self.config;
    }

    pub fn handle_view_event(
        &self,
        scene: &mut SpatialScene,
        event: &ClientViewEvent,
        now: Instant,
    ) {
        self.sync_scene_config(scene);
        match event {
            ClientViewEvent::EntitySpawned { entity }
            | ClientViewEvent::EntityReplaced { entity }
            | ClientViewEvent::EntityIdentified { entity } => {
                scene.upsert_sampling_snapshot(
                    SpatialBodyId::Entity(entity.guid),
                    entity.position,
                    entity.velocity,
                    entity.omega,
                    entity.motion_snapshot,
                    now,
                );
            }
            ClientViewEvent::EntityMoved { guid, pos } => {
                scene.update_sampling_authoritative_pose(
                    SpatialBodyId::Entity(*guid),
                    *pos,
                    scene.body(SpatialBodyId::Entity(*guid)).is_none(),
                    now,
                );
            }
            ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity,
                omega,
            } => {
                scene.update_sampling_kinematics(
                    SpatialBodyId::Entity(*guid),
                    *velocity,
                    *omega,
                );
            }
            ClientViewEvent::EntityMotionUpdated { guid, snapshot } => {
                scene.update_sampling_motion_state(SpatialBodyId::Entity(*guid), *snapshot);
            }
            ClientViewEvent::ForcedReposition { guid, pos, .. } => {
                scene.reset_sampling_body(SpatialBodyId::Entity(*guid), *pos, now, true);
            }
            ClientViewEvent::TeleportStarted { .. } => {
                scene.suspend_all_sampling(now);
            }
            ClientViewEvent::EntityDespawned { guid } => {
                scene.remove_guid_bodies(*guid);
            }
            _ => {}
        }
    }

    pub fn tick(&self, scene: &mut SpatialScene, now: Instant) {
        self.sync_scene_config(scene);
        scene.tick_sampling(now);
    }

    pub fn reset_entity(&self, scene: &mut SpatialScene, guid: Guid) {
        scene.remove_guid_bodies(guid);
    }

    pub fn clear(&self, scene: &mut SpatialScene) {
        scene.bodies.clear();
    }

    pub fn projected_entity(&self, scene: &SpatialScene, guid: Guid) -> Option<ProjectedEntityState> {
        scene.projected_entity_state(guid)
    }

    pub fn spatial_sample(&self, scene: &SpatialScene, guid: Guid) -> Option<EntitySpatialSample> {
        scene.spatial_sample(guid)
    }

    pub fn projected_pose(&self, scene: &SpatialScene, guid: Guid) -> Option<WorldPosition> {
        self.projected_entity(scene, guid)
            .map(|entity| entity.projected_pose)
    }

    pub fn authoritative_pose(&self, scene: &SpatialScene, guid: Guid) -> Option<WorldPosition> {
        scene.projected_entity_state(guid).map(|entity| entity.authoritative_pose)
    }

    /// Returns the current projected scene view for batch consumers such as renderers.
    ///
    /// Each item retains both authoritative and projected poses so callers can update visual
    /// transforms from `projected_pose` without losing access to the last server-authored pose.
    pub fn iter_projected_entities<'a>(
        &self,
        scene: &'a SpatialScene,
    ) -> impl Iterator<Item = ProjectedEntityState> + 'a {
        scene.iter_projected_entities()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::movement::InterpretedMotionCommand;

    struct ProjectionHarness {
        system: super::ClientViewSpatialBridge,
        scene: SpatialScene,
    }

    impl ProjectionHarness {
        fn new(config: ProjectionConfig) -> Self {
            let system = super::ClientViewSpatialBridge::new(config);
            let scene = system.new_scene();
            Self { system, scene }
        }

        fn handle_view_event(&mut self, event: &ClientViewEvent, now: Instant) {
            self.system.handle_view_event(&mut self.scene, event, now);
        }

        fn tick(&mut self, now: Instant) {
            self.system.tick(&mut self.scene, now);
        }

        fn clear(&mut self) {
            self.system.clear(&mut self.scene);
        }

        fn projected_entity(&self, guid: Guid) -> Option<ProjectedEntityState> {
            self.system.projected_entity(&self.scene, guid)
        }

        fn iter_projected_entities(&self) -> impl Iterator<Item = ProjectedEntityState> + '_ {
            self.system.iter_projected_entities(&self.scene)
        }
    }

    type ClientViewSpatialBridge = ProjectionHarness;

    fn make_position(x: f32, y: f32, heading_rad: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading_rad),
        }
    }

    fn make_entity(guid: Guid, position: WorldPosition) -> Entity {
        Entity::new(guid, "Drudge".to_string(), position)
    }

    #[test]
    fn despawn_and_clear_remove_projection_state() {
        let guid = Guid(0x5000_0006);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(0.0, 0.0, 0.0));

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(entity),
            },
            start,
        );
        assert!(system.projected_entity(guid).is_some());

        system.handle_view_event(&ClientViewEvent::EntityDespawned { guid }, start);
        assert!(system.projected_entity(guid).is_none());

        let entity = make_entity(guid, make_position(1.0, 0.0, 0.0));
        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(entity),
            },
            start,
        );
        assert!(system.projected_entity(guid).is_some());

        system.clear();
        assert!(system.projected_entity(guid).is_none());
        assert_eq!(system.iter_projected_entities().count(), 0);
    }

    #[test]
    fn forced_reposition_clears_stale_kinematics() {
        let guid = Guid(0x5000_0007);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(10.0, 20.0, 0.5));

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(entity),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::new(0.0, 0.0, 1.0),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::EntityMotionUpdated {
                guid,
                snapshot: Some(EntityMotionSnapshot {
                    forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                    forward_speed: Some(
                        holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                            .expect("speed should encode"),
                    ),
                    ..Default::default()
                }),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::ForcedReposition {
                guid,
                pos: make_position(100.0, 50.0, 1.5),
                sequence: 42,
            },
            start + Duration::from_millis(50),
        );

        system.tick(start + Duration::from_millis(200));

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.velocity, Vector3::zero());
        assert_eq!(projected.omega, Vector3::zero());
        assert_eq!(projected.motion_state, None);
        assert_eq!(projected.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(projected.projected_pose, make_position(100.0, 50.0, 1.5));
    }

    #[test]
    fn ordinary_authoritative_move_preserves_existing_motion_state() {
        let guid = Guid(0x5000_0008);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });
        let entity = make_entity(guid, make_position(0.0, 0.0, 0.0));

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(entity),
            },
            start,
        );
        let snapshot = EntityMotionSnapshot {
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        };
        system.handle_view_event(
            &ClientViewEvent::EntityMotionUpdated {
                guid,
                snapshot: Some(snapshot),
            },
            start,
        );

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(3.0, 4.0, 0.5),
            },
            start + Duration::from_millis(50),
        );

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.motion_state, Some(snapshot));
        assert_eq!(projected.authoritative_pose, make_position(3.0, 4.0, 0.5));
    }

    #[test]
    fn first_authoritative_move_bootstraps_without_interpolation() {
        let guid = Guid(0x5000_0009);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(3.0, 4.0, 0.5),
            },
            start,
        );

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(projected.authoritative_pose, make_position(3.0, 4.0, 0.5));
        assert_eq!(projected.projected_pose, make_position(3.0, 4.0, 0.5));
    }

    #[test]
    fn teleport_suspension_requires_authoritative_resume() {
        let guid = Guid(0x5000_000A);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(1.0, 2.0, 0.25));

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(entity),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::TeleportStarted { sequence: 7 },
            start + Duration::from_millis(10),
        );

        system.handle_view_event(
            &ClientViewEvent::EntityMotionUpdated {
                guid,
                snapshot: Some(EntityMotionSnapshot {
                    turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                    turn_speed: Some(
                        holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                            .expect("speed should encode"),
                    ),
                    ..Default::default()
                }),
            },
            start + Duration::from_millis(20),
        );

        let suspended = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(suspended.projection_mode, ProjectionMode::Suspended);

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(5.0, 6.0, 0.5),
            },
            start + Duration::from_millis(30),
        );

        let resumed = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(resumed.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(resumed.projected_pose, make_position(5.0, 6.0, 0.5));
    }

    #[test]
    fn authoritative_snapshot_resumes_suspended_projection() {
        let guid = Guid(0x5000_000B);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(1.0, 2.0, 0.25));

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(entity),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::TeleportStarted { sequence: 7 },
            start + Duration::from_millis(10),
        );

        let mut resumed_entity = make_entity(guid, make_position(8.0, 9.0, 1.0));
        resumed_entity.velocity = Vector3::new(1.0, 0.0, 0.0);
        system.handle_view_event(
            &ClientViewEvent::EntityIdentified {
                entity: Box::new(resumed_entity),
            },
            start + Duration::from_millis(20),
        );

        let resumed = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(resumed.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(resumed.projected_pose, make_position(8.0, 9.0, 1.0));
        assert_eq!(resumed.velocity, Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn partial_kinematics_updates_do_not_create_projection_entries() {
        let guid = Guid(0x5000_000D);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());

        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::zero(),
            },
            start,
        );

        assert!(system.projected_entity(guid).is_none());
        assert_eq!(system.iter_projected_entities().count(), 0);
    }

    #[test]
    fn partial_motion_updates_do_not_create_projection_entries() {
        let guid = Guid(0x5000_000E);
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());

        system.handle_view_event(
            &ClientViewEvent::EntityMotionUpdated {
                guid,
                snapshot: Some(EntityMotionSnapshot {
                    turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                    turn_speed: Some(
                        holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                            .expect("speed should encode"),
                    ),
                    ..Default::default()
                }),
            },
            start,
        );

        assert!(system.projected_entity(guid).is_none());
        assert_eq!(system.iter_projected_entities().count(), 0);
    }

    #[test]
    fn iter_projected_entities_supports_batch_scene_updates() {
        let start = Instant::now();
        let mut system = ClientViewSpatialBridge::new(ProjectionConfig::default());
        let first_guid = Guid(0x5000_000F);
        let second_guid = Guid(0x5000_0010);

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(make_entity(first_guid, make_position(0.0, 0.0, 0.0))),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(make_entity(second_guid, make_position(10.0, 5.0, 0.25))),
            },
            start,
        );

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid: first_guid,
                pos: make_position(2.0, 0.0, 0.5),
            },
            start,
        );
        system.handle_view_event(&ClientViewEvent::TeleportStarted { sequence: 99 }, start);

        system.tick(start + Duration::from_millis(100));

        let scene_nodes: Vec<ProjectedEntityState> = system
            .iter_projected_entities()
            .collect();

        assert_eq!(scene_nodes.len(), 2);
        assert!(scene_nodes.iter().any(|entity| entity.guid == first_guid
            && entity.authoritative_pose == make_position(2.0, 0.0, 0.5)
            && entity.projection_mode == ProjectionMode::Suspended));
        assert!(scene_nodes.iter().any(|entity| entity.guid == second_guid
            && entity.authoritative_pose == make_position(10.0, 5.0, 0.25)
            && entity.projection_mode == ProjectionMode::Suspended));
    }
}

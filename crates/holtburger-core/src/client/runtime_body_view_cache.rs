//! Frontend runtime-body read cache over mirrored `ClientViewEvent` snapshots and deltas.
//!
//! Canonical runtime body state belongs to the world-owned spatial model. This module is a
//! mirrored read-model cache only; it does not own or advance runtime state.

use crate::client::types::ClientViewEvent;
use holtburger_common::position::WorldPosition;
use holtburger_common::Guid;
use holtburger_world::{
    entity::Entity, RuntimeSpatialBodyView, SpatialBodyId, SpatialEntitySample, SpatialSampleMode,
};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, Copy)]
struct CachedRuntimeBodyView {
    view: RuntimeSpatialBodyView,
}

#[derive(Debug, Clone)]
pub struct RuntimeBodyViewCache {
    bodies: HashMap<SpatialBodyId, CachedRuntimeBodyView>,
}

impl Default for RuntimeBodyViewCache {
    fn default() -> Self {
        Self {
            bodies: HashMap::new(),
        }
    }
}

impl RuntimeBodyViewCache {
    fn upsert_runtime_body(&mut self, body: RuntimeSpatialBodyView, received_at: Instant) {
        let _ = received_at;
        self.bodies.insert(
            body.body_id,
            CachedRuntimeBodyView { view: body },
        );
    }

    fn clear(&mut self) {
        self.bodies.clear();
    }

    pub fn apply_view_event(&mut self, event: &ClientViewEvent, now: Instant) {
        match event {
            ClientViewEvent::RuntimeBodySnapshot { bodies } => {
                self.clear();
                for body in bodies.iter().copied() {
                    self.upsert_runtime_body(body, now);
                }
            }
            ClientViewEvent::RuntimeBodyUpserted { body } => {
                self.upsert_runtime_body(**body, now);
            }
            ClientViewEvent::RuntimeBodyRemoved { body_id } => {
                self.bodies.remove(body_id);
            }
            ClientViewEvent::RuntimeBodiesReset { .. } | ClientViewEvent::Disconnected => {
                self.clear();
            }
            _ => {}
        }
    }

    pub fn reset_guid(&mut self, guid: Guid) {
        self.bodies.remove(&SpatialBodyId::Entity(guid));
        self.bodies.remove(&SpatialBodyId::LocalPlayer(guid));
    }

    pub fn runtime_body(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.bodies.get(&body_id).map(|cached| cached.view)
    }

    pub fn iter_runtime_bodies(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.bodies.values().map(|cached| cached.view)
    }

    fn resolve_guid_body(&self, guid: Guid) -> Option<&CachedRuntimeBodyView> {
        self.bodies
            .get(&SpatialBodyId::LocalPlayer(guid))
            .or_else(|| self.bodies.get(&SpatialBodyId::Entity(guid)))
    }

    fn spatial_sample_from_cached(
        view: &CachedRuntimeBodyView,
    ) -> Option<SpatialEntitySample> {
        let guid = view.view.body_id.authoritative_guid()?;
        let authoritative_pose = view.view.authoritative_pose.unwrap_or(view.view.runtime_pose);

        Some(SpatialEntitySample {
            guid,
            authoritative_pose,
            projected_pose: view.view.runtime_pose,
            velocity: view.view.velocity,
            omega: view.view.omega,
            motion_state: view.view.motion_state,
            projection_mode: view.view.sample_mode,
        })
    }

    pub fn spatial_sample(&self, guid: Guid) -> Option<SpatialEntitySample> {
        self.resolve_guid_body(guid)
            .and_then(Self::spatial_sample_from_cached)
    }

    pub fn projected_pose(&self, guid: Guid) -> Option<WorldPosition> {
        self.spatial_sample(guid)
            .map(|entity| entity.projected_pose)
    }

    pub fn authoritative_pose(&self, guid: Guid) -> Option<WorldPosition> {
        self.spatial_sample(guid)
            .map(|entity| entity.authoritative_pose)
    }

    pub fn spatial_sample_or_authoritative(&self, entity: &Entity) -> SpatialEntitySample {
        self.spatial_sample(entity.guid)
            .unwrap_or_else(|| SpatialEntitySample {
                guid: entity.guid,
                authoritative_pose: entity.position,
                projected_pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
                projection_mode: SpatialSampleMode::AuthoritativeOnly,
            })
    }

    pub fn iter_spatial_samples(&self) -> impl Iterator<Item = SpatialEntitySample> + '_ {
        self.bodies
            .values()
            .filter_map(Self::spatial_sample_from_cached)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::math::Quaternion;
    use holtburger_common::Vector3;
    use holtburger_world::RuntimeBodyResetCause;
    use std::time::Duration;


    struct CacheHarness {
        cache: RuntimeBodyViewCache,
    }

    impl CacheHarness {
        fn new() -> Self {
            Self {
                cache: RuntimeBodyViewCache::default(),
            }
        }

        fn handle_view_event(&mut self, event: &ClientViewEvent, now: Instant) {
            self.cache.apply_view_event(event, now);
        }

        fn spatial_sample(&self, guid: Guid) -> Option<SpatialEntitySample> {
            self.cache.spatial_sample(guid)
        }

        fn iter_spatial_samples(&self) -> impl Iterator<Item = SpatialEntitySample> + '_ {
            self.cache.iter_spatial_samples()
        }
    }

    fn make_position(x: f32, y: f32, heading_rad: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading_rad),
        }
    }

    fn make_runtime_body(body_id: SpatialBodyId, x: f32, y: f32) -> RuntimeSpatialBodyView {
        RuntimeSpatialBodyView {
            body_id,
            authoritative_pose: Some(make_position(x, y, 0.0)),
            runtime_pose: make_position(x + 1.0, y + 2.0, 0.25),
            velocity: Vector3::new(3.0, 0.0, 0.0),
            omega: Vector3::new(0.0, 0.0, 1.0),
            motion_state: None,
            contact: holtburger_world::ContactState::Grounded,
            sample_mode: SpatialSampleMode::SimulatingVelocity,
        }
    }

    #[test]
    fn runtime_snapshot_and_deltas_drive_runtime_body_cache() {
        let guid = Guid(0x5000_0006);
        let start = Instant::now();
        let mut system = CacheHarness::new();
        let initial = make_runtime_body(SpatialBodyId::Entity(guid), 10.0, 20.0);

        system.handle_view_event(
            &ClientViewEvent::RuntimeBodySnapshot {
                bodies: vec![initial].into(),
            },
            start,
        );

        let projected = system.spatial_sample(guid).expect("entity should exist");
        assert_eq!(projected.projected_pose, initial.runtime_pose);
        assert_eq!(projected.authoritative_pose, initial.authoritative_pose.unwrap());
        assert_eq!(projected.projection_mode, initial.sample_mode);

        system.handle_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(make_runtime_body(SpatialBodyId::Entity(guid), 30.0, 40.0)),
            },
            start + Duration::from_millis(50),
        );

        let updated = system.spatial_sample(guid).expect("entity should still exist");
        assert_eq!(updated.projected_pose, make_position(31.0, 42.0, 0.25));

        system.handle_view_event(
            &ClientViewEvent::RuntimeBodyRemoved {
                body_id: SpatialBodyId::Entity(guid),
            },
            start + Duration::from_millis(75),
        );

        assert!(system.spatial_sample(guid).is_none());
    }

    #[test]
    fn runtime_reset_clears_cache_and_tick_does_not_reanimate_it() {
        let guid = Guid(0x5000_0007);
        let start = Instant::now();
        let mut system = CacheHarness::new();

        system.handle_view_event(
            &ClientViewEvent::RuntimeBodySnapshot {
                bodies: vec![make_runtime_body(SpatialBodyId::Entity(guid), 0.0, 0.0)].into(),
            },
            start,
        );

        system.handle_view_event(
            &ClientViewEvent::RuntimeBodiesReset {
                cause: RuntimeBodyResetCause::Resync,
            },
            start + Duration::from_millis(20),
        );

        assert!(system.spatial_sample(guid).is_none());
        assert_eq!(system.iter_spatial_samples().count(), 0);
    }

    #[test]
    fn spatial_sample_or_authoritative_falls_back_when_runtime_body_is_missing() {
        let guid = Guid(0x5000_0008);
        let start = Instant::now();
        let mut system = CacheHarness::new();
        let entity = Entity::new(guid, "Drudge".to_string(), make_position(10.0, 20.0, 0.5));

        let authoritative = system.cache.spatial_sample_or_authoritative(&entity);
        assert_eq!(authoritative.projected_pose, entity.position);
        assert_eq!(authoritative.projection_mode, SpatialSampleMode::AuthoritativeOnly);

        system.handle_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(make_runtime_body(SpatialBodyId::Entity(guid), 10.0, 20.0)),
            },
            start,
        );

        let mirrored = system.cache.spatial_sample_or_authoritative(&entity);
        assert_eq!(mirrored.projected_pose, make_position(11.0, 22.0, 0.25));
        assert_eq!(mirrored.projection_mode, SpatialSampleMode::SimulatingVelocity);
    }
}
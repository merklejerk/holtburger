//! Source adapters that resolve content-authored geometry into world physical-body shapes.

use holtburger_common::{Sphere, Vector3};
use holtburger_dat::file_type::SetupModel;
#[cfg(test)]
use holtburger_world::PhysicalCollisionFilter;
use holtburger_world::{PhysicalBodyDefinitionError, PhysicalSphereSet};
use thiserror::Error;

/// Retail's collision fallback for a setup with no authored ordinary motion spheres.
///
/// `CPhysicsObj::transition` supplies this global sphere at scale one (`acclient.c:308364-308369`);
/// its initialization is at `acclient.c:749275-749278`.
pub const RETAIL_DUMMY_MOTION_SPHERE: Sphere = Sphere {
    center: Vector3 {
        x: 0.0,
        y: 0.0,
        z: 0.1,
    },
    radius: 0.1,
};

/// Invalid setup/runtime data rejected before physical-body registration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum SetupPhysicalShapeError {
    /// Runtime whole-object scale must preserve finite, positive motion geometry.
    #[error("physical-body runtime object scale must be finite and positive")]
    InvalidObjectScale,
    /// Authored or scaled sphere geometry violates the world body contract.
    #[error(transparent)]
    InvalidGeometry(#[from] PhysicalBodyDefinitionError),
}

/// Resolves the retail motion-sphere subset for one setup and runtime whole-object scale.
///
/// Retail retains the first two ordinary spheres in source order and uniformly scales both their
/// centers and radii (`SPHEREPATH::init_sphere`, `acclient.c:302241-302291`). The empty-setup dummy
/// is already world-sized and therefore deliberately bypasses the object's scale.
pub fn resolve_setup_physical_spheres(
    setup: &SetupModel,
    object_scale: f32,
) -> Result<PhysicalSphereSet, SetupPhysicalShapeError> {
    if !object_scale.is_finite() || object_scale <= 0.0 {
        return Err(SetupPhysicalShapeError::InvalidObjectScale);
    }

    let mut spheres = setup
        .spheres
        .iter()
        .take(2)
        .copied()
        .map(|sphere| scaled_sphere(sphere, object_scale));
    let primary = spheres.next().unwrap_or(RETAIL_DUMMY_MOTION_SPHERE);
    Ok(PhysicalSphereSet::new(primary, spheres.next())?)
}

fn scaled_sphere(sphere: Sphere, scale: f32) -> Sphere {
    Sphere {
        center: sphere.center * scale,
        radius: sphere.radius * scale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Guid, Quaternion};
    use holtburger_world::{
        CollisionScene, EdgeProtection, GroundedConfig, PhysicalBodyDefinition,
        PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
        PhysicalSurfaceMotion, RETAIL_WALKABLE_NORMAL_Z, SpatialBody, SpatialBodyId, SpatialScene,
    };
    use std::time::Instant;

    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        step_up_height: 0.6,
        step_down_height: 1.5,
        edge_protection: EdgeProtection::Creature,
        maximum_substep_distance: 0.25,
        maximum_substeps: 8,
        maximum_contact_passes: 4,
        separation_epsilon: 0.001,
    };
    const STABLE_POLICY: PhysicalBodyResponsePolicy = PhysicalBodyResponsePolicy {
        restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
        friction: PhysicalFriction::DEFAULT,
        surface_motion: PhysicalSurfaceMotion::Stable,
        align_path: false,
    };

    fn sphere(x: f32, z: f32, radius: f32) -> Sphere {
        Sphere {
            center: Vector3::new(x, 0.0, z),
            radius,
        }
    }

    fn setup(spheres: Vec<Sphere>) -> SetupModel {
        SetupModel {
            id: 0x0200_0001,
            flags: 0,
            parts: Vec::new(),
            parent_index: Vec::new(),
            default_scale: Vec::new(),
            holding_locations: Default::default(),
            connection_points: Default::default(),
            placement_frames: Default::default(),
            cyl_spheres: Vec::new(),
            spheres,
            height: 0.0,
            radius: 0.0,
            step_up: 0.0,
            step_down: 0.0,
            sorting_sphere: sphere(0.0, 0.0, 0.0),
            selection_sphere: sphere(0.0, 0.0, 0.0),
            lights: Vec::new(),
            default_animation: None,
            default_script: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        }
    }

    #[test]
    fn setup_projection_scales_and_retains_only_the_first_two_spheres() {
        let resolved = resolve_setup_physical_spheres(
            &setup(vec![
                sphere(0.5, 1.0, 0.25),
                sphere(1.0, 2.0, 0.5),
                sphere(9.0, 9.0, 9.0),
            ]),
            2.0,
        )
        .unwrap();

        assert_eq!(resolved.primary().center, Vector3::new(1.0, 0.0, 2.0));
        assert_eq!(resolved.primary().radius, 0.5);
        assert_eq!(
            resolved.upper_constraint().unwrap().center,
            Vector3::new(2.0, 0.0, 4.0)
        );
        assert_eq!(resolved.upper_constraint().unwrap().radius, 1.0);
    }

    #[test]
    fn setup_projection_preserves_one_sphere_and_uses_the_retail_empty_fallback() {
        let single =
            resolve_setup_physical_spheres(&setup(vec![sphere(0.0, 0.4, 0.3)]), 1.0).unwrap();
        assert!(single.upper_constraint().is_none());

        let empty = resolve_setup_physical_spheres(&setup(Vec::new()), 3.0).unwrap();
        assert_eq!(empty.primary().center, RETAIL_DUMMY_MOTION_SPHERE.center);
        assert_eq!(empty.primary().radius, RETAIL_DUMMY_MOTION_SPHERE.radius);
        assert!(empty.upper_constraint().is_none());
    }

    #[test]
    fn setup_projection_rejects_invalid_runtime_scale() {
        let setup = setup(vec![sphere(0.0, 0.4, 0.3)]);
        for scale in [0.0, -1.0, f32::NAN, f32::INFINITY] {
            assert_eq!(
                resolve_setup_physical_spheres(&setup, scale),
                Err(SetupPhysicalShapeError::InvalidObjectScale)
            );
        }
    }

    #[test]
    fn setup_and_equivalent_explicit_geometry_resolve_to_the_same_definition() {
        let authored = setup(vec![sphere(0.0, 0.4, 0.3), sphere(0.0, 1.2, 0.3)]);
        let from_setup = PhysicalBodyDefinition::grounded(
            resolve_setup_physical_spheres(&authored, 1.5).unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap();
        let explicit = PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.4 * 1.5),
                    radius: 0.3 * 1.5,
                },
                Some(Sphere {
                    center: Vector3::new(0.0, 0.0, 1.2 * 1.5),
                    radius: 0.3 * 1.5,
                }),
            )
            .unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap();

        assert_eq!(from_setup, explicit);
    }

    #[test]
    fn setup_resolved_entity_and_explicit_ephemeral_share_the_world_body_store() {
        let setup_definition = PhysicalBodyDefinition::grounded(
            resolve_setup_physical_spheres(
                &setup(vec![sphere(0.0, 0.4, 0.3), sphere(0.0, 1.2, 0.3)]),
                1.0,
            )
            .unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap();
        let explicit_definition = PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(sphere(0.0, 0.4, 0.3), Some(sphere(0.0, 1.2, 0.3))).unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap();
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords: Vector3::new(96.0, 96.0, 20.0),
            rotation: Quaternion::identity(),
        };
        let now = Instant::now();
        let mut world = SpatialScene::new();
        let entity = SpatialBodyId::Entity(Guid(0x5000_0001));
        world.register_body(SpatialBody::new(entity, pose, now));
        let ephemeral = world.register_ephemeral_body(pose, now);
        let collision = CollisionScene::new();
        world
            .attach_physical_body(
                entity,
                setup_definition,
                PhysicalCollisionFilter::ALL,
                STABLE_POLICY,
                None,
                &collision,
            )
            .unwrap();
        world
            .attach_physical_body(
                ephemeral,
                explicit_definition,
                PhysicalCollisionFilter::ALL,
                STABLE_POLICY,
                None,
                &collision,
            )
            .unwrap();

        assert_eq!(
            world
                .body(entity)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition,
            world
                .body(ephemeral)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition
        );
    }
}

//! Source adapters that resolve content-authored geometry into world physical-body shapes.

use holtburger_common::{Sphere, Vector3};
use holtburger_dat::file_type::SetupModel;
#[cfg(test)]
use holtburger_world::PhysicalCollisionFilter;
use holtburger_world::{
    EdgeProtection, FreeSphereConfig, GroundedConfig, PhysicalBodyDefinition,
    PhysicalBodyDefinitionError, PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
    RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z,
};
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

/// One fully resolved named body profile: validated geometry, solver config, and response policy.
///
/// Profiles keep solver physics out of frontend contracts: the frontend names a profile and its
/// app-policy knobs, and every retail constant is sourced here from `holtburger_world` rather
/// than mirrored across languages.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedBodyProfile {
    /// Validated geometry and solver response kind.
    pub definition: PhysicalBodyDefinition,
    /// Initial mutable contact response.
    pub response_policy: PhysicalBodyResponsePolicy,
}

/// A retail grounded body over caller-supplied spheres: PhysicsDesc response defaults and the
/// retail two-threshold grounded config.
///
/// This is the shared resolution path: the camera profile applies it to the cited human pair
/// below, and spawned entities apply it to spheres resolved from their own authored setup via
/// [`resolve_setup_physical_spheres`]. Edge protection stays a caller choice: it is UX/behavior
/// policy, not a retail body fact.
pub fn retail_grounded_body(
    spheres: PhysicalSphereSet,
    edge_protection: EdgeProtection,
) -> Result<ResolvedBodyProfile, PhysicalBodyDefinitionError> {
    retail_grounded_body_with_policy(
        spheres,
        edge_protection,
        -9.8,
        stable_policy(PhysicalElasticity::DEFAULT),
    )
}

/// Retail grounded solver geometry with entity-resolved gravity and response policy.
///
/// Dynamic entity preparation derives these values from the complete effective physics state and
/// authored coefficients. Camera/player convenience profiles continue using
/// [`retail_grounded_body`] so frontend policy cannot leak into this operation.
pub fn retail_grounded_body_with_policy(
    spheres: PhysicalSphereSet,
    edge_protection: EdgeProtection,
    gravity: f32,
    response_policy: PhysicalBodyResponsePolicy,
) -> Result<ResolvedBodyProfile, PhysicalBodyDefinitionError> {
    let definition = PhysicalBodyDefinition::grounded(
        spheres,
        GroundedConfig {
            gravity,
            walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
            landing_normal_z: RETAIL_LANDING_NORMAL_Z,
            airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
            step_up_height: 0.6,
            step_down_height: 1.5,
            edge_protection,
            maximum_substep_distance: 0.24,
            maximum_substeps: 32,
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        },
    )?;
    Ok(ResolvedBodyProfile {
        definition,
        response_policy,
    })
}

/// The retail player as a grounded body: the authored human sphere pair over
/// [`retail_grounded_body`].
///
/// The sphere pair is retail's authored human setup pair projected in source order by
/// `SPHEREPATH::init_sphere` (`acclient.c:302241-302291`). This profile is a synthetic
/// explorer/camera body at scale one — real characters resolve their own setup and scale through
/// [`resolve_setup_physical_spheres`] at spawn time.
pub fn retail_player_grounded_profile(
    edge_protection: EdgeProtection,
) -> Result<ResolvedBodyProfile, PhysicalBodyDefinitionError> {
    let spheres = PhysicalSphereSet::new(
        Sphere {
            center: Vector3::new(0.0, 0.0, 0.475),
            radius: 0.48,
        },
        Some(Sphere {
            center: Vector3::new(0.0, 0.0, 1.35),
            radius: 0.48,
        }),
    )?;
    retail_grounded_body(spheres, edge_protection)
}

/// Explorer physical-fly viewer as a controlled-kinematic sphere with zero elasticity.
///
/// RETAIL DIVERGENCE: Retail initializes the render-viewer sphere to 0.3 m
/// (`acclient.c:139301-139305`); this inherited Explorer-only profile uses 0.25 m, reducing free-fly
/// wall clearance by 0.05 m. The call-site census is one production consumer,
/// `HostPhysicalFlyRuntime`, plus its focused tests. Possession-camera clearance is projection-
/// derived and does not consume this profile.
///
/// Anti-tunneling and separation budgets for one small free-flying sphere.
///
/// The 0.25 m substep over 32 substeps bounds any one solve at 8 m.
pub const FREE_SPHERE_FLY_CONFIG: FreeSphereConfig = FreeSphereConfig {
    maximum_substep_distance: 0.25,
    maximum_substeps: 32,
    maximum_contact_passes: 8,
    separation_epsilon: 0.000_5,
};

pub fn physical_fly_viewer_profile() -> Result<ResolvedBodyProfile, PhysicalBodyDefinitionError> {
    let spheres = PhysicalSphereSet::new(
        Sphere {
            center: Vector3::zero(),
            radius: 0.25,
        },
        None,
    )?;
    let definition = PhysicalBodyDefinition::free_sphere(spheres, FREE_SPHERE_FLY_CONFIG)?;
    Ok(ResolvedBodyProfile {
        definition,
        response_policy: stable_policy(PhysicalElasticity::ZERO),
    })
}

/// Stable, non-aligning response at retail's default friction with the given restitution.
fn stable_policy(elasticity: PhysicalElasticity) -> PhysicalBodyResponsePolicy {
    PhysicalBodyResponsePolicy {
        restitution: PhysicalRestitution::Elastic(elasticity),
        friction: PhysicalFriction::DEFAULT,
        surface_motion: PhysicalSurfaceMotion::Stable,
        align_path: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Guid, Quaternion};
    use holtburger_world::{
        EdgeProtection, GroundedConfig, PhysicalBodyDefinition, PhysicalBodyResponsePolicy,
        PhysicalElasticity, PhysicalFriction, PhysicalRestitution, PhysicalSurfaceMotion,
        RETAIL_WALKABLE_NORMAL_Z, SpatialBody, SpatialBodyId, SpatialScene,
    };
    use std::time::Instant;

    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: holtburger_world::RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: holtburger_world::RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
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
        world
            .install_physical_body(
                entity,
                setup_definition,
                PhysicalCollisionFilter::ALL,
                STABLE_POLICY,
                None,
            )
            .unwrap();
        world
            .install_physical_body(
                ephemeral,
                explicit_definition,
                PhysicalCollisionFilter::ALL,
                STABLE_POLICY,
                None,
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

#[cfg(test)]
mod profile_tests {
    use super::*;

    fn grounded_config(profile: &ResolvedBodyProfile) -> GroundedConfig {
        let PhysicalBodyDefinition::Grounded { config, .. } = profile.definition else {
            panic!("retail player profile must be grounded");
        };
        config
    }

    /// The profile's thresholds are the world constants themselves — no mirrored literals.
    #[test]
    fn retail_player_profile_sources_the_world_threshold_constants() {
        let profile = retail_player_grounded_profile(EdgeProtection::Creature).unwrap();
        let config = grounded_config(&profile);
        assert_eq!(config.walkable_normal_z, RETAIL_WALKABLE_NORMAL_Z);
        assert_eq!(config.landing_normal_z, RETAIL_LANDING_NORMAL_Z);
        assert_eq!(
            config.airborne_step_down_height,
            RETAIL_AIRBORNE_STEP_DOWN_HEIGHT
        );
        assert_eq!(config.edge_protection, EdgeProtection::Creature);
        // Former frontend-authored values, pinned at their new owner: any change here is a
        // deliberate profile decision, not contract drift.
        assert_eq!(config.gravity, -9.8);
        assert_eq!(config.step_up_height, 0.6);
        assert_eq!(config.step_down_height, 1.5);
        assert_eq!(config.maximum_substep_distance, 0.24);
        assert_eq!(config.maximum_substeps, 32);
        assert_eq!(config.maximum_contact_passes, 8);
        assert_eq!(config.separation_epsilon, 0.000_5);
    }

    /// Edge protection is caller policy; both choices produce otherwise identical configs.
    #[test]
    fn edge_protection_is_the_only_caller_variable() {
        let creature =
            grounded_config(&retail_player_grounded_profile(EdgeProtection::Creature).unwrap());
        let none = grounded_config(&retail_player_grounded_profile(EdgeProtection::None).unwrap());
        assert_eq!(
            GroundedConfig {
                edge_protection: EdgeProtection::Creature,
                ..none
            },
            creature
        );
    }

    /// The shared grounded builder produces the same config for arbitrary spawn spheres, so the
    /// spawner path consumes it unchanged.
    #[test]
    fn shared_grounded_builder_matches_the_player_profile_config() {
        let spawn_spheres = PhysicalSphereSet::new(
            Sphere {
                center: Vector3::new(0.0, 0.0, 0.3),
                radius: 0.35,
            },
            None,
        )
        .unwrap();
        let spawned = retail_grounded_body(spawn_spheres, EdgeProtection::None).unwrap();
        let player = retail_player_grounded_profile(EdgeProtection::None).unwrap();
        let (
            PhysicalBodyDefinition::Grounded {
                config: spawned_config,
                ..
            },
            PhysicalBodyDefinition::Grounded {
                config: player_config,
                ..
            },
        ) = (spawned.definition, player.definition)
        else {
            panic!("both bodies must be grounded");
        };
        assert_eq!(spawned_config, player_config);
        assert_eq!(spawned.response_policy, player.response_policy);
    }

    #[test]
    fn fly_viewer_profile_is_a_single_free_sphere() {
        let profile = physical_fly_viewer_profile().unwrap();
        assert!(matches!(
            profile.definition,
            PhysicalBodyDefinition::FreeSphere { .. }
        ));
    }
}

//! Shared input fixtures for the retail differential suites.
//!
//! Differential oracles must transliterate retail *logic* independently of production; the
//! authored *inputs* they drive production with — the retail creature body pair, the
//! retail-default grounded config, flat synthetic terrain — are shared here so the suites stay
//! comparable and a new config field is a one-line change instead of a per-suite sweep.

use super::{
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, EntityContactResponse, GroundState, PhysicalBodyResponsePolicy,
    PhysicalBodyResponseState, PhysicalBodyState, PhysicalCollisionFilter, PhysicalElasticity,
    PhysicalFriction, PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
    PreparedEntityTargetGeometry, SpatialBody, SpatialBodyId,
};
use crate::{
    EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
    EntityIntegrationEligibility, LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand,
};
use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_content::ColliderScale;
use holtburger_content::{LandblockTerrain, TerrainCollisionSurface};
use std::{sync::Arc, time::Instant};

use super::grounded_types::{
    EdgeProtection, GroundedBodySpheres, GroundedConfig, GroundedSphere,
    RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z,
};

/// Authored collision-sphere radius and center Z of setup 0x0200007C (WCID 33609).
/// Preserve the exact f32 encoding decoded from the client archive (approximately 0.318m).
pub(crate) const PATHWARDEN_CHEST_RADIUS: f32 = f32::from_bits(0x3ea2_d0e5);

/// The retail-default grounded config used by the human-pair differential scenarios.
pub(crate) fn retail_creature_config() -> GroundedConfig {
    GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        step_up_height: 0.6,
        step_down_height: 1.5,
        edge_protection: EdgeProtection::None,
        minimum_stair_rise: 0.000_5,
    }
}

/// Retail's authored human sphere pair (`SPHEREPATH::init_sphere`, acclient.c:302241-302291).
pub(crate) fn retail_creature_pair() -> GroundedBodySpheres {
    GroundedBodySpheres {
        support: GroundedSphere {
            center: Vector3::new(0.0, 0.0, 0.475),
            radius: 0.48,
        },
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, 1.35),
            radius: 0.48,
        }),
    }
}

/// A full flat 8x8 synthetic terrain surface at z = 0 for one landblock.
pub(crate) fn flat_terrain(landblock_id: u32) -> TerrainCollisionSurface {
    TerrainCollisionSurface::from_terrain(&LandblockTerrain {
        grid_size: 9,
        tile_size: 24.0,
        height_indices: vec![0; 81],
        heights: vec![0.0; 81],
        terrain_samples: vec![0; 81],
        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(landblock_id),
    })
    .unwrap()
}

/// Current-runtime fixture at retail response defaults, without peer targets or reports.
/// Full movement scenarios include restitution; threshold-only reference functions must not
/// be mistaken for an oracle of the entire landing transaction.
pub(crate) fn movement_body(
    pose: holtburger_common::position::WorldPosition,
    definition: super::PhysicalBodyDefinition,
    velocity: Vector3,
    ground: super::GroundState,
) -> super::SpatialBody {
    let cell = pose.is_indoors().then_some(pose.landblock_id);
    let primary = definition.spheres().primary();
    let configuration = DynamicPhysicalBodyConfiguration::new(
        DynamicPhysicalBodyDefinition {
            movement: definition,
            response_policy: PhysicalBodyResponsePolicy {
                restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
                friction: PhysicalFriction::DEFAULT,
                surface_motion: PhysicalSurfaceMotion::Stable,
                align_path: false,
            },
            entity_collision: DynamicBodyCollisionDefinition {
                player_collision: None,
                contact_response: EntityContactResponse::Character(
                    EntityIntegrationEligibility::Eligible,
                ),
                target_geometry: Arc::new(PreparedEntityTargetGeometry {
                    setup_radius: primary.radius,
                    setup_height: primary.center.z + primary.radius,
                    collision_animations: Default::default(),
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                }),
                dynamic_collision: EntityDynamicCollisionPolicy {
                    is_static: false,
                    target: EntityCollisionParticipation::Suppressed,
                    mover_accepts_response: true,
                    accepts_peer_reports: false,
                    missile: false,
                    path_clipped: false,
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: false,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        },
        LocalPhysicalDemand {
            target: LocalTargetDemand::Absent,
            integration: LocalIntegrationDemand::Eligible,
        },
    )
    .unwrap();
    let mut body = SpatialBody::new(SpatialBodyId::LocalPlayer(Guid(1)), pose, Instant::now());
    let mut physical =
        PhysicalBodyState::new_dynamic(configuration, PhysicalCollisionFilter::ALL, cell);
    if let PhysicalBodyResponseState::Grounded {
        ground: retained, ..
    } = &mut physical.response
    {
        *retained = ground;
    }
    body.physical = Some(physical);
    body.retained.velocity = velocity;
    body
}

/// Runs one admitted fixed tick and returns the complete scene-published body.
pub(crate) fn movement_tick(
    collision: &super::CollisionScene,
    body: super::SpatialBody,
    input: super::PhysicalBodyInput,
) -> super::SpatialBody {
    let id = body.id;
    let mut scene = super::SpatialScene::new();
    scene.register_body(body);
    let result = scene
        .advance_dynamic_entity_collection(
            collision,
            super::MOBILE_CONTACT_TICK_SECONDS,
            std::time::Instant::now(),
            |_| Ok(input.clone()),
        )
        .unwrap();
    assert!(
        result.coverage_rejections.is_empty(),
        "{:#?}",
        result.coverage_rejections
    );
    assert!(
        matches!(
            result.outcomes.as_slice(),
            [super::DynamicEntityBodyOutcome::Integrated(_)]
        ),
        "movement fixture must publish one ordinary integrated tick"
    );
    scene.remove_body(id).unwrap()
}

/// Solver-owned support, read from the canonical body's installed physical response.
pub(crate) fn movement_ground(body: &super::SpatialBody) -> super::GroundState {
    body.physical.as_ref().unwrap().response.ground()
}

/// Installs the provided grounded fixture without a second movement implementation.
pub(crate) fn grounded_movement_body(
    pose: holtburger_common::position::WorldPosition,
    spheres: GroundedBodySpheres,
    config: GroundedConfig,
    velocity: Vector3,
    ground: GroundState,
) -> SpatialBody {
    let sphere = |s: GroundedSphere| holtburger_common::Sphere {
        center: s.center,
        radius: s.radius,
    };
    let definition = super::PhysicalBodyDefinition::grounded(
        PhysicalSphereSet::new(sphere(spheres.support), spheres.upper.map(sphere)).unwrap(),
        config,
    )
    .unwrap();
    movement_body(pose, definition, velocity, ground)
}

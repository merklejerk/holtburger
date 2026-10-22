//! Single-body diagnostic replays through the same transaction as runtime entities.

use std::{sync::Arc, time::Instant};

use anyhow::{Context, Result, bail, ensure};
use holtburger_common::{Guid, Sphere, position::WorldPosition};
use holtburger_content::{ColliderScale, LandblockCollisionAsset};
use holtburger_core::{
    ContentAssetService, ResolvedBodyProfile, physical_fly_viewer_profile, retail_grounded_body,
};
use holtburger_world::{
    CollisionScene, DynamicBodyCollisionDefinition, DynamicEntityBodyOutcome,
    DynamicPhysicalBodyConfiguration, DynamicPhysicalBodyDefinition, EdgeProtection,
    EntityCollisionParticipation, EntityCollisionReportPolicy, EntityContactResponse,
    EntityDynamicCollisionPolicy, EntityIntegrationEligibility, GroundState, GroundedBodySpheres,
    LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, MOBILE_CONTACT_TICK_SECONDS,
    MotionWaypoint, MotionWaypointPlacement, PhysicalBodyActuation, PhysicalBodyInput,
    PhysicalBodyState, PhysicalCollisionFilter, PhysicalElasticity, PhysicalSphereSet,
    PreparedEntityTargetGeometry, SpatialBody, SpatialBodyId, SpatialScene,
};

/// Body facts read from the runtime's installed physics rather than separately retained state.
pub trait ProbeBodyView {
    /// The primary sphere's committed interior cell, or outdoors.
    fn cell(&self) -> Option<Guid>;
    /// The last support classification published by the physical transaction.
    fn ground(&self) -> GroundState;
}

impl ProbeBodyView for SpatialBody {
    fn cell(&self) -> Option<Guid> {
        self.physical
            .as_ref()
            .expect("probe body has physics")
            .response
            .cell()
    }

    fn ground(&self) -> GroundState {
        self.physical
            .as_ref()
            .expect("probe body has physics")
            .response
            .ground()
    }
}

/// Published body and accepted root path from one ordinary fixed tick.
pub struct ProbeMovement {
    /// Complete runtime body, retained unchanged as the next tick's input.
    pub body: SpatialBody,
    /// Accepted endpoints, including the placement already committed by collision.
    pub motion: Vec<MotionWaypoint>,
}

/// Creates a character with the selected authored movement-sphere roles.
pub fn grounded_body(
    pose: WorldPosition,
    spheres: GroundedBodySpheres,
    cell: Option<Guid>,
) -> Result<SpatialBody> {
    let sphere = |s: holtburger_world::GroundedSphere| Sphere {
        center: s.center,
        radius: s.radius,
    };
    let profile = retail_grounded_body(
        PhysicalSphereSet::new(sphere(spheres.support), spheres.upper.map(sphere))?,
        EdgeProtection::Creature,
    )?;
    body_with_profile(pose, profile, cell)
}

/// Creates the ordinary Explorer flight body, without grounded policy.
pub fn flight_body(pose: WorldPosition, cell: Option<Guid>) -> Result<SpatialBody> {
    body_with_profile(pose, physical_fly_viewer_profile()?, cell)
}

/// Installs a validated diagnostic profile using ordinary dynamic-character preparation.
/// Scaled/body-shape experiments still enter the same scene transaction as runtime movement.
pub fn body_with_profile(
    pose: WorldPosition,
    profile: ResolvedBodyProfile,
    cell: Option<Guid>,
) -> Result<SpatialBody> {
    let primary = profile.definition.spheres().primary();
    // These probes own no peer targets or reports. Geometry and integration still use the
    // production dynamic-character policy, including direct supported motor admission.
    let configuration = DynamicPhysicalBodyConfiguration::new(
        DynamicPhysicalBodyDefinition {
            movement: profile.definition,
            response_policy: profile.response_policy,
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
                    fallback_scale: ColliderScale::uniform(1.0)?,
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
    )?;
    let mut body = SpatialBody::new(SpatialBodyId::LocalPlayer(Guid(1)), pose, Instant::now());
    body.physical = Some(PhysicalBodyState::new_dynamic(
        configuration,
        PhysicalCollisionFilter::ALL,
        cell,
    ));
    Ok(body)
}

/// Advances and publishes a single body. Peer/report lifetimes are absent from this diagnostic;
/// every retained body fact and accepted path comes from the real scene collection boundary.
pub fn advance_probe_body(
    collision: &CollisionScene,
    body: SpatialBody,
    actuation: PhysicalBodyActuation,
) -> Result<ProbeMovement> {
    advance_probe_input(collision, body, PhysicalBodyInput::autonomous(actuation))
}

/// Replays fully prepared authored/controller input through the ordinary publication boundary.
pub fn advance_probe_input(
    collision: &CollisionScene,
    body: SpatialBody,
    input: PhysicalBodyInput,
) -> Result<ProbeMovement> {
    let id = body.id;
    let mut scene = SpatialScene::new();
    scene.register_body(body);
    let result = scene.advance_dynamic_entity_collection(
        collision,
        MOBILE_CONTACT_TICK_SECONDS,
        Instant::now(),
        |_| Ok(input.clone()),
    )?;
    ensure!(
        result.coverage_rejections.is_empty(),
        "probe movement lacks coverage: {:?}",
        result.coverage_rejections
    );
    let [outcome]: [_; 1] = result
        .outcomes
        .try_into()
        .map_err(|_| anyhow::anyhow!("single-body probe must publish one outcome"))?;
    let DynamicEntityBodyOutcome::Integrated(tick) = outcome else {
        bail!("ordinary probe movement unexpectedly relocated the body");
    };
    let motion = tick
        .path
        .legs()
        .iter()
        .map(|leg| MotionWaypoint {
            center: leg.end().center(),
            end_fraction: leg.end_fraction(),
            placement: MotionWaypointPlacement::Committed(leg.end().placement().committed_cell()),
        })
        .collect();
    Ok(ProbeMovement {
        body: scene
            .remove_body(id)
            .context("published probe body disappeared")?,
        motion,
    })
}

/// Canonically assembled fixed-radius collision neighborhood for diagnostic replay.
pub struct CollisionNeighborhood {
    /// Present collision owners, including the caller's already assembled center.
    pub assets: Vec<LandblockCollisionAsset>,
    /// Absent neighbors, retained as explicit unavailable coverage in reports.
    pub unavailable_owners: Vec<u32>,
}

/// Reuses an already assembled center; radius and missing-coverage policy stay with the caller.
pub fn collision_neighborhood(
    service: &ContentAssetService,
    center: LandblockCollisionAsset,
    radius: i32,
) -> Result<CollisionNeighborhood> {
    ensure!(
        radius >= 0,
        "collision neighborhood radius must be nonnegative"
    );
    let owner = center.landblock_id;
    let owner_x = ((owner >> 24) & 255) as i32;
    let owner_y = ((owner >> 16) & 255) as i32;
    let mut assets = vec![center];
    let mut unavailable_owners = Vec::new();
    for dx in -radius..=radius {
        for dy in -radius..=radius {
            if dx == 0 && dy == 0 {
                continue;
            }
            let x = owner_x + dx;
            let y = owner_y + dy;
            if !(0..=255).contains(&x) || !(0..=255).contains(&y) {
                continue;
            }
            let id = ((x as u32) << 24) | ((y as u32) << 16) | 0xffff;
            match service.load_landblock(id)? {
                Some(block) => assets.push(service.resolve_collision(&block)?),
                None => unavailable_owners.push(id),
            }
        }
    }
    Ok(CollisionNeighborhood {
        assets,
        unavailable_owners,
    })
}

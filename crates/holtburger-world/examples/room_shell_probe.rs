//! Temporary real-content experiment: room shells and portals without object obstacles.
//! Run explicitly with an HBA path or prepared content directory; this is not an asset-dependent automated test.

use std::{path::Path, sync::Arc, time::Instant};

use anyhow::{Context, Result, ensure};
use holtburger_common::{Guid, Quaternion, Sphere, Vector3, position::WorldPosition};
use holtburger_content::{
    CellCollisionPortalTarget, CellVolume, ColliderScale, LandblockCollisionAsset,
    NavigationContent, StaticColliderPlacement,
};
use holtburger_world::{
    CollisionScene, DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, EntityCollisionParticipation, EntityCollisionReportPolicy,
    EntityContactResponse, EntityDynamicCollisionPolicy, EntityIntegrationEligibility,
    LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, MOBILE_CONTACT_TICK_SECONDS,
    PhysicalBodyActuation, PhysicalBodyDefinition, PhysicalBodyInput, PhysicalBodyResponsePolicy,
    PhysicalBodyState, PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PointPlacement,
    PreparedEntityTargetGeometry, SpatialBody, SpatialBodyId, SpatialScene,
};

const OWNER: u32 = 0x8602_ffff;
const RADIUS: f32 = 0.2;
const TOLERANCE: f32 = 0.02;

fn main() -> Result<()> {
    let path = std::env::args()
        .nth(1)
        .context("provide an HBA path or prepared content directory")?;
    let asset = load_scene(Path::new(&path))?;
    let assembled = &asset.static_geometry;
    let volumes = assembled.cell_volumes().to_vec();
    let shells = assembled.colliders.clone();
    ensure!(!shells.is_empty(), "fixture has no room physics shells");
    ensure!(
        shells.iter().all(|shell| matches!(
            shell.source_placement,
            StaticColliderPlacement::EnvCellShell { .. }
        )),
        "room assembly included object obstacles"
    );
    println!(
        "fixture owner={OWNER:08X} cells={} shells={}",
        volumes.len(),
        shells.len()
    );
    let mut collision = CollisionScene::new();
    collision.insert(asset)?;

    let mut crossed = false;
    'portals: for source in &volumes {
        for portal in &source.portals {
            // Exercise an ordinary wall opening, not a floor/ceiling portal.
            let world_normal = source
                .placement
                .orientation
                .rotate_vector(portal.plane.normal);
            if world_normal.z.abs() > 0.1 {
                continue;
            }
            let CellCollisionPortalTarget::EnvCell(target_id) = portal.target else {
                continue;
            };
            let target = volumes
                .iter()
                .find(|cell| cell.cell_selector == target_id)
                .context("portal target is missing")?;
            let center = centroid(&portal.aperture_vertices);
            for sign in [-1.0, 1.0] {
                let offset = portal.plane.normal * (0.6 * sign);
                let start = placed(source, center + offset);
                let end = placed(source, center - offset);
                if !contains(source, start) || !contains(target, end) {
                    continue;
                }
                let result = travel(&collision, source.cell_selector, start, end - start)?;
                if result.pose.landblock_id.0 == (OWNER & 0xffff_0000) | u32::from(target_id)
                    && result.pose.coords.distance(&end) < TOLERANCE
                {
                    ensure!(
                        collision.point_placement(result.pose)?
                            == PointPlacement::Unique(result.pose),
                        "endpoint containment disagrees with the accepted doorway destination"
                    );
                    println!(
                        "PASS doorway {:04X}->{target_id:04X}: {:?} -> {:?}",
                        source.cell_selector, start, result.pose.coords
                    );
                    crossed = true;
                    break 'portals;
                }
            }
        }
    }
    ensure!(
        crossed,
        "no sampled internal portal allowed the sphere to cross"
    );

    let mut slid = false;
    'walls: for shell in &shells {
        let StaticColliderPlacement::EnvCellShell { cell_id } = shell.source_placement else {
            continue;
        };
        let volume = volumes
            .iter()
            .find(|cell| u32::from(cell.cell_selector) == cell_id & 0xffff)
            .context("shell cell is missing")?;
        let solid = shell.shape.as_bsp().context("room shell is not a BSP")?;
        let mut polygons = solid.polygons.iter().collect::<Vec<_>>();
        polygons.sort_by_key(|(id, _)| **id);
        for (polygon_id, polygon) in polygons {
            let normal = shell.normal_to_landblock_space(polygon.normal);
            if normal.z.abs() > 0.1 {
                continue;
            }
            let center = shell.point_to_landblock_space(centroid(&polygon.vertices));
            let tangent = Vector3::new(-normal.y, normal.x, 0.0).normalize();
            for sign in [-1.0, 1.0] {
                let inward = normal * sign;
                let start = center + inward;
                if !contains(volume, start) {
                    continue;
                }
                let desired = inward * -2.0 + tangent;
                let result = travel(&collision, volume.cell_selector, start, desired)?;
                let accepted = result.pose.coords - start;
                let tangent_progress = accepted.dot(&tangent);
                let normal_progress = accepted.dot(&inward);
                if (tangent_progress - 1.0).abs() < TOLERANCE
                    && (normal_progress + (1.0 - RADIUS)).abs() < TOLERANCE
                    && result.pose.landblock_id.0 == cell_id
                {
                    println!(
                        "PASS slide cell={cell_id:08X} polygon={polygon_id}: normal={normal_progress:.4}m tangent={tangent_progress:.4}m"
                    );
                    slid = true;
                    break 'walls;
                }
            }
        }
    }
    ensure!(
        slid,
        "no sampled wall preserved tangent travel while blocking normal travel"
    );
    Ok(())
}

fn load_scene(path: &Path) -> Result<LandblockCollisionAsset> {
    let content = NavigationContent::open(path)?;
    let creation = content.bootstrap().read_character_gen_catalog()?;
    println!(
        "creation catalog: {} heritage groups",
        creation.heritage_groups.len()
    );
    content
        .load_collision(OWNER)?
        .context("probe landblock is missing")
}

fn centroid(vertices: &[Vector3]) -> Vector3 {
    vertices
        .iter()
        .copied()
        .fold(Vector3::zero(), |sum, point| sum + point)
        / vertices.len() as f32
}

fn placed(cell: &CellVolume, local: Vector3) -> Vector3 {
    cell.placement.orientation.rotate_vector(local) + cell.placement.origin
}

fn contains(cell: &CellVolume, point: Vector3) -> bool {
    let local = cell.placement.to_local_space(point);
    cell.planes
        .iter()
        .all(|plane| plane.distance_to_point(&local) >= 0.0)
}

fn travel(
    collision: &CollisionScene,
    cell: u16,
    start: Vector3,
    delta: Vector3,
) -> Result<SpatialBody> {
    // A model-free sphere has no peer target geometry, gravity, animation, or scripts.
    let configuration = DynamicPhysicalBodyConfiguration::new(
        DynamicPhysicalBodyDefinition {
            movement: PhysicalBodyDefinition::free_sphere(PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: RADIUS,
                },
                None,
            )?)?,
            response_policy: PhysicalBodyResponsePolicy {
                restitution: PhysicalRestitution::Elastic(PhysicalElasticity::ZERO),
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
                    setup_radius: RADIUS,
                    setup_height: RADIUS * 2.0,
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
                elasticity: PhysicalElasticity::ZERO,
                default_animation_available: false,
                default_script_available: false,
            },
        },
        LocalPhysicalDemand {
            target: LocalTargetDemand::Absent,
            integration: LocalIntegrationDemand::Eligible,
        },
    )?;
    let cell = Guid((OWNER & 0xffff_0000) | u32::from(cell));
    let id = SpatialBodyId::Entity(Guid(1));
    let mut body = SpatialBody::new(
        id,
        WorldPosition {
            landblock_id: cell,
            coords: start,
            rotation: Quaternion::identity(),
        },
        Instant::now(),
    );
    body.physical = Some(PhysicalBodyState::new_dynamic(
        configuration,
        PhysicalCollisionFilter::ALL,
        Some(cell),
    ));
    let mut scene = SpatialScene::new();
    scene.register_body(body);
    let input = PhysicalBodyInput::autonomous(PhysicalBodyActuation::free_flight(
        delta / MOBILE_CONTACT_TICK_SECONDS,
    )?);
    let result = scene.advance_dynamic_entity_collection(
        collision,
        MOBILE_CONTACT_TICK_SECONDS,
        Instant::now(),
        |_| Ok(input.clone()),
    )?;
    ensure!(
        result.coverage_rejections.is_empty(),
        "missing coverage: {:?}",
        result.coverage_rejections
    );
    scene.remove_body(id).context("probe body disappeared")
}

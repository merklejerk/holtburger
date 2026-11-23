use super::possession::possession_grounded_actuation;
use crate::explorer_possession_control::{
    ActivePossession, PossessionEventQueueResult, PossessionIntentReplaceResult,
    PossessionLifecycleEvent,
};
use holtburger_common::RigidTransform;
use holtburger_content::MotionSequenceCatalog;
use holtburger_core::client::movement_types::CharacterDrive;
use holtburger_core::{DynamicEntityBodyOperationError, DynamicEntityPresentationClass};
use holtburger_world::motion::MotionPresentation;
use holtburger_world::{ContactState, SpatialBody, SpatialBodyId};
use std::sync::Arc;

/// Every scheduled body coasts, for tests that do not care about drive.
fn coasting() -> impl Fn(&SpatialBody) -> anyhow::Result<holtburger_world::PhysicalBodyInput> {
    |body| {
        crate::host_simulation_runtime::dynamic_entity_coasting_actuation(body)
            .map(holtburger_world::PhysicalBodyInput::autonomous)
    }
}

use super::*;
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{PhysicsState, WeenieType};
use holtburger_common::{ParentLocation, Placement, Quaternion, Sphere, Vector3};
use holtburger_content::{ColliderScale, CollisionBall, CollisionShape, LandblockCollisionAsset};
use holtburger_core::{
    DynamicEntityContent, DynamicEntityDefinitionInput, DynamicEntityIdentity,
    DynamicEntityInitialState,
};
use holtburger_dat::file_type::animation::AnimationFlags;
use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
use holtburger_dat::file_type::setup_model::AnimationFrame;
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::graphics::Frame;
use holtburger_world::motion::MotionCommand;
use holtburger_world::{
    DynamicBodyCollisionDefinition, EdgeProtection, EntityAppearance, EntityCollisionParticipation,
    EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, PhysicalBodyDefinition,
    PhysicalBodyParticipation, PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PhysicsAttachment,
    PreparedEntityTargetGeometry, resolve_effective_entity_physics_state,
};
use std::time::Instant;

#[derive(Default)]
struct EmptySpaceCollisionSource;

impl crate::host_simulation_runtime::CollisionSource for EmptySpaceCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        Ok(Some(LandblockCollisionAsset {
            landblock_id,
            terrain: holtburger_content::TerrainCollisionSurface::empty(),
            static_geometry: holtburger_content::LandblockColliders::default(),
        }))
    }
}

fn fixture_landblock_ids() -> Vec<String> {
    (0xd9..=0xdb)
        .flat_map(|x| (0x54..=0x56).map(move |y| format!("0x{x:02x}{y:02x}ffff")))
        .collect()
}

fn install_fixture_interest(simulation: &HostSimulationRuntime) -> u64 {
    let session = simulation.reserve_interest_session();
    let receipt = simulation
        .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
            session,
            revision: 1,
            landblock_ids: fixture_landblock_ids(),
        })
        .unwrap();
    assert!(receipt.committed);
    assert!(receipt.unavailable_landblock_ids.is_empty());
    session
}

fn runtime(start: u32, end: u32) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime) {
    let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(
        EmptySpaceCollisionSource,
    )));
    install_fixture_interest(&simulation);
    let runtime = ExplorerEntityRuntime::with_guid_range(Arc::clone(&simulation), start, end);
    (simulation, runtime)
}

/// Setup every fixture entity presents, and the one the fixture catalog defaults for.
const FIXTURE_SETUP_DID: u32 = 0x0200_0001;

fn definition(guid: Guid, wcid: u32, x: f32) -> DynamicEntityDefinition {
    DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
        identity: DynamicEntityIdentity {
            guid,
            wcid,
            name: format!("WCID {wcid}"),
            weenie_type: WeenieType::Creature,
        },
        level: None,
        content: DynamicEntityContent {
            motion_table_did: None,
            setup_did: FIXTURE_SETUP_DID,
            sound_table_did: None,
            physics_effect_table_did: None,
        },
        appearance: EntityAppearance::default(),
        placement: EntityPlacement::World(DynamicEntityInitialState {
            pose: WorldPosition {
                landblock_id: Guid(0xda55_0001),
                coords: Vector3::new(x, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
            created_at: Instant::now(),
        }),
        object_scale: 1.0,
        friction: None,
        elasticity: None,
        translucency: 0.0,
        maximum_velocity: None,
        rotation_speed: None,
        radar: holtburger_core::DynamicEntityRadarFacts::default(),
        body_height: 2.05,
        physics: resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
    })
    .unwrap()
}

/// Child definition whose transform is wholly owned by `parent`; it intentionally has no
/// world-motion state or host body to accidentally keep alive.
fn attached_definition(guid: Guid, wcid: u32, parent: Guid) -> DynamicEntityDefinition {
    let mut child = definition(guid, wcid, 0.0);
    child.placement = EntityPlacement::Attached(PhysicsAttachment {
        parent,
        location: ParentLocation::RightHand,
        placement: Placement::RightHandCombat,
    });
    child
}

fn prepared(definition: DynamicEntityDefinition) -> ExplorerPreparedEntity {
    ExplorerPreparedEntity {
        presentation_class: DynamicEntityPresentationClass::Other,
        definition,
    }
}

fn physical_with_upper(upper_constraint: Option<Sphere>) -> DynamicPhysicalBodyDefinition {
    let response_policy = PhysicalBodyResponsePolicy {
        restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
        friction: PhysicalFriction::DEFAULT,
        surface_motion: PhysicalSurfaceMotion::Stable,
        align_path: false,
    };
    let movement = holtburger_core::retail_grounded_body_with_policy(
        PhysicalSphereSet::new(
            Sphere {
                center: Vector3::new(0.0, 0.0, 0.5),
                radius: 0.5,
            },
            upper_constraint,
        )
        .unwrap(),
        EdgeProtection::Creature,
        -9.8,
        response_policy,
    )
    .unwrap()
    .definition;
    DynamicPhysicalBodyDefinition {
        movement,
        response_policy,
        entity_collision: DynamicBodyCollisionDefinition {
            player_collision: None,
            contact_response: holtburger_world::EntityContactResponse::Character(
                holtburger_world::EntityIntegrationEligibility::Eligible,
            ),
            target_geometry: Arc::new(PreparedEntityTargetGeometry {
                setup_radius: 0.5,
                setup_height: 1.0,
                collision_animations: Default::default(),
                physics_bsp_parts: Vec::new(),
                fallback_setup_did: 0x0200_0001,
                fallback_shapes: Vec::new(),
                fallback_scale: ColliderScale::uniform(1.0).unwrap(),
            }),
            dynamic_collision: EntityDynamicCollisionPolicy {
                is_static: false,
                target: EntityCollisionParticipation::Solid,
                mover_accepts_response: true,
                accepts_peer_reports: true,
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
    }
}

fn physical() -> DynamicPhysicalBodyDefinition {
    physical_with_upper(None)
}

fn physical_with_ball_target() -> DynamicPhysicalBodyDefinition {
    let mut physical = physical();
    Arc::get_mut(&mut physical.entity_collision.target_geometry)
        .expect("new fixture geometry has no other owner")
        .fallback_shapes = vec![Arc::new(CollisionShape::Ball(CollisionBall {
        center: Vector3::zero(),
        radius: 0.5,
    }))];
    physical
}

fn report_only_physical() -> DynamicPhysicalBodyDefinition {
    let mut physical = physical_with_ball_target();
    physical.movement = PhysicalBodyDefinition::free_sphere(
        PhysicalSphereSet::new(
            Sphere {
                center: Vector3::zero(),
                radius: 0.5,
            },
            None,
        )
        .unwrap(),
    )
    .unwrap();
    physical.entity_collision.reporting.enabled = true;
    physical
        .entity_collision
        .dynamic_collision
        .mover_accepts_response = false;
    physical
}

#[test]
fn guid_allocator_is_bounded_and_resettable() {
    let (_simulation, runtime) = runtime(0xf000_0001, 0xf000_0002);
    assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0001));
    assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0002));
    assert_eq!(
        runtime.reserve_guid(),
        Err(ExplorerEntityRuntimeError::GuidExhausted)
    );
    runtime.reset().unwrap();
    assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0001));
}

#[test]
fn repeated_same_wcid_spawns_have_independent_identity_and_optional_physics() {
    let (_simulation, runtime) = runtime(0xf000_0010, 0xf000_0011);
    let first_guid = runtime.reserve_guid().unwrap();
    let second_guid = runtime.reserve_guid().unwrap();
    let first = runtime
        .spawn_prepared(
            prepared(definition(first_guid, 42, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap();
    let second = runtime
        .spawn_prepared(
            prepared(definition(second_guid, 42, 2.0)),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();

    assert_ne!(
        first.instance.definition.identity.guid,
        second.instance.definition.identity.guid
    );
    assert_eq!(
        first.instance.definition.identity.wcid,
        second.instance.definition.identity.wcid
    );
    assert_eq!(
        first.body.participation,
        PhysicalBodyParticipation::PoseOnly
    );
    assert_eq!(
        second.body.participation,
        PhysicalBodyParticipation::Physical
    );
    assert_eq!(runtime.snapshot().unwrap().len(), 2);
}

#[test]
fn spawn_rejects_prepared_body_and_derived_demand_mismatches_before_publication() {
    let (_simulation, runtime) = runtime(0xf000_0010, 0xf000_0011);
    let missing_guid = runtime.reserve_guid().unwrap();
    assert_eq!(
        runtime.spawn_prepared(
            prepared(definition(missing_guid, 42, 0.0)),
            ExplorerPhysicalMode::Integrated,
            None,
        ),
        Err(ExplorerEntityRuntimeError::MissingPreparedPhysics)
    );

    let unexpected_guid = runtime.reserve_guid().unwrap();
    assert_eq!(
        runtime.spawn_prepared(
            prepared(definition(unexpected_guid, 42, 2.0)),
            ExplorerPhysicalMode::PoseOnly,
            Some(physical()),
        ),
        Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics)
    );
    assert!(runtime.snapshot().unwrap().is_empty());
}

#[test]
fn collection_tick_visits_only_eligible_physical_instances_in_guid_order() {
    let (_simulation, runtime) = runtime(0xf000_0100, 0xf000_0103);
    let pose_only_guid = runtime.reserve_guid().unwrap();
    let frozen_guid = runtime.reserve_guid().unwrap();
    let first_active_guid = runtime.reserve_guid().unwrap();
    let second_active_guid = runtime.reserve_guid().unwrap();
    runtime
        .spawn_prepared(
            prepared(definition(pose_only_guid, 1, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap();

    let mut frozen_definition = definition(frozen_guid, 2, 1.0);
    frozen_definition.physics =
        resolve_effective_entity_physics_state(PhysicsState::GRAVITY | PhysicsState::FROZEN);
    runtime
        .spawn_prepared(
            prepared(frozen_definition),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();
    let first = runtime
        .spawn_prepared(
            prepared(definition(first_active_guid, 3, 2.0)),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();
    let second = runtime
        .spawn_prepared(
            prepared(definition(second_active_guid, 4, 3.0)),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();

    let ticks = runtime
        .tick_physical_collection(1.0 / 30.0, Instant::now())
        .unwrap();

    assert_eq!(
        ticks
            .ticks
            .iter()
            .map(|tick| (tick.input.identity.guid, tick.generation))
            .collect::<Vec<_>>(),
        [
            (first_active_guid, first.instance.generation),
            (second_active_guid, second.instance.generation),
        ]
    );
    assert!(ticks.ticks.iter().all(|tick| {
        tick.solved.path.anchor() == Guid(0xda55_ffff) && tick.solved.path.legs().last().is_some()
    }));
}

#[test]
fn missile_contact_updates_solver_and_explorer_semantics_in_one_collection_transaction() {
    let (_simulation, runtime) = runtime(0xf000_0110, 0xf000_0111);
    let mover_guid = runtime.reserve_guid().unwrap();
    let target_guid = runtime.reserve_guid().unwrap();
    let mut mover_definition = definition(mover_guid, 1499, 0.0);
    mover_definition.placement.world_mut().unwrap().velocity = Vector3::new(10.0, 0.0, 0.0);
    mover_definition.physics = resolve_effective_entity_physics_state(
        PhysicsState::GRAVITY
            | PhysicsState::MISSILE
            | PhysicsState::ALIGN_PATH
            | PhysicsState::PATH_CLIPPED
            | PhysicsState::INELASTIC,
    );
    let mut mover_physical = physical_with_ball_target();
    mover_physical.response_policy.restitution = PhysicalRestitution::Inelastic;
    mover_physical.response_policy.align_path = true;
    mover_physical.entity_collision.dynamic_collision.missile = true;
    mover_physical
        .entity_collision
        .dynamic_collision
        .path_clipped = true;
    let mover = runtime
        .spawn_prepared(
            prepared(mover_definition),
            ExplorerPhysicalMode::Integrated,
            Some(mover_physical),
        )
        .unwrap();
    runtime
        .spawn_prepared(
            prepared(definition(target_guid, 1, 1.2)),
            ExplorerPhysicalMode::Integrated,
            Some(physical_with_ball_target()),
        )
        .unwrap();

    let quantum = holtburger_world::MOBILE_CONTACT_TICK_SECONDS;
    let now = Instant::now();
    let mover_tick = (0..3)
        .find_map(|step| {
            runtime
                .tick_physical_collection(
                    quantum,
                    now + Duration::from_secs_f32(quantum * step as f32),
                )
                .unwrap()
                .ticks
                .into_iter()
                .find(|tick| {
                    tick.input.identity.guid == mover_guid
                        && tick.solved.dynamic_state_change.is_some()
                })
        })
        .expect("the projectile must reach its target within the admitted intervals");
    assert_eq!(mover_tick.generation, mover.instance.generation);
    let physics = runtime.project(mover_guid).unwrap().input.physics;
    assert!(!physics.semantic.contains(PhysicsState::MISSILE));
    assert!(!physics.semantic.contains(PhysicsState::ALIGN_PATH));
    assert!(!physics.semantic.contains(PhysicsState::PATH_CLIPPED));
    assert!(physics.semantic.contains(PhysicsState::INELASTIC));
}

#[test]
fn report_only_collection_outcomes_do_not_become_explorer_projection_ticks() {
    let (simulation, runtime) = runtime(0xf000_0120, 0xf000_0121);
    let mut guids = Vec::new();
    for (index, wcid) in [1, 2].into_iter().enumerate() {
        let guid = runtime.reserve_guid().unwrap();
        guids.push(guid);
        let mut definition = definition(guid, wcid, index as f32 * 2.0);
        definition.physics = resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY | PhysicsState::REPORT_COLLISIONS,
        );
        runtime
            .spawn_prepared(
                prepared(definition),
                ExplorerPhysicalMode::Integrated,
                Some(report_only_physical()),
            )
            .unwrap();
    }

    let baseline_at = Instant::now();
    let baseline = simulation
        .tick_dynamic_entity_collection(0.1, baseline_at, false, coasting())
        .unwrap();
    assert!(baseline.collision_reports.is_empty());
    simulation
        .relocate_dynamic_entity(
            SpatialBodyId::Entity(guids[1]),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
            baseline_at + std::time::Duration::from_millis(100),
        )
        .unwrap();
    let collection = simulation
        .tick_dynamic_entity_collection(
            0.1,
            baseline_at + std::time::Duration::from_millis(200),
            false,
            coasting(),
        )
        .unwrap();
    assert_eq!(collection.collision_reports.len(), 2);
    assert_eq!(collection.bodies.len(), 1);
    assert_eq!(
        collection.bodies[0].current.id.authoritative_guid(),
        Some(guids[1])
    );
    assert!(
        collection
            .bodies
            .iter()
            .all(|tick| !physical_tick_changed(tick))
    );
    assert_eq!(runtime.snapshot().unwrap().len(), 2);
}

#[test]
fn failed_body_install_publishes_no_semantic_record() {
    let (simulation, runtime) = runtime(0xf000_0020, 0xf000_0020);
    let guid = runtime.reserve_guid().unwrap();
    let definition = definition(guid, 7, 0.0);
    simulation
        .install_dynamic_entity(
            &definition,
            require_world_initial(&definition, "test install").unwrap(),
            None,
        )
        .unwrap();

    assert_eq!(
        runtime.spawn_prepared(prepared(definition), ExplorerPhysicalMode::PoseOnly, None),
        Err(ExplorerEntityRuntimeError::Body(
            DynamicEntityBodyOperationError::AlreadyRegistered {
                body_id: SpatialBodyId::Entity(guid)
            }
        ))
    );
    assert_eq!(
        runtime.project(guid),
        Err(ExplorerEntityRuntimeError::NotRegistered { guid })
    );
}

#[test]
fn replacement_retires_one_generation_and_late_work_cannot_touch_the_successor() {
    let (_simulation, runtime) = runtime(0xf000_0030, 0xf000_0030);
    let guid = runtime.reserve_guid().unwrap();
    let first = runtime
        .spawn_prepared(
            prepared(definition(guid, 8, 0.0)),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();
    let replacement = runtime
        .replace_prepared(
            prepared(definition(guid, 9, 5.0)),
            first.instance.generation,
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap();

    assert_eq!(replacement.removed, first.instance);
    assert!(replacement.installed.generation > replacement.removed.generation);
    assert_eq!(
        replacement.body.installed.participation,
        PhysicalBodyParticipation::PoseOnly
    );
    assert!(!runtime.is_current(guid, first.instance.generation));
    assert_eq!(
        runtime
            .project(guid)
            .unwrap()
            .input
            .placement
            .world()
            .unwrap()
            .body
            .runtime_pose
            .coords
            .x,
        5.0
    );

    let stale = runtime
        .replace_prepared(
            prepared(definition(guid, 10, 9.0)),
            first.instance.generation,
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap_err();
    assert_eq!(
        stale,
        ExplorerEntityRuntimeError::StaleGeneration {
            guid,
            expected: first.instance.generation,
            actual: replacement.installed.generation,
        }
    );
    assert_eq!(runtime.project(guid).unwrap().input.identity.wcid, 9);
}

#[test]
fn despawn_and_reset_remove_each_body_once_without_reusing_generations() {
    let (_simulation, runtime) = runtime(0xf000_0040, 0xf000_0041);
    let first_guid = runtime.reserve_guid().unwrap();
    let first = runtime
        .spawn_prepared(
            prepared(definition(first_guid, 11, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap();
    let despawned = runtime
        .despawn(first_guid, first.instance.generation)
        .unwrap();
    assert_eq!(despawned.instance, first.instance);
    assert_eq!(
        runtime.despawn(first_guid, first.instance.generation),
        Err(ExplorerEntityRuntimeError::NotRegistered { guid: first_guid })
    );

    let second_guid = runtime.reserve_guid().unwrap();
    let second = runtime
        .spawn_prepared(
            prepared(definition(second_guid, 12, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap();
    assert_eq!(runtime.reset().unwrap(), vec![second.instance.clone()]);
    assert!(runtime.snapshot().unwrap().is_empty());
    assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0040));
    let after_reset = runtime
        .spawn_prepared(
            prepared(definition(Guid(0xf000_0040), 13, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
        )
        .unwrap();
    assert!(after_reset.instance.generation > second.instance.generation);
}

/// Both malformed-child-set clauses are reachable and name every wearer involved, so a
/// miswired producer learns which group it published under, not only what the child claims.
#[test]
fn a_malformed_child_set_is_refused_before_any_body_is_installed() {
    let (_simulation, runtime) = runtime(0xf000_0090, 0xf000_0095);
    let wearer_guid = runtime.reserve_guid().unwrap();
    let other_wearer_guid = runtime.reserve_guid().unwrap();
    let child_guid = runtime.reserve_guid().unwrap();

    assert_eq!(
        runtime
            .spawn_prepared_group(
                prepared(definition(wearer_guid, 10, 0.0)),
                ExplorerPhysicalMode::PoseOnly,
                None,
                vec![prepared(attached_definition(
                    child_guid,
                    20,
                    other_wearer_guid,
                ))],
            )
            .unwrap_err(),
        ExplorerEntityRuntimeError::ChildWearerMismatch {
            guid: child_guid,
            expected_parent: wearer_guid,
            declared_parent: other_wearer_guid,
        }
    );
    assert_eq!(
        runtime
            .spawn_prepared_group(
                prepared(definition(wearer_guid, 10, 0.0)),
                ExplorerPhysicalMode::PoseOnly,
                None,
                vec![prepared(definition(child_guid, 20, 0.0))],
            )
            .unwrap_err(),
        ExplorerEntityRuntimeError::ChildNotAttached {
            guid: child_guid,
            parent: wearer_guid,
        }
    );
    // A refused group leaves no wearer, no child, and no host body behind.
    assert!(runtime.snapshot().unwrap().is_empty());
}

#[test]
fn attached_children_cut_over_with_their_wearer_and_reject_independent_despawn() {
    let (_simulation, runtime) = runtime(0xf000_0050, 0xf000_0055);
    let wearer_guid = runtime.reserve_guid().unwrap();
    let first_child_guid = runtime.reserve_guid().unwrap();
    let first = runtime
        .spawn_prepared_group(
            prepared(definition(wearer_guid, 10, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
            vec![prepared(attached_definition(
                first_child_guid,
                20,
                wearer_guid,
            ))],
        )
        .unwrap();

    assert_eq!(first.children.len(), 1);
    let independent_error = runtime
        .despawn(first_child_guid, first.children[0].generation)
        .unwrap_err();
    assert_eq!(
        independent_error,
        ExplorerEntityRuntimeError::AttachedOperation {
            guid: first_child_guid,
            parent: wearer_guid,
            operation: "independent despawn",
        }
    );
    assert_eq!(
        runtime
            .physical_preparation_required(
                first_child_guid,
                first.children[0].generation,
                LocalPhysicalDemand::NONE,
            )
            .unwrap_err(),
        ExplorerEntityRuntimeError::AttachedOperation {
            guid: first_child_guid,
            parent: wearer_guid,
            operation: "physics-state planning",
        }
    );

    let second_child_guid = runtime.reserve_guid().unwrap();
    let replacement = runtime
        .replace_prepared_group(
            prepared(definition(wearer_guid, 11, 1.0)),
            first.instance.generation,
            ExplorerPhysicalMode::PoseOnly,
            None,
            vec![prepared(attached_definition(
                second_child_guid,
                21,
                wearer_guid,
            ))],
        )
        .unwrap();
    assert_eq!(replacement.removed_children, first.children);
    assert_eq!(replacement.installed_children.len(), 1);
    assert_eq!(
        runtime
            .snapshot()
            .unwrap()
            .into_iter()
            .map(|projection| projection.input.identity.guid)
            .collect::<Vec<_>>(),
        vec![wearer_guid, second_child_guid]
    );

    let removed = runtime
        .despawn(wearer_guid, replacement.installed.generation)
        .unwrap();
    assert_eq!(removed.children, replacement.installed_children);
    assert!(runtime.snapshot().unwrap().is_empty());

    let reset_wearer_guid = runtime.reserve_guid().unwrap();
    let reset_child_guid = runtime.reserve_guid().unwrap();
    runtime
        .spawn_prepared_group(
            prepared(definition(reset_wearer_guid, 12, 0.0)),
            ExplorerPhysicalMode::PoseOnly,
            None,
            vec![prepared(attached_definition(
                reset_child_guid,
                22,
                reset_wearer_guid,
            ))],
        )
        .unwrap();
    let reset = runtime.reset().unwrap();
    assert_eq!(reset.len(), 2);
    assert!(runtime.snapshot().unwrap().is_empty());
}

/// Serves flat ground so a fixture body can prove stable support.
struct FlatGround;

impl crate::host_simulation_runtime::CollisionSource for FlatGround {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        Ok(Some(LandblockCollisionAsset {
            landblock_id,
            terrain: holtburger_content::TerrainCollisionSurface::from_terrain(
                &holtburger_content::LandblockTerrain {
                    grid_size: 9,
                    tile_size: 24.0,
                    height_indices: vec![0; 81],
                    heights: vec![0.0; 81],
                    terrain_samples: vec![0; 81],
                    cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                        landblock_id,
                    ),
                },
            )?,
            static_geometry: holtburger_content::LandblockColliders::default(),
        }))
    }
}

const WALK_TABLE: u32 = 0x0900_0001;
const WALK_STYLE: u32 = 0x8000_003D;
const WALK_STAND: u32 = 0x4500_0003;
const WALK_FORWARD: u32 = 0x4500_0005;
const RUN_FORWARD: u32 = 0x4400_0007;
/// Default substate of the fixture's only style: what an unpossessed entity idles on.
const STAND_ANIM: u32 = 0x0300_0001;
const WALK_ANIM: u32 = 0x0300_0002;
const RUN_ANIM: u32 = 0x0300_0006;
const READY_ANIM: u32 = 0x0300_0003;
const FALLING_ANIM: u32 = 0x0300_0004;
/// Successor the idle cycle advances to on its own, with no input and no possession.
const FIDGET_ANIM: u32 = 0x0300_0005;

/// Four part frames with no hooks: the minimum an assembled animation needs.
fn part_frames() -> Vec<AnimationFrame> {
    use holtburger_dat::file_type::setup_model::AnimationFrame;
    (0..4)
        .map(|_| AnimationFrame {
            frames: Vec::new(),
            hooks: Vec::new(),
        })
        .collect()
}

/// A clip that authors a per-frame root step, which is what a locomotion cycle does.
fn travelling_animation(id: u32, step: f32) -> Animation {
    Animation {
        id,
        flags: AnimationFlags::POS_FRAMES,
        num_parts: 0,
        num_frames: 4,
        pos_frames: (0..4)
            .map(|_| Frame {
                origin: Vector3::new(0.0, step, 0.0),
                orientation: Quaternion::identity(),
            })
            .collect(),
        part_frames: part_frames(),
    }
}

/// A clip with no root track at all, which is what an idle or a presentation pose is.
///
/// The distinction matters to scheduling, not just to travel: a stationary clip leaves its
/// body settled out of the collection scan.
fn stationary_animation(id: u32) -> Animation {
    Animation {
        id,
        flags: AnimationFlags::empty(),
        num_parts: 0,
        num_frames: 4,
        pos_frames: Vec::new(),
        part_frames: part_frames(),
    }
}

/// One cycle entry playing the named animations in order.
fn cycle(anim_ids: impl IntoIterator<Item = u32>) -> MotionData {
    MotionData {
        bitfield: 0,
        flags: MotionDataFlags::empty(),
        anims: anim_ids
            .into_iter()
            .map(|anim_id| AnimData {
                anim_id,
                low_frame: 0,
                high_frame: -1,
                framerate: 4.0,
            })
            .collect(),
        velocity: None,
        omega: None,
    }
}

/// Assembles the single-table, single-style catalog every motion fixture here shares.
fn motion_catalog(
    cycles: std::collections::HashMap<u32, MotionData>,
    animations: Vec<Animation>,
    setup_defaults: impl IntoIterator<Item = (u32, u32)>,
) -> Arc<MotionSequenceCatalog> {
    Arc::new(
        MotionSequenceCatalog::assemble(
            [MotionTable {
                id: WALK_TABLE,
                default_style: WALK_STYLE,
                style_defaults: std::collections::HashMap::from([(WALK_STYLE, WALK_STAND)]),
                cycles,
                modifiers: std::collections::HashMap::new(),
                links: std::collections::HashMap::new(),
            }],
            animations,
            setup_defaults,
        )
        .expect("motion fixture should assemble"),
    )
}

/// A table whose idle cycle advances between two stationary clips without any input, which is
/// what a real fidget does and the only way an unpossessed clip changes on its own.
fn fidgeting_catalog() -> Arc<MotionSequenceCatalog> {
    motion_catalog(
        std::collections::HashMap::from([(
            MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
            cycle([STAND_ANIM, FIDGET_ANIM]),
        )]),
        vec![
            stationary_animation(STAND_ANIM),
            stationary_animation(FIDGET_ANIM),
        ],
        [],
    )
}

/// A table whose walk cycle authors root motion along local Y, which is what a real walk does.
fn walking_catalog() -> Arc<MotionSequenceCatalog> {
    walking_catalog_with_jump_presentation(false)
}

/// A target-authored run cycle used to check physical command and playback ownership.
fn running_catalog() -> Arc<MotionSequenceCatalog> {
    motion_catalog(
        std::collections::HashMap::from([
            (
                MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
                cycle([STAND_ANIM]),
            ),
            (
                MotionTable::cycle_key(WALK_STYLE, RUN_FORWARD),
                cycle([RUN_ANIM]),
            ),
        ]),
        vec![
            stationary_animation(STAND_ANIM),
            travelling_animation(RUN_ANIM, 1.0),
        ],
        [(FIXTURE_SETUP_DID, WALK_TABLE)],
    )
}

fn walking_catalog_with_jump_presentation(
    include_jump_presentation: bool,
) -> Arc<MotionSequenceCatalog> {
    let mut cycles = std::collections::HashMap::from([
        (
            MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
            cycle([STAND_ANIM]),
        ),
        (
            MotionTable::cycle_key(WALK_STYLE, WALK_FORWARD),
            cycle([WALK_ANIM]),
        ),
    ]);
    let mut animations = vec![
        stationary_animation(STAND_ANIM),
        travelling_animation(WALK_ANIM, 1.0),
    ];
    if include_jump_presentation {
        cycles.insert(
            MotionTable::cycle_key(WALK_STYLE, MotionCommand::READY.raw()),
            cycle([READY_ANIM]),
        );
        cycles.insert(
            MotionTable::cycle_key(WALK_STYLE, MotionCommand::FALLING.raw()),
            cycle([FALLING_ANIM]),
        );
        animations.extend([
            stationary_animation(READY_ANIM),
            stationary_animation(FALLING_ANIM),
        ]);
    }
    motion_catalog(cycles, animations, [(FIXTURE_SETUP_DID, WALK_TABLE)])
}

fn walking_runtime() -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
    walking_runtime_with_catalog(walking_catalog())
}

fn walking_runtime_with_catalog(
    catalog: Arc<MotionSequenceCatalog>,
) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
    walking_runtime_with_body(catalog, physical())
}

fn walking_runtime_with_body(
    catalog: Arc<MotionSequenceCatalog>,
    body: DynamicPhysicalBodyDefinition,
) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
    let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
    let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
        Arc::clone(&simulation),
        0xf000_0090,
        0xf000_00a0,
        catalog,
    );
    install_fixture_interest(&simulation);

    let guid = runtime.reserve_guid().unwrap();
    let mut definition = definition(guid, 1, 0.0);
    definition.content.motion_table_did = Some(WALK_TABLE);
    runtime
        .spawn_prepared(
            prepared(definition),
            ExplorerPhysicalMode::Integrated,
            Some(body),
        )
        .unwrap();
    (simulation, runtime, guid)
}

use std::time::Duration;

fn settle(simulation: &HostSimulationRuntime, start: Instant) -> Instant {
    for step in 0..240 {
        let now = start + std::time::Duration::from_millis(step * 33);
        if simulation
            .tick_dynamic_entity_collection(1.0 / 30.0, now, false, coasting())
            .unwrap()
            .bodies
            .is_empty()
        {
            return now;
        }
    }
    panic!("the grounded fixture body must settle before possession");
}

fn set_walk_intent(
    runtime: &ExplorerEntityRuntime,
    possession: &ExplorerPossession,
    revision: u64,
) {
    assert_eq!(
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().walk().forward().build(),
                run_rate_scalar: 1.0,
            })
            .expect("walk intent is valid"),
        PossessionIntentReplaceResult::Accepted
    );
}

/// The payoff of the whole plan, at the Explorer boundary: a possessed entity commanded to walk
/// travels in response to its animation's authored movement.
#[test]
fn a_possessed_entity_walks_on_its_authored_root_motion() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let before = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .expect("the possessed body must exist")
        .pose
        .coords;

    let possession = runtime.possess(guid).unwrap();
    assert_eq!(possession.motion_table_id, WALK_TABLE);
    assert_eq!(possession.accepted_stance, WALK_STYLE);
    set_walk_intent(&runtime, &possession, 1);

    for step in 1..=15 {
        runtime
            .tick_physical_collection(
                1.0 / 30.0,
                settled_at + std::time::Duration::from_millis(step * 33),
            )
            .unwrap();
    }

    let after = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .expect("the possessed body must still exist")
        .pose
        .coords;
    assert!(
        (after - before).length() > 0.5,
        "a possessed entity ordered to walk must travel: {before:?} -> {after:?}"
    );
}

#[test]
fn explorer_and_client_authored_grounded_adapters_resolve_equal_actuation() {
    let (simulation, runtime, guid) = walking_runtime_with_catalog(running_catalog());
    settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).expect("fixture is possessable");
    let table = runtime
        .motion_catalog
        .table(possession.motion_table_id)
        .expect("the possession table remains projected");
    let mut active = ActivePossession::new(
        guid,
        possession.entity_generation,
        possession.possession_generation,
        possession.motion_table_id,
        table,
        runtime.possession_profile,
    )
    .expect("fixture possession should resolve");
    let drive = CharacterDrive::builder().run().forward().build();
    active.controller.replace_drive(drive);
    let body = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .expect("the possessed body must exist after settling");
    assert_eq!(body.contact, ContactState::Grounded);
    let offset = RigidTransform {
        translation: Vector3::new(0.0, 0.25, 0.0),
        rotation: Quaternion::identity(),
    };

    let explorer = possession_grounded_actuation(
        &active,
        super::possession::PossessionGroundedStep {
            authored_offset: offset,
            body: &body,
            object_scale: 1.0,
            profile: runtime.possession_profile,
            delta_seconds: 1.0 / 30.0,
            launch: None,
            manual_yaw_radians: 0.0,
        },
    )
    .expect("Explorer adapter should produce grounded actuation");
    let client = holtburger_world::authored_grounded_actuation(
        offset,
        body.pose,
        body.contact,
        1.0,
        1.0 / 30.0,
    )
    .expect("client adapter should produce grounded actuation");
    assert_eq!(explorer, client);
}

#[test]
fn observed_gait_uses_supported_motion_without_changing_authored_playback() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();
    set_walk_intent(&runtime, &possession, 1);
    let collection = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at)
        .unwrap();
    let mut tick = collection
        .ticks
        .into_iter()
        .find(|tick| tick.solved.current.id == SpatialBodyId::Entity(guid))
        .unwrap();
    let MotionPresentation::Playing(clip) = tick.motion.unwrap().locomotion.unwrap().clip else {
        panic!("accepted walking must present a gait");
    };
    assert_eq!(clip.animation_id, WALK_ANIM);
    let table = runtime.motion_catalog.table(WALK_TABLE).unwrap();
    let authored_rate = table.cycle(WALK_STYLE, WALK_FORWARD).unwrap().clips[0].framerate;
    let supported_speed = tick.solved.supported_motion.accepted.velocity.length();
    assert!(supported_speed > holtburger_world::motion::OBSERVED_LINEAR_IDLE_SPEED_MPS);
    assert!(
        (clip.framerate
            - authored_rate * supported_speed / holtburger_world::motion::OBSERVED_WALK_SPEED_MPS)
            .abs()
            < 0.001
    );

    let mut registry = runtime.registry.lock().unwrap();
    let definition = registry.entities.get(&guid).unwrap().definition.clone();
    let before = registry.motion.playback.get(guid).unwrap().clone();
    // Keep the nonzero accepted path, but report no supported travel. A path may include
    // airborne travel or lifts; the observer must consume the solver's supported-motion fact.
    assert!(tick.solved.current.pose.coords != tick.solved.previous.pose.coords);
    tick.solved.supported_motion = holtburger_world::SupportedBodyMotion::default();
    registry
        .motion
        .observe_body(
            &runtime.motion_catalog,
            &definition,
            &tick.solved,
            1.0 / 30.0,
        )
        .unwrap();
    let after = registry.motion.playback.get(guid).unwrap();
    assert_eq!(
        after
            .motion_playback()
            .unwrap()
            .locomotion
            .unwrap()
            .clip
            .animation_id(),
        STAND_ANIM
    );
    assert_eq!(after.tick(), before.tick());
    assert_eq!(after.state(), before.state());
    assert_eq!(
        after.sequence().frame_number(),
        before.sequence().frame_number()
    );
    registry.motion.playback.clear_locomotion(guid);
    let restored = registry.motion.playback.get(guid).unwrap();
    assert_eq!(
        restored
            .motion_playback()
            .unwrap()
            .ordinary
            .unwrap()
            .clip
            .animation_id(),
        WALK_ANIM
    );
    assert_eq!(restored.tick(), before.tick());
}

#[test]
fn walk_rate_does_not_scale_authored_translation() {
    let measure = |run_rate_scalar: f32| {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("body")
            .pose
            .coords;
        let possession = runtime.possess(guid).expect("fixture is possessable");
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().walk().forward().build(),
                run_rate_scalar,
            })
            .expect("walk intent");
        for step in 1..=15 {
            runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .expect("walk tick");
        }
        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("body")
            .pose
            .coords;
        (after - before).length()
    };

    let rate_one = measure(1.0);
    let rate_ten = measure(10.0);
    assert!(
        (rate_ten - rate_one).abs() < 0.05,
        "walk rates diverged: {rate_one} vs {rate_ten}"
    );
}

#[test]
fn fallback_run_immediately_uses_the_resolved_speed() {
    for run_rate_scalar in [1.0, 10.0] {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).expect("fixture is possessable");
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar,
            })
            .expect("run intent");
        let expected = runtime.possession_profile.fallback.run_speed() * run_rate_scalar;
        let quantum = holtburger_world::MOBILE_CONTACT_TICK_SECONDS;
        runtime
            .tick_physical_collection(quantum, settled_at + Duration::from_secs_f32(quantum))
            .expect("run tick");
        let body = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("body");
        assert!(
            (body.retained.velocity.y - expected).abs() < 0.001,
            "resolved run speed must apply on the first tick: {:?}, expected {expected}",
            body.retained.velocity
        );
    }
}

#[test]
fn authored_run_speed_and_playback_rate_use_the_same_scalar() {
    let measure = |run_rate_scalar: f32| {
        let catalog = running_catalog();
        let clip = &catalog
            .table(WALK_TABLE)
            .expect("table")
            .cycle(WALK_STYLE, RUN_FORWARD)
            .expect("run cycle")
            .clips[0];
        let expected_speed = clip
            .animation
            .root
            .composed_over(clip.low_frame, clip.high_frame)
            .translation
            .y
            * clip.framerate
            / clip.frame_span() as f32
            * run_rate_scalar;
        let (simulation, runtime, guid) = walking_runtime_with_catalog(catalog);
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).expect("fixture is possessable");
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar,
            })
            .expect("run intent");
        let quantum = 1.0 / 30.0;
        runtime
            .tick_physical_collection(quantum, settled_at + Duration::from_secs_f32(quantum))
            .expect("run tick");
        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("body")
            .retained
            .velocity;
        assert!((after.y - expected_speed).abs() < 0.001);
        let probe = runtime.possession_motion_probe().expect("probe");
        (after.y, probe.substate.speed)
    };

    let (rate_one_speed, rate_one_playback) = measure(1.0);
    let (rate_two_speed, rate_two_playback) = measure(2.0);
    assert!(
        rate_one_speed > 0.0 && (rate_two_speed - rate_one_speed * 2.0).abs() < 0.001,
        "settled authored run speed did not scale: {rate_one_speed} vs {rate_two_speed}"
    );
    assert_eq!(rate_one_playback, 1.0);
    assert_eq!(rate_two_playback, 2.0);
}

#[test]
fn reset_preserves_the_applied_run_rate_snapshot() {
    let (simulation, runtime, guid) = walking_runtime_with_catalog(running_catalog());
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).expect("fixture is possessable");
    assert_eq!(
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar: 10.0,
            })
            .expect("run intent"),
        PossessionIntentReplaceResult::Accepted
    );
    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .expect("run tick");
    assert_eq!(
        runtime
            .possession_motion_probe()
            .expect("run probe")
            .requested_run_rate,
        10.0
    );

    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 2,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 10.0,
            event: PossessionLifecycleEvent::Reset,
        })
        .expect("reset edge");
    let reset = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
        .expect("reset tick");
    assert!(reset.ticks.iter().any(|tick| {
        tick.possession_event_outcomes
            .iter()
            .any(|outcome| outcome.result == PossessionEventOutcomeKind::Reset)
    }));
    assert_eq!(
        runtime
            .possession_motion_probe()
            .expect("reset probe")
            .requested_run_rate,
        10.0,
        "reset clears drive state without resetting the selected rate"
    );

    runtime
        .replace_possession_intent(ExplorerPossessionIntentRequest {
            possession_generation: possession.possession_generation,
            revision: 3,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().run().forward().build(),
            run_rate_scalar: 10.0,
        })
        .expect("restored run intent");
    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(99))
        .expect("restored run tick");
    let restored = runtime.possession_motion_probe().expect("restored probe");
    assert_eq!(restored.requested_run_rate, 10.0);
    assert_eq!(restored.substate.speed, 10.0);
}

#[test]
fn possession_commits_bounded_motion_and_playback() {
    let (simulation, runtime, guid) = walking_runtime_with_body(running_catalog(), physical());
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).expect("fixture is possessable");
    let result = runtime
        .replace_possession_intent(ExplorerPossessionIntentRequest {
            possession_generation: possession.possession_generation,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().run().forward().build(),
            run_rate_scalar: 10.0,
        })
        .expect("run intent is valid");
    assert_eq!(result, PossessionIntentReplaceResult::Accepted);

    let tick = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .expect("the safe prefix still commits");
    let body_tick = tick
        .ticks
        .iter()
        .find(|tick| tick.input.identity.guid == guid)
        .expect("the possessed body must publish its committed tick");
    assert!(!body_tick.solved.path.legs().is_empty());

    let probe = runtime
        .possession_motion_probe()
        .expect("the possession remains active after a bounded tick");
    assert_eq!(probe.requested_run_rate, 10.0);
    assert_eq!(
        probe.physical_status,
        Some(ExplorerPossessionPhysicalStatus::Solved)
    );
    assert_eq!(
        probe
            .motion
            .expect("run playback must be committed")
            .ordinary
            .unwrap()
            .clip
            .animation_id(),
        RUN_ANIM
    );
    assert_eq!(probe.substate.speed, 10.0);
    let speed = probe
        .effective_planar_speed
        .expect("the committed body exposes achieved speed");
    let catalog = running_catalog();
    let clip = &catalog
        .table(WALK_TABLE)
        .unwrap()
        .cycle(WALK_STYLE, RUN_FORWARD)
        .unwrap()
        .clips[0];
    let expected_speed = clip
        .animation
        .root
        .composed_over(clip.low_frame, clip.high_frame)
        .translation
        .y
        * clip.framerate
        / clip.frame_span() as f32
        * probe.requested_run_rate;
    assert!(
        (speed - expected_speed).abs() < 0.001,
        "first tick must follow authored speed: {speed}"
    );
}

/// Every tick states the clip its entity is playing, changed or not, so a consumer never has
/// to have witnessed the transition that selected it.
#[test]
fn every_tick_states_the_clip_its_entity_is_playing() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();

    let first = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .unwrap();
    assert!(
        first.ticks.iter().any(|tick| {
            tick.publish
                && tick
                    .motion
                    .and_then(|motion| motion.ordinary)
                    .map(|layer| layer.clip.animation_id())
                    == Some(STAND_ANIM)
        }),
        "the first tick publishes the idle the entity is already playing"
    );

    set_walk_intent(&runtime, &possession, 1);
    let mut levels = Vec::new();
    for step in 2..=20 {
        for tick in runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap()
            .ticks
        {
            assert!(
                tick.motion.is_some(),
                "a body driven by a motion table always has a clip to state"
            );
            if tick.publish {
                levels.push(
                    tick.motion
                        .expect("a stated motion presentation")
                        .ordinary
                        .unwrap()
                        .clip
                        .animation_id(),
                );
            }
        }
    }

    assert!(
        levels.contains(&WALK_ANIM),
        "commanding a walk moves the stated level onto the walk cycle: {levels:?}"
    );
}

#[test]
fn unpossessed_fixed_obstacle_consumes_scaled_root_motion_once_per_tick() {
    let catalog = motion_catalog(
        std::collections::HashMap::from([(
            MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
            cycle([STAND_ANIM]),
        )]),
        vec![travelling_animation(STAND_ANIM, 0.25)],
        [],
    );
    let mut body = physical();
    body.movement = PhysicalBodyDefinition::fixed_position(body.movement.spheres()).unwrap();
    body.entity_collision.contact_response = holtburger_world::EntityContactResponse::Obstacle;
    let (simulation, runtime, guid) = walking_runtime_with_body(catalog, body.clone());
    let generation = runtime.project(guid).unwrap().generation;
    let mut scaled = definition(guid, 1, 0.0);
    scaled.content.motion_table_did = Some(WALK_TABLE);
    scaled.object_scale = 2.0;
    runtime
        .replace_prepared(
            prepared(scaled),
            generation,
            ExplorerPhysicalMode::Integrated,
            Some(body),
        )
        .unwrap();
    let initial = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap();
    let start = Instant::now();
    for tick in 1..=30 {
        runtime
            .tick_physical_collection(1.0 / 30.0, start + Duration::from_millis(tick * 34))
            .unwrap();
    }
    let current = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap();
    // Four authored 0.25m steps per second, with root scale 2, for one admitted second.
    assert!((current.pose.coords.y - initial.pose.coords.y - 2.0).abs() < 0.001);
    assert_eq!(current.retained.velocity, Vector3::zero());
    assert_eq!(current.retained.acceleration, Vector3::zero());
}

/// The bug this contract exists to prevent: an entity that settles while a consumer is still
/// realizing it must still be able to state what it is playing. The clip was previously an
/// edge drained on publication, so a consumer that missed it never learned the entity idles.
#[test]
fn a_settled_unpossessed_entity_states_its_idle_to_a_late_consumer() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    for step in 1..=30 {
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap();
    }

    assert_eq!(
        runtime
            .project(guid)
            .expect("the spawned entity must project")
            .motion
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip.animation_id()),
        Some(STAND_ANIM),
        "a projection taken long after spawn still states the idle"
    );
    assert_eq!(
        runtime
            .snapshot()
            .expect("the population must snapshot")
            .into_iter()
            .find(|projection| projection.input.identity.guid == guid)
            .expect("the spawned entity must appear in its snapshot")
            .motion
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip.animation_id()),
        Some(STAND_ANIM),
        "a complete snapshot reconstructs playback without replaying history"
    );
}

/// A frontend stages a clip closure for the table id its view names, and has no setup catalog
/// to consult. Leaving the setup's default unresolved would publish an entity that states a
/// clip it also claims to have no table for.
#[test]
fn an_entity_without_its_own_table_publishes_the_one_its_setup_defaults_to() {
    let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
    let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
        Arc::clone(&simulation),
        0xf000_0090,
        0xf000_00a0,
        walking_catalog(),
    );
    let guid = runtime.reserve_guid().unwrap();
    let definition = definition(guid, 1, 0.0);
    assert_eq!(
        definition.content.motion_table_did, None,
        "the fixture weenie carries no table of its own"
    );

    runtime
        .spawn_prepared(prepared(definition), ExplorerPhysicalMode::PoseOnly, None)
        .unwrap();

    assert_eq!(
        runtime
            .project(guid)
            .unwrap()
            .input
            .content
            .motion_table_did,
        Some(WALK_TABLE),
        "the published entity names the table it actually animates from"
    );
}

/// An idle contributes no root motion, so nothing else returns a settled body to the collection
/// scan. Its own clip change has to, or the change has no tick to travel on and a consumer is
/// left rendering the clip the body stopped playing.
#[test]
fn a_clip_change_wakes_a_settled_body_so_it_can_publish() {
    let (simulation, runtime, guid) = walking_runtime_with_catalog(fidgeting_catalog());
    let mut now = settle(&simulation, Instant::now());

    // Run until the idle's first clip leaves the body settled and out of the scan entirely.
    let mut quiet = false;
    for _ in 0..30 {
        now += Duration::from_millis(33);
        quiet = runtime
            .tick_physical_collection(1.0 / 30.0, now)
            .unwrap()
            .ticks
            .is_empty();
        if quiet {
            break;
        }
    }
    assert!(
        quiet,
        "a stationary idle must let the fixture body settle out of the scan"
    );
    assert_eq!(
        runtime
            .project(guid)
            .unwrap()
            .motion
            .unwrap()
            .ordinary
            .unwrap()
            .clip
            .animation_id(),
        STAND_ANIM,
        "the settled body is still on the first clip of its idle"
    );

    // Playback keeps advancing off the scan, so the successor clip eventually comes due.
    let mut published = None;
    for _ in 0..90 {
        now += Duration::from_millis(33);
        let tick = runtime.tick_physical_collection(1.0 / 30.0, now).unwrap();
        if let Some(clip) = tick
            .ticks
            .iter()
            .filter(|tick| tick.publish)
            .find_map(|tick| tick.motion)
        {
            published = clip.ordinary.map(|layer| layer.clip.animation_id());
            break;
        }
    }
    assert_eq!(
        published,
        Some(FIDGET_ANIM),
        "the successor clip must wake its body back into the scan and publish there"
    );
}

/// Releasing possession stops the entity: authored drive is per-tick, so nothing survives it.
#[test]
fn releasing_possession_stops_authored_travel() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();
    set_walk_intent(&runtime, &possession, 1);
    for step in 1..=15 {
        runtime
            .tick_physical_collection(
                1.0 / 30.0,
                settled_at + std::time::Duration::from_millis(step * 33),
            )
            .unwrap();
    }

    let released_at = settled_at + std::time::Duration::from_millis(600);
    let release = runtime.release_possession(released_at).unwrap();
    assert_eq!(release.released_guid, Some(guid));
    assert!(release.possession_generation > possession.possession_generation);
    let before = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;
    for step in 1..=15 {
        runtime
            .tick_physical_collection(
                1.0 / 30.0,
                released_at + std::time::Duration::from_millis(step * 33),
            )
            .unwrap();
    }
    let after = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;

    assert!(
        (after - before).length() < 0.05,
        "a released entity keeps no authored momentum: {before:?} -> {after:?}"
    );
}

/// Capability distinguishes authored physics from fallback with or without target presentation.
#[test]
fn possession_reports_composite_sources_for_every_canonical_family() {
    let (_simulation, runtime, guid) = walking_runtime();

    let possession = runtime.possess(guid).unwrap();
    let capability = possession
        .stances
        .iter()
        .find(|capability| capability.style == WALK_STYLE)
        .expect("non-combat capability");
    assert_eq!(
        capability.walk,
        crate::explorer_possession_control::PossessionLocomotionSource::TargetAuthored
    );
    for source in [capability.run, capability.sidestep, capability.turn] {
        assert_eq!(
            source,
            crate::explorer_possession_control::PossessionLocomotionSource::StandardFallbackWithoutTargetPresentation
        );
    }
}

#[test]
fn mixed_authored_forward_and_fallback_sidestep_drive_once_per_axis() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let before = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;
    let possession = runtime.possess(guid).unwrap();
    runtime
        .replace_possession_intent(ExplorerPossessionIntentRequest {
            possession_generation: possession.possession_generation,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder()
                .walk()
                .forward()
                .strafe_right()
                .build(),
            run_rate_scalar: 1.0,
        })
        .unwrap();

    for step in 1..=30 {
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap();
    }
    let after = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;
    let travelled = after - before;

    assert!(
        travelled.y > 2.5,
        "target-authored forward was lost: {travelled:?}"
    );
    assert!(
        travelled.x > 1.0 && travelled.x < 2.0,
        "fallback sidestep should contribute once at about 1.5m/s: {travelled:?}"
    );
}

#[test]
fn absent_turn_presentation_still_turns_the_possessed_body_with_fallback() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let before = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();
    let possession = runtime.possess(guid).unwrap();
    runtime
        .replace_possession_intent(ExplorerPossessionIntentRequest {
            possession_generation: possession.possession_generation,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().turn_right().build(),
            run_rate_scalar: 1.0,
        })
        .unwrap();

    for step in 1..=15 {
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap();
    }
    let after = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();
    assert!(
        after - before > 0.6,
        "fallback turn should rotate about 0.75rad in half a second: {before} -> {after}"
    );
}

#[test]
fn jump_launches_without_falling_target_presentation() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();
    assert_eq!(
        possession.stances[0].jump_presentation,
        crate::explorer_possession_control::PossessionJumpPresentation::ReadyOnly
    );
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::BeginJump,
        })
        .unwrap();
    let charged = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .unwrap();
    assert!(charged.ticks.iter().any(|tick| {
        tick.possession_event_outcomes.iter().any(|outcome| {
            matches!(
                outcome.result,
                PossessionEventOutcomeKind::ChargeAccepted { .. }
            )
        })
    }));

    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 1,
            revision: 2,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().forward().turn_right().build(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::ReleaseJump {
                extent: holtburger_core::JumpExtent::MAXIMUM,
            },
        })
        .unwrap();
    let launched = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
        .unwrap();
    assert!(launched.ticks.iter().any(|tick| {
        tick.possession_event_outcomes.iter().any(|outcome| {
            matches!(
                outcome.result,
                PossessionEventOutcomeKind::JumpReleased { .. }
            )
        })
    }));
    let body = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap();
    assert!(
        body.retained.velocity.z > 0.0,
        "accepted release must launch upward"
    );

    let launch_planar_speed = body.retained.velocity.x.hypot(body.retained.velocity.y);
    assert_eq!(
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 3,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder()
                    .walk()
                    .forward()
                    .turn_right()
                    .build(),
                run_rate_scalar: 10.0,
            })
            .unwrap(),
        PossessionIntentReplaceResult::Accepted
    );
    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(99))
        .unwrap();
    let airborne_body = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap();
    assert!(
        (airborne_body
            .retained
            .velocity
            .x
            .hypot(airborne_body.retained.velocity.y)
            - launch_planar_speed)
            .abs()
            < 0.1,
        "changing rate in flight must not rescale retained planar velocity: {launch_planar_speed} -> {}",
        airborne_body
            .retained
            .velocity
            .x
            .hypot(airborne_body.retained.velocity.y)
    );

    let launch_heading = body.pose.rotation.to_heading();
    let mut saw_airborne_turn = false;
    let mut restored_walk_clip = false;
    let mut landed = false;
    for step in 4..=140 {
        let ticks = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap();
        assert!(
            ticks
                .ticks
                .iter()
                .flat_map(|tick| &tick.possession_event_outcomes)
                .all(|outcome| !matches!(
                    outcome.result,
                    PossessionEventOutcomeKind::JumpReleased { .. }
                )),
            "one release edge must launch at most once"
        );
        let body = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap();
        if body.contact == ContactState::Airborne
            && body.pose.rotation.to_heading() - launch_heading > 0.08
        {
            saw_airborne_turn = true;
        }
        restored_walk_clip |= ticks.ticks.iter().any(|tick| {
            tick.motion
                .and_then(|motion| motion.locomotion)
                .is_some_and(|layer| layer.clip.animation_id() == WALK_ANIM)
        });
        if body.contact == ContactState::Grounded && step > 3 {
            landed = true;
            // The landing tick can contain only airborne travel. Observed walking
            // resumes once a subsequent tick accepts supported travel, without new input.
            if restored_walk_clip {
                break;
            }
        }
    }
    assert!(
        saw_airborne_turn,
        "turn intent must remain effective while airborne"
    );
    assert!(
        landed,
        "jump fixture must land within its bounded test horizon"
    );
    assert!(
        restored_walk_clip,
        "landing must restore retained authored locomotion without new input"
    );
}

#[test]
fn queued_jump_release_keeps_its_rate_snapshot_when_a_newer_intent_arrives() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).expect("fixture is possessable");
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::BeginJump,
        })
        .expect("begin edge queues");
    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .expect("charge tick");

    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 1,
            revision: 2,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().run().forward().build(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::ReleaseJump {
                extent: holtburger_core::JumpExtent::MAXIMUM,
            },
        })
        .expect("release edge queues");
    assert_eq!(
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 3,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar: 10.0,
            })
            .expect("newer rate intent is accepted"),
        PossessionIntentReplaceResult::Accepted
    );

    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
        .expect("release tick");
    let body = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .expect("body remains registered");
    let planar_speed = body.retained.velocity.x.hypot(body.retained.velocity.y);
    assert!(
        planar_speed < 8.0,
        "release must use its captured 1x planar speed, not newer 10x intent: {planar_speed}"
    );
    assert!(
        body.retained.velocity.z > 0.0,
        "the queued release must launch upward"
    );
}

#[test]
fn target_jump_presentation_selects_ready_then_falling_on_accepted_edges() {
    let (simulation, runtime, guid) =
        walking_runtime_with_catalog(walking_catalog_with_jump_presentation(true));
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();
    assert_eq!(
        possession.stances[0].jump_presentation,
        crate::explorer_possession_control::PossessionJumpPresentation::ReadyAndFalling
    );
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::BeginJump,
        })
        .unwrap();
    let charged = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .unwrap();
    assert!(charged.ticks.iter().any(|tick| {
        tick.motion
            .and_then(|motion| motion.ordinary)
            .is_some_and(|layer| layer.clip.animation_id() == READY_ANIM)
    }));

    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 1,
            revision: 2,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::ReleaseJump {
                extent: holtburger_core::JumpExtent::MINIMUM,
            },
        })
        .unwrap();
    let launched = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
        .unwrap();
    assert!(launched.ticks.iter().any(|tick| {
        tick.motion
            .and_then(|motion| motion.ordinary)
            .is_some_and(|layer| layer.clip.animation_id() == FALLING_ANIM)
    }));
}

#[test]
fn contact_collection_commits_the_release_edge() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::BeginJump,
        })
        .unwrap();
    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .unwrap();

    let peer_guid = runtime.reserve_guid().unwrap();
    let mut peer = definition(peer_guid, 2, 0.0);
    let EntityPlacement::World(mut initial) = peer.placement else {
        unreachable!()
    };
    initial.pose.coords.z = 4.0;
    peer.placement = EntityPlacement::World(initial);
    let peer = runtime
        .spawn_prepared(
            prepared(peer),
            ExplorerPhysicalMode::Integrated,
            Some(physical_with_ball_target()),
        )
        .unwrap();
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 1,
            revision: 2,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::ReleaseJump {
                extent: holtburger_core::JumpExtent::MAXIMUM,
            },
        })
        .unwrap();

    let limited = runtime
        .tick_physical_collection(1.0, settled_at + Duration::from_secs(1))
        .unwrap();
    assert!(
        limited.ticks.iter().any(|tick| {
            tick.possession_event_outcomes.iter().any(|outcome| {
                matches!(
                    outcome.result,
                    PossessionEventOutcomeKind::JumpReleased { .. }
                )
            })
        }),
        "a dynamic work limit must not roll back the accepted release edge"
    );

    runtime
        .despawn(peer_guid, peer.instance.generation)
        .unwrap();
    let next = runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(1_033))
        .unwrap();
    assert!(next.ticks.iter().all(|tick| {
        tick.possession_event_outcomes.iter().all(|outcome| {
            !matches!(
                outcome.result,
                PossessionEventOutcomeKind::JumpReleased { .. }
            )
        })
    }));
}

#[test]
fn nonphysical_possession_rejects_contiguous_jump_edges_without_wedging() {
    let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
    let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
        simulation,
        0xf000_00d0,
        0xf000_00e0,
        walking_catalog(),
    );
    let guid = runtime.reserve_guid().unwrap();
    let mut target = definition(guid, 1, 0.0);
    target.content.motion_table_did = Some(WALK_TABLE);
    runtime
        .spawn_prepared(prepared(target), ExplorerPhysicalMode::PoseOnly, None)
        .unwrap();
    let possession = runtime.possess(guid).unwrap();

    let queue = |sequence, event| {
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence,
                revision: sequence + 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event,
            })
            .unwrap()
    };
    assert_eq!(
        queue(0, PossessionLifecycleEvent::BeginJump).outcomes[0].result,
        PossessionEventOutcomeKind::Rejected {
            reason: PossessionEventRejection::NonphysicalResponse
        }
    );
    assert_eq!(
        queue(1, PossessionLifecycleEvent::Reset).outcomes[0].result,
        PossessionEventOutcomeKind::Reset
    );
    assert_eq!(
        queue(2, PossessionLifecycleEvent::BeginJump).outcomes[0].sequence,
        2,
        "the reset and rejection both advance the contiguous queue"
    );
}

#[test]
fn standing_charge_suppresses_new_translation_but_moving_charge_keeps_it() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::BeginJump,
        })
        .unwrap();
    runtime
        .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
        .unwrap();
    runtime
        .replace_possession_intent(ExplorerPossessionIntentRequest {
            possession_generation: possession.possession_generation,
            revision: 2,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().forward().build(),
            run_rate_scalar: 1.0,
        })
        .unwrap();
    let before = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;
    for step in 2..=10 {
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap();
    }
    let held = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;
    assert!(
        (held - before).length() < 0.01,
        "standing charge must retain but suppress later translation"
    );

    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 1,
            revision: 3,
            stance: WALK_STYLE,
            drive: CharacterDrive::default(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::Reset,
        })
        .unwrap();
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 2,
            revision: 4,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().forward().build(),
            run_rate_scalar: 1.0,
            event: PossessionLifecycleEvent::BeginJump,
        })
        .unwrap();
    for step in 11..=20 {
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
            .unwrap();
    }
    let moved = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .coords;
    assert!(
        (moved - held).length() > 0.5,
        "a charge begun while moving must retain locomotion"
    );
}

#[test]
fn same_guid_repossession_and_release_form_hard_input_generation_barriers() {
    let (_simulation, runtime, guid) = walking_runtime();
    let first = runtime.possess(guid).expect("first possession");
    let second = runtime.possess(guid).expect("same-guid repossession");
    assert!(second.possession_generation > first.possession_generation);

    let stale_intent = ExplorerPossessionIntentRequest {
        possession_generation: first.possession_generation,
        revision: 1,
        stance: WALK_STYLE,
        drive: CharacterDrive::builder().walk().forward().build(),
        run_rate_scalar: 1.0,
    };
    assert_eq!(
        runtime.replace_possession_intent(stale_intent).unwrap(),
        PossessionIntentReplaceResult::IgnoredStalePossession
    );
    assert_eq!(
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: first.possession_generation,
                sequence: 0,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::Reset,
            })
            .unwrap()
            .result,
        PossessionEventQueueResult::IgnoredStalePossession
    );

    let release = runtime.release_possession(Instant::now()).unwrap();
    assert!(release.possession_generation > second.possession_generation);
    assert_eq!(
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: second.possession_generation,
                ..stale_intent
            })
            .unwrap(),
        PossessionIntentReplaceResult::IgnoredStalePossession
    );
    let third = runtime.possess(guid).expect("possession after release");
    assert!(third.possession_generation > release.possession_generation);
}

#[test]
fn target_despawn_replacement_and_reset_retire_possession_in_the_registry_transaction() {
    let assert_stale = |runtime: &ExplorerEntityRuntime, generation: u64| {
        assert_eq!(
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: generation,
                    revision: 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().forward().build(),
                    run_rate_scalar: 1.0,
                })
                .unwrap(),
            PossessionIntentReplaceResult::IgnoredStalePossession
        );
    };

    let (_simulation, runtime, guid) = walking_runtime();
    let generation = runtime.project(guid).unwrap().generation;
    let possession = runtime.possess(guid).unwrap();
    runtime.despawn(guid, generation).unwrap();
    assert_stale(&runtime, possession.possession_generation);

    let (_simulation, runtime, guid) = walking_runtime();
    let possession = runtime.possess(guid).unwrap();
    let generation = runtime.project(guid).unwrap().generation;
    let mut replacement = definition(guid, 2, 1.0);
    replacement.content.motion_table_did = Some(WALK_TABLE);
    runtime
        .replace_prepared(
            prepared(replacement),
            generation,
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();
    assert_stale(&runtime, possession.possession_generation);

    let (_simulation, runtime, guid) = walking_runtime();
    let possession = runtime.possess(guid).unwrap();
    runtime.reset().unwrap();
    assert_stale(&runtime, possession.possession_generation);
}

#[test]
fn possession_rejects_a_target_without_a_resolved_motion_table() {
    let (_simulation, runtime) = runtime(0xf000_00b0, 0xf000_00c0);
    let guid = runtime.reserve_guid().unwrap();
    runtime
        .spawn_prepared(
            prepared(definition(guid, 1, 0.0)),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();

    assert!(matches!(
        runtime.possess(guid),
        Err(ExplorerEntityRuntimeError::MissingPossessionMotionTable { guid: missing })
            if missing == guid
    ));
}

#[test]
fn possession_rejects_a_target_outside_current_collision_interest() {
    let (simulation, runtime, guid) = walking_runtime();
    let session = simulation.reserve_interest_session();
    simulation
        .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
            session,
            revision: 1,
            landblock_ids: vec!["0xdb55ffff".to_owned()],
        })
        .unwrap();

    assert_eq!(
        runtime.possess(guid),
        Err(
            ExplorerEntityRuntimeError::PossessionTargetMissingCollisionOwner {
                guid,
                owner: Guid(0xda55_ffff),
            }
        )
    );
    assert_eq!(
        runtime
            .release_possession(Instant::now())
            .unwrap()
            .released_guid,
        None,
        "a rejected target must not mutate possession authority"
    );
}

/// A settled body lazily revalidates changed static support without publication-time mutation.
#[test]
fn loaded_collision_eviction_rejects_the_dependent_body_without_global_waking() {
    /// Serves flat ground so the fixture body can prove stable support and settle.
    struct FlatGroundSource;

    impl crate::host_simulation_runtime::CollisionSource for FlatGroundSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: holtburger_content::TerrainCollisionSurface::from_terrain(
                    &holtburger_content::LandblockTerrain {
                        grid_size: 9,
                        tile_size: 24.0,
                        height_indices: vec![0; 81],
                        heights: vec![0.0; 81],
                        terrain_samples: vec![0; 81],
                        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                            landblock_id,
                        ),
                    },
                )?,
                static_geometry: holtburger_content::LandblockColliders::default(),
            }))
        }
    }

    let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGroundSource)));
    let runtime =
        ExplorerEntityRuntime::with_guid_range(Arc::clone(&simulation), 0xf000_0050, 0xf000_0060);
    let session = install_fixture_interest(&simulation);

    let guid = runtime.reserve_guid().unwrap();
    runtime
        .spawn_prepared(
            prepared(definition(guid, 1, 0.0)),
            ExplorerPhysicalMode::Integrated,
            Some(physical()),
        )
        .unwrap();

    // Integrate until the body proves stable support and settles out of the scan.
    let start = Instant::now();
    let mut settled_at = None;
    for step in 0..240 {
        let now = start + std::time::Duration::from_millis(step * 33);
        let tick = simulation
            .tick_dynamic_entity_collection(1.0 / 30.0, now, false, coasting())
            .unwrap();
        if tick.bodies.is_empty() {
            settled_at = Some(now);
            break;
        }
    }
    let settled_at = settled_at.expect("the grounded fixture body must settle");
    assert!(
        simulation
            .tick_dynamic_entity_collection(1.0 / 30.0, settled_at, false, coasting())
            .unwrap()
            .bodies
            .is_empty(),
        "a settled body must stay out of the integration scan"
    );

    let before = runtime.project(guid).unwrap();

    // Replacing interest with a different owner evicts the product that proved support.
    simulation
        .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
            session,
            revision: 2,
            landblock_ids: fixture_landblock_ids()
                .into_iter()
                .filter(|owner| owner != "0xda55ffff")
                .collect(),
        })
        .unwrap();

    let collection = simulation
        .tick_dynamic_entity_collection(1.0 / 30.0, settled_at, false, coasting())
        .unwrap();
    assert!(collection.bodies.is_empty());
    assert_eq!(
        collection
            .coverage_rejections
            .iter()
            .map(|rejection| (rejection.body.id, rejection.owner))
            .collect::<Vec<_>>(),
        [(SpatialBodyId::Entity(guid), Guid(0xda55_ffff))]
    );
    assert_eq!(runtime.project(guid).unwrap(), before);
}

#[test]
fn host_boom_follows_exact_possession_without_registering_a_camera_body() {
    use crate::host_kinematic_boom_runtime::{
        HostKinematicBoomCollisionProof, HostKinematicBoomFailureReason,
        HostKinematicBoomIntentRequest, HostKinematicBoomRuntime, HostKinematicBoomStartRequest,
        HostKinematicBoomTargetSphereRole, HostKinematicBoomTick, HostKinematicBoomUpdateReceipt,
    };

    let upper = Sphere {
        center: Vector3::new(0.0, 0.0, 1.2),
        radius: 0.20,
    };
    let (simulation, entities, guid) =
        walking_runtime_with_body(walking_catalog(), physical_with_upper(Some(upper)));
    let entities = Arc::new(entities);
    let possession = entities.possess(guid).unwrap();
    let boom =
        HostKinematicBoomRuntime::new(Arc::clone(&entities), Arc::clone(&simulation)).unwrap();
    let body_count = simulation.registered_body_count();
    assert_eq!(body_count, 1, "the fixture owns only its possessed body");

    let receipt = boom
        .start(HostKinematicBoomStartRequest {
            possession_generation: possession.possession_generation,
            guid,
            entity_generation: possession.entity_generation,
            initial_reach: 4.0,
            minimum_reach: 1.2,
            maximum_reach: 4.25,
            input_sequence: 1,
            view_direction: [0.0, -1.0, 0.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.25,
        })
        .unwrap();
    assert_eq!(simulation.registered_body_count(), body_count);
    assert_eq!(
        boom.set_intent(HostKinematicBoomIntentRequest {
            identity: receipt.identity,
            input_sequence: 1,
            view_direction: [1.0, 0.0, 0.0],
            cumulative_zoom_displacement: 1.0,
        })
        .unwrap(),
        HostKinematicBoomUpdateReceipt::IgnoredStale
    );
    assert_eq!(
        boom.set_intent(HostKinematicBoomIntentRequest {
            identity: receipt.identity,
            input_sequence: 2,
            view_direction: [1.0, 0.0, 0.0],
            cumulative_zoom_displacement: 1.0,
        })
        .unwrap(),
        HostKinematicBoomUpdateReceipt::Accepted
    );

    let started_at = Instant::now();
    // Registration's proved seed is sufficient before the next entity tick arrives.
    let initial_tick = boom.advance(1.0 / 30.0).unwrap();
    assert!(matches!(
        initial_tick,
        HostKinematicBoomTick::Reseeded {
            reason:
                crate::host_kinematic_boom_runtime::HostKinematicBoomReseedReason::InitialPlacement,
            ..
        }
    ));
    let collection = entities
        .tick_physical_collection(1.0 / 30.0, started_at)
        .unwrap();
    boom.publish_target(&collection);
    // A pending entity transaction cannot block advancement against already published input.
    let tick = {
        let _entity_transaction = entities.registry.lock().unwrap();
        boom.advance(1.0 / 30.0).unwrap()
    };
    let HostKinematicBoomTick::Advanced {
        identity,
        sequence,
        target_sphere_role,
        clearance,
        desired_reach,
        path,
        ..
    } = tick
    else {
        panic!("an empty flat scene must accept the first boom path")
    };
    assert_eq!(identity, receipt.identity);
    assert_eq!(sequence, 2);
    assert_eq!(
        target_sphere_role,
        HostKinematicBoomTargetSphereRole::UpperConstraint
    );
    assert_eq!(clearance.radius, 0.25);
    assert_eq!(desired_reach, 4.25);
    assert_eq!(path.legs.last().unwrap().end_fraction, 1.0);
    assert!(path.initial.visual_pivot.coords.z.is_finite());
    assert_eq!(simulation.registered_body_count(), body_count);
    let continued = boom.advance(1.0 / 60.0).unwrap();
    assert!(matches!(
        continued,
        HostKinematicBoomTick::Advanced { sequence: 3, .. }
    ));

    let target_tick = collection
        .ticks
        .iter()
        .find(|tick| tick.solved.current.id == SpatialBodyId::Entity(guid))
        .unwrap();
    let unavailable_owner = Guid(0xda55_ffff);
    let rejected_target = ExplorerEntityCollectionTick {
        entity_collision: collection.entity_collision.clone(),
        ticks: Vec::new(),
        coverage_rejections: vec![
            crate::host_simulation_runtime::HostPhysicalBodyCoverageRejection {
                body: target_tick.solved.current.clone(),
                owner: unavailable_owner,
                collision: Arc::clone(&target_tick.solved.collision),
            },
        ],
        possession: Some(ExplorerPossessedBodyEpoch {
            guid,
            entity_generation: possession.entity_generation,
            possession_generation: possession.possession_generation,
        }),
    };
    boom.publish_target(&rejected_target);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Advanced {
            identity,
            sequence: 4,
            diagnostics,
            ..
        }) if identity == receipt.identity
            && diagnostics.collision_proof
                == HostKinematicBoomCollisionProof::Uncovered {
                    owner: unavailable_owner,
                }
    ));

    let missing_target = ExplorerEntityCollectionTick {
        entity_collision: collection.entity_collision.clone(),
        ticks: Vec::new(),
        coverage_rejections: Vec::new(),
        possession: Some(ExplorerPossessedBodyEpoch {
            guid,
            entity_generation: possession.entity_generation,
            possession_generation: possession.possession_generation,
        }),
    };
    boom.publish_target(&missing_target);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Held {
            identity,
            sequence: 5,
            reason: HostKinematicBoomFailureReason::TargetContract,
            ..
        }) if identity == receipt.identity
    ));

    assert_eq!(
        boom.set_intent(HostKinematicBoomIntentRequest {
            identity: receipt.identity,
            input_sequence: 3,
            view_direction: [0.0, 1.0, 0.0],
            cumulative_zoom_displacement: 1.0,
        })
        .unwrap(),
        HostKinematicBoomUpdateReceipt::Accepted
    );
    boom.publish_target(&collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Advanced {
            identity,
            sequence: 6,
            ..
        }) if identity == receipt.identity
    ));

    // Query preparation failure holds the camera without invalidating accepted target motion.
    let mut collection = collection;
    let prepared_entities = collection.entity_collision.take();
    collection.entity_collision = Some(Err("injected collision preparation failure".into()));
    boom.publish_target(&collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Held {
            reason: HostKinematicBoomFailureReason::TargetContract,
            ..
        })
    ));
    collection.entity_collision = prepared_entities;
    boom.publish_target(&collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Advanced { .. })
    ));

    let replacement_possession = entities.possess(guid).unwrap();
    let replacement = boom
        .start(HostKinematicBoomStartRequest {
            possession_generation: replacement_possession.possession_generation,
            guid,
            entity_generation: replacement_possession.entity_generation,
            initial_reach: 4.0,
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            input_sequence: 1,
            view_direction: [0.0, -1.0, 0.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.25,
        })
        .unwrap();
    assert!(replacement.identity.boom_generation > receipt.identity.boom_generation);
    assert!(
        !boom.stop(receipt.identity),
        "a stale stop must preserve the replacement"
    );
    let replacement_missing_target = ExplorerEntityCollectionTick {
        entity_collision: collection.entity_collision.clone(),
        ticks: Vec::new(),
        coverage_rejections: Vec::new(),
        possession: Some(ExplorerPossessedBodyEpoch {
            guid,
            entity_generation: replacement_possession.entity_generation,
            possession_generation: replacement_possession.possession_generation,
        }),
    };
    boom.publish_target(&replacement_missing_target);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Fallback {
            identity,
            sequence: 1,
            reason: HostKinematicBoomFailureReason::TargetContract,
            ..
        }) if identity == replacement.identity
    ));
    let replacement_collection = entities
        .tick_physical_collection(
            1.0 / 30.0,
            started_at + std::time::Duration::from_millis(33),
        )
        .unwrap();
    boom.publish_target(&replacement_collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Reseeded {
            identity,
            sequence: 2,
            ..
        })
            if identity == replacement.identity
    ));

    entities
        .release_possession(started_at + std::time::Duration::from_millis(34))
        .unwrap();
    let released_collection = entities
        .tick_physical_collection(
            1.0 / 30.0,
            started_at + std::time::Duration::from_millis(66),
        )
        .unwrap();
    boom.publish_target(&released_collection);
    assert!(boom.advance(1.0 / 30.0).is_none());
    boom.publish_target(&released_collection);
    assert!(boom.advance(1.0 / 30.0).is_none());
    assert_eq!(simulation.registered_body_count(), body_count);
}

#[test]
fn fixed_tick_publishes_entity_and_boom_together_and_retires_on_release() {
    use crate::explorer_entity_delivery::{ExplorerEntityDelivery, ExplorerFixedTickEnvelope};
    use crate::explorer_entity_simulation::{DynamicEntityEventSink, ExplorerEntitySimulation};
    use crate::host_fixed_tick_runtime::HostFixedTickParticipant;
    use crate::host_kinematic_boom_runtime::{
        HostKinematicBoomIntentRequest, HostKinematicBoomRuntime, HostKinematicBoomStartRequest,
        HostKinematicBoomUpdateReceipt,
    };

    struct RecordingSink(Mutex<Vec<ExplorerFixedTickEnvelope>>);
    impl DynamicEntityEventSink for RecordingSink {
        fn publish(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()> {
            self.0.lock().unwrap().push(envelope);
            Ok(())
        }
        fn publish_possession_outcomes(
            &self,
            _: Vec<PossessionEventOutcome>,
        ) -> anyhow::Result<()> {
            Ok(())
        }
    }

    let (simulation, entities, guid) = walking_runtime();
    settle(&simulation, Instant::now());
    let entities = Arc::new(entities);
    let possession = entities.possess(guid).unwrap();
    let camera =
        Arc::new(HostKinematicBoomRuntime::new(Arc::clone(&entities), simulation).unwrap());
    let receipt = camera
        .start(HostKinematicBoomStartRequest {
            possession_generation: possession.possession_generation,
            guid,
            entity_generation: possession.entity_generation,
            initial_reach: 4.0,
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            input_sequence: 1,
            view_direction: [0.0, -1.0, 0.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.25,
        })
        .unwrap();
    let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
    let sink = Arc::new(RecordingSink(Mutex::new(Vec::new())));
    let simulation_participant = ExplorerEntitySimulation::new(
        Arc::clone(&entities),
        delivery,
        Arc::clone(&camera),
        Arc::clone(&sink) as Arc<dyn DynamicEntityEventSink>,
    );
    let tick = Duration::from_secs_f64(1.0 / crate::host_fixed_tick_runtime::HOST_FIXED_TICK_HZ);

    simulation_participant.fixed_tick(tick).unwrap();
    simulation_participant.fixed_tick(tick).unwrap();
    {
        let published = sink.0.lock().unwrap();
        assert_eq!(published.len(), 2);
        assert!(published[0].boom.is_some() && published[1].boom.is_some());
        assert_eq!(published[0].entity_advances.len(), 1);
        assert_eq!(published[1].entity_advances.len(), 1);
        assert!(published[1].epoch > published[0].epoch);
        assert!((published[0].duration_ms - 1000.0 / 30.0).abs() < 1e-6);
    }

    entities.release_possession(Instant::now()).unwrap();
    sink.0.lock().unwrap().clear();
    simulation_participant.fixed_tick(tick).unwrap();
    {
        let published = sink.0.lock().unwrap();
        assert!(published.iter().all(|envelope| envelope.boom.is_none()));
    }
    assert_eq!(
        camera
            .set_intent(HostKinematicBoomIntentRequest {
                identity: receipt.identity,
                input_sequence: 2,
                view_direction: [1.0, 0.0, 0.0],
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap(),
        HostKinematicBoomUpdateReceipt::IgnoredStale
    );
    camera.shutdown();
    assert!(camera.advance(1.0 / 30.0).is_none());
}

#[test]
fn host_boom_rejects_a_possessed_target_after_collision_interest_moves() {
    use crate::host_kinematic_boom_runtime::{
        HostKinematicBoomRuntime, HostKinematicBoomStartRequest,
    };

    let (simulation, entities, guid) = walking_runtime();
    let entities = Arc::new(entities);
    let possession = entities.possess(guid).unwrap();
    let session = simulation.reserve_interest_session();
    simulation
        .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
            session,
            revision: 1,
            landblock_ids: vec!["0xdb55ffff".to_owned()],
        })
        .unwrap();
    let boom =
        HostKinematicBoomRuntime::new(Arc::clone(&entities), Arc::clone(&simulation)).unwrap();

    let error = boom
        .start(HostKinematicBoomStartRequest {
            possession_generation: possession.possession_generation,
            guid,
            entity_generation: possession.entity_generation,
            initial_reach: 4.0,
            minimum_reach: 1.2,
            maximum_reach: 4.25,
            input_sequence: 1,
            view_direction: [0.0, -1.0, 0.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.25,
        })
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "kinematic boom target is outside current simulation interest"
    );
}

#[test]
fn host_boom_retains_session_while_control_work_is_limited() {
    use crate::host_kinematic_boom_runtime::{
        HostKinematicBoomDiagnostics, HostKinematicBoomIntentRequest, HostKinematicBoomRuntime,
        HostKinematicBoomStartRequest, HostKinematicBoomTick, HostKinematicBoomUpdateReceipt,
    };
    use holtburger_core::{KinematicBoomProfile, KinematicBoomProfileDefinition};

    let (simulation, entities, guid) = walking_runtime();
    let entities = Arc::new(entities);
    let possession = entities.possess(guid).unwrap();
    let profile = KinematicBoomProfile::new(KinematicBoomProfileDefinition {
        minimum_reach: 1.2,
        maximum_reach: 8.0,
        vertical_pivot_half_life: 0.08,
        maximum_vertical_pivot_lag: 0.30,
        clearance_recovery_half_life: 0.10,
        clearance_hysteresis: 0.05,
        maximum_control_leg_displacement: 0.01,
        maximum_control_legs: 1,
        surface_clearance: 0.000_5,
        settled_position_tolerance: 0.001,
        settled_pivot_tolerance: 0.001,
        placement: holtburger_world::FreeSphereSettleConfig {
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        },
    })
    .unwrap();
    let boom = HostKinematicBoomRuntime::with_profile(
        Arc::clone(&entities),
        Arc::clone(&simulation),
        profile,
    );
    let receipt = boom
        .start(HostKinematicBoomStartRequest {
            possession_generation: possession.possession_generation,
            guid,
            entity_generation: possession.entity_generation,
            initial_reach: 4.0,
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            input_sequence: 1,
            view_direction: [0.0, -1.0, 0.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.25,
        })
        .unwrap();
    assert_eq!(
        boom.set_intent(HostKinematicBoomIntentRequest {
            identity: receipt.identity,
            input_sequence: 2,
            view_direction: [0.0, 1.0, 0.0],
            cumulative_zoom_displacement: 0.0,
        })
        .unwrap(),
        HostKinematicBoomUpdateReceipt::Accepted
    );
    let collection = entities
        .tick_physical_collection(1.0 / 30.0, Instant::now())
        .unwrap();
    boom.publish_target(&collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Reseeded {
            identity,
            sequence: 1,
            ..
        }) if identity == receipt.identity
    ));
    boom.publish_target(&collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Advanced {
            identity,
            sequence: 2,
            diagnostics: HostKinematicBoomDiagnostics { control_legs: 1, .. },
            ..
        }) if identity == receipt.identity
    ));
    boom.publish_target(&collection);
    assert!(matches!(
        boom.advance(1.0 / 30.0),
        Some(HostKinematicBoomTick::Advanced {
            identity,
            sequence: 3,
            ..
        }) if identity == receipt.identity
    ));
    assert_eq!(simulation.registered_body_count(), 1);
}

#[test]
fn possession_manual_yaw_accumulates_rotates_once_and_rejects_stale_or_non_finite() {
    let (simulation, runtime, guid) = walking_runtime();
    let settled_at = settle(&simulation, Instant::now());
    let possession = runtime.possess(guid).unwrap();

    // Stale generation is ignored without error.
    assert_eq!(
        runtime
            .apply_possession_yaw(possession.possession_generation + 99, 0.5)
            .unwrap(),
        PossessionIntentReplaceResult::IgnoredStalePossession
    );
    // Non-finite yaw is rejected loudly.
    assert!(
        runtime
            .apply_possession_yaw(possession.possession_generation, f32::NAN)
            .is_err()
    );
    assert!(
        runtime
            .apply_possession_yaw(possession.possession_generation, f32::INFINITY)
            .is_err()
    );

    let initial_heading = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();

    // Two samples accumulate before the next fixed tick (total +PI/2 = +90 deg clockwise).
    assert_eq!(
        runtime
            .apply_possession_yaw(
                possession.possession_generation,
                std::f32::consts::FRAC_PI_4
            )
            .unwrap(),
        PossessionIntentReplaceResult::Accepted
    );
    assert_eq!(
        runtime
            .apply_possession_yaw(
                possession.possession_generation,
                std::f32::consts::FRAC_PI_4
            )
            .unwrap(),
        PossessionIntentReplaceResult::Accepted
    );

    let tick1 = settled_at + Duration::from_millis(34);
    runtime.tick_physical_collection(1.0 / 30.0, tick1).unwrap();
    let heading_after_tick1 = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();
    let expected_heading =
        (initial_heading + std::f32::consts::FRAC_PI_2).rem_euclid(std::f32::consts::TAU);
    assert!(
        (heading_after_tick1 - expected_heading).abs() < 0.01,
        "expected heading ~{expected_heading}, got {heading_after_tick1}"
    );

    // Subsequent tick with no new yaw samples does not replay the previous delta.
    let tick2 = tick1 + Duration::from_millis(34);
    runtime.tick_physical_collection(1.0 / 30.0, tick2).unwrap();
    let heading_after_tick2 = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();
    assert!(
        (heading_after_tick2 - heading_after_tick1).abs() < 0.01,
        "manual yaw must be consumed once per tick: {heading_after_tick1} vs {heading_after_tick2}"
    );

    // Large finite deltas wrap before accumulation so they cannot overflow to NaN.
    assert_eq!(
        runtime
            .apply_possession_yaw(possession.possession_generation, f32::MAX)
            .unwrap(),
        PossessionIntentReplaceResult::Accepted
    );
    assert_eq!(
        runtime
            .apply_possession_yaw(possession.possession_generation, f32::MAX)
            .unwrap(),
        PossessionIntentReplaceResult::Accepted
    );
    let tick3 = tick2 + Duration::from_millis(34);
    runtime.tick_physical_collection(1.0 / 30.0, tick3).unwrap();
    let heading_after_tick3 = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();
    assert!(heading_after_tick3.is_finite());

    // Motion Reset clears queued manual yaw so it does not apply on that tick.
    assert_eq!(
        runtime
            .apply_possession_yaw(
                possession.possession_generation,
                std::f32::consts::FRAC_PI_2
            )
            .unwrap(),
        PossessionIntentReplaceResult::Accepted
    );
    runtime
        .queue_possession_event(ExplorerPossessionEventRequest {
            possession_generation: possession.possession_generation,
            sequence: 0,
            revision: 1,
            stance: possession.accepted_stance,
            run_rate_scalar: possession.run_rate_capability.initial,
            drive: CharacterDrive::default(),
            event: crate::explorer_possession_control::PossessionLifecycleEvent::Reset,
        })
        .unwrap();
    let tick4 = tick3 + Duration::from_millis(34);
    runtime.tick_physical_collection(1.0 / 30.0, tick4).unwrap();
    let heading_after_reset = simulation
        .physical_body_snapshot(SpatialBodyId::Entity(guid))
        .unwrap()
        .pose
        .rotation
        .to_heading();
    assert!(
        (heading_after_reset - heading_after_tick3).abs() < 0.01,
        "Reset must clear pending manual yaw: {heading_after_tick3} vs {heading_after_reset}"
    );
}

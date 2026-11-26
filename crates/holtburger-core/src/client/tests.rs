use super::*;
use crate::{
    CLIENT_COLLISION_OWNER_RADIUS, CharacterMotionEvent, CharacterMotionSequence,
    DynamicEntityHostTime, JumpExtent, SequencedCharacterMotionEvent, SimulationSceneInterest,
    SimulationSceneOwnerAvailability, SimulationSceneSnapshot,
};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    ItemType, PhysicsState, PropertyDataId, PropertyInt, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{
    ColliderScale, LandblockColliders, LandblockCollisionAsset, LandblockTerrain,
    MotionSequenceCatalog, TerrainCellDiagonals, TerrainCollisionSurface,
};
use holtburger_dat::file_type::animation::AnimationFlags;
use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
use holtburger_dat::file_type::setup_model::AnimationFrame;
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::graphics::Frame;
use holtburger_protocol::messages::movement::{
    InterpretedMotionCommand, InterpretedMotionState, MotionStance, MovementEventData,
    MovementInvalid, MovementStateFlags, MovementType, MovementTypeData, PositionPack,
    TurnToObject, TurnToParameters, UpdatePositionData, UpdatePositionFlag,
};
use holtburger_protocol::messages::{CharacterEntry, GameMessage, VectorUpdateData};
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_world::FellowshipActivity;
use holtburger_world::entity::{
    Entity, EntityMotionSnapshot, EntityNetworkMotion, OrderedMotionScalar,
};
use holtburger_world::motion::PLAYER_LOCOMOTION_BASELINE_TABLE;
use holtburger_world::state::motion_resolution::test_support::FIXTURE_STAND_COMMAND;
use holtburger_world::stats::{
    Attribute, AttributeType, Skill, SkillType, TrainingLevel, Vital, VitalType,
};
use holtburger_world::{
    CollisionScene, DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, EdgeProtection, EntityCollisionParticipation,
    EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, GroundedConfig,
    LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalBodyDefinition,
    PhysicalBodyResponsePolicy, PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PlayerMotionTableSource,
    PreparedEntityTargetGeometry, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z,
    RETAIL_WALKABLE_NORMAL_Z, SelfMovementCapabilities, SelfMovementKinematics,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

const JUMP_FIXTURE_RELEASE_COMMAND: u32 = 0x4000_002b;
const JUMP_FIXTURE_STAND_ANIMATION: u32 = 0x0300_1001;
const JUMP_FIXTURE_RUN_ANIMATION: u32 = 0x0300_1002;
const JUMP_FIXTURE_TAKEOFF_ANIMATION: u32 = 0x0300_1004;
const JUMP_FIXTURE_FALLING_ANIMATION: u32 = 0x0300_1005;
const JUMP_FIXTURE_LANDING_ANIMATION: u32 = 0x0300_1006;
const JUMP_FIXTURE_ACTION_ANIMATION: u32 = 0x0300_1007;
const STOP_FIXTURE_ANIMATION: u32 = 0x0300_1008;
const JUMP_FIXTURE_ACTION_COMMAND: u32 = 0x1000_004A;
const CAST_TURN_TARGET: Guid = Guid(0x0500_0042);

fn pose_at(landblock_id: u32, x: f32, y: f32, z: f32) -> WorldPosition {
    WorldPosition {
        landblock_id: Guid(landblock_id),
        coords: Vector3::new(x, y, z),
        rotation: Quaternion::identity(),
    }
}

fn outdoor_pose(x: f32, y: f32, z: f32) -> WorldPosition {
    pose_at(0x1000_0001, x, y, z)
}

fn physics_dt() -> Duration {
    Duration::from_millis(PHYSICS_TICK_MS)
}

fn ordinary_anim_id(world: &WorldState, guid: Guid) -> Option<u32> {
    world
        .motion_runtimes
        .motion_playback(guid)
        .and_then(|motion| motion.ordinary)
        .map(|layer| layer.clip.animation_id())
}

fn locomotion_anim_id(world: &WorldState, guid: Guid) -> Option<u32> {
    world
        .motion_runtimes
        .motion_playback(guid)
        .and_then(|motion| motion.locomotion)
        .map(|layer| layer.clip.animation_id())
}

/// Routes a constructed message through the same pack/unpack boundary as a wire datagram.
fn encoded_game_message(message: GameMessage) -> GameMessage {
    let mut bytes = Vec::new();
    message.pack(&mut bytes);
    let mut offset = 0;
    let decoded =
        GameMessage::unpack(&bytes, &mut offset).expect("encoded movement fixture should decode");
    assert_eq!(offset, bytes.len());
    decoded
}

fn update_motion_packet(
    guid: Guid,
    movement_sequence: u16,
    server_control_sequence: u16,
    is_autonomous: bool,
    forward_command: Option<InterpretedMotionCommand>,
    forward_speed: Option<f32>,
    sticky_object: Option<Guid>,
) -> GameMessage {
    let mut flags = MovementStateFlags::CURRENT_STYLE;
    flags.set(
        MovementStateFlags::FORWARD_COMMAND,
        forward_command.is_some(),
    );
    flags.set(MovementStateFlags::FORWARD_SPEED, forward_speed.is_some());
    encoded_game_message(GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 0,
        movement_sequence,
        server_control_sequence,
        is_autonomous,
        movement_type: MovementType::Invalid,
        motion_flags: u8::from(sticky_object.is_some()),
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::Invalid(MovementInvalid {
            state: InterpretedMotionState {
                flags,
                current_style: Some(MotionStance::NonCombat.interpreted()),
                forward_command,
                forward_speed,
                ..Default::default()
            },
            sticky_object,
        }),
    })))
}

fn idle_motion_packet(guid: Guid, movement_sequence: u16, is_autonomous: bool) -> GameMessage {
    encoded_game_message(GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 0,
        movement_sequence,
        server_control_sequence: 0,
        is_autonomous,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: 0,
        data: MovementTypeData::Invalid(MovementInvalid::default()),
    })))
}

fn vector_update_packet(
    guid: Guid,
    velocity: Vector3,
    vector_sequence: u16,
    instance_sequence: u16,
) -> GameMessage {
    encoded_game_message(GameMessage::VectorUpdate(Box::new(VectorUpdateData {
        guid,
        velocity,
        omega: Vector3::zero(),
        instance_sequence,
        vector_sequence,
    })))
}

fn step_ticks(
    client: &mut ClientRuntime,
    now: &mut Instant,
    dt: Duration,
    collision: &SimulationSceneSnapshot,
    ticks: usize,
) {
    for _ in 0..ticks {
        simulation::tick(
            *now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(collision),
        )
        .unwrap();
        *now += dt;
    }
}

fn step_until_grounded(
    client: &mut ClientRuntime,
    body_id: SpatialBodyId,
    now: &mut Instant,
    dt: Duration,
    collision: &SimulationSceneSnapshot,
    max_ticks: usize,
) {
    for _ in 0..max_ticks {
        simulation::tick(
            *now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(collision),
        )
        .unwrap();
        *now += dt;
        if client.world.scene.body(body_id).unwrap().contact
            == holtburger_world::ContactState::Grounded
        {
            break;
        }
    }
    assert_eq!(
        client.world.scene.body(body_id).unwrap().contact,
        holtburger_world::ContactState::Grounded
    );
}

fn grounded_player_client(
    guid: Guid,
    name: &str,
    pose: WorldPosition,
    catalog: MotionSequenceCatalog,
    motion_table_id: u32,
) -> (ClientRuntime, SimulationSceneSnapshot, Instant) {
    let mut client = builder::build_test_client(ClientState::InWorld);
    client.world.seed_local_player_entity(guid, name, pose);
    client.world.set_motion_sequences(catalog);
    client
        .world
        .player_entity_mut()
        .unwrap()
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    seed_test_self_movement_capabilities(&mut client);
    seed_test_jump_authority(&mut client);
    let body_id = SpatialBodyId::LocalPlayer(guid);
    client
        .world
        .scene
        .set_dynamic_physical_body(
            body_id,
            Some(stable_dynamic_body_definition()),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let interest =
        SimulationSceneInterest::prefetch_neighborhood(pose, CLIENT_COLLISION_OWNER_RADIUS)
            .unwrap();
    let collision = collision_snapshot(
        interest.clone(),
        flat_collision_scene_for_interest(&interest),
    );
    let dt = physics_dt();
    let mut now = Instant::now();
    let ticks = Duration::from_secs(1).as_nanos().div_ceil(dt.as_nanos()) as usize;
    step_ticks(&mut client, &mut now, dt, &collision, ticks);
    assert_eq!(
        client.world.scene.body(body_id).unwrap().contact,
        holtburger_world::ContactState::Grounded
    );
    (client, collision, now)
}

fn remote_gravity_creature(guid: Guid, pose: WorldPosition, motion_table_id: u32) -> Entity {
    let mut remote = Entity::new(guid, "Remote".to_owned(), pose);
    remote.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    remote
        .physics
        .reconcile(holtburger_world::resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY,
        ));
    remote
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    remote.acceleration = Vector3::new(0.0, 0.0, -9.8);
    remote
}

/// A real motion-table fixture for jump presentation tests.
///
/// Explicit motion vectors keep physical expectations readable while actual animation records
/// and authored links make clip identity independently observable. Production still selects
/// content IDs from the actor's table; none of these fixture IDs cross the test boundary.
fn jump_presentation_motion_catalog(motion_table_id: u32) -> MotionSequenceCatalog {
    jump_presentation_motion_catalog_with_falling(motion_table_id, true)
}

fn jump_presentation_motion_catalog_with_falling(
    motion_table_id: u32,
    include_falling: bool,
) -> MotionSequenceCatalog {
    let style = MotionStance::NonCombat as u32;
    let cycle = |animation_id: u32, velocity: Option<Vector3>, omega: Option<Vector3>| {
        let mut flags = MotionDataFlags::empty();
        flags.set(MotionDataFlags::HAS_VELOCITY, velocity.is_some());
        flags.set(MotionDataFlags::HAS_OMEGA, omega.is_some());
        MotionData {
            bitfield: 0,
            flags,
            anims: vec![AnimData {
                anim_id: animation_id,
                low_frame: 0,
                high_frame: -1,
                framerate: 10.0,
            }],
            velocity,
            omega,
        }
    };
    let link = |animation_id, framerate| MotionData {
        bitfield: 0,
        flags: MotionDataFlags::empty(),
        anims: vec![AnimData {
            anim_id: animation_id,
            low_frame: 0,
            high_frame: -1,
            framerate,
        }],
        velocity: None,
        omega: None,
    };
    let cycles = HashMap::from([
        (
            MotionTable::cycle_key(style, JUMP_FIXTURE_RELEASE_COMMAND),
            cycle(JUMP_FIXTURE_STAND_ANIMATION, None, None),
        ),
        (
            MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND),
            cycle(JUMP_FIXTURE_STAND_ANIMATION, None, None),
        ),
        (
            MotionTable::cycle_key(style, MotionTable::WALK_FORWARD_COMMAND),
            cycle(
                JUMP_FIXTURE_RUN_ANIMATION,
                Some(Vector3::new(1.0, 0.0, 0.0)),
                None,
            ),
        ),
        (
            MotionTable::cycle_key(style, MotionTable::RUN_FORWARD_COMMAND),
            cycle(
                JUMP_FIXTURE_RUN_ANIMATION,
                Some(Vector3::new(2.5, 0.0, 0.0)),
                None,
            ),
        ),
        (
            MotionTable::cycle_key(style, MotionTable::TURN_LEFT_COMMAND),
            cycle(
                JUMP_FIXTURE_STAND_ANIMATION,
                None,
                Some(Vector3::new(0.0, 0.0, -1.0)),
            ),
        ),
        (
            MotionTable::cycle_key(style, MotionTable::TURN_RIGHT_COMMAND),
            cycle(
                JUMP_FIXTURE_STAND_ANIMATION,
                None,
                Some(Vector3::new(0.0, 0.0, 1.0)),
            ),
        ),
        (
            MotionTable::cycle_key(
                style,
                holtburger_world::motion::MotionCommand::FALLING.raw(),
            ),
            cycle(JUMP_FIXTURE_FALLING_ANIMATION, None, None),
        ),
    ]);
    let takeoff_targets = HashMap::from([(
        holtburger_world::motion::MotionCommand::FALLING.raw(),
        link(JUMP_FIXTURE_TAKEOFF_ANIMATION, 20.0),
    )]);
    let landing_targets = HashMap::from([
        (
            FIXTURE_STAND_COMMAND,
            link(JUMP_FIXTURE_LANDING_ANIMATION, 200.0),
        ),
        (
            MotionTable::RUN_FORWARD_COMMAND,
            link(JUMP_FIXTURE_LANDING_ANIMATION, 200.0),
        ),
    ]);
    let links = HashMap::from([
        (
            MotionTable::cycle_key(style, holtburger_world::motion::MotionCommand::READY.raw()),
            takeoff_targets.clone(),
        ),
        (
            MotionTable::cycle_key(style, MotionTable::RUN_FORWARD_COMMAND),
            takeoff_targets,
        ),
        (
            MotionTable::cycle_key(
                style,
                holtburger_world::motion::MotionCommand::FALLING.raw(),
            ),
            landing_targets,
        ),
    ]);
    let mut table = MotionTable {
        id: motion_table_id,
        default_style: style,
        style_defaults: HashMap::from([(style, FIXTURE_STAND_COMMAND)]),
        cycles,
        modifiers: HashMap::new(),
        links,
    };
    if !include_falling {
        table.cycles.remove(&MotionTable::cycle_key(
            style,
            holtburger_world::motion::MotionCommand::FALLING.raw(),
        ));
    }
    let animation = |id| Animation {
        id,
        flags: AnimationFlags::empty(),
        num_parts: 0,
        num_frames: 4,
        pos_frames: Vec::new(),
        part_frames: (0..4)
            .map(|_| AnimationFrame {
                frames: Vec::new(),
                hooks: Vec::new(),
            })
            .collect(),
    };
    MotionSequenceCatalog::assemble(
        [table],
        [
            animation(JUMP_FIXTURE_STAND_ANIMATION),
            animation(JUMP_FIXTURE_RUN_ANIMATION),
            animation(JUMP_FIXTURE_TAKEOFF_ANIMATION),
            animation(JUMP_FIXTURE_FALLING_ANIMATION),
            animation(JUMP_FIXTURE_LANDING_ANIMATION),
        ],
        [],
    )
    .expect("jump presentation fixture should assemble")
}

/// Authored action and locomotion fixture with measurable root tracks at clip boundaries.
fn local_authored_motion_catalog(motion_table_id: u32) -> MotionSequenceCatalog {
    local_authored_motion_catalog_with_idle_body(motion_table_id, None)
}

fn local_authored_motion_catalog_with_idle_body(
    motion_table_id: u32,
    idle_body_table: Option<u32>,
) -> MotionSequenceCatalog {
    let style = MotionStance::NonCombat as u32;
    let clip = |animation_id| MotionData {
        bitfield: 0,
        flags: MotionDataFlags::empty(),
        anims: vec![AnimData {
            anim_id: animation_id,
            low_frame: 0,
            high_frame: -1,
            framerate: 10.0,
        }],
        velocity: None,
        omega: None,
    };
    let animation = |id, step| Animation {
        id,
        flags: AnimationFlags::POS_FRAMES,
        num_parts: 0,
        num_frames: 4,
        pos_frames: (0..4)
            .map(|_| Frame {
                origin: step,
                orientation: Quaternion::identity(),
            })
            .collect(),
        part_frames: (0..4)
            .map(|_| AnimationFrame {
                frames: Vec::new(),
                hooks: Vec::new(),
            })
            .collect(),
    };
    let table = MotionTable {
        id: motion_table_id,
        default_style: style,
        style_defaults: HashMap::from([(style, FIXTURE_STAND_COMMAND)]),
        cycles: HashMap::from([
            (
                MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND),
                clip(JUMP_FIXTURE_STAND_ANIMATION),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::RUN_FORWARD_COMMAND),
                clip(JUMP_FIXTURE_RUN_ANIMATION),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::WALK_FORWARD_COMMAND),
                clip(JUMP_FIXTURE_RUN_ANIMATION),
            ),
        ]),
        modifiers: HashMap::new(),
        links: HashMap::from([
            (
                MotionTable::cycle_key(style, MotionTable::RUN_FORWARD_COMMAND),
                HashMap::from([(FIXTURE_STAND_COMMAND, clip(STOP_FIXTURE_ANIMATION))]),
            ),
            (
                MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND),
                HashMap::from([
                    (
                        JUMP_FIXTURE_ACTION_COMMAND,
                        clip(JUMP_FIXTURE_ACTION_ANIMATION),
                    ),
                    (0x1000_0070, clip(JUMP_FIXTURE_ACTION_ANIMATION)),
                ]),
            ),
        ]),
    };
    let mut tables = Vec::new();
    if let Some(id) = idle_body_table {
        let mut native = table.clone();
        native.id = id;
        native
            .cycles
            .retain(|key, _| *key == MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND));
        tables.push(native);
    }
    tables.push(table);
    MotionSequenceCatalog::assemble(
        tables,
        [
            animation(JUMP_FIXTURE_STAND_ANIMATION, Vector3::zero()),
            animation(JUMP_FIXTURE_RUN_ANIMATION, Vector3::new(0.0, 0.1, 0.0)),
            animation(STOP_FIXTURE_ANIMATION, Vector3::new(0.0, 0.02, 0.0)),
            animation(JUMP_FIXTURE_ACTION_ANIMATION, Vector3::new(0.0, 0.25, 0.0)),
        ],
        [],
    )
    .expect("local authored motion fixture should assemble")
}

/// Stationary, projectable actor with executable transient-action content.
fn motion_publication_client() -> (ClientRuntime, Guid) {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let guid = Guid(0x7000_0042);
    let table_id = 0x0900_0042;
    client
        .world
        .set_motion_sequences(local_authored_motion_catalog(table_id));
    let mut entity = Entity::new(
        guid,
        "Stationary attacker".into(),
        pose_at(0xda55_0001, 0.0, 0.0, 0.0),
    );
    entity.wcid = Some(42);
    entity.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
    entity.set_did_prop(PropertyDataId::MotionTable, Guid(table_id));
    client.world.add_entity(entity);
    (client, guid)
}

/// Observe the real packet-to-client-event boundary, without advancing a simulation tick.
async fn publish_motion_packet(
    client: &mut ClientRuntime,
    guid: Guid,
    sequence: u16,
    command: Option<InterpretedMotionCommand>,
    sticky: bool,
    autonomous: bool,
) -> Vec<Box<crate::DynamicEntityView>> {
    let mut events = client.subscribe_client_view_events();
    let message = update_motion_packet(
        guid,
        sequence,
        0,
        autonomous,
        command,
        None,
        sticky.then_some(Guid(0x5000_0001)),
    );
    let mut bytes = Vec::new();
    message.pack(&mut bytes);
    let world_events = client.handle_message(&bytes).await.unwrap();
    assert!(
        world_events
            .iter()
            .filter(|event| matches!(
                event,
                WorldEvent::EntityMotionUpdated { .. }
                    | WorldEvent::EntityMotionPlaybackChanged { .. }
            ))
            .count()
            <= 1,
        "one admission must choose one motion notification route"
    );
    std::iter::from_fn(|| events.try_recv().ok())
        .filter_map(|event| match event {
            ClientViewEvent::DynamicEntity(crate::DynamicEntityEvent::Upserted { entity })
                if entity.identity.guid == guid =>
            {
                Some(entity)
            }
            _ => None,
        })
        .collect()
}

pub(super) fn dynamic_definition(
    movement: PhysicalBodyDefinition,
    response_policy: PhysicalBodyResponsePolicy,
) -> DynamicPhysicalBodyConfiguration {
    let definition = DynamicPhysicalBodyDefinition {
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
                fallback_setup_did: 0,
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
    };
    DynamicPhysicalBodyConfiguration::new(
        definition,
        LocalPhysicalDemand {
            target: LocalTargetDemand::Retained,
            integration: LocalIntegrationDemand::Eligible,
        },
    )
    .unwrap()
}

fn test_self_movement_capabilities(
    run_rate_scalar: f32,
    walk_speed: f32,
    run_speed: f32,
    turn_speed_rad_per_sec: f32,
) -> SelfMovementCapabilities {
    SelfMovementCapabilities {
        kinematics: SelfMovementKinematics {
            source: PlayerMotionTableSource::DirectProperty {
                motion_table_id: 0x0900_0020,
            },
            motion_table_id: 0x0900_0020,
            stance: 0x8000_003D,
            base_walk_forward_velocity: Vector3::new(walk_speed, 0.0, 0.0),
            base_run_forward_velocity: Vector3::new(run_speed, 0.0, 0.0),
            base_turn_left_omega: Vector3::new(0.0, 0.0, -turn_speed_rad_per_sec),
            base_turn_right_omega: Vector3::new(0.0, 0.0, turn_speed_rad_per_sec),
        },
        run_rate_scalar,
    }
}

fn flat_collision_scene_for_interest(interest: &SimulationSceneInterest) -> CollisionScene {
    let mut scene = CollisionScene::new();
    for owner in interest.owners() {
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: owner.0,
                terrain: TerrainCollisionSurface::from_terrain(&LandblockTerrain {
                    grid_size: 9,
                    tile_size: 24.0,
                    height_indices: vec![0; 81],
                    heights: vec![0.0; 81],
                    terrain_samples: vec![0; 81],
                    cell_diagonals: TerrainCellDiagonals::for_landblock(owner.0),
                })
                .unwrap(),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
    }
    scene
}

fn collision_snapshot(
    interest: SimulationSceneInterest,
    scene: CollisionScene,
) -> SimulationSceneSnapshot {
    let availability = interest
        .owners()
        .iter()
        .map(|&owner| {
            (
                owner,
                SimulationSceneOwnerAvailability::Resident { owner_revision: 1 },
            )
        })
        .collect::<BTreeMap<_, _>>();
    SimulationSceneSnapshot {
        revision: 1,
        content_source_generation: 1,
        interest,
        availability,
        scene: Arc::new(scene),
    }
}

fn test_grounded_body_definition() -> PhysicalBodyDefinition {
    PhysicalBodyDefinition::grounded(
        PhysicalSphereSet::new(
            holtburger_common::Sphere {
                center: Vector3::new(0.0, 0.0, 0.5),
                radius: 0.5,
            },
            None,
        )
        .unwrap(),
        GroundedConfig {
            gravity: -9.8,
            walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
            landing_normal_z: RETAIL_LANDING_NORMAL_Z,
            airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
            step_up_height: 0.6,
            step_down_height: 1.5,
            edge_protection: EdgeProtection::Creature,
            minimum_stair_rise: 0.0005,
        },
    )
    .unwrap()
}

pub(super) fn stable_dynamic_body_definition() -> DynamicPhysicalBodyConfiguration {
    dynamic_definition(
        test_grounded_body_definition(),
        PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Inelastic,
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        },
    )
}

fn seed_test_self_movement_capabilities(client: &mut ClientRuntime) -> SelfMovementCapabilities {
    let capabilities = test_self_movement_capabilities(2.25, 1.0, 2.0, 1.5);
    client
        .world
        .set_self_movement_capabilities_override(capabilities.clone());
    capabilities
}

fn seed_test_jump_authority(client: &mut ClientRuntime) {
    let player = client.world.player_entity_mut().unwrap();
    player.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    player
        .physics
        .reconcile(holtburger_world::resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY,
        ));
    client.world.player.attributes.insert(
        AttributeType::StrengthAttr,
        Attribute {
            attr_type: AttributeType::StrengthAttr,
            ranks: 0,
            start: 100,
            spent_xp: 0,
            next_rank_xp: None,
            base: 100,
            current: 100,
            breakdown: Default::default(),
        },
    );
    let skill = |skill_type, value| Skill {
        skill_type,
        ranks: 0,
        init: value,
        spent_xp: 0,
        next_rank_xp: None,
        base: value,
        current: value,
        training: TrainingLevel::Trained,
        trained_cost: 0,
        specialized_cost: 0,
        breakdown: Default::default(),
    };
    client
        .world
        .player
        .skills
        .insert(SkillType::Jump, skill(SkillType::Jump, 400));
    client
        .world
        .player
        .skills
        .insert(SkillType::Run, skill(SkillType::Run, 300));
    client.world.player.vitals.insert(
        VitalType::Stamina,
        Vital {
            vital_type: VitalType::Stamina,
            ranks: 0,
            start: 100,
            spent_xp: 0,
            next_rank_xp: None,
            base: 100,
            buffed_max: 100,
            current: 100,
            breakdown: Default::default(),
        },
    );
}

async fn receive_matching_cast_turn(client: &mut ClientRuntime) {
    let before_motion = client
        .world
        .motion_runtimes
        .motion_playback(client.world.player.guid);
    let before_pose = client.world.local_player_runtime_pose();
    let before_snapshot = client.world.player_entity().unwrap().network_motion;
    let was_manual = client.movement.has_active_manual_drive();
    let sequence = client.world.player.server_control_sequence.wrapping_add(1);
    let packet = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid: client.world.player.guid,
        object_instance_sequence: client.world.player.instance_sequence,
        movement_sequence: client.world.player.movement_sequence.wrapping_add(1),
        server_control_sequence: sequence,
        is_autonomous: false,
        movement_type: MovementType::TurnToObject,
        motion_flags: 0,
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::TurnToObject(TurnToObject {
            target: CAST_TURN_TARGET,
            desired_heading: 180.0,
            params: TurnToParameters {
                movement_parameters: 0,
                speed: 1.0,
                desired_heading: 180.0,
            },
        }),
    }));
    let mut bytes = Vec::new();
    packet.pack(&mut bytes);
    client.handle_message(&bytes).await.unwrap();
    assert_eq!(client.world.player.server_control_sequence, sequence);
    assert_eq!(
        client
            .world
            .player_entity()
            .unwrap()
            .server_control_sequence(),
        sequence
    );
    assert_eq!(
        client.world.player_entity().unwrap().network_motion,
        before_snapshot
    );
    assert_eq!(
        client
            .world
            .motion_runtimes
            .motion_playback(client.world.player.guid),
        before_motion
    );
    assert_eq!(client.world.local_player_runtime_pose(), before_pose);
    assert_eq!(client.movement.has_active_manual_drive(), was_manual);
    assert!(!client.movement.has_server_controlled_motion());
}

#[test]
fn object_inspection_result_is_forwarded_only_for_full_appraisal_demand() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();
    let guid = Guid(0x5000_0042);
    let result = holtburger_world::inspection::ObjectInspectionResult {
        guid,
        outcome: holtburger_world::inspection::ObjectInspectionOutcome::Missing,
    };

    // Background facts-only appraisal suppresses ObjectInspectionResult and emits AppraisalFactsSettled.
    client.appraisal.request(
        guid,
        Some(1),
        appraisal::AppraisalOutputDemand::FactsOnly,
        false,
    );
    assert!(
        client
            .appraisal
            .pop_next_dispatch(Instant::now(), |_| Some(1))
            == Some(guid)
    );
    client.handle_world_event(&WorldEvent::ObjectInspectionResult(result.clone()));
    assert!(matches!(
        events.try_recv().unwrap(),
        ClientViewEvent::AppraisalFactsSettled { guid: settled } if settled == guid
    ));
    assert!(events.try_recv().is_err());

    // Foreground full appraisal forwards ObjectInspectionResult without reconstruction.
    client
        .appraisal
        .request(guid, Some(1), appraisal::AppraisalOutputDemand::Full, false);
    let later =
        Instant::now() + Duration::from_millis(appraisal::DEFAULT_APPRAISAL_RETRY_INTERVAL_MS);
    assert!(client.appraisal.pop_next_dispatch(later, |_| Some(1)) == Some(guid));
    client.handle_world_event(&WorldEvent::ObjectInspectionResult(result.clone()));

    assert!(matches!(
        events.try_recv().unwrap(),
        ClientViewEvent::ObjectInspectionResult(forwarded)
            if forwarded.guid == result.guid
                && matches!(
                    forwarded.outcome,
                    holtburger_world::inspection::ObjectInspectionOutcome::Missing
                )
    ));
    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn stationary_action_publication_precedes_ticks_and_repeats_without_movement() {
    for sticky in [false, true] {
        let (mut client, guid) = motion_publication_client();
        publish_motion_packet(&mut client, guid, 1, None, false, false).await;
        let mut previous_playback = None;
        for sequence in 2..=3 {
            let views = publish_motion_packet(
                &mut client,
                guid,
                sequence,
                Some(InterpretedMotionCommand(JUMP_FIXTURE_ACTION_COMMAND as u16)),
                sticky,
                false,
            )
            .await;
            assert_eq!(
                views.len(),
                1,
                "an action-only admission must publish immediately"
            );
            let motion = views[0].motion.as_ref().unwrap();
            assert_eq!(
                motion.activity,
                crate::DynamicEntityMotionActivity::Explicit
            );
            let layer = motion.ordinary.as_ref().unwrap();
            assert_eq!(layer.clip.animation_id(), JUMP_FIXTURE_ACTION_ANIMATION);
            assert_ne!(previous_playback.as_ref(), Some(&layer.playback_id));
            previous_playback = Some(layer.playback_id.clone());

            // The next tick starts after admission. Its unchanged clip cannot rescue a
            // missed packet publication; only completion produces another changed level.
            let before_views = client.current_dynamic_entity_views();
            let before = client.capture_dynamic_entity_tick_cursor();
            client
                .world
                .advance_authored_motion(Duration::from_millis(10));
            assert_eq!(before_views, client.current_dynamic_entity_views());
            client.world.advance_authored_motion(Duration::from_secs(1));
            let batch = client
                .dynamic_entity_tick_batch(
                    before,
                    || DynamicEntityHostTime::new(f64::from(sequence)).unwrap(),
                    1000.0,
                    &Default::default(),
                )
                .unwrap()
                .unwrap();
            assert!(batch.advances.is_empty());
            assert_eq!(batch.updates.len(), 1);
            assert_eq!(
                batch.updates[0]
                    .motion
                    .as_ref()
                    .unwrap()
                    .ordinary
                    .as_ref()
                    .unwrap()
                    .clip
                    .animation_id(),
                JUMP_FIXTURE_STAND_ANIMATION
            );
        }
    }
}

#[tokio::test]
async fn queued_action_publication_waits_for_its_playback_start() {
    let (mut client, guid) = motion_publication_client();
    publish_motion_packet(&mut client, guid, 1, None, false, false).await;
    let action = Some(InterpretedMotionCommand(JUMP_FIXTURE_ACTION_COMMAND as u16));
    let first = publish_motion_packet(&mut client, guid, 2, action, false, false).await;
    assert_eq!(first.len(), 1);
    let first_motion = first[0].motion.as_ref().unwrap();
    assert!(
        publish_motion_packet(&mut client, guid, 3, action, false, false)
            .await
            .is_empty()
    );
    let before = client.capture_dynamic_entity_tick_cursor();
    client.world.advance_authored_motion(Duration::from_secs(1));
    let batch = client
        .dynamic_entity_tick_batch(
            before,
            || DynamicEntityHostTime::new(1.0).unwrap(),
            1000.0,
            &Default::default(),
        )
        .unwrap()
        .unwrap();
    let next = batch.updates[0].motion.as_ref().unwrap();
    assert_eq!(next.activity, crate::DynamicEntityMotionActivity::Explicit);
    assert_eq!(
        next.ordinary.as_ref().unwrap().clip.animation_id(),
        JUMP_FIXTURE_ACTION_ANIMATION
    );
    assert_ne!(
        next.ordinary.as_ref().unwrap().playback_id,
        first_motion.ordinary.as_ref().unwrap().playback_id
    );
    assert!(
        publish_motion_packet(&mut client, guid, 3, action, false, false)
            .await
            .is_empty(),
        "a stale packet must not publish or enqueue another attack"
    );
    assert_eq!(
        client
            .world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .action_count(),
        1
    );
}

#[tokio::test]
async fn network_motion_change_already_publishes_the_admitted_action() {
    let (mut client, guid) = motion_publication_client();
    publish_motion_packet(
        &mut client,
        guid,
        1,
        Some(InterpretedMotionCommand::RUN_FORWARD),
        false,
        false,
    )
    .await;
    let events = publish_motion_packet(
        &mut client,
        guid,
        2,
        Some(InterpretedMotionCommand(JUMP_FIXTURE_ACTION_COMMAND as u16)),
        false,
        false,
    )
    .await;
    assert!(
        !events.is_empty(),
        "the network-motion notification must publish playback"
    );
    assert!(
        events
            .iter()
            .all(|view| view.motion.as_ref().unwrap().activity
                == crate::DynamicEntityMotionActivity::Explicit)
    );
}

#[tokio::test]
async fn local_action_echo_preserves_predicted_playback_without_republication() {
    let (mut client, guid) = motion_publication_client();
    publish_motion_packet(&mut client, guid, 1, None, false, false).await;
    client.world.player.guid = guid;
    let command = InterpretedMotionCommand(JUMP_FIXTURE_ACTION_COMMAND as u16);
    client
        .world
        .submit_local_authored_motion_command(command, 1.0, 1, None)
        .unwrap();
    client.world.advance_authored_motion(Duration::ZERO);
    let predicted = client.world.motion_runtimes.motion_playback(guid).unwrap();
    assert_eq!(
        predicted.ordinary.unwrap().clip.animation_id(),
        JUMP_FIXTURE_ACTION_ANIMATION
    );
    assert!(
        publish_motion_packet(&mut client, guid, 2, Some(command), true, true)
            .await
            .is_empty()
    );
    assert_eq!(
        client.world.motion_runtimes.motion_playback(guid),
        Some(predicted)
    );
    assert_eq!(
        client
            .world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .action_count(),
        1
    );
}

#[tokio::test]
async fn unmodelled_action_does_not_publish_unchanged_playback() {
    let (mut client, guid) = motion_publication_client();
    publish_motion_packet(&mut client, guid, 1, None, false, false).await;
    let idle = client.world.motion_runtimes.motion_playback(guid);
    // AttackHigh1 is a valid action, but this fixture only authors the named fixture action.
    assert!(
        publish_motion_packet(
            &mut client,
            guid,
            2,
            Some(InterpretedMotionCommand(0x62)),
            false,
            false
        )
        .await
        .is_empty()
    );
    assert_eq!(client.world.motion_runtimes.motion_playback(guid), idle);
    assert_eq!(
        client
            .world
            .motion_runtimes
            .get(guid)
            .unwrap()
            .action_count(),
        0
    );
}

#[test]
fn server_authored_local_action_uses_the_local_adapter_for_its_exact_root_offset() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_1007);
    let motion_table_id = 0x0900_1007;
    world.set_motion_sequences(local_authored_motion_catalog(motion_table_id));
    world.seed_local_player_entity(guid, "Player", WorldPosition::default());
    world
        .entities
        .get_mut(guid)
        .unwrap()
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    assert_eq!(
        world.effective_motion_table_id_for_guid(guid),
        Some(motion_table_id),
    );

    let message = update_motion_packet(
        guid,
        1,
        1,
        false,
        Some(InterpretedMotionCommand(74)),
        None,
        None,
    );
    let GameMessage::UpdateMotion(decoded) = &message else {
        panic!("encoded fixture changed message kind");
    };
    let MovementTypeData::Invalid(decoded) = &decoded.data else {
        panic!("encoded fixture changed movement kind");
    };
    assert_eq!(
        decoded.state.forward_command,
        Some(InterpretedMotionCommand(74)),
    );
    assert_eq!(
        holtburger_world::motion::MotionCommand::from_interpreted(
            decoded.state.forward_command.unwrap(),
        )
        .map(holtburger_world::motion::MotionCommand::raw),
        Some(JUMP_FIXTURE_ACTION_COMMAND),
    );
    world.handle_message(&message);

    assert!(world.has_authored_motion_actions(guid));
    assert_eq!(
        world
            .player_entity()
            .unwrap()
            .network_motion
            .snapshot()
            .unwrap()
            .forward_command,
        None,
        "the action edge must not become retained forward locomotion",
    );
    let offset = MovementSystem::new()
        .advance_local_authored_motion(&mut world, Duration::from_millis(150))
        .expect("local action playback should resolve")
        .expect("the local adapter must return the action's authored offset");
    assert_eq!(
        ordinary_anim_id(&world, guid),
        Some(JUMP_FIXTURE_ACTION_ANIMATION),
    );
    assert!(
        offset.offset.translation.length() > 0.0,
        "action root offset was {offset:?}",
    );
}

#[tokio::test]
async fn client_authored_action_predicts_the_edge_filtered_from_its_autonomous_echo() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_1008);
    let motion_table_id = 0x0900_1008;
    world.set_motion_sequences(local_authored_motion_catalog(motion_table_id));
    world.seed_local_player_entity(guid, "Player", WorldPosition::default());
    world
        .entities
        .get_mut(guid)
        .unwrap()
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));

    let mut movement = MovementSystem::new();
    movement.enqueue_authored_motion(
        InterpretedMotionCommand(74),
        crate::client::movement_types::MotionStyle::Explicit(MotionStance::NonCombat),
    );
    let mut session = holtburger_session::Session::new_test();
    movement
        .tick(Instant::now(), &mut world, &mut session)
        .await
        .expect("client-authored action pulse should send");

    assert!(world.has_authored_motion_actions(guid));
    movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(150))
        .expect("predicted local action should advance")
        .expect("predicted local action should expose its authored offset");
    assert_eq!(
        ordinary_anim_id(&world, guid),
        Some(JUMP_FIXTURE_ACTION_ANIMATION),
    );
}

#[test]
fn reduced_navigation_does_not_advertise_jump_charge_capabilities() {
    const TABLE: u32 = 0x0900_0020;
    let mut client = builder::build_test_client(ClientState::InWorld);
    client.world.seed_local_player_entity(
        Guid(0x5000_0001),
        "Player",
        pose_at(0x1234_0001, 0.0, 0.0, 0.0),
    );
    client
        .world
        .set_motion_sequences(local_authored_motion_catalog(TABLE));
    client
        .world
        .player_entity_mut()
        .unwrap()
        .set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
    seed_test_self_movement_capabilities(&mut client);
    seed_test_jump_authority(&mut client);
    assert!(client.character_motion_capabilities().is_some());
    client.movement =
        movement::MovementSystem::with_policy(movement_types::ClientMovementPolicy::Navigation);
    assert!(client.character_motion_capabilities().is_none());
}

#[tokio::test]
async fn manual_movement_preserves_windup_and_applies_one_locomotion_and_stop_displacement() {
    const FIXTURE_MOTION_TABLE_ID: u32 = 0x0900_0020;
    let guid = Guid(0x0102_0304);
    let pose = outdoor_pose(48.0, 48.0, 0.0);
    let (mut client, collision, mut now) = grounded_player_client(
        guid,
        "Player",
        pose,
        local_authored_motion_catalog(FIXTURE_MOTION_TABLE_ID),
        FIXTURE_MOTION_TABLE_ID,
    );
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let dt = physics_dt();
    // Allow a full second for support settlement and each four-frame fixture sequence,
    // independently of the simulation's configured tick cadence.
    let observation_ticks = Duration::from_secs(1).as_nanos().div_ceil(dt.as_nanos());

    assert!(client.arm_busy_operation(PendingOperation::SpellCast {
        target: Some(CAST_TURN_TARGET)
    }));
    receive_matching_cast_turn(&mut client).await;
    let message = update_motion_packet(
        guid,
        client.world.player.movement_sequence.wrapping_add(1),
        client.world.player.server_control_sequence.wrapping_add(1),
        false,
        Some(InterpretedMotionCommand(0x70)),
        None,
        None,
    );
    client.world.handle_message(&message);
    let GameMessage::UpdateMotion(data) = message else {
        unreachable!()
    };
    simulation::handle_server_controlled_movement(&data, &mut client.movement, &mut client.world);
    assert!(client.world.has_authored_motion_actions(guid));
    for drive in [
        movement_types::CharacterDrive::builder()
            .run()
            .forward()
            .build(),
        movement_types::CharacterDrive::default(),
    ] {
        if drive.is_stationary() {
            // Manual idle must also retire a cursor retained by a prior visual controller.
            client
                .world
                .present_character_locomotion(
                    body_id,
                    holtburger_world::motion::LocomotionPresentationSource::Command(
                        holtburger_world::motion::MotionOrder {
                            forward: Some((
                                holtburger_world::motion::MotionCommand::RUN_FORWARD,
                                1.0,
                            )),
                            ..Default::default()
                        },
                    ),
                    holtburger_world::motion::CharacterMotionPresentation::Grounded,
                    Duration::ZERO,
                )
                .unwrap();
        }
        client
            .movement
            .enqueue_drive_intent(movement_types::PlayerDriveIntent::ManualHeld(drive), now);
        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .unwrap();
        receive_matching_cast_turn(&mut client).await;
        let start_pose = client.world.scene.body(body_id).unwrap().pose;
        let mut authored_translation = Vector3::zero();
        let mut saw_stop = false;
        let mut saw_gesture = false;
        let mut saw_idle = false;
        let mut moving_idle_boundary = false;
        for _ in 0..observation_ticks {
            simulation::tick(
                now,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            saw_gesture |= client.world.has_authored_motion_actions(guid);
            assert_eq!(
                client.active_busy_operation(),
                Some(BusyOperationKind::SpellCast)
            );
            let runtime = client.world.motion_runtimes.get(guid).unwrap();
            authored_translation = authored_translation + runtime.tick().offset.translation;
            let holtburger_world::motion::AuthoredCollisionPose::Animation {
                animation_id: authored,
                ..
            } = runtime.collision_pose()
            else {
                panic!("fixture must retain authored animation");
            };
            saw_stop |= authored == STOP_FIXTURE_ANIMATION;
            saw_idle |= authored == JUMP_FIXTURE_STAND_ANIMATION;
            moving_idle_boundary |= authored == JUMP_FIXTURE_STAND_ANIMATION
                && runtime.tick().offset.translation.length_squared() > 0.0;
            now += dt;
        }
        let displacement =
            client.world.scene.body(body_id).unwrap().pose.coords - start_pose.coords;
        assert!(
            (displacement.y - authored_translation.y).abs() < 0.001,
            "flat collision solve must apply exactly one authored displacement: {displacement:?} versus {authored_translation:?}"
        );
        assert!(displacement.y > 0.0);
        if !drive.is_stationary() {
            assert!(saw_gesture, "manual movement must preserve the windup");
            assert!(
                !client.world.has_authored_motion_actions(guid),
                "windup must finish at its authored boundary"
            );
        }
        if drive.is_stationary() {
            assert!(saw_stop, "release must play the authored stop transition");
            assert!(saw_idle, "stop transition must complete into idle");
            assert!(
                moving_idle_boundary,
                "the idle-entry tick must still contain stop displacement"
            );
        }
    }
}

#[tokio::test]
async fn physical_fallback_movement_stops_and_rebinds_without_leaking_pose_or_authority() {
    const IDLE_BODY_TABLE: u32 = 0x0900_0020;
    let guid = Guid(0x0102_0304);
    let pose = outdoor_pose(48.0, 48.0, 0.0);
    let (mut client, collision, mut now) = grounded_player_client(
        guid,
        "Creature",
        pose,
        local_authored_motion_catalog_with_idle_body(
            PLAYER_LOCOMOTION_BASELINE_TABLE,
            Some(IDLE_BODY_TABLE),
        ),
        IDLE_BODY_TABLE,
    );
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let dt = physics_dt();
    let ticks = Duration::from_secs(1).as_nanos().div_ceil(dt.as_nanos());
    let start = client.world.scene.body(body_id).unwrap().pose;
    let walking = movement_types::CharacterDrive::builder()
        .walk()
        .forward()
        .build();
    for drive in [walking, movement_types::CharacterDrive::default()] {
        client
            .movement
            .enqueue_drive_intent(movement_types::PlayerDriveIntent::ManualHeld(drive), now);
        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .unwrap();
        let phase_start = client.world.scene.body(body_id).unwrap().pose;
        for _ in 0..ticks {
            simulation::tick(
                now,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            now += dt;
            let playback = client.world.motion_runtimes.motion_playback(guid).unwrap();
            for layer in [playback.ordinary, playback.locomotion]
                .into_iter()
                .flatten()
            {
                assert_ne!(
                    layer.clip.animation_id(),
                    JUMP_FIXTURE_RUN_ANIMATION,
                    "baseline clip must not become the creature pose"
                );
            }
        }
        let end = client.world.scene.body(body_id).unwrap().pose;
        if drive.is_stationary() {
            assert!((end.coords - phase_start.coords).length() < 0.00001);
        } else {
            assert!(end.coords.y > start.coords.y);
        }
        assert_eq!(
            client.world.player_entity().unwrap().mtable_id(),
            Some(Guid(IDLE_BODY_TABLE))
        );
    }
    // A real body-table change can now legitimately publish the baseline table's native clip.
    client
        .world
        .player_entity_mut()
        .unwrap()
        .properties
        .set_did_prop(
            PropertyDataId::MotionTable,
            Guid(PLAYER_LOCOMOTION_BASELINE_TABLE),
        );
    client
        .movement
        .enqueue_drive_intent(movement_types::PlayerDriveIntent::ManualHeld(walking), now);
    client
        .movement
        .tick(now, &mut client.world, &mut client.session)
        .await
        .unwrap();
    simulation::tick(
        now,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    let runtime = client.world.motion_runtimes.get(guid).unwrap();
    assert_eq!(runtime.motion_table_id(), PLAYER_LOCOMOTION_BASELINE_TABLE);
    assert_eq!(
        runtime
            .motion_playback()
            .unwrap()
            .locomotion
            .unwrap()
            .clip
            .animation_id(),
        JUMP_FIXTURE_RUN_ANIMATION
    );
}

#[tokio::test]
async fn missing_falling_animation_preserves_physical_jump_and_landing() {
    const TABLE: u32 = 0x0900_0020;
    let guid = Guid(0x0102_0304);
    let pose = outdoor_pose(48.0, 48.0, 0.0);
    let (mut client, collision, mut now) = grounded_player_client(
        guid,
        "Creature",
        pose,
        jump_presentation_motion_catalog_with_falling(TABLE, false),
        TABLE,
    );
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let dt = physics_dt();
    let start_height = client.world.scene.body(body_id).unwrap().pose.coords.z;
    let drive = movement_types::CharacterDrive::default();
    client
        .movement
        .enqueue_drive_intent(movement_types::PlayerDriveIntent::ManualHeld(drive), now);
    for (sequence, event) in [
        (1, CharacterMotionEvent::BeginJump { drive }),
        (
            2,
            CharacterMotionEvent::ReleaseJump {
                drive,
                extent: JumpExtent::MAXIMUM,
            },
        ),
    ] {
        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(sequence),
                event,
            });
    }
    client
        .movement
        .tick(now, &mut client.world, &mut client.session)
        .await
        .unwrap();
    let mut commits = 0;
    let mut airborne = false;
    let mut landed = false;
    let mut peak = start_height;
    for _ in 0..Duration::from_secs(5).as_nanos().div_ceil(dt.as_nanos()) {
        let tick = simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        commits += usize::from(tick.committed_jump.is_some());
        let body = client.world.scene.body(body_id).unwrap();
        peak = peak.max(body.pose.coords.z);
        airborne |= body.contact == holtburger_world::ContactState::Airborne;
        if airborne && body.contact == holtburger_world::ContactState::Grounded {
            landed = true;
            break;
        }
        now += dt;
    }
    assert_eq!(commits, 1);
    assert!(airborne && landed);
    assert!(peak > start_height + RETAIL_AIRBORNE_STEP_DOWN_HEIGHT);
}

#[tokio::test]
async fn fixed_tick_commits_one_midcast_grounded_jump_from_the_release_origin() {
    const MOTION_TABLE_ID: u32 = 0x0900_0020;
    let guid = Guid(0x0102_0304);
    let release_pose = WorldPosition {
        rotation: Quaternion::from_heading(0.5),
        ..outdoor_pose(48.0, 48.0, 0.0)
    };
    let (mut client, collision, mut now) = grounded_player_client(
        guid,
        "Player",
        release_pose,
        jump_presentation_motion_catalog(MOTION_TABLE_ID),
        MOTION_TABLE_ID,
    );
    client.world.player.instance_sequence = 11;
    client.world.player.server_control_sequence = 11;
    client.world.player.teleport_sequence = 13;
    client.world.player.force_position_sequence = 14;
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let dt = physics_dt();

    let idle_drive = movement_types::CharacterDrive::default();
    client.movement.enqueue_drive_intent(
        movement_types::PlayerDriveIntent::ManualHeld(idle_drive),
        now,
    );
    client
        .movement
        .tick(now, &mut client.world, &mut client.session)
        .await
        .unwrap();
    simulation::tick(
        now + Duration::from_millis(1),
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert!(client.arm_busy_operation(PendingOperation::SpellCast {
        target: Some(CAST_TURN_TARGET)
    }));
    let mut message = update_motion_packet(
        guid,
        1,
        12,
        false,
        Some(InterpretedMotionCommand(
            JUMP_FIXTURE_RELEASE_COMMAND as u16,
        )),
        None,
        None,
    );
    if let GameMessage::UpdateMotion(ref mut data) = message {
        data.object_instance_sequence = 11;
    }
    client.world.handle_message(&message);
    let GameMessage::UpdateMotion(data) = message else {
        unreachable!()
    };
    simulation::handle_server_controlled_movement(&data, &mut client.movement, &mut client.world);
    assert!(client.world.has_pending_motion_gesture(guid));
    let clip_before_rejected_launch = client
        .world
        .motion_runtimes
        .motion_playback(guid)
        .and_then(|motion| motion.ordinary)
        .map(|layer| layer.clip);
    let grounded_release_pose = client.world.scene.body(body_id).unwrap().pose;

    client
        .movement
        .enqueue_character_motion_event(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(1),
            event: CharacterMotionEvent::BeginJump { drive: idle_drive },
        });
    client
        .movement
        .enqueue_character_motion_event(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(2),
            event: CharacterMotionEvent::ReleaseJump {
                drive: idle_drive,
                extent: JumpExtent::new(0.75).unwrap(),
            },
        });
    client
        .movement
        .tick(now + dt, &mut client.world, &mut client.session)
        .await
        .unwrap();
    let unavailable = simulation::tick(
        now + dt * 2,
        dt,
        &mut client.world,
        &mut client.movement,
        None,
    )
    .unwrap();
    assert!(unavailable.committed_jump.is_none());
    assert_eq!(
        unavailable.character_motion_feedback,
        Some(ClientCharacterMotionFeedback {
            sequence: CharacterMotionSequence(2),
            outcome: ClientCharacterMotionOutcome::Rejected {
                reason: ClientCharacterMotionRejection::CollisionUnavailable,
            },
        })
    );
    let no_replay = simulation::tick(
        now + dt * 3,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert!(no_replay.committed_jump.is_none());
    assert!(no_replay.character_motion_feedback.is_none());
    assert_eq!(
        client
            .world
            .motion_runtimes
            .motion_playback(guid)
            .and_then(|motion| motion.ordinary)
            .map(|layer| layer.clip),
        clip_before_rejected_launch,
        "a rejected launch must not replace the grounded clip"
    );

    client
        .movement
        .enqueue_character_motion_event(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(3),
            event: CharacterMotionEvent::BeginJump { drive: idle_drive },
        });
    client
        .movement
        .tick(now + dt * 3, &mut client.world, &mut client.session)
        .await
        .unwrap();
    let charging = simulation::tick(
        now + dt * 4,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert!(charging.committed_jump.is_none());
    assert_eq!(
        client.world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(JUMP_FIXTURE_RELEASE_COMMAND)
    );
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_STAND_ANIMATION),
        "retail Ready and Stand must resolve through their shared motion-table row"
    );

    receive_matching_cast_turn(&mut client).await;
    client
        .movement
        .enqueue_character_motion_event(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(4),
            event: CharacterMotionEvent::ReleaseJump {
                drive: idle_drive,
                extent: JumpExtent::new(0.75).unwrap(),
            },
        });
    client
        .movement
        .tick(now + dt * 4, &mut client.world, &mut client.session)
        .await
        .unwrap();
    let tick = simulation::tick(
        now + dt * 5,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    let committed = tick
        .committed_jump
        .expect("supported local launch should commit exactly once");

    assert_eq!(
        client.active_busy_operation(),
        Some(BusyOperationKind::SpellCast)
    );
    assert!(client.world.has_pending_motion_gesture(guid));
    assert_eq!(committed.position, grounded_release_pose);
    assert_eq!(committed.resolved.extent(), JumpExtent::new(0.75).unwrap());
    assert_eq!(
        (
            committed.instance_sequence,
            committed.server_control_sequence,
            committed.teleport_sequence,
            committed.force_position_sequence,
        ),
        (11, 13, 13, 14)
    );
    assert!(committed.resolved.world_velocity().z > 0.0);
    assert!(
        client
            .world
            .scene
            .body(body_id)
            .unwrap()
            .retained
            .velocity
            .z
            > 0.0
    );
    assert_eq!(
        client.world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(JUMP_FIXTURE_RELEASE_COMMAND),
        "accepted launch must preserve the ordinary release gesture"
    );
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_TAKEOFF_ANIMATION),
        "accepted launch must begin the table-authored Ready-to-Falling transition"
    );

    receive_matching_cast_turn(&mut client).await;
    now += dt * 6;
    let mut falling_step = None;
    for step in 6..=25 {
        let airborne = simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        now += dt;
        assert!(airborne.committed_jump.is_none());
        if locomotion_anim_id(&client.world, guid) == Some(JUMP_FIXTURE_FALLING_ANIMATION) {
            assert_eq!(
                client.world.scene.body(body_id).unwrap().contact,
                holtburger_world::ContactState::Airborne
            );
            falling_step = Some(step);
            break;
        }
    }
    let falling_step = falling_step
        .expect("stationary takeoff must advance into Falling independently from the body arc");
    step_until_grounded(
        &mut client,
        body_id,
        &mut now,
        dt,
        &collision,
        (400 - falling_step) as usize,
    );
    assert_eq!(
        client.world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(JUMP_FIXTURE_RELEASE_COMMAND),
        "landing must preserve the ordinary release gesture"
    );
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_LANDING_ANIMATION),
        "support recovery must begin the table-authored landing transition"
    );
    step_ticks(&mut client, &mut now, dt, &collision, 1);
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_STAND_ANIMATION),
        "the authored landing transition must complete into idle"
    );

    let moving_start = now;
    let moving_drive = movement_types::CharacterDrive::builder()
        .run()
        .forward()
        .build();
    client.movement.enqueue_drive_intent(
        movement_types::PlayerDriveIntent::ManualHeld(moving_drive),
        moving_start,
    );
    client
        .movement
        .enqueue_character_motion_event(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(5),
            event: CharacterMotionEvent::BeginJump {
                drive: moving_drive,
            },
        });
    client
        .movement
        .tick(moving_start, &mut client.world, &mut client.session)
        .await
        .unwrap();
    simulation::tick(
        moving_start + dt,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_RUN_ANIMATION),
        "fractional run-frame movement must already produce locomotion presentation"
    );

    client
        .movement
        .enqueue_character_motion_event(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(6),
            event: CharacterMotionEvent::ReleaseJump {
                drive: moving_drive,
                extent: JumpExtent::new(0.75).unwrap(),
            },
        });
    client
        .movement
        .tick(moving_start + dt, &mut client.world, &mut client.session)
        .await
        .unwrap();
    let moving_launch = simulation::tick(
        moving_start + dt * 2,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap()
    .committed_jump
    .expect("held-run jump should commit from grounded support");
    let moving_velocity = moving_launch.resolved.world_velocity();
    assert!(moving_velocity.z > 0.0);
    assert!(
        moving_velocity.x * moving_velocity.x + moving_velocity.y * moving_velocity.y > 0.0,
        "moving launch must retain a horizontal velocity component"
    );
    assert_eq!(
        client.world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(JUMP_FIXTURE_RELEASE_COMMAND)
    );
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_TAKEOFF_ANIMATION),
        "moving takeoff must use the authored run-to-Falling transition"
    );

    now = moving_start + dt * 3;
    let mut moving_falling_step = None;
    for step in 3..=20 {
        simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        now += dt;
        if locomotion_anim_id(&client.world, guid) == Some(JUMP_FIXTURE_FALLING_ANIMATION) {
            assert_eq!(
                client.world.scene.body(body_id).unwrap().contact,
                holtburger_world::ContactState::Airborne
            );
            moving_falling_step = Some(step);
            break;
        }
    }
    let moving_falling_step =
        moving_falling_step.expect("moving takeoff must advance into Falling");
    step_until_grounded(
        &mut client,
        body_id,
        &mut now,
        dt,
        &collision,
        (400 - moving_falling_step) as usize,
    );
    assert!(client.world.has_manual_locomotion(guid));
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_LANDING_ANIMATION)
    );
    step_ticks(&mut client, &mut now, dt, &collision, 1);
    assert_eq!(
        locomotion_anim_id(&client.world, guid),
        Some(JUMP_FIXTURE_RUN_ANIMATION),
        "held locomotion must resume after the authored landing transition"
    );
}

#[test]
fn lifecycle_preserves_selection_slots_and_snapshot_owns_local_identity() {
    let characters = vec![
        CharacterEntry {
            guid: Guid(0x5000_0001),
            name: "Mira".to_string(),
            delete_time: 0,
        },
        CharacterEntry {
            guid: Guid(0x5000_0002),
            name: "Nox".to_string(),
            delete_time: 123,
        },
    ];
    let mut client = builder::build_test_client(ClientState::CharacterSelection);
    client.character_selection.characters = characters.clone();
    client.character_selection.max_slots = 11;

    assert_eq!(
        client.lifecycle(),
        ClientLifecycleState::CharacterSelection {
            rejection: None,
            max_slots: 11,
            characters: vec![
                ClientCharacterSummary {
                    guid: Guid(0x5000_0001),
                    name: "Mira".to_string(),
                    slot: 0,
                    delete_time: 0,
                },
                ClientCharacterSummary {
                    guid: Guid(0x5000_0002),
                    name: "Nox".to_string(),
                    slot: 1,
                    delete_time: 123,
                },
            ],
        }
    );

    client.conn.state = ClientState::InWorld;
    client.world.player.guid = Guid(0x5000_0002);
    let snapshot = client.application_snapshot();
    assert_eq!(snapshot.lifecycle, ClientLifecycleState::InWorld);
    assert_eq!(snapshot.local_player_guid, Some(Guid(0x5000_0002)));
    assert_eq!(snapshot.world_generation, 0);
    assert!(snapshot.runtime_bodies.is_empty());
    assert_eq!(
        characters.len(),
        2,
        "selection source remains lossless in core"
    );
}

#[tokio::test]
async fn world_activation_retires_pre_portal_movement_epoch() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x5000_0001);
    client
        .world
        .seed_local_player_entity(player_guid, "Player", outdoor_pose(0.0, 0.0, 0.0));
    let started_at = Instant::now();
    let forward = movement_types::PlayerDriveIntent::ManualHeld(
        movement_types::CharacterDrive::builder()
            .run()
            .forward()
            .build(),
    );

    client.movement.enqueue_drive_intent(forward, started_at);
    client
        .movement
        .tick(started_at, &mut client.world, &mut client.session)
        .await
        .expect("pre-portal drive should become active");
    client
        .movement
        .enqueue_drive_intent(forward, started_at + Duration::from_millis(10));

    client.start_world_activation(ClientWorldActivationState::Teleport, player_guid);
    client
        .movement
        .tick(
            started_at + Duration::from_millis(30),
            &mut client.world,
            &mut client.session,
        )
        .await
        .expect("destination activation should leave movement idle");

    assert!(!client.movement.has_active_manual_drive());
    assert!(!client.movement.has_local_steering());
}

#[tokio::test]
async fn activation_waits_for_an_authoritative_destination() {
    let mut client = builder::build_test_client(ClientState::EnteringWorld);
    let player_guid = Guid(0x5000_0001);
    client
        .world
        .seed_local_player_entity(player_guid, "Player", WorldPosition::default());
    client.start_world_activation(ClientWorldActivationState::Teleport, player_guid);

    client.try_complete_world_activation().await.unwrap();

    assert!(matches!(
        client
            .portal
            .activation
            .as_ref()
            .map(|activation| activation.phase),
        Some(ClientWorldActivationPhase::TeleportAwaitingDestination)
    ));
    assert_eq!(client.session.bytes_out, 0);
}

#[test]
fn remote_stop_and_landing_drive_initialized_idle_without_changing_placement() {
    let mut world = WorldState::synthetic();
    let remote_guid = Guid(0x0102_2201);
    let motion_table_id = 0x0900_0040;
    world.set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));

    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_owned(),
        pose_at(0xda55_0001, 0.0, 0.0, 0.0),
    );
    remote
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    world.add_entity(remote);

    let run_events = world.handle_message(&update_motion_packet(
        remote_guid,
        1,
        0,
        true,
        Some(InterpretedMotionCommand::RUN_FORWARD),
        None,
        None,
    ));
    assert!(run_events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMotionUpdated { guid, motion }
            if *guid == remote_guid
                && motion.snapshot().is_some_and(|snapshot| {
                    snapshot.forward_command == Some(InterpretedMotionCommand::RUN_FORWARD)
                })
    )));
    world.advance_authored_motion(Duration::from_millis(30));
    assert_eq!(
        ordinary_anim_id(&world, remote_guid),
        Some(JUMP_FIXTURE_RUN_ANIMATION)
    );
    let pose_before_stop = world
        .entities
        .get(remote_guid)
        .expect("remote authority must remain registered")
        .position;

    world.handle_message(&idle_motion_packet(remote_guid, 2, true));
    world.advance_authored_motion(Duration::ZERO);
    assert_eq!(
        ordinary_anim_id(&world, remote_guid),
        Some(JUMP_FIXTURE_STAND_ANIMATION),
        "an admitted empty update must retire the prior run cycle"
    );
    assert_eq!(
        world.entities.get(remote_guid).unwrap().position,
        pose_before_stop,
        "a clip-only stop must not reconstruct or move the runtime body"
    );

    world
        .drive_authored_motion_for_body(
            remote_guid,
            holtburger_world::motion::MotionOrder {
                style: Some(holtburger_world::motion::MotionCommand(
                    MotionStance::NonCombat as u32,
                )),
                forward: Some((holtburger_world::motion::MotionCommand::FALLING, 1.0)),
                ..Default::default()
            },
            Duration::from_millis(250),
        )
        .expect("fixture must model Falling");
    assert_eq!(
        ordinary_anim_id(&world, remote_guid),
        Some(JUMP_FIXTURE_FALLING_ANIMATION),
        "fixture setup must reach the unsupported cycle before landing"
    );

    world.reconcile_authored_motion_support(remote_guid, holtburger_world::ContactState::Grounded);
    assert_eq!(
        ordinary_anim_id(&world, remote_guid),
        Some(JUMP_FIXTURE_LANDING_ANIMATION),
        "grounded support must actively retire Falling into authored landing"
    );

    world.advance_authored_motion(Duration::from_millis(30));
    assert_eq!(
        ordinary_anim_id(&world, remote_guid),
        Some(JUMP_FIXTURE_STAND_ANIMATION),
        "initialized idle authority must complete landing into the stance default"
    );
}

#[test]
fn remote_clip_only_stop_projects_as_a_path_stable_dynamic_update() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let remote_guid = Guid(0x0102_2202);
    let motion_table_id = 0x0900_0042;
    client
        .world
        .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_owned(),
        pose_at(0xda55_0001, 0.0, 0.0, 0.0),
    );
    remote.wcid = Some(42);
    remote
        .properties
        .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
    remote
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    remote
        .physics
        .reconcile(holtburger_world::resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY,
        ));
    client.world.add_entity(remote);

    client.world.handle_message(&update_motion_packet(
        remote_guid,
        1,
        0,
        true,
        Some(InterpretedMotionCommand::RUN_FORWARD),
        None,
        None,
    ));
    client.world.advance_authored_motion(Duration::ZERO);
    let before_views = client.current_dynamic_entity_views();
    let before = client.capture_dynamic_entity_tick_cursor();
    assert_eq!(
        before_views[0]
            .motion
            .as_ref()
            .and_then(|motion| motion.ordinary.as_ref())
            .map(|layer| layer.clip.animation_id()),
        Some(JUMP_FIXTURE_RUN_ANIMATION)
    );

    client
        .world
        .handle_message(&idle_motion_packet(remote_guid, 2, true));
    client.world.advance_authored_motion(Duration::ZERO);
    let after = client.current_dynamic_entity_views();
    assert_eq!(before_views[0].placement, after[0].placement);

    let batch = client
        .dynamic_entity_tick_batch(
            before,
            || DynamicEntityHostTime::new(1.0).unwrap(),
            30.0,
            &Default::default(),
        )
        .unwrap()
        .expect("clip-only change must publish a path-stable update");
    assert!(batch.advances.is_empty());
    assert_eq!(batch.updates.len(), 1);
    assert_eq!(
        batch.updates[0]
            .motion
            .as_ref()
            .and_then(|motion| motion.ordinary.as_ref())
            .map(|layer| layer.clip.animation_id()),
        Some(JUMP_FIXTURE_STAND_ANIMATION)
    );
}

#[test]
fn remote_airborne_casting_preserves_playback_and_ballistic_motion() {
    let mut trajectories = Vec::new();
    // No cast, cast before takeoff, and a fresh cast after Falling is already selected.
    for cast_step in [None, Some(0), Some(2)] {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_2300);
        let remote_guid = Guid(0x0102_2301);
        let motion_table_id = 0x0900_0041;
        let pose = outdoor_pose(48.0, 48.0, 0.0);
        client
            .world
            .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
        client
            .world
            .seed_local_player_entity(player_guid, "Player", pose);
        client.world.add_entity(remote_gravity_creature(
            remote_guid,
            outdoor_pose(52.0, 48.0, 0.0),
            motion_table_id,
        ));
        client.world.handle_message(&update_motion_packet(
            remote_guid,
            1,
            0,
            true,
            Some(InterpretedMotionCommand::RUN_FORWARD),
            None,
            None,
        ));
        let body_id = SpatialBodyId::Entity(remote_guid);
        client
            .world
            .scene
            .set_dynamic_physical_body(
                body_id,
                Some(stable_dynamic_body_definition()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let interest =
            SimulationSceneInterest::prefetch_neighborhood(pose, CLIENT_COLLISION_OWNER_RADIUS)
                .unwrap();
        let collision = collision_snapshot(
            interest.clone(),
            flat_collision_scene_for_interest(&interest),
        );
        let mut now = Instant::now();
        let dt = physics_dt();
        step_until_grounded(&mut client, body_id, &mut now, dt, &collision, 60);
        let release = update_motion_packet(
            remote_guid,
            2,
            0,
            true,
            Some(InterpretedMotionCommand(
                JUMP_FIXTURE_RELEASE_COMMAND as u16,
            )),
            None,
            None,
        );
        if cast_step == Some(0) {
            client.world.handle_message(&release);
        }
        let origin = client.world.scene.body(body_id).unwrap().pose.coords;
        client.world.handle_message(&vector_update_packet(
            remote_guid,
            Vector3::new(2.0, 1.0, 5.0),
            1,
            0,
        ));
        let mut trajectory = Vec::new();
        let mut landed = false;
        for step in 1..=120 {
            if cast_step == Some(step) {
                client.world.handle_message(&release);
            }
            now += dt;
            simulation::tick(
                now,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            let body = client.world.scene.body(body_id).unwrap();
            let playback = client
                .world
                .motion_runtimes
                .motion_playback(remote_guid)
                .unwrap();
            if cast_step.is_some_and(|start| step >= start) {
                assert_eq!(
                    playback.activity,
                    holtburger_world::motion::OrdinaryMotionActivity::Gesture
                );
                assert_eq!(
                    client
                        .world
                        .motion_runtimes
                        .state(remote_guid)
                        .unwrap()
                        .substate
                        .raw(),
                    JUMP_FIXTURE_RELEASE_COMMAND
                );
                assert_eq!(
                    playback.ordinary.unwrap().clip.animation_id(),
                    JUMP_FIXTURE_STAND_ANIMATION
                );
            }
            if body.contact == holtburger_world::ContactState::Grounded {
                landed = true;
                break;
            }
            assert_eq!(body.contact, holtburger_world::ContactState::Airborne);
            assert_eq!(
                playback.locomotion.unwrap().clip.animation_id(),
                JUMP_FIXTURE_FALLING_ANIMATION
            );
            trajectory.push((
                body.pose.coords - origin,
                body.pose.rotation,
                body.retained.velocity,
            ));
        }
        assert!(landed);
        assert!(trajectory.len() > 2);
        trajectories.push(trajectory);
    }
    assert_eq!(
        trajectories[0], trajectories[1],
        "casting before takeoff must preserve the physical arc and heading"
    );
    assert_eq!(
        trajectories[0], trajectories[2],
        "casting received airborne must preserve the physical arc and heading"
    );
}

#[test]
fn fixed_tick_remote_upward_vector_launches_once_and_selects_falling() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_2300);
    let remote_guid = Guid(0x0102_2301);
    let motion_table_id = 0x0900_0041;
    let player_pose = outdoor_pose(48.0, 48.0, 0.0);
    let remote_pose = outdoor_pose(52.0, 48.0, 0.0);
    client
        .world
        .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
    client
        .world
        .seed_local_player_entity(player_guid, "Player", player_pose);

    client.world.add_entity(remote_gravity_creature(
        remote_guid,
        remote_pose,
        motion_table_id,
    ));
    let motion_events = client.world.handle_message(&update_motion_packet(
        remote_guid,
        1,
        0,
        true,
        Some(InterpretedMotionCommand::RUN_FORWARD),
        Some(1.0),
        None,
    ));
    assert!(motion_events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMotionUpdated { guid, motion }
            if *guid == remote_guid
                && motion.snapshot().is_some_and(|snapshot| {
                    snapshot.forward_command == Some(InterpretedMotionCommand::RUN_FORWARD)
                })
    )));

    let body_id = SpatialBodyId::Entity(remote_guid);
    client
        .world
        .scene
        .set_dynamic_physical_body(
            body_id,
            Some(stable_dynamic_body_definition()),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let interest =
        SimulationSceneInterest::prefetch_neighborhood(player_pose, CLIENT_COLLISION_OWNER_RADIUS)
            .unwrap();
    let collision = collision_snapshot(
        interest.clone(),
        flat_collision_scene_for_interest(&interest),
    );
    let mut now = Instant::now();
    let dt = physics_dt();
    let support_deadline = now + Duration::from_secs(1);
    while now < support_deadline {
        simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        if client.world.scene.body(body_id).unwrap().contact
            == holtburger_world::ContactState::Grounded
            && ordinary_anim_id(&client.world, remote_guid) == Some(JUMP_FIXTURE_RUN_ANIMATION)
        {
            break;
        }
        now += dt;
    }
    assert_eq!(
        client.world.scene.body(body_id).unwrap().contact,
        holtburger_world::ContactState::Grounded
    );
    assert_eq!(
        ordinary_anim_id(&client.world, remote_guid),
        Some(JUMP_FIXTURE_RUN_ANIMATION)
    );

    let jump_velocity = Vector3::new(2.0, 1.0, 5.0);
    let jump_events =
        client
            .world
            .handle_message(&vector_update_packet(remote_guid, jump_velocity, 1, 0));
    assert!(jump_events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated { guid, velocity, .. }
            if *guid == remote_guid && *velocity == jump_velocity
    )));
    let ignored_duplicate = client.world.handle_message(&vector_update_packet(
        remote_guid,
        Vector3::new(99.0, 99.0, 99.0),
        1,
        0,
    ));
    assert!(ignored_duplicate.is_empty());
    assert_eq!(
        client.world.entities.get(remote_guid).unwrap().velocity,
        jump_velocity
    );
    assert_eq!(
        client.world.scene.body(body_id).unwrap().retained.velocity,
        jump_velocity
    );
    assert_eq!(
        client.world.entities.get(remote_guid).unwrap().acceleration,
        Vector3::new(0.0, 0.0, -9.8)
    );
    assert_eq!(
        client
            .world
            .resolve_body_projection_input(body_id)
            .unwrap()
            .retained,
        holtburger_world::RetainedBodyKinematics {
            velocity: jump_velocity,
            acceleration: Vector3::new(0.0, 0.0, -9.8),
            omega: Vector3::zero(),
        }
    );

    simulation::tick(
        now + dt,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    let launched = client.world.scene.body(body_id).unwrap().clone();
    assert_eq!(launched.contact, holtburger_world::ContactState::Airborne);
    assert!(launched.pose.coords.z > remote_pose.coords.z);
    assert!(launched.retained.velocity.z > 0.0);
    assert!(launched.retained.velocity.z < jump_velocity.z);
    assert_eq!(
        client
            .world
            .motion_runtimes
            .state(remote_guid)
            .unwrap()
            .substate,
        holtburger_world::motion::MotionCommand::FALLING
    );
    assert_eq!(
        ordinary_anim_id(&client.world, remote_guid),
        Some(JUMP_FIXTURE_TAKEOFF_ANIMATION),
        "the observer must enter the table-authored takeoff transition independently from its arc"
    );

    let duplicate_after_integration =
        client
            .world
            .handle_message(&vector_update_packet(remote_guid, jump_velocity, 1, 0));
    assert!(duplicate_after_integration.is_empty());
    assert_eq!(
        client.world.scene.body(body_id).unwrap().retained.velocity,
        launched.retained.velocity,
        "a duplicate observer packet must not reset gravity-integrated velocity"
    );
    for (velocity, instance_sequence, vector_sequence) in [
        (Vector3::new(88.0, 88.0, 88.0), 0, 0),
        (Vector3::new(77.0, 77.0, 77.0), 1, 2),
    ] {
        assert!(
            client
                .world
                .handle_message(&vector_update_packet(
                    remote_guid,
                    velocity,
                    vector_sequence,
                    instance_sequence,
                ))
                .is_empty(),
            "stale or wrong-instance vector samples must be handled without mutation"
        );
    }
    assert_eq!(
        client.world.scene.body(body_id).unwrap().retained.velocity,
        launched.retained.velocity
    );

    simulation::tick(
        now + dt + dt,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    let continued = client.world.scene.body(body_id).unwrap();
    assert_eq!(continued.contact, holtburger_world::ContactState::Airborne);
    assert!(continued.pose.coords.z > launched.pose.coords.z);
    assert!(continued.retained.velocity.z < launched.retained.velocity.z);
    assert_eq!(
        ordinary_anim_id(&client.world, remote_guid),
        Some(JUMP_FIXTURE_TAKEOFF_ANIMATION)
    );

    let mut falling_step = None;
    for step in 3..=20 {
        simulation::tick(
            now + dt * step,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        if ordinary_anim_id(&client.world, remote_guid) == Some(JUMP_FIXTURE_FALLING_ANIMATION) {
            assert_eq!(
                client.world.scene.body(body_id).unwrap().contact,
                holtburger_world::ContactState::Airborne,
                "the Falling clip must be observed during the physical arc"
            );
            falling_step = Some(step);
            break;
        }
    }
    let falling_step = falling_step.expect("takeoff must advance into the Falling cycle");
    assert_eq!(
        ordinary_anim_id(&client.world, remote_guid),
        Some(JUMP_FIXTURE_FALLING_ANIMATION),
        "the observer must visibly play Falling instead of sliding in its run cycle"
    );

    let mut landed = false;
    let mut landing_step = 0;
    for step in (falling_step + 1)..=240 {
        simulation::tick(
            now + dt * step,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        if client.world.scene.body(body_id).unwrap().contact
            == holtburger_world::ContactState::Grounded
        {
            landed = true;
            landing_step = step;
            break;
        }
    }
    assert!(landed, "remote jump should return to flat support");
    assert_eq!(
        client
            .world
            .motion_runtimes
            .state(remote_guid)
            .unwrap()
            .substate,
        holtburger_world::motion::MotionCommand::RUN_FORWARD,
        "remote landing should restore the server-authored locomotion snapshot"
    );
    assert_eq!(
        ordinary_anim_id(&client.world, remote_guid),
        Some(JUMP_FIXTURE_LANDING_ANIMATION),
        "remote support recovery must start the authored landing transition"
    );
    simulation::tick(
        now + dt * (landing_step + 1),
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert_eq!(
        ordinary_anim_id(&client.world, remote_guid),
        Some(JUMP_FIXTURE_RUN_ANIMATION),
        "the authored landing transition must complete into the server's held run"
    );

    client
        .world
        .handle_message(&idle_motion_packet(remote_guid, 2, true));
    client.world.advance_authored_motion(Duration::ZERO);
    assert_eq!(
        client
            .world
            .motion_runtimes
            .state(remote_guid)
            .unwrap()
            .substate,
        holtburger_world::motion::MotionCommand(FIXTURE_STAND_COMMAND),
        "the next launch must begin from initialized style-zero idle authority"
    );

    let correction_start = now + dt * (landing_step + 2);
    let second_jump_velocity = Vector3::new(-1.0, 2.0, 4.0);
    let second_jump_events = client.world.handle_message(&vector_update_packet(
        remote_guid,
        second_jump_velocity,
        2,
        0,
    ));
    assert!(second_jump_events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated { guid, velocity, .. }
            if *guid == remote_guid && *velocity == second_jump_velocity
    )));
    simulation::tick(
        correction_start,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert_eq!(
        client.world.scene.body(body_id).unwrap().contact,
        holtburger_world::ContactState::Airborne
    );

    let airborne_before_stop = client.world.scene.body(body_id).unwrap().retained.velocity;
    let stop_events = client
        .world
        .handle_message(&idle_motion_packet(remote_guid, 3, true));
    assert!(
        stop_events.is_empty(),
        "repeating the retained idle order must not restart playback"
    );
    assert!(
        client
            .world
            .entities
            .get(remote_guid)
            .and_then(|entity| entity.network_motion.snapshot())
            .is_some_and(|snapshot| {
                snapshot.current_style == Some(MotionStance::NonCombat)
                    && snapshot.motion_command().is_none()
            })
    );
    assert_eq!(
        client.world.scene.body(body_id).unwrap().retained.velocity,
        airborne_before_stop,
        "an airborne stop changes future grounded presentation, not committed ballistics"
    );

    let corrected_pose = outdoor_pose(54.0, 48.0, 0.0);
    let correction_events =
        client
            .world
            .handle_message(&encoded_game_message(GameMessage::UpdatePosition(
                Box::new(UpdatePositionData {
                    guid: remote_guid,
                    pos: PositionPack {
                        flags: UpdatePositionFlag::HAS_CONTACT,
                        pos: corrected_pose,
                        instance_sequence: 0,
                        position_sequence: 1,
                        teleport_sequence: 1,
                        force_position_sequence: 0,
                        ..PositionPack::default()
                    },
                }),
            )));
    assert!(correction_events.iter().any(|event| matches!(
        event,
        WorldEvent::ForcedReposition { guid, pos, .. }
            if *guid == remote_guid && *pos == corrected_pose
    )));
    let corrected = client.world.scene.body(body_id).unwrap();
    assert_eq!(corrected.pose, corrected_pose);
    assert_eq!(corrected.retained.velocity, Vector3::zero());
    // Contact is a solver product. The reset clears the launch immediately, while the next
    // collision ticks reacquire support at the corrected pose.
    let mut settle_now = correction_start + dt;
    step_until_grounded(&mut client, body_id, &mut settle_now, dt, &collision, 30);
    let settled_correction = client.world.scene.body(body_id).unwrap();
    assert!((settled_correction.pose.coords.z - corrected_pose.coords.z).abs() < 0.000_01);
    assert_eq!(settled_correction.retained.velocity.x, 0.0);
    assert_eq!(settled_correction.retained.velocity.y, 0.0);
    assert!(
        settled_correction.retained.velocity.z <= 0.0,
        "support solve may retain its gravity sample but must not resurrect upward launch"
    );
}

#[test]
fn busy_operation_timeout_clears_state_and_emits_completion() {
    let mut client = builder::build_test_client(ClientState::Connected);
    let mut events = client.subscribe_client_view_events();

    assert!(
        client.arm_busy_operation(crate::client::PendingOperation::UseWithTarget {
            spell_target: None
        })
    );
    client.poll_busy_timeout(Instant::now() + BUSY_OPERATION_TIMEOUT + Duration::from_secs(1));

    assert!(client.character.active_busy_operation.is_none());

    let mut saw_busy_clear = false;
    let mut saw_timeout = false;
    while let Ok(event) = events.try_recv() {
        match event {
            ClientViewEvent::BusyStateUpdated { busy: None } => saw_busy_clear = true,
            ClientViewEvent::BusyOperationFinished {
                operation: BusyOperationKind::UseWithTarget,
                result: BusyOperationResult::TimedOut,
            } => saw_timeout = true,
            _ => {}
        }
    }

    assert!(saw_busy_clear);
    assert!(saw_timeout);
}

#[test]
fn arm_busy_operation_rejects_overlap_and_preserves_original_pending_state() {
    let mut client = builder::build_test_client(ClientState::Connected);

    assert!(
        client.arm_busy_operation(crate::client::PendingOperation::UseWithTarget {
            spell_target: None
        })
    );
    assert!(
        !client.arm_busy_operation(crate::client::PendingOperation::SpellCast { target: None })
    );

    assert!(matches!(
        client.character.active_busy_operation,
        Some(PendingBusyOperation {
            operation: PendingOperation::UseWithTarget { spell_target: None },
            ..
        })
    ));
}

#[test]
fn fellowship_activity_is_only_projected_after_entering_world() {
    let mut client = builder::build_test_client(ClientState::EnteringWorld);
    let mut events = client.subscribe_client_view_events();

    client.handle_world_event(&WorldEvent::FellowshipActivity(
        FellowshipActivity::MemberJoined {
            member_name: "Bravo".to_string(),
        },
    ));

    assert!(events.try_recv().is_err());
}

#[test]
fn fellowship_activity_projects_when_in_world() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();

    client.handle_world_event(&WorldEvent::FellowshipActivity(
        FellowshipActivity::MemberLeft {
            member_name: "Bravo".to_string(),
        },
    ));

    let saw_activity = std::iter::from_fn(|| events.try_recv().ok()).any(|event| {
        matches!(
            event,
            ClientViewEvent::FellowshipActivity {
                activity: FellowshipActivity::MemberLeft { member_name }
            } if member_name == "Bravo"
        )
    });
    assert!(saw_activity);
}

#[test]
fn inventory_server_save_failed_projection_preserves_item_guid() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();
    let item_guid = Guid(0x4000_0001);

    client.emit_action_result(
        ActionResultSource::Wire,
        ActionResultReason::InventoryServerSaveFailed {
            item_guid,
            error: holtburger_protocol::errors::WeenieError::YoureTooBusy,
        },
    );

    let saw_projected_event = std::iter::from_fn(|| events.try_recv().ok()).any(|event| {
        if let ClientViewEvent::ActionResult {
            source: ActionResultSource::Wire,
            reason:
                ActionResultReason::InventoryServerSaveFailed {
                    item_guid: projected_item_guid,
                    error,
                },
        } = event
        {
            assert_eq!(projected_item_guid, item_guid);
            assert_eq!(
                error,
                holtburger_protocol::errors::WeenieError::YoureTooBusy
            );
            true
        } else {
            false
        }
    });
    assert!(saw_projected_event);
}

#[test]
fn entity_vector_updates_project_to_client_view_kinematics() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();
    let guid = Guid(0x5000_0001);
    let velocity = Vector3::new(1.0, 2.0, 3.0);
    let omega = Vector3::new(0.0, 0.0, 4.0);

    client.handle_world_event(&WorldEvent::EntityVectorUpdated {
        guid,
        velocity,
        omega,
    });

    let saw_kinematics = std::iter::from_fn(|| events.try_recv().ok()).any(|event| {
        matches!(
            event,
            ClientViewEvent::EntityKinematicsUpdated {
                guid: event_guid,
                velocity: event_velocity,
                omega: event_omega,
            } if event_guid == guid && event_velocity == velocity && event_omega == omega
        )
    });
    assert!(saw_kinematics);
}

#[test]
fn player_entity_projection_emits_self_movement_kinematics_update() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();
    let player_guid = Guid(0x5000_0001);
    let capabilities = test_self_movement_capabilities(4.5, 1.0, 2.0, 1.5);
    let expected_kinematics = capabilities.kinematics().clone();

    client.world.player.guid = player_guid;
    client
        .world
        .set_self_movement_capabilities_override(capabilities);

    client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ))));

    let saw_kinematics = std::iter::from_fn(|| events.try_recv().ok()).any(|event| {
        matches!(
            event,
            ClientViewEvent::SelfMovementKinematicsUpdated {
                kinematics: Some(event_kinematics)
            } if event_kinematics == expected_kinematics
        )
    });
    assert!(saw_kinematics);
}

#[test]
fn player_entity_projection_emits_empty_self_movement_kinematics_when_resolution_fails() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();
    let player_guid = Guid(0x5000_0001);

    client.world.player.guid = player_guid;
    client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ))));

    let saw_kinematics_none = std::iter::from_fn(|| events.try_recv().ok()).any(|event| {
        matches!(
            event,
            ClientViewEvent::SelfMovementKinematicsUpdated { kinematics: None }
        )
    });
    assert!(saw_kinematics_none);
}

#[test]
fn repeated_self_movement_capability_failures_do_not_emit_client_errors() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let mut events = client.subscribe_client_view_events();
    let player_guid = Guid(0x5000_0001);

    client.world.player.guid = player_guid;

    let entity = Box::new(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));
    client.handle_world_event(&WorldEvent::EntitySpawned(entity.clone()));
    client.handle_world_event(&WorldEvent::EntityReplaced(entity));

    while let Ok(event) = events.try_recv() {
        assert!(!matches!(event, ClientViewEvent::ActionResult { .. }));
    }
}

#[test]
fn sync_server_time_updates_world_state_and_emits_client_view_event() {
    let mut client = builder::build_test_client(ClientState::EnteringWorld);
    let mut events = client.subscribe_client_view_events();
    let synced_at = Instant::now();
    let server_time = 289_184_283.365_664_66;

    client.sync_server_time(server_time, synced_at);

    let sync = client
        .world
        .server_time
        .as_ref()
        .expect("server time should be recorded");
    assert_eq!(sync.server_time, server_time);
    assert_eq!(sync.local_time, synced_at);

    let saw_event = std::iter::from_fn(|| events.try_recv().ok()).any(
        |event| matches!(event, ClientViewEvent::ServerTimeUpdated { time } if time == server_time),
    );
    assert!(saw_event);
}

#[test]
fn simulation_build_projection_returns_none_without_projectable_remote() {
    let client = builder::build_test_client(ClientState::InWorld);
    assert!(simulation::build_projection_request(&client.world).is_none());
}

#[tokio::test]
async fn simulation_build_projection_discovers_nearby_actor() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_0304);
    let remote_guid = Guid(0x0102_0305);
    let now = Instant::now();

    seed_test_self_movement_capabilities(&mut client);

    client
        .world
        .seed_local_player_entity(player_guid, "Player", outdoor_pose(0.0, 0.0, 0.0));
    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_string(),
        outdoor_pose(8.0, 0.0, 0.0),
    );
    remote.velocity = Vector3::new(1.0, 0.0, 0.0);
    client.world.add_entity(remote);

    client.movement.enqueue_drive_intent(
        movement_types::PlayerDriveIntent::ManualHeld(
            movement_types::CharacterDrive::builder()
                .run()
                .forward()
                .build(),
        ),
        now,
    );

    let _ = client
        .movement
        .tick(now, &mut client.world, &mut client.session)
        .await
        .expect("movement tick should succeed");

    let request = simulation::build_projection_request(&client.world)
        .expect("nearby actor should join the solve set");

    assert_eq!(request.bodies.len(), 1);
    assert!(
        request
            .bodies
            .iter()
            .any(|body| body.body_id == SpatialBodyId::Entity(remote_guid))
    );
}

#[test]
fn simulation_build_projection_discovers_grounded_actor_without_vector_update() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_1304);
    let remote_guid = Guid(0x0102_1305);
    let motion_table_id = 0x0900_0040;

    client
        .world
        .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
    client
        .world
        .seed_local_player_entity(player_guid, "Player", outdoor_pose(0.0, 0.0, 0.0));

    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_string(),
        outdoor_pose(8.0, 0.0, 0.0),
    );
    remote
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    remote.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
        sidestep_command: None,
        turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
        forward_speed: OrderedMotionScalar::from_f32(3.5),
        sidestep_speed: None,
        turn_speed: OrderedMotionScalar::from_f32(0.75),
        directive: None,
    });
    client.world.add_entity(remote);

    client.world.advance_authored_motion(physics_dt());
    let request = simulation::build_projection_request(&client.world)
        .expect("grounded remote should join the solve set");

    let remote_body = request
        .bodies
        .iter()
        .find(|body| body.body_id == SpatialBodyId::Entity(remote_guid))
        .expect("grounded remote should be present");

    assert!(
        remote_body.authored_offset.is_some(),
        "a grounded remote performing a motion drives from its authored offset"
    );
}

#[tokio::test]
async fn simulation_tick_leaves_a_pose_only_local_player_authoritative() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let guid = Guid(0x0102_0304);
    let now = Instant::now();
    let player_pose = outdoor_pose(0.0, 0.0, 0.0);

    seed_test_self_movement_capabilities(&mut client);
    client
        .world
        .seed_local_player_entity(guid, "Player", player_pose);

    client.movement.enqueue_drive_intent(
        movement_types::PlayerDriveIntent::ManualHeld(
            movement_types::CharacterDrive::builder()
                .run()
                .forward()
                .build(),
        ),
        now,
    );

    let _ = client
        .movement
        .tick(now, &mut client.world, &mut client.session)
        .await
        .expect("movement tick should succeed");

    let events = simulation::tick(
        now,
        physics_dt(),
        &mut client.world,
        &mut client.movement,
        None,
    )
    .expect("pose-only simulation should not fail");

    let authoritative_pose = client
        .world
        .player_position()
        .expect("local player entity should exist");
    assert_eq!(authoritative_pose.landblock_id, Guid(0x1000_0001));
    assert!(authoritative_pose.coords.y.abs() <= f32::EPSILON);
    let body = client
        .world
        .scene
        .body(SpatialBodyId::LocalPlayer(guid))
        .expect("local player runtime body should exist after solve");
    assert_eq!(body.pose, player_pose);
    assert!(!events.events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged {
            body_id: SpatialBodyId::LocalPlayer(_)
        }
    )));
}

#[test]
fn stationary_nonintegrating_body_publishes_refreshed_cell_membership() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let guid = Guid(0x0102_0304);
    let pose = pose_at(0x1000_0100, 12.0, 12.0, 1.0);
    client.world.seed_local_player_entity(guid, "Player", pose);
    let entity = client.world.entities.get_mut(guid).unwrap();
    entity.wcid = Some(42);
    entity.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let definition = stable_dynamic_body_definition().definition().clone();
    client
        .world
        .scene
        .set_dynamic_physical_body(
            body_id,
            Some(
                DynamicPhysicalBodyConfiguration::new(
                    definition,
                    LocalPhysicalDemand {
                        target: LocalTargetDemand::Retained,
                        integration: LocalIntegrationDemand::Excluded,
                    },
                )
                .unwrap(),
            ),
            PhysicalCollisionFilter::ALL,
            Some(pose.landblock_id),
        )
        .unwrap();
    let before = client.capture_dynamic_entity_tick_cursor();
    let before_membership = client
        .world
        .scene
        .body(body_id)
        .unwrap()
        .spatial_membership();
    let mut scene = CollisionScene::new();
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: 0x1000_ffff,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(
                Vec::new(),
                vec![holtburger_content::CellVolume {
                    visibility: holtburger_content::CellVisibility {
                        visible_cell_selectors: Vec::new(),
                        seen_outside: false,
                    },
                    cell_selector: 0x0100,
                    placement: holtburger_content::LandblockPlacement {
                        origin: Vector3::zero(),
                        orientation: Quaternion::identity(),
                    },
                    planes: Vec::new(),
                    portals: vec![holtburger_content::CellCollisionPortal {
                        plane: holtburger_common::Plane {
                            normal: Vector3::new(1.0, 0.0, 0.0),
                            d: -12.0,
                        },
                        aperture_vertices: Vec::new(),
                        reciprocal_visibility_vertices: None,
                        positive_side: true,
                        target: holtburger_content::CellCollisionPortalTarget::Outdoor,
                        outdoor_building: None,
                    }],
                }],
            ),
        })
        .unwrap();
    let interest =
        SimulationSceneInterest::prefetch_neighborhood(pose, CLIENT_COLLISION_OWNER_RADIUS)
            .unwrap();
    let collision = collision_snapshot(interest, scene);
    let tick = simulation::tick(
        Instant::now(),
        physics_dt(),
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    assert!(
        tick.body_motions.is_empty(),
        "excluded body must not integrate"
    );
    let body = client.world.scene.body(body_id).unwrap();
    assert_eq!(body.pose, pose);
    assert_ne!(body.spatial_membership(), before_membership);
    let batch = client
        .dynamic_entity_tick_batch(
            before,
            || DynamicEntityHostTime::new(1.0).unwrap(),
            30.0,
            &tick.body_motions,
        )
        .unwrap()
        .unwrap();
    assert!(batch.advances.is_empty());
    assert_eq!(batch.updates.len(), 1);
    let crate::DynamicEntityPlacementView::World {
        pose: published,
        spatial_membership,
        ..
    } = &batch.updates[0].placement
    else {
        panic!("expected world placement")
    };
    assert_eq!(*published, pose);
    assert_eq!(
        spatial_membership.reached_env_cell_ids,
        vec![pose.landblock_id]
    );
}

#[tokio::test]
async fn mouse_turning_preserves_player_path_and_boom_reach() {
    for drive in [
        movement_types::CharacterDrive::default(),
        movement_types::CharacterDrive::builder()
            .run()
            .forward()
            .build(),
        movement_types::CharacterDrive::builder()
            .run()
            .turn_right()
            .build(),
    ] {
        let (mut client, collision, _) = floor_contact_publication();
        let guid = client.world.player.guid;
        const MOTION_TABLE_ID: u32 = 0x0900_0091;
        client
            .world
            .set_motion_sequences(jump_presentation_motion_catalog(MOTION_TABLE_ID));
        client
            .world
            .player_entity_mut()
            .unwrap()
            .set_did_prop(PropertyDataId::MotionTable, Guid(MOTION_TABLE_ID));
        seed_test_self_movement_capabilities(&mut client);
        seed_test_jump_authority(&mut client);
        let body_id = SpatialBodyId::LocalPlayer(guid);
        client
            .world
            .scene
            .set_dynamic_physical_body(
                body_id,
                Some(stable_dynamic_body_definition()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let mut body = client.world.scene.body(body_id).unwrap().clone();
        body.retained = Default::default();
        client.world.scene.update_body(body).unwrap();
        let dt = physics_dt();
        let mut now = Instant::now();
        // Settle the grounded actor before measuring camera continuity.
        let ticks = Duration::from_secs(1).as_nanos().div_ceil(dt.as_nanos()) as usize;
        step_ticks(&mut client, &mut now, dt, &collision, ticks);
        assert_eq!(
            client.world.scene.body(body_id).unwrap().contact,
            holtburger_world::ContactState::Grounded
        );
        let mut camera = camera::ClientCameraRuntime::new().unwrap();
        let request = ClientCameraStartRequest {
            player_guid: guid,
            entity_generation: u64::from(client.world.player_entity().unwrap().instance_sequence()),
            initial_reach: 4.5,
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            input_sequence: 0,
            view_direction: [0.0, 0.0, 1.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.2,
        };
        let identity = camera.start(request, &client.world).unwrap().identity;
        let input = camera::ClientCameraSceneInput::capture(&client.world, Some(&collision), None);
        for _ in 0..100 {
            camera.advance(&input, dt).unwrap().unwrap();
        }
        if !drive.is_stationary() {
            client
                .movement
                .enqueue_drive_intent(movement_types::PlayerDriveIntent::ManualHeld(drive), now);
        }
        for sequence in 1..=30 {
            let previous = client.world.local_player_runtime_pose().unwrap();
            client.movement.enqueue_drive_intent(
                movement_types::PlayerDriveIntent::RotateFacing { delta_radians: 0.1 },
                now,
            );
            let prepared = client.movement.prepare_tick(now, &mut client.world);
            client
                .movement
                .advance_tick(prepared, now, &mut client.world, &mut client.session)
                .await
                .unwrap();
            // Match live ordering: movement commands precede the dynamic publication baseline.
            let before = client.capture_dynamic_entity_tick_cursor();
            let tick = simulation::tick(
                now,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            assert!(tick.relative_facing_changed);
            assert!(
                client
                    .movement
                    .publish_position_after_simulation(
                        now,
                        &client.world,
                        &mut client.session,
                        tick.relative_facing_changed
                    )
                    .await
                    .unwrap()
            );
            assert!(
                !client
                    .movement
                    .publish_position_after_simulation(
                        now,
                        &client.world,
                        &mut client.session,
                        false
                    )
                    .await
                    .unwrap()
            );
            let batch = client
                .dynamic_entity_tick_batch(
                    before,
                    || DynamicEntityHostTime::new(sequence as f64).unwrap(),
                    dt.as_secs_f64() * 1000.0,
                    &tick.body_motions,
                )
                .unwrap();
            let pose = client.world.local_player_runtime_pose().unwrap();
            assert_ne!(pose.rotation, previous.rotation);
            let input = camera::ClientCameraSceneInput::capture(
                &client.world,
                Some(&collision),
                batch.as_ref(),
            );
            let c = std::f32::consts::FRAC_1_SQRT_2;
            let direction = pose.rotation.rotate_vector(Vector3::new(0.0, -c, c));
            camera
                .set_intent(ClientCameraIntentRequest {
                    camera_generation: identity.camera_generation,
                    player_guid: guid,
                    entity_generation: identity.entity_generation,
                    input_sequence: sequence,
                    view_direction: [direction.x, direction.y, direction.z],
                    cumulative_zoom_displacement: 0.0,
                })
                .unwrap();
            let result = camera.advance(&input, dt).unwrap().unwrap();
            let ClientCameraTick::Advanced { rendered_reach, .. } = result else {
                panic!("continuous mouse turning reset the boom: {result:?}");
            };
            assert!(
                rendered_reach >= request.minimum_reach,
                "mouse turning collapsed the boom: {rendered_reach}"
            );
            let batch = batch.expect("physical turning must publish its accepted path");
            let advance = batch
                .advances
                .iter()
                .find(|advance| advance.entity.identity.guid == guid)
                .unwrap();
            assert_eq!(
                advance.kind,
                crate::DynamicEntityPlacementAdvanceKind::Integrated
            );
            assert_eq!(advance.path.initial.pose, previous);
            let end = advance.path.legs.last().unwrap().end.pose;
            assert_eq!(end.landblock_id, pose.landblock_id);
            assert_eq!(end.coords, pose.coords);
            // Path interpolation normalizes endpoint quaternions; compare orientation,
            // not their f32 component representation.
            let forward = Vector3::new(0.0, 1.0, 0.0);
            assert!(
                (end.rotation.rotate_vector(forward) - pose.rotation.rotate_vector(forward))
                    .length()
                    < 1e-5
            );
            now += dt;
        }
    }
}

/// Runs real free-body integration into a floor, producing a bent accepted route.
pub(super) fn floor_contact_publication() -> (
    ClientRuntime,
    SimulationSceneSnapshot,
    crate::DynamicEntityTickBatch,
) {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let guid = Guid(0x0102_0304);
    let pose = outdoor_pose(12.0, 12.0, 0.55);
    client.world.seed_local_player_entity(guid, "Player", pose);
    client
        .world
        .entities
        .get_mut(guid)
        .unwrap()
        .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
    client.world.entities.get_mut(guid).unwrap().wcid = Some(42);
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let definition = PhysicalBodyDefinition::free_sphere(
        PhysicalSphereSet::new(
            holtburger_common::Sphere {
                center: Vector3::zero(),
                radius: 0.5,
            },
            None,
        )
        .unwrap(),
    )
    .unwrap();
    client
        .world
        .scene
        .set_dynamic_physical_body(
            body_id,
            Some(dynamic_definition(
                definition,
                PhysicalBodyResponsePolicy {
                    restitution: PhysicalRestitution::Elastic(PhysicalElasticity::MAXIMUM),
                    friction: PhysicalFriction::new(0.0).unwrap(),
                    surface_motion: PhysicalSurfaceMotion::Stable,
                    align_path: false,
                },
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let mut body = client.world.scene.body(body_id).unwrap().clone();
    body.retained.velocity = Vector3::new(3.0, 0.0, -4.0);
    client.world.scene.update_body(body).unwrap();
    let interest =
        SimulationSceneInterest::prefetch_neighborhood(pose, CLIENT_COLLISION_OWNER_RADIUS)
            .unwrap();
    let collision = collision_snapshot(
        interest.clone(),
        flat_collision_scene_for_interest(&interest),
    );
    client.world.tick(None);
    let before = client.capture_dynamic_entity_tick_cursor();
    let dt = physics_dt();
    let tick = simulation::tick(
        Instant::now(),
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    let simulation::ClientBodyMotion::Physical { path: accepted, .. } = &tick.body_motions[&guid]
    else {
        panic!("expected a physical route")
    };
    assert!(
        accepted.legs().len() > 1,
        "fixture must exercise intermediate geometry"
    );
    let batch = client
        .dynamic_entity_tick_batch(
            before,
            || DynamicEntityHostTime::new(1.0).unwrap(),
            dt.as_secs_f64() * 1000.0,
            &tick.body_motions,
        )
        .unwrap()
        .unwrap();
    let path = &batch.advances[0].path;
    assert_eq!(path.legs.len(), accepted.legs().len());
    for (published, solved) in path.legs.iter().zip(accepted.legs()) {
        assert_eq!(published.end_fraction, solved.end_fraction());
        assert_eq!(published.end.pose.coords, solved.end().center());
        assert_eq!(
            published.end.spatial_membership,
            crate::DynamicEntitySpatialMembership::from(solved.end().placement())
        );
    }
    let intermediate = &path.legs[0];
    let endpoint = path.legs.last().unwrap().end.pose.coords;
    let chord = pose.coords + (endpoint - pose.coords) * intermediate.end_fraction;
    assert!(
        (intermediate.end.pose.coords - chord).length() > 0.001,
        "endpoint-only publication must fail this fixture"
    );
    let wire = serde_json::to_string(&batch).unwrap();
    let batch: crate::DynamicEntityTickBatch = serde_json::from_str(&wire).unwrap();
    (client, collision, batch)
}

#[tokio::test]
async fn simulation_tick_advances_remote_projection_while_local_player_is_suspended() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_0304);
    let remote_guid = Guid(0x0102_0305);
    let now = Instant::now();
    let player_pose = outdoor_pose(0.0, 0.0, 0.0);

    seed_test_self_movement_capabilities(&mut client);
    client
        .world
        .seed_local_player_entity(player_guid, "Player", player_pose);
    let remote_start = Vector3::new(8.0, 0.0, 0.0);
    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_string(),
        outdoor_pose(8.0, 0.0, 0.0),
    );
    remote.velocity = Vector3::new(2.0, 0.0, 0.0);
    remote.wcid = Some(1);
    remote
        .properties
        .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
    remote
        .physics
        .reconcile(holtburger_world::resolve_effective_entity_physics_state(
            PhysicsState::STATIC,
        ));
    client.world.add_entity(remote);

    client.movement.enqueue_drive_intent(
        movement_types::PlayerDriveIntent::ManualHeld(
            movement_types::CharacterDrive::builder()
                .run()
                .forward()
                .build(),
        ),
        now,
    );

    let _ = client
        .movement
        .tick(now, &mut client.world, &mut client.session)
        .await
        .expect("movement tick should succeed");

    let events = simulation::tick(
        now,
        physics_dt(),
        &mut client.world,
        &mut client.movement,
        None,
    )
    .expect("pose-only simulation should not fail");

    let remote_after = client
        .world
        .scene
        .body(SpatialBodyId::Entity(remote_guid))
        .expect("remote body should still exist after solve");
    let player_body = client
        .world
        .scene
        .body(SpatialBodyId::LocalPlayer(player_guid))
        .expect("local player runtime body should exist after solve");
    assert_eq!(player_body.pose, player_pose);
    assert!(remote_after.pose.coords.x > remote_start.x);
    assert!(!events.events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged {
            body_id: SpatialBodyId::LocalPlayer(_)
        }
    )));
    assert!(events.events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyAdvanced {
            body_id: SpatialBodyId::Entity(event_guid),
            ..
        } if *event_guid == remote_guid
    )));
}

#[tokio::test]
async fn prepared_remote_body_lands_on_terrain_instead_of_dead_reckoning_through_it() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_0304);
    let remote_guid = Guid(0x0102_0305);
    let drop_pose = outdoor_pose(48.0, 48.0, 2.0);
    client
        .world
        .seed_local_player_entity(player_guid, "Player", drop_pose);
    let mut remote = Entity::new(remote_guid, "Remote".to_owned(), drop_pose);
    remote.velocity = Vector3::new(0.0, 0.0, -0.8);
    remote.acceleration = Vector3::new(0.0, 0.0, -9.8);
    client.world.add_entity(remote);

    let body_id = SpatialBodyId::Entity(remote_guid);
    client
        .world
        .scene
        .set_dynamic_physical_body(
            body_id,
            Some(stable_dynamic_body_definition()),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let interest =
        SimulationSceneInterest::prefetch_neighborhood(drop_pose, CLIENT_COLLISION_OWNER_RADIUS)
            .unwrap();
    let collision = collision_snapshot(
        interest.clone(),
        flat_collision_scene_for_interest(&interest),
    );
    let dt = physics_dt();
    let mut now = Instant::now() + dt;
    step_ticks(&mut client, &mut now, dt, &collision, 50);

    let landed = client.world.scene.body(body_id).unwrap();
    assert_eq!(landed.contact, holtburger_world::ContactState::Grounded);
    assert!(
        landed.pose.coords.z >= -0.001,
        "remote fell below terrain: {landed:?}"
    );
}

#[test]
fn direct_projection_discovery_sees_remote_vector_changes() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_0304);
    let remote_guid = Guid(0x0102_0305);

    client
        .world
        .seed_local_player_entity(player_guid, "Player", outdoor_pose(0.0, 0.0, 0.0));
    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_string(),
        outdoor_pose(12.0, 0.0, 0.0),
    );
    remote.velocity = Vector3::new(1.0, 0.0, 0.0);
    client.world.add_entity(remote);

    let runtime_events =
        client
            .world
            .apply_solved_body_kinematics(&holtburger_world::SolvedBodyKinematics {
                body_id: SpatialBodyId::Entity(remote_guid),
                pose: outdoor_pose(12.5, 0.0, 0.0),
                accepted_motion: holtburger_world::AcceptedBodyMotion::default(),
                retained: holtburger_world::RetainedBodyKinematics {
                    velocity: Vector3::new(1.0, 0.0, 0.0),
                    ..Default::default()
                },
                contact: holtburger_world::ContactState::Grounded,
                projection_state: None,
            });
    assert!(!runtime_events.is_empty());

    let request = simulation::build_projection_request(&client.world);
    assert!(request.is_some());
    assert!(
        request
            .expect("remote mover should produce a solve request")
            .bodies
            .iter()
            .any(|body| body.body_id == SpatialBodyId::Entity(remote_guid))
    );
}

#[test]
fn direct_projection_discovery_sees_grounded_authored_motion() {
    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_2304);
    let remote_guid = Guid(0x0102_2305);
    let motion_table_id = 0x0900_0050;

    client
        .world
        .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
    client
        .world
        .seed_local_player_entity(player_guid, "Player", outdoor_pose(0.0, 0.0, 0.0));

    let mut remote = Entity::new(
        remote_guid,
        "Remote".to_string(),
        outdoor_pose(12.0, 0.0, 0.0),
    );
    remote
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
    remote.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
        sidestep_command: None,
        turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
        forward_speed: OrderedMotionScalar::from_f32(3.5),
        sidestep_speed: None,
        turn_speed: OrderedMotionScalar::from_f32(0.75),
        directive: None,
    });
    client.world.add_entity(remote);

    client.world.advance_authored_motion(physics_dt());
    let request = simulation::build_projection_request(&client.world);

    assert!(request.is_some());
    assert!(
        request
            .expect("grounded remote should produce a solve request")
            .bodies
            .iter()
            .any(|body| body.body_id == SpatialBodyId::Entity(remote_guid))
    );
}

#[test]
fn remote_non_contact_recovery_parks_tracks_and_unparks_cleanly_in_tick_batch() {
    use holtburger_protocol::messages::{
        GameMessage, PositionPack, UpdatePositionData, UpdatePositionFlag,
    };
    use holtburger_world::{ContactState, SpatialSampleMode};

    let mut client = builder::build_test_client(ClientState::InWorld);
    let player_guid = Guid(0x0102_3304);
    let remote_guid = Guid(0x0102_3305);
    let player_pose = outdoor_pose(40.0, 48.0, 0.0);
    let remote_start = outdoor_pose(48.0, 48.0, 0.0);
    client
        .world
        .seed_local_player_entity(player_guid, "Player", player_pose);
    let mut remote = Entity::new(remote_guid, "Remote".to_owned(), remote_start);
    remote.wcid = Some(42);
    remote.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
    client.world.add_entity(remote);

    let remote_body_id = SpatialBodyId::Entity(remote_guid);
    client
        .world
        .scene
        .set_dynamic_physical_body(
            remote_body_id,
            Some(stable_dynamic_body_definition()),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();

    let interest =
        SimulationSceneInterest::prefetch_neighborhood(player_pose, CLIENT_COLLISION_OWNER_RADIUS)
            .unwrap();
    let collision = collision_snapshot(
        interest.clone(),
        flat_collision_scene_for_interest(&interest),
    );
    let dt = physics_dt();
    let mut now = Instant::now() + dt;
    let mut host_secs = 0.0_f64;

    // Settle remote body on flat terrain first.
    step_ticks(&mut client, &mut now, dt, &collision, 15);
    let grounded_pose = client.world.scene.body(remote_body_id).unwrap().pose;
    assert_eq!(
        client.world.scene.body(remote_body_id).unwrap().contact,
        holtburger_world::ContactState::Grounded
    );

    // Deliver a settled non-contact floating pose (simulating reduced-collision client elevation).
    let floating = outdoor_pose(52.0, 48.0, grounded_pose.coords.z + 4.5);
    client
        .world
        .handle_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
            guid: remote_guid,
            pos: PositionPack {
                pos: floating,
                position_sequence: 1,
                flags: UpdatePositionFlag::NONE,
                ..Default::default()
            },
        })));

    let mut parked_snap_seen = false;
    for _ in 0..100 {
        let before = client.capture_dynamic_entity_tick_cursor();
        now += dt;
        host_secs += dt.as_secs_f64();
        let tick = simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        let batch = client
            .dynamic_entity_tick_batch(
                before,
                || DynamicEntityHostTime::new(host_secs).unwrap(),
                dt.as_secs_f64() * 1_000.0,
                &tick.body_motions,
            )
            .expect("dynamic_entity_tick_batch must succeed across parking ticks");
        if let Some(batch) = batch
            && batch.advances.iter().any(|advance| {
                advance.entity.identity.guid == remote_guid
                    && advance.kind == crate::DynamicEntityPlacementAdvanceKind::CorrectionSnap
            })
        {
            parked_snap_seen = true;
            break;
        }
    }
    assert!(
        parked_snap_seen,
        "floating remote must park with a CorrectionSnap"
    );
    let body = client.world.scene.body(remote_body_id).unwrap();
    assert_eq!(body.sampling.mode, SpatialSampleMode::AuthoritativeOnly);
    assert_eq!(body.contact, ContactState::Unknown);
    assert!(body.pose.distance_to(&floating) < 0.01);

    // Track another non-contact update while parked and verify subsequent tick batches stay valid.
    let floating_next = outdoor_pose(54.0, 48.0, grounded_pose.coords.z + 4.5);
    let events = client
        .world
        .handle_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
            guid: remote_guid,
            pos: PositionPack {
                pos: floating_next,
                position_sequence: 2,
                flags: UpdatePositionFlag::NONE,
                ..Default::default()
            },
        })));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged { body_id } if *body_id == remote_body_id
    )));
    for _ in 0..5 {
        let before = client.capture_dynamic_entity_tick_cursor();
        now += dt;
        host_secs += dt.as_secs_f64();
        let tick = simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        client
            .dynamic_entity_tick_batch(
                before,
                || DynamicEntityHostTime::new(host_secs).unwrap(),
                dt.as_secs_f64() * 1_000.0,
                &tick.body_motions,
            )
            .expect("parked ticks and placement refresh must not fail tick batch invariants");
    }
    assert!(
        client
            .world
            .scene
            .body(remote_body_id)
            .unwrap()
            .pose
            .distance_to(&floating_next)
            < 0.01
    );

    // Move remote onto clear supported ground -> must unpark cleanly on the next tick.
    let clear_ground = outdoor_pose(56.0, 48.0, grounded_pose.coords.z);
    client
        .world
        .handle_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
            guid: remote_guid,
            pos: PositionPack {
                pos: clear_ground,
                position_sequence: 3,
                flags: UpdatePositionFlag::NONE,
                ..Default::default()
            },
        })));
    let before = client.capture_dynamic_entity_tick_cursor();
    now += dt;
    host_secs += dt.as_secs_f64();
    let tick = simulation::tick(
        now,
        dt,
        &mut client.world,
        &mut client.movement,
        Some(&collision),
    )
    .unwrap();
    let _ = client
        .dynamic_entity_tick_batch(
            before,
            || DynamicEntityHostTime::new(host_secs).unwrap(),
            dt.as_secs_f64() * 1_000.0,
            &tick.body_motions,
        )
        .expect("unpark tick batch must succeed");
    let unparked = client.world.scene.body(remote_body_id).unwrap();
    assert_eq!(
        unparked.sampling.mode,
        SpatialSampleMode::SimulatingVelocity
    );
    assert!(unparked.pose.distance_to(&clear_ground) < 0.01);
}

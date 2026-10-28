use super::*;
use std::io::Cursor;

use holtburger_common::properties::{ObjectDescriptionFlag, PhysicsState};
use holtburger_common::{Quaternion, Sphere, Vector3, position::WorldPosition};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, HbaStreamWriter, file_type::SetupModel};
use holtburger_world::{
    PhysicalBodyDefinition, entity::Entity, resolve_effective_entity_physics_state,
};
use tempfile::TempDir;

mod room_motion;

const SETUP: u32 = 0x0200_0001;
const REMOTE: Guid = Guid(0x7000_0001);

fn facts() -> NavigationBodyFacts {
    NavigationBodyFacts {
        guid: REMOTE,
        instance_sequence: 0,
        setup_did: Some(SETUP),
        physics: resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
        object_scale: 1.0,
        is_contact_character: true,
        friction: None,
        elasticity: None,
    }
}

fn source(spheres: Vec<Sphere>) -> (TempDir, NavigationClientSource) {
    let sphere = Sphere {
        center: Vector3::zero(),
        radius: 0.5,
    };
    let setup = SetupModel {
        id: SETUP,
        flags: 0,
        // Deliberately absent resources: envelope preparation must never follow these links.
        parts: vec![0x0100_0001],
        parent_index: Vec::new(),
        default_scale: Vec::new(),
        holding_locations: Default::default(),
        connection_points: Default::default(),
        placement_frames: Default::default(),
        cyl_spheres: Vec::new(),
        spheres,
        height: 2.0,
        radius: 0.5,
        step_up: 0.6,
        step_down: 1.5,
        sorting_sphere: sphere,
        selection_sphere: sphere,
        lights: Vec::new(),
        default_animation: Some(0x0300_0001),
        default_script_did: Some(0x3300_0001),
        default_motion_table: Some(0x0900_0001),
        default_sound_table: None,
        default_script_table: None,
    };
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("bootstrap.hba");
    let mut bytes = Cursor::new(Vec::new());
    setup.pack(&mut bytes).unwrap();
    let mut writer = HbaStreamWriter::create(&path).unwrap();
    writer
        .add(EOR_PORTAL_NAMESPACE, SETUP, 0, bytes.into_inner())
        .unwrap();
    writer.finish().unwrap();
    let content = NavigationContent::open(path).unwrap();
    (temp, NavigationClientSource::new(Arc::new(content)))
}

#[test]
fn preparation_preserves_both_motion_spheres_without_models_or_scripts() {
    let spheres = vec![
        Sphere {
            center: Vector3::new(0.0, 0.0, 0.5),
            radius: 0.5,
        },
        Sphere {
            center: Vector3::new(0.0, 0.0, 1.5),
            radius: 0.4,
        },
    ];
    let (_temp, source) = source(spheres.clone());
    let facts = facts();
    let dimensions = source
        .content
        .bootstrap()
        .read_setup_dimension_catalog()
        .unwrap();
    assert_eq!(
        dimensions.get(SETUP),
        Some(holtburger_content::SetupDimensions {
            radius: 0.5,
            height: 2.0
        })
    );
    let definition = source.prepare_body(facts.clone()).unwrap();
    assert!(matches!(
        definition.movement,
        PhysicalBodyDefinition::Grounded { .. }
    ));
    let actual: Vec<_> = definition.movement.spheres().iter().collect();
    assert_eq!(actual.len(), spheres.len());
    for (actual, expected) in actual.iter().zip(spheres) {
        assert_eq!(actual.center, expected.center);
        assert_eq!(actual.radius, expected.radius);
    }
    let collision = definition.entity_collision;
    assert!(collision.target_geometry.physics_bsp_parts.is_empty());
    assert!(collision.target_geometry.fallback_shapes.is_empty());
    assert!(!collision.reporting.enabled);
    assert_eq!(
        collision.dynamic_collision.target,
        EntityCollisionParticipation::Suppressed
    );
    assert_eq!(facts.demand().target, LocalTargetDemand::Absent);
    assert_eq!(facts.demand().integration, LocalIntegrationDemand::Eligible);
}

#[test]
fn empty_setup_preserves_fixed_position_and_missing_setup_fails() {
    let (_temp, source) = source(Vec::new());
    let mut facts = facts();
    assert!(matches!(
        source.prepare_body(facts.clone()).unwrap().movement,
        PhysicalBodyDefinition::FixedPosition { .. }
    ));
    facts.setup_did = None;
    assert_eq!(
        source.prepare_body(facts.clone()).unwrap_err().to_string(),
        "remote navigation body has no setup DID"
    );
    facts.setup_did = Some(SETUP + 1);
    assert!(source.prepare_body(facts).is_err());
}

#[test]
fn remote_capture_does_not_require_wcid_or_setup_to_hold_prediction() {
    let mut world = WorldState::synthetic();
    let mut entity = Entity::new(
        REMOTE,
        "Remote".to_owned(),
        WorldPosition {
            landblock_id: Guid(0x1234_0100),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        },
    );
    entity.flags = ObjectDescriptionFlag::PLAYER;
    world.add_entity(entity);
    assert!(world.entities.get(REMOTE).unwrap().wcid.is_none());
    let captured = NavigationBodyFacts::capture(&world, REMOTE).unwrap();
    assert_eq!(captured.setup_did, None);
    assert_eq!(captured.demand().target, LocalTargetDemand::Absent);
    let mut scaled = captured.clone();
    scaled.object_scale = 2.0;
    assert!(captured.definition_eq(&scaled));
    scaled.setup_did = Some(SETUP);
    assert!(!captured.definition_eq(&scaled));
    world.player.guid = REMOTE;
    assert!(NavigationBodyFacts::capture(&world, REMOTE).is_none());
}

#[tokio::test]
async fn coordinator_installs_remote_envelopes_and_rebuilds_without_peer_response() {
    use crate::client::collision::{ClientCollisionCoordinator, ClientSpatialPolicy};
    use holtburger_common::properties::WorldObjectPropertyAccessorsMut as _;
    use holtburger_world::PhysicalCollisionExclusions;
    use std::time::{Duration, Instant};

    let (_temp, source) = source(vec![Sphere {
        center: Vector3::new(0.0, 0.0, 0.5),
        radius: 0.5,
    }]);
    let mut coordinator =
        ClientCollisionCoordinator::with_policy(ClientSpatialPolicy::Navigation(Arc::new(source)));
    let mut world = WorldState::synthetic();
    let pose = WorldPosition {
        landblock_id: Guid(0x1234_0100),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    world.seed_local_player_entity(Guid(0x5000_0001), "Player", pose);
    let mut entity = Entity::new(REMOTE, "Remote".to_owned(), pose);
    entity.flags = ObjectDescriptionFlag::PLAYER;
    entity
        .properties
        .set_did_prop(PropertyDataId::Setup, Guid(SETUP));
    world.add_entity(entity);
    let id = SpatialBodyId::Entity(REMOTE);
    for state in [
        PhysicsState::GRAVITY,
        PhysicsState::GRAVITY | PhysicsState::REPORT_COLLISIONS,
    ] {
        world
            .entities
            .get_mut(REMOTE)
            .unwrap()
            .physics
            .reconcile(resolve_effective_entity_physics_state(state));
        coordinator.observe(&mut world);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                coordinator.poll(&mut world, Instant::now());
                if world
                    .scene
                    .body(id)
                    .is_some_and(|body| body.physical.is_some())
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let physical = world.scene.body(id).unwrap().physical.as_ref().unwrap();
        assert!(
            physical
                .collision_filter
                .excludes(PhysicalCollisionExclusions::ENTITY_RESPONSE)
        );
        assert!(
            world
                .scene
                .body(SpatialBodyId::LocalPlayer(world.player.guid))
                .unwrap()
                .physical
                .is_none()
        );
    }
}

#[tokio::test]
async fn navigation_activation_waits_for_coverage_then_enters_without_model_body_facts() {
    use crate::client::builder::build_test_client;
    use crate::client::collision::{ClientCollisionCoordinator, ClientSpatialPolicy};
    use crate::client::movement::MovementSystem;
    use crate::client::movement_types::ClientMovementPolicy;
    use crate::client::{ClientState, ClientWorldActivationPhase, ClientWorldActivationState};
    use holtburger_content::navigation_bundle::{
        BOOTSTRAP_FILE, NAVIGATION_FILE, NavigationArchiveWriter, NavigationTerrain, sha256_file,
    };
    use holtburger_content::{
        LandblockSceneClass, LandblockTerrain, TERRAIN_GRID_CELLS, TerrainCellDiagonals,
    };
    use std::{
        collections::BTreeMap,
        time::{Duration, Instant},
    };

    let (temp, _hba_source) = source(Vec::new());
    let owner = Guid(0x1234_ffff);
    let grid_size = TERRAIN_GRID_CELLS + 1;
    let mut writer = NavigationArchiveWriter::create(
        temp.path().join(NAVIGATION_FILE),
        sha256_file(temp.path().join(BOOTSTRAP_FILE)).unwrap(),
    )
    .unwrap();
    writer
        .add_terrain(
            owner.0,
            &NavigationTerrain {
                scene_class: LandblockSceneClass::OutdoorOnly,
                terrain: LandblockTerrain {
                    grid_size,
                    tile_size: holtburger_common::position::METERS_PER_LANDBLOCK
                        / TERRAIN_GRID_CELLS as f32,
                    height_indices: vec![0; grid_size * grid_size],
                    heights: vec![0.0; grid_size * grid_size],
                    terrain_samples: vec![0; grid_size * grid_size],
                    cell_diagonals: TerrainCellDiagonals::for_landblock(owner.0),
                },
                buildings: Vec::new(),
                restrictions: BTreeMap::new(),
            },
        )
        .unwrap();
    writer.finish().unwrap();
    let content = Arc::new(NavigationContent::open(temp.path()).unwrap());
    for cause in [
        ClientWorldActivationState::InitialEntry,
        ClientWorldActivationState::Teleport,
    ] {
        let mut client = build_test_client(ClientState::EnteringWorld);
        let guid = Guid(0x5000_0001);
        let pose = WorldPosition::from_outdoor_frame(
            owner,
            Vector3::new(12.0, 12.0, 0.0),
            Quaternion::identity(),
        );
        client.world.seed_local_player_entity(guid, "Player", pose);
        client.movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
        client.collision_coordinator = Some(ClientCollisionCoordinator::with_policy(
            ClientSpatialPolicy::Navigation(Arc::new(NavigationClientSource::new(Arc::clone(
                &content,
            )))),
        ));
        client.start_world_activation(cause, guid);
        if cause == ClientWorldActivationState::Teleport {
            client.try_complete_world_activation().await.unwrap();
            assert!(client.activation.is_some());
            client.activation.as_mut().unwrap().phase =
                ClientWorldActivationPhase::TeleportDestinationInstalled;
        }
        client.try_complete_world_activation().await.unwrap();
        assert!(client.activation.is_some());
        assert_eq!(client.session.bytes_out, 0);
        let coordinator = client.collision_coordinator.as_mut().unwrap();
        coordinator.observe(&mut client.world);
        tokio::time::timeout(Duration::from_secs(1), async {
            while coordinator.snapshot().revision == 0 {
                coordinator.poll(&mut client.world, Instant::now());
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(client.world.player_entity().unwrap().wcid.is_none());
        assert!(client.body_readiness().is_none());
        client.try_complete_world_activation().await.unwrap();
        assert!(client.activation.is_none());
        assert_eq!(client.state, ClientState::InWorld);
        assert!(client.session.bytes_out > 0);
        assert!(
            client
                .world
                .scene
                .body(SpatialBodyId::LocalPlayer(guid))
                .unwrap()
                .physical
                .is_none()
        );
    }
}

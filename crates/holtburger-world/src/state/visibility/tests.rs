use super::*;
use crate::context::WorldContext as _;
use crate::{
    WorldEvent,
    entity::Entity,
    state::{
        ServerTimeSync,
        liveness::{ACE_DESTRUCTION_TIMEOUT_SECS, EntityPruneReason},
    },
};
use holtburger_common::{
    Quaternion, Vector3,
    properties::{PropertyInstanceId, WorldObjectPropertyAccessorsMut},
};
use holtburger_content::{
    CellVisibility, CellVolume, LandblockColliders, LandblockCollisionAsset, LandblockPlacement,
    TerrainCollisionSurface,
};
use std::time::Instant;

const OWNER: u32 = 0x01e3_ffff;
const NEIGHBOR: u32 = 0x01e4_ffff;
const PLAYER: Guid = Guid(0x5000_0001);
const TARGET: Guid = Guid(0x8145_56f3);
const UPPER: u16 = 0x0243;
const LOWER: u16 = 0x015e;

fn cell_id(owner: u32, selector: u16) -> u32 {
    (owner & 0xffff_0000) | u32::from(selector)
}
fn pose(id: u32) -> WorldPosition {
    WorldPosition {
        landblock_id: Guid(id),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    }
}
fn insert_rooms(scene: &mut CollisionScene, owner: u32, rooms: &[(u16, bool, &[u16])]) {
    let volumes = rooms
        .iter()
        .map(|&(selector, seen_outside, visible)| CellVolume {
            visibility: CellVisibility {
                visible_cell_selectors: visible.to_vec(),
                seen_outside,
            },
            cell_selector: selector,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: Vec::new(),
            portals: Vec::new(),
        })
        .collect();
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: owner,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(Vec::new(), volumes),
        })
        .unwrap();
}
fn scene() -> CollisionScene {
    let mut scene = CollisionScene::new();
    insert_rooms(
        &mut scene,
        OWNER,
        &[(UPPER, false, &[]), (LOWER, false, &[])],
    );
    scene
}
fn world(observer: u32, target: u32) -> WorldState {
    let mut world = WorldState::synthetic();
    world.player.guid = PLAYER;
    world.seed_local_player_entity(PLAYER, "Observer", pose(observer));
    world.add_entity(Entity::new(TARGET, "Servant".into(), pose(target)));
    time(&mut world, 100.0);
    world
}
fn time(world: &mut WorldState, server_time: f64) {
    world.server_time = Some(ServerTimeSync {
        server_time,
        local_time: Instant::now(),
    });
}
fn deadline(world: &WorldState) -> f64 {
    let request = world
        .entity_lifecycle_state(TARGET)
        .unwrap()
        .prune_request
        .unwrap();
    assert_eq!(request.reason, EntityPruneReason::Visibility);
    request.deadline
}
fn classify(scene: &CollisionScene, observer: u32, candidate: u32) -> EntityVisibility {
    ObserverScope::new(Some(pose(observer)), Some(scene)).classify(pose(candidate), Some(scene))
}

#[test]
fn authored_lists_are_directional_and_empty_lists_still_include_the_current_room() {
    let mut scene = CollisionScene::new();
    insert_rooms(
        &mut scene,
        OWNER,
        &[(UPPER, false, &[LOWER]), (LOWER, false, &[])],
    );
    let upper = cell_id(OWNER, UPPER);
    let lower = cell_id(OWNER, LOWER);
    assert_eq!(classify(&scene, upper, lower), EntityVisibility::Visible);
    assert_eq!(classify(&scene, lower, upper), EntityVisibility::Outside);
    assert_eq!(classify(&scene, lower, lower), EntityVisibility::Visible);
    // Directed lists are not transitively expanded into other cells' lists.
    insert_rooms(
        &mut scene,
        OWNER,
        &[
            (UPPER, false, &[LOWER]),
            (LOWER, false, &[0x0100]),
            (0x0100, false, &[]),
        ],
    );
    assert_eq!(
        classify(&scene, upper, cell_id(OWNER, 0x0100)),
        EntityVisibility::Outside
    );
}

#[test]
fn indoor_outdoor_visibility_obeys_seen_outside_and_owner_boundaries() {
    let mut scene = scene();
    insert_rooms(
        &mut scene,
        NEIGHBOR,
        &[(UPPER, true, &[]), (LOWER, false, &[])],
    );
    let upper = cell_id(OWNER, UPPER);
    assert_eq!(classify(&scene, upper, OWNER), EntityVisibility::Outside);
    assert_eq!(classify(&scene, OWNER, upper), EntityVisibility::Outside);
    assert_eq!(
        classify(&scene, OWNER, cell_id(NEIGHBOR, UPPER)),
        EntityVisibility::Visible
    );
    assert_eq!(
        classify(&scene, OWNER, cell_id(NEIGHBOR, LOWER)),
        EntityVisibility::Outside
    );
    insert_rooms(&mut scene, OWNER, &[(UPPER, true, &[])]);
    assert_eq!(classify(&scene, upper, NEIGHBOR), EntityVisibility::Visible);
    assert_eq!(
        classify(&scene, upper, cell_id(NEIGHBOR, UPPER)),
        EntityVisibility::Visible
    );
    assert_eq!(
        classify(&scene, upper, cell_id(NEIGHBOR, LOWER)),
        EntityVisibility::Outside
    );
    assert_eq!(
        classify(&scene, upper, 0x01e5_ffff),
        EntityVisibility::Outside
    );
    // Owner arithmetic must not wrap across either world edge.
    assert_eq!(
        classify(&scene, 0x0000_ffff, 0xffff_ffff),
        EntityVisibility::Outside
    );
    assert_eq!(
        classify(&scene, 0x0000_ffff, 0x0001_ffff),
        EntityVisibility::Visible
    );
}

#[test]
fn missing_required_metadata_is_unavailable_without_requiring_unrelated_owners() {
    let scene = scene();
    let upper = cell_id(OWNER, UPPER);
    let unknown = cell_id(NEIGHBOR, UPPER);
    assert_eq!(
        classify(&scene, unknown, upper),
        EntityVisibility::Unavailable
    );
    assert_eq!(
        classify(&scene, OWNER, unknown),
        EntityVisibility::Unavailable
    );
    assert_eq!(classify(&scene, upper, unknown), EntityVisibility::Outside);
    assert_eq!(classify(&scene, OWNER, 0), EntityVisibility::Unavailable);
    assert_eq!(
        ObserverScope::new(None, Some(&scene)).classify(pose(upper), Some(&scene)),
        EntityVisibility::Unavailable
    );
}

#[test]
fn recorded_dungeon_absence_expires_servant_and_allows_same_instance_recreation() {
    let scene = scene();
    let mut world = world(cell_id(OWNER, UPPER), cell_id(OWNER, UPPER));
    world.tick(Some(&scene));
    assert!(world.entity_lifecycle_state(TARGET).is_none());
    world.set_local_player_runtime_pose(pose(cell_id(OWNER, LOWER)));
    world.tick(Some(&scene));
    let expiry = deadline(&world);
    let recorded_absence_seconds = (64693.0 - 23053.0) / 1000.0;
    assert!(recorded_absence_seconds > ACE_DESTRUCTION_TIMEOUT_SECS);
    time(
        &mut world,
        expiry - ACE_DESTRUCTION_TIMEOUT_SECS + recorded_absence_seconds,
    );
    let events = world.tick(Some(&scene));
    assert!(world.entities.get(TARGET).is_none());
    assert!(
        events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned { guid, .. } if *guid == TARGET)
        )
    );
    assert!(
        world
            .scene
            .body(crate::SpatialBodyId::Entity(TARGET))
            .is_none()
    );
    let mut events = Vec::new();
    world.upsert_entity_from_create(
        Entity::new(TARGET, "Servant".into(), pose(cell_id(OWNER, LOWER))),
        &mut events,
    );
    world.tick(Some(&scene));
    assert!(world.get_visible_entity(TARGET).is_some());
    assert!(
        world
            .scene
            .body(crate::SpatialBodyId::Entity(TARGET))
            .is_some()
    );
}

#[test]
fn visibility_return_before_expiry_cancels_but_due_requests_expire_before_reconciliation() {
    let scene = scene();
    for expired in [false, true] {
        let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
        world.tick(Some(&scene));
        let expiry = deadline(&world);
        time(
            &mut world,
            if expired {
                expiry
            } else {
                expiry - ACE_DESTRUCTION_TIMEOUT_SECS / 2.0
            },
        );
        world.set_local_player_runtime_pose(pose(cell_id(OWNER, UPPER)));
        world.tick(Some(&scene));
        assert_eq!(world.entities.get(TARGET).is_none(), expired);
        assert!(world.entity_lifecycle_state(TARGET).is_none());
    }
}

#[test]
fn coverage_loss_invalidates_even_due_visibility_requests_and_restoration_restarts_grace() {
    let scene = scene();
    let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
    world.tick(Some(&scene));
    let old = deadline(&world);
    time(&mut world, old + ACE_DESTRUCTION_TIMEOUT_SECS);
    world.tick(None);
    assert!(world.entities.get(TARGET).is_some());
    assert!(world.entity_lifecycle_state(TARGET).is_none());
    world.tick(Some(&scene));
    assert!(deadline(&world) >= old + ACE_DESTRUCTION_TIMEOUT_SECS * 2.0);
}

#[test]
fn accepted_remote_movement_does_not_refresh_visibility_deadline_or_use_predicted_cell() {
    let scene = scene();
    let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
    world.tick(Some(&scene));
    let old = deadline(&world);
    let mut position = pose(cell_id(OWNER, UPPER));
    position.coords.x = 10.0;
    let mut events = Vec::new();
    world.apply_public_position_update(
        TARGET,
        holtburger_protocol::messages::PositionType::Location,
        position,
        &mut events,
    );
    world.tick(Some(&scene));
    assert_eq!(deadline(&world), old);
    world.reconcile_entity_retention(TARGET);
    assert_eq!(deadline(&world), old);
    // A wrong remote runtime room does not grant server visibility.
    world.scene.apply_runtime_body_pose(
        crate::SpatialBodyId::Entity(TARGET),
        pose(cell_id(OWNER, LOWER)),
        crate::SpatialSampleMode::SimulatingVelocity,
    );
    world.tick(Some(&scene));
    assert_eq!(deadline(&world), old);
}

#[test]
fn non_contact_position_return_cancels_visibility_prune_without_moving_runtime_body() {
    use crate::state::attachment_lifecycle::DeferredPlacementMessage;
    use holtburger_protocol::messages::{PositionPack, UpdatePositionData};

    let scene = scene();
    for returns in [false, true] {
        let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
        world.tick(Some(&scene));
        let expiry = deadline(&world);
        let initial_runtime = world
            .scene
            .body(crate::SpatialBodyId::Entity(TARGET))
            .unwrap()
            .pose;
        time(&mut world, expiry - ACE_DESTRUCTION_TIMEOUT_SECS / 2.0);
        let incoming = pose(cell_id(OWNER, if returns { LOWER } else { UPPER }));
        world.receive_placement_message(
            DeferredPlacementMessage::Position(UpdatePositionData {
                guid: TARGET,
                pos: PositionPack {
                    pos: incoming,
                    position_sequence: 1,
                    ..PositionPack::default()
                },
            }),
            &mut Vec::new(),
        );
        assert_eq!(world.entities.get(TARGET).unwrap().position, incoming);
        assert_eq!(
            world
                .scene
                .body(crate::SpatialBodyId::Entity(TARGET))
                .unwrap()
                .pose,
            initial_runtime
        );
        world.tick(Some(&scene));
        if returns {
            assert!(world.entity_lifecycle_state(TARGET).is_none());
        } else {
            assert_eq!(deadline(&world), expiry);
        }
        time(&mut world, expiry);
        world.tick(Some(&scene));
        assert_eq!(world.get_visible_entity(TARGET).is_some(), returns);
    }
}

#[test]
fn uncertainty_does_not_cancel_unretained_cleanup_or_explicit_server_deletion() {
    for server_delete in [false, true] {
        let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
        if server_delete {
            world.mark_entity_explicit_delete(TARGET);
        } else {
            world.request_unretained_entity_prune(TARGET, world.current_server_time());
        }
        world.tick(None);
        assert!(world.entities.get(TARGET).is_none());
    }
}

#[test]
fn nonworld_retention_prevents_visibility_cleanup() {
    let scene = scene();
    for retention in ["inventory", "equipment", "preview", "transfer"] {
        let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
        match retention {
            "inventory" => {
                assert!(world.move_entity_into_container(TARGET, PLAYER, &mut Vec::new()));
                assert!(world.is_in_player_inventory(TARGET));
            }
            "equipment" => {
                world
                    .entities
                    .get_mut(TARGET)
                    .unwrap()
                    .set_iid_prop(PropertyInstanceId::Wielder, PLAYER);
            }
            "preview" => world.mark_trade_preview(TARGET),
            "transfer" => world.retain_inventory_transfer(TARGET),
            _ => unreachable!(),
        }
        world.tick(Some(&scene));
        assert!(
            world
                .entity_lifecycle_state(TARGET)
                .is_none_or(|state| state.prune_request.is_none()),
            "{retention}"
        );
        let later = world.current_server_time() + ACE_DESTRUCTION_TIMEOUT_SECS * 2.0;
        time(&mut world, later);
        world.tick(Some(&scene));
        assert!(world.entities.get(TARGET).is_some(), "{retention}");
    }
}

#[test]
fn missing_candidate_coverage_clears_its_due_visibility_timer() {
    let mut scene = scene();
    let mut world = world(OWNER, cell_id(OWNER, UPPER));
    world.tick(Some(&scene));
    let expiry = deadline(&world);
    scene.remove(Guid(OWNER));
    time(&mut world, expiry);
    world.tick(Some(&scene));
    assert!(world.entities.get(TARGET).is_some());
    assert!(world.entity_lifecycle_state(TARGET).is_none());
}

#[test]
fn visibility_timeout_retires_attached_dependents_and_recreation_can_restore_them() {
    let scene = scene();
    let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
    let child = Guid(0x8146_3efd);
    let mut weapon = Entity::new(child, "Weapon".into(), pose(cell_id(OWNER, UPPER)));
    weapon.set_wielder_id(Some(TARGET));
    weapon.set_attachment(Some(crate::attachment::PhysicsAttachment {
        parent: TARGET,
        location: holtburger_common::ParentLocation::RightHand,
        placement: holtburger_common::Placement::RightHandCombat,
    }));
    world.add_entity(weapon.clone());
    world.tick(Some(&scene));
    let expiry = deadline(&world);
    time(&mut world, expiry);
    world.tick(Some(&scene));
    world.tick(Some(&scene));
    assert!(world.entities.get(TARGET).is_none());
    assert!(world.entities.get(child).is_none());
    let mut events = Vec::new();
    world.upsert_entity_from_create(
        Entity::new(TARGET, "Servant".into(), pose(cell_id(OWNER, LOWER))),
        &mut events,
    );
    world.upsert_entity_from_create(weapon, &mut events);
    world.tick(Some(&scene));
    assert!(world.get_visible_entity(TARGET).is_some());
    assert!(world.get_visible_entity(child).is_some());
    assert!(world.is_entity_world_participant(child));
}

#[test]
fn admitted_parent_cancels_orphan_grace_without_visibility_coverage() {
    let mut world = world(cell_id(OWNER, LOWER), cell_id(OWNER, UPPER));
    let missing_parent = Guid(0x8146_0001);
    world.entities.get_mut(TARGET).unwrap().set_attachment(Some(
        crate::attachment::PhysicsAttachment {
            parent: missing_parent,
            location: holtburger_common::ParentLocation::RightHand,
            placement: holtburger_common::Placement::RightHandCombat,
        },
    ));
    world.tick(None);
    let request = world
        .entity_lifecycle_state(TARGET)
        .unwrap()
        .prune_request
        .unwrap();
    assert_eq!(request.reason, EntityPruneReason::Unretained);
    time(
        &mut world,
        request.deadline - ACE_DESTRUCTION_TIMEOUT_SECS / 2.0,
    );
    world.upsert_entity_from_create(
        Entity::new(missing_parent, "Parent".into(), pose(cell_id(OWNER, UPPER))),
        &mut Vec::new(),
    );
    world.tick(None);
    assert!(world.entity_lifecycle_state(TARGET).is_none());
    time(&mut world, request.deadline);
    world.tick(None);
    assert!(world.entities.get(TARGET).is_some());
    assert!(world.is_entity_world_participant(TARGET));
}

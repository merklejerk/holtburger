//! Client-composition adapter into the shared focused dynamic-entity projection.

use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyFloat, PropertyString, WorldObjectExt as _, WorldObjectPropertyAccessors as _,
};
use holtburger_world::{EntityPlacement, PhysicalBodyParticipation, WorldState};
use thiserror::Error;

use crate::{
    DynamicEntityAdvance, DynamicEntityContent, DynamicEntityEvent, DynamicEntityHostTime,
    DynamicEntityIdentityView, DynamicEntityPathLeg, DynamicEntityPathPoint,
    DynamicEntityPlacedPath, DynamicEntityPlacementAdvanceKind, DynamicEntitySnapshot,
    DynamicEntitySpatialMembership, DynamicEntityTickBatch, DynamicEntityViewSource,
    DynamicEntityWorldProjection, project_dynamic_entity_view, semantic_dynamic_entity_category,
};

use super::{ClientRuntime, ClientViewEvent};

/// A client entity cannot enter the focused visual surface without these wire-derived facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ClientDynamicEntityViewError {
    #[error("client entity 0x{guid:08X} is not registered")]
    NotRegistered { guid: u32 },
    #[error("client entity 0x{guid:08X} has no WCID")]
    MissingWcid { guid: u32 },
    #[error("client entity 0x{guid:08X} has no display name")]
    MissingName { guid: u32 },
    #[error("client entity 0x{guid:08X} has no setup-model data ID")]
    MissingSetup { guid: u32 },
    #[error("client entity 0x{guid:08X} has invalid object scale")]
    InvalidObjectScale { guid: u32 },
    #[error("client entity 0x{guid:08X} has no canonical runtime body")]
    MissingBody { guid: u32 },
}

/// Adapts current client authority and solver facts into the same pure projector used by Explorer.
pub fn project_client_dynamic_entity(
    world: &WorldState,
    guid: Guid,
) -> Result<crate::DynamicEntityView, ClientDynamicEntityViewError> {
    let entity = world
        .entities
        .get(guid)
        .ok_or(ClientDynamicEntityViewError::NotRegistered { guid: guid.0 })?;
    let wcid = entity
        .wcid
        .ok_or(ClientDynamicEntityViewError::MissingWcid { guid: guid.0 })?;
    let name = entity
        .get_string_prop(PropertyString::Name)
        .filter(|name| !name.is_empty())
        .ok_or(ClientDynamicEntityViewError::MissingName { guid: guid.0 })?
        .to_owned();
    let setup_did = entity
        .csetup_id()
        .map(|did| did.0)
        .ok_or(ClientDynamicEntityViewError::MissingSetup { guid: guid.0 })?;
    let object_scale = entity.obj_scale().unwrap_or(1.0) as f32;
    if !object_scale.is_finite() || object_scale <= 0.0 {
        return Err(ClientDynamicEntityViewError::InvalidObjectScale { guid: guid.0 });
    }
    let placement = if let Some(attachment) = entity.attachment {
        EntityPlacement::Attached(attachment)
    } else {
        let body_id = world
            .runtime_body_id_for_guid(guid)
            .ok_or(ClientDynamicEntityViewError::MissingBody { guid: guid.0 })?;
        let spatial_body = world
            .scene
            .body(body_id)
            .ok_or(ClientDynamicEntityViewError::MissingBody { guid: guid.0 })?;
        let body = spatial_body.runtime_view();
        let participation = if spatial_body.physical.is_some() {
            PhysicalBodyParticipation::Physical
        } else {
            PhysicalBodyParticipation::PoseOnly
        };
        EntityPlacement::World(DynamicEntityWorldProjection {
            body,
            spatial_membership: DynamicEntitySpatialMembership::from(
                &spatial_body.spatial_membership(),
            ),
            participation,
        })
    };

    Ok(project_dynamic_entity_view(DynamicEntityViewSource {
        generation: u64::from(entity.instance_sequence()),
        category: semantic_dynamic_entity_category(entity.flags, entity.item_type()),
        identity: DynamicEntityIdentityView { guid, wcid, name },
        content: DynamicEntityContent {
            setup_did,
            motion_table_did: entity.mtable_id().map(|did| did.0),
            sound_table_did: entity.stable_id().map(|did| did.0),
            physics_effect_table_did: entity.petable_id().map(|did| did.0),
        },
        appearance: entity.appearance.clone(),
        object_scale,
        physics: entity.physics,
        radar: crate::DynamicEntityRadarFacts::from_authored(
            format_args!("client entity 0x{:08X}", guid.0),
            entity.radar_blip_color().map(|value| value as i32),
            crate::semantic_radar_blip_color(entity.flags, entity.item_type()),
            entity.radar_enum().map(|value| value as i32),
            entity.get_float_prop(PropertyFloat::ObviousRadarRange),
        ),
        placement,
        playing_clip: world.motion_runtimes.playing_clip(guid),
    }))
}

/// Projects every currently representable client entity in stable GUID order.
pub fn project_client_dynamic_entities(
    world: &WorldState,
) -> Vec<Result<crate::DynamicEntityView, ClientDynamicEntityViewError>> {
    let mut guids = world
        .entities
        .iter()
        .map(|entity| entity.guid)
        .collect::<Vec<_>>();
    guids.sort_unstable();
    guids
        .into_iter()
        .map(|guid| project_client_dynamic_entity(world, guid))
        .collect()
}

impl ClientRuntime {
    pub(super) fn dynamic_entity_host_time(&self) -> DynamicEntityHostTime {
        DynamicEntityHostTime::new(self.dynamic_entity_time_origin.elapsed().as_secs_f64())
            .expect("monotonic elapsed time must be finite and nonnegative")
    }

    pub(super) fn current_dynamic_entity_views(&self) -> Vec<crate::DynamicEntityView> {
        project_client_dynamic_entities(&self.world)
            .into_iter()
            .filter_map(|result| match result {
                Ok(view) => Some(view),
                Err(error) => {
                    log::warn!("client dynamic-entity projection rejected: {error}");
                    None
                }
            })
            .collect()
    }

    pub(super) fn emit_dynamic_entity_snapshot(&self) {
        let snapshot = DynamicEntitySnapshot::new(
            self.dynamic_entity_host_time(),
            self.current_dynamic_entity_views(),
        );
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::DynamicEntity(
                DynamicEntityEvent::Snapshot { snapshot },
            ));
    }

    pub(super) fn emit_dynamic_entity_upsert(&self, guid: Guid) {
        let entity = match project_client_dynamic_entity(&self.world, guid) {
            Ok(entity) => entity,
            Err(error) => {
                log::warn!("client dynamic-entity projection rejected: {error}");
                return;
            }
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::DynamicEntity(
                DynamicEntityEvent::Upserted {
                    entity: Box::new(entity),
                },
            ));
    }

    pub(super) fn emit_dynamic_entity_removed(&self, guid: Guid, generation: u64) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::DynamicEntity(
                DynamicEntityEvent::Removed { guid, generation },
            ));
    }

    /// Builds one closed advance product from authority-owned tick boundaries.
    ///
    /// This intentionally accepts captured views rather than sampling `WorldState` from an app
    /// host. The runtime owns both boundaries and publishes at most one batch for the turn.
    pub(super) fn dynamic_entity_tick_event(
        &self,
        before: Vec<crate::DynamicEntityView>,
        after: Vec<crate::DynamicEntityView>,
        host_time: DynamicEntityHostTime,
        duration_ms: f64,
        placement_kind_overrides: &std::collections::HashMap<
            Guid,
            DynamicEntityPlacementAdvanceKind,
        >,
    ) -> Option<DynamicEntityEvent> {
        let before_by_guid = before
            .into_iter()
            .map(|entity| (entity.identity.guid, entity))
            .collect::<std::collections::HashMap<_, _>>();
        let mut advances = Vec::new();
        let mut updates = Vec::new();

        for entity in after {
            let Some(previous) = before_by_guid.get(&entity.identity.guid) else {
                continue;
            };
            if previous.generation != entity.generation || previous == &entity {
                continue;
            }

            let (
                crate::DynamicEntityPlacementView::World {
                    pose: previous_pose,
                    spatial_membership: previous_membership,
                    ..
                },
                crate::DynamicEntityPlacementView::World {
                    pose: current_pose,
                    spatial_membership: current_membership,
                    ..
                },
            ) = (&previous.placement, &entity.placement)
            else {
                if previous.placement == entity.placement {
                    updates.push(Box::new(entity));
                }
                continue;
            };

            if previous_pose == current_pose && previous_membership == current_membership {
                updates.push(Box::new(entity));
                continue;
            }

            let initial = DynamicEntityPathPoint {
                pose: *previous_pose,
                spatial_membership: previous_membership.clone(),
            };
            let end = DynamicEntityPathPoint {
                pose: *current_pose,
                spatial_membership: current_membership.clone(),
            };

            advances.push(DynamicEntityAdvance {
                entity: Box::new(entity),
                kind: placement_kind_overrides
                    .get(&previous.identity.guid)
                    .copied()
                    .unwrap_or(DynamicEntityPlacementAdvanceKind::Integrated),
                path: DynamicEntityPlacedPath {
                    initial,
                    legs: vec![DynamicEntityPathLeg {
                        end_fraction: 1.0,
                        end,
                    }],
                },
            });
        }

        let duration_ms = if !advances.is_empty()
            && advances
                .iter()
                .all(|advance| advance.kind != DynamicEntityPlacementAdvanceKind::Integrated)
        {
            0.0
        } else {
            duration_ms
        };
        DynamicEntityTickBatch::new(host_time, duration_ms, advances, updates)
            .map(|batch| DynamicEntityEvent::Ticked { batch })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, ObjectDescriptionFlag, PhysicsState, PropertyDataId, PropertyFloat, PropertyInt,
        WeenieType, WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_common::{ParentLocation, Placement, Quaternion, Vector3};
    use holtburger_world::entity::Entity;
    use holtburger_world::{
        ContactState, EntityAppearance, PhysicalBodyParticipation, PhysicsAttachment,
        SpatialBodyId, resolve_effective_entity_physics_state,
    };

    use crate::client::{ClientState, builder};
    use crate::{
        DynamicEntityCategory, DynamicEntityContent, DynamicEntityIdentity,
        DynamicEntityPlacementView, DynamicEntityProjectionInput, DynamicEntityViewSource,
    };

    fn projectable_entity(guid: Guid, pose: WorldPosition) -> Entity {
        let mut entity = Entity::new(guid, "Drudge".to_owned(), pose);
        entity.wcid = Some(42);
        entity.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        entity
    }

    fn projected_view(guid: Guid) -> Box<crate::DynamicEntityView> {
        let mut world = WorldState::synthetic();
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        };
        let mut entity = projectable_entity(guid, pose);
        entity.physics = resolve_effective_entity_physics_state(PhysicsState::GRAVITY);
        world.add_entity(entity);
        Box::new(project_client_dynamic_entity(&world, guid).unwrap())
    }

    #[test]
    fn client_category_uses_live_description_facts_and_includes_vendors_as_npcs() {
        assert_eq!(
            semantic_dynamic_entity_category(
                ObjectDescriptionFlag::PLAYER,
                Some(ItemType::CREATURE),
            ),
            DynamicEntityCategory::Player
        );
        assert_eq!(
            semantic_dynamic_entity_category(
                ObjectDescriptionFlag::empty(),
                Some(ItemType::CREATURE)
            ),
            DynamicEntityCategory::Npc
        );
        assert_eq!(
            semantic_dynamic_entity_category(
                ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::CREATURE),
            ),
            DynamicEntityCategory::Mob
        );
        assert_eq!(
            semantic_dynamic_entity_category(
                ObjectDescriptionFlag::VENDOR | ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::CREATURE),
            ),
            DynamicEntityCategory::Npc
        );
        assert_eq!(
            semantic_dynamic_entity_category(
                ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::ARMOR)
            ),
            DynamicEntityCategory::Other
        );
    }

    fn advance(guid: Guid) -> DynamicEntityAdvance {
        let point = DynamicEntityPathPoint {
            pose: WorldPosition::default(),
            spatial_membership: DynamicEntitySpatialMembership {
                reaches_outdoors: true,
                reached_env_cell_ids: Vec::new(),
            },
        };
        DynamicEntityAdvance {
            entity: projected_view(guid),
            kind: DynamicEntityPlacementAdvanceKind::Integrated,
            path: DynamicEntityPlacedPath {
                initial: point.clone(),
                legs: vec![DynamicEntityPathLeg {
                    end_fraction: 1.0,
                    end: point,
                }],
            },
        }
    }

    fn test_host_time() -> DynamicEntityHostTime {
        DynamicEntityHostTime::new(1.0).unwrap()
    }

    #[test]
    fn tick_batch_sorts_each_disjoint_population_by_guid() {
        let batch = DynamicEntityTickBatch::new(
            test_host_time(),
            30.0,
            vec![advance(Guid(4)), advance(Guid(2))],
            vec![projected_view(Guid(3)), projected_view(Guid(1))],
        )
        .unwrap();

        assert_eq!(
            batch
                .advances
                .iter()
                .map(|advance| advance.entity.identity.guid)
                .collect::<Vec<_>>(),
            vec![Guid(2), Guid(4)]
        );
        assert_eq!(
            batch
                .updates
                .iter()
                .map(|entity| entity.identity.guid)
                .collect::<Vec<_>>(),
            vec![Guid(1), Guid(3)]
        );
    }

    #[test]
    #[should_panic(expected = "dynamic tick contains duplicate advance GUIDs")]
    fn tick_batch_rejects_duplicate_advance_guids() {
        let _ = DynamicEntityTickBatch::new(
            test_host_time(),
            30.0,
            vec![advance(Guid(1)), advance(Guid(1))],
            Vec::new(),
        );
    }

    #[test]
    #[should_panic(expected = "dynamic tick contains duplicate update GUIDs")]
    fn tick_batch_rejects_duplicate_update_guids() {
        let _ = DynamicEntityTickBatch::new(
            test_host_time(),
            30.0,
            Vec::new(),
            vec![projected_view(Guid(1)), projected_view(Guid(1))],
        );
    }

    #[test]
    #[should_panic(expected = "dynamic tick GUID cannot be both advanced and updated")]
    fn tick_batch_rejects_guid_in_both_populations() {
        let _ = DynamicEntityTickBatch::new(
            test_host_time(),
            30.0,
            vec![advance(Guid(1))],
            vec![projected_view(Guid(1))],
        );
    }

    #[test]
    fn client_and_explorer_adapters_project_equal_source_facts() {
        let guid = Guid(0x7000_0001);
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(12.0, 24.0, 3.0),
            rotation: Quaternion::identity(),
        };
        let physics = resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY | PhysicsState::HAS_DEFAULT_ANIM,
        );
        let appearance = EntityAppearance::default();
        let mut entity = projectable_entity(guid, pose);
        entity.physics = physics;
        entity.appearance = appearance.clone();
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        entity.set_did_prop(PropertyDataId::MotionTable, Guid(0x0900_0001));
        entity.set_float_prop(PropertyFloat::DefaultScale, 1.25);

        let mut world = WorldState::synthetic();
        world.add_entity(entity);
        let client = project_client_dynamic_entity(&world, guid).unwrap();
        let body = world
            .runtime_body_view(SpatialBodyId::Entity(guid))
            .unwrap();
        let explorer = project_dynamic_entity_view(DynamicEntityViewSource::from_projection(
            0,
            DynamicEntityCategory::Npc,
            DynamicEntityProjectionInput {
                identity: DynamicEntityIdentity {
                    guid,
                    wcid: 42,
                    name: "Drudge".to_owned(),
                    weenie_type: WeenieType::Creature,
                },
                content: DynamicEntityContent {
                    motion_table_did: Some(0x0900_0001),
                    setup_did: 0x0200_0001,
                    sound_table_did: None,
                    physics_effect_table_did: None,
                },
                appearance,
                object_scale: 1.25,
                physics,
                radar: crate::DynamicEntityRadarFacts::from_authored(
                    "test explorer entity",
                    None,
                    crate::explorer_radar_blip_color(
                        WeenieType::Creature,
                        Some(ItemType::CREATURE),
                        Some(false),
                    ),
                    None,
                    None,
                ),
                placement: EntityPlacement::World(DynamicEntityWorldProjection {
                    body,
                    spatial_membership: DynamicEntitySpatialMembership {
                        reaches_outdoors: true,
                        reached_env_cell_ids: Vec::new(),
                    },
                    participation: PhysicalBodyParticipation::PoseOnly,
                }),
            },
            world.motion_runtimes.playing_clip(guid),
        ));

        assert_eq!(client, explorer);
    }

    #[test]
    fn focused_client_events_preserve_broader_entity_delivery_and_snapshot_current_state() {
        let guid = Guid(0x7000_0002);
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(4.0, 5.0, 6.0),
            rotation: Quaternion::identity(),
        };
        let entity = projectable_entity(guid, pose);
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.add_entity(entity.clone());
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&holtburger_world::WorldEvent::EntitySpawned(Box::new(
            entity,
        )));
        let delivered = std::iter::from_fn(|| events.try_recv().ok()).collect::<Vec<_>>();
        assert!(delivered.iter().any(
            |event| matches!(event, ClientViewEvent::EntitySpawned { entity } if entity.guid == guid)
        ));
        assert!(delivered.iter().any(|event| matches!(
            event,
            ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity, .. })
                if entity.identity.guid == guid
        )));

        client.emit_current_application_snapshot();
        let snapshot =
            std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| match event {
                ClientViewEvent::DynamicEntity(DynamicEntityEvent::Snapshot { snapshot }) => {
                    Some(snapshot)
                }
                _ => None,
            });
        assert_eq!(
            snapshot.unwrap().entities[0].identity.guid,
            guid,
            "focused initial state must reconstruct current client entities"
        );
    }

    #[test]
    fn client_projection_rejections_each_have_a_reachable_source_shape() {
        let pose = WorldPosition::default();

        let world = WorldState::synthetic();
        assert_eq!(
            project_client_dynamic_entity(&world, Guid(1)),
            Err(ClientDynamicEntityViewError::NotRegistered { guid: 1 })
        );

        let mut world = WorldState::synthetic();
        let missing_wcid = Entity::new(Guid(2), "No WCID".to_owned(), pose);
        world.add_entity(missing_wcid);
        assert_eq!(
            project_client_dynamic_entity(&world, Guid(2)),
            Err(ClientDynamicEntityViewError::MissingWcid { guid: 2 })
        );

        let mut world = WorldState::synthetic();
        let mut missing_name = Entity::new(Guid(3), String::new(), pose);
        missing_name.wcid = Some(42);
        world.add_entity(missing_name);
        assert_eq!(
            project_client_dynamic_entity(&world, Guid(3)),
            Err(ClientDynamicEntityViewError::MissingName { guid: 3 })
        );

        let mut world = WorldState::synthetic();
        let mut missing_setup = Entity::new(Guid(4), "No Setup".to_owned(), pose);
        missing_setup.wcid = Some(42);
        world.add_entity(missing_setup);
        assert_eq!(
            project_client_dynamic_entity(&world, Guid(4)),
            Err(ClientDynamicEntityViewError::MissingSetup { guid: 4 })
        );

        for (guid, scale) in [(5, f64::NAN), (6, 0.0)] {
            let mut world = WorldState::synthetic();
            let mut invalid_scale = projectable_entity(Guid(guid), pose);
            invalid_scale.set_float_prop(PropertyFloat::DefaultScale, scale);
            world.add_entity(invalid_scale);
            assert_eq!(
                project_client_dynamic_entity(&world, Guid(guid)),
                Err(ClientDynamicEntityViewError::InvalidObjectScale { guid })
            );
        }

        let mut world = WorldState::synthetic();
        world.add_entity(projectable_entity(Guid(7), pose));
        world.scene.remove_body(SpatialBodyId::Entity(Guid(7)));
        assert_eq!(
            project_client_dynamic_entity(&world, Guid(7)),
            Err(ClientDynamicEntityViewError::MissingBody { guid: 7 })
        );
    }

    #[test]
    fn focused_snapshot_reconstructs_local_player_and_attached_entity_placement() {
        let player_guid = Guid(0x5000_0001);
        let attached_guid = Guid(0x7000_0001);
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(4.0, 5.0, 6.0),
            rotation: Quaternion::identity(),
        };
        let attachment = PhysicsAttachment {
            parent: player_guid,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        };
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = player_guid;
        client
            .world
            .add_entity(projectable_entity(player_guid, pose));
        let mut attached = projectable_entity(attached_guid, pose);
        attached.attachment = Some(attachment);
        client.world.add_entity(attached);
        let mut events = client.subscribe_client_view_events();

        client.emit_dynamic_entity_snapshot();

        let snapshot =
            std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| match event {
                ClientViewEvent::DynamicEntity(DynamicEntityEvent::Snapshot { snapshot }) => {
                    Some(snapshot)
                }
                _ => None,
            });
        let snapshot = snapshot.expect("focused snapshot must be emitted");
        assert_eq!(
            snapshot
                .entities
                .iter()
                .map(|entity| entity.identity.guid)
                .collect::<Vec<_>>(),
            vec![player_guid, attached_guid]
        );
        assert!(matches!(
            snapshot.entities[0].placement,
            DynamicEntityPlacementView::World { .. }
        ));
        assert!(matches!(
            snapshot.entities[1].placement,
            DynamicEntityPlacementView::Attached {
                parent,
                parent_location,
                placement,
            } if parent == attachment.parent
                && parent_location == attachment.location
                && placement == attachment.placement
        ));
    }

    #[test]
    fn one_authority_tick_publishes_one_tick_batch() {
        let guid = Guid(0x5000_0003);
        let start = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(1.0, 2.0, 3.0),
            rotation: Quaternion::identity(),
        };
        let end = WorldPosition {
            coords: Vector3::new(4.0, 5.0, 3.0),
            ..start
        };
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = guid;
        client.world.add_entity(projectable_entity(guid, start));

        let before = client.current_dynamic_entity_views();
        let _ = client.world.set_local_player_runtime_pose(end);
        let after = client.current_dynamic_entity_views();
        let event = client
            .dynamic_entity_tick_event(
                before,
                after,
                DynamicEntityHostTime::new(12.5).expect("test host time is valid"),
                30.0,
                &Default::default(),
            )
            .expect("changed world placement should produce one advance");

        let DynamicEntityEvent::Ticked { batch } = event else {
            panic!("expected a tick event");
        };
        assert_eq!(batch.host_time.seconds, 12.5);
        assert_eq!(batch.duration_ms, 30.0);
        assert_eq!(batch.advances.len(), 1);
        assert!(batch.updates.is_empty());
        let advance = &batch.advances[0];
        assert_eq!(advance.entity.identity.guid, guid);
        assert_eq!(advance.kind, DynamicEntityPlacementAdvanceKind::Integrated);
        assert_eq!(advance.path.initial.pose, start);
        assert_eq!(advance.path.legs[0].end_fraction, 1.0);
        assert_eq!(advance.path.legs[0].end.pose, end);
    }

    #[test]
    fn near_remote_packet_changes_authority_without_changing_projected_placement() {
        let player_guid = Guid(0x5000_0010);
        let remote_guid = Guid(0x5000_0011);
        let pose = |x| WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(x, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = player_guid;
        client
            .world
            .add_entity(projectable_entity(player_guid, pose(0.0)));
        client
            .world
            .add_entity(projectable_entity(remote_guid, pose(8.0)));
        let before = project_client_dynamic_entity(&client.world, remote_guid)
            .expect("remote should project before packet");

        let events = client.world.handle_message(
            &holtburger_protocol::messages::GameMessage::UpdatePosition(Box::new(
                holtburger_protocol::messages::UpdatePositionData {
                    guid: remote_guid,
                    pos: holtburger_protocol::messages::PositionPack {
                        pos: pose(10.0),
                        position_sequence: 1,
                        flags: holtburger_protocol::messages::UpdatePositionFlag::HAS_CONTACT,
                        ..Default::default()
                    },
                },
            )),
        );
        assert!(!events.is_empty());
        let after = project_client_dynamic_entity(&client.world, remote_guid)
            .expect("remote should project after packet");
        let (
            DynamicEntityPlacementView::World {
                pose: before_pose,
                spatial_membership: before_membership,
                ..
            },
            DynamicEntityPlacementView::World {
                pose: after_pose,
                spatial_membership: after_membership,
                ..
            },
        ) = (&before.placement, &after.placement)
        else {
            panic!("remote fixture should stay world placed");
        };
        assert_eq!(before_pose, after_pose);
        assert_eq!(before_membership, after_membership);
        assert_eq!(
            client.world.entities.get(remote_guid).unwrap().position,
            pose(10.0)
        );
    }

    #[test]
    fn correction_only_tick_uses_zero_duration_and_distinct_kind() {
        let guid = Guid(0x5000_0005);
        let start = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(1.0, 2.0, 3.0),
            rotation: Quaternion::identity(),
        };
        let end = WorldPosition {
            coords: Vector3::new(99.0, 2.0, 3.0),
            ..start
        };
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = guid;
        client.world.add_entity(projectable_entity(guid, start));
        let before = client.current_dynamic_entity_views();
        client.world.set_local_player_runtime_pose(end);
        let kinds = std::collections::HashMap::from([(
            guid,
            DynamicEntityPlacementAdvanceKind::CorrectionSnap,
        )]);

        let event = client
            .dynamic_entity_tick_event(
                before,
                client.current_dynamic_entity_views(),
                DynamicEntityHostTime::new(12.75).expect("test host time is valid"),
                30.0,
                &kinds,
            )
            .expect("correction snap should produce one advance");
        let DynamicEntityEvent::Ticked { batch } = event else {
            panic!("expected a tick event");
        };
        assert_eq!(batch.duration_ms, 0.0);
        assert_eq!(
            batch.advances[0].kind,
            DynamicEntityPlacementAdvanceKind::CorrectionSnap
        );
    }

    #[test]
    fn path_stable_body_level_change_publishes_one_update() {
        let guid = Guid(0x5000_0004);
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            coords: Vector3::new(1.0, 2.0, 3.0),
            rotation: Quaternion::identity(),
        };
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = guid;
        client.world.add_entity(projectable_entity(guid, pose));
        let before = client.current_dynamic_entity_views();

        assert!(
            client.world.scene.apply_runtime_body_contact(
                SpatialBodyId::LocalPlayer(guid),
                ContactState::Grounded,
            )
        );
        let event = client
            .dynamic_entity_tick_event(
                before,
                client.current_dynamic_entity_views(),
                DynamicEntityHostTime::new(13.0).expect("test host time is valid"),
                30.0,
                &Default::default(),
            )
            .expect("path-stable contact change should produce one update");

        let DynamicEntityEvent::Ticked { batch } = event else {
            panic!("expected a tick event");
        };
        assert!(batch.advances.is_empty());
        assert_eq!(batch.updates.len(), 1);
        assert_eq!(batch.updates[0].identity.guid, guid);
    }

    #[test]
    fn identical_population_produces_no_tick_event() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        for offset in 0..52 {
            let guid = Guid(0x7000_0000 + offset);
            client.world.add_entity(projectable_entity(
                guid,
                WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::new(offset as f32, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
            ));
        }
        let before = client.current_dynamic_entity_views();

        assert!(
            client
                .dynamic_entity_tick_event(
                    before.clone(),
                    before,
                    DynamicEntityHostTime::new(14.0).expect("test host time is valid"),
                    30.0,
                    &Default::default(),
                )
                .is_none()
        );
    }
}

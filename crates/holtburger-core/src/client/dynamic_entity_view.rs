//! Client-composition adapter into the shared focused dynamic-entity projection.

use super::simulation::ClientBodyMotion;
use anyhow::Context;

use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyFloat, PropertyInt, PropertyString, WorldObjectExt as _,
    WorldObjectPropertyAccessors as _,
};
use holtburger_world::{
    EntityPlacement, PhysicalBodyParticipation, ResolvedScenePlacement, ScenePlacementError,
    WorldState,
};
use thiserror::Error;

use crate::{
    DynamicEntityAdvance, DynamicEntityContent, DynamicEntityEvent, DynamicEntityHostTime,
    DynamicEntityIdentityView, DynamicEntityPathLeg, DynamicEntityPathPoint,
    DynamicEntityPlacedPath, DynamicEntityPlacementAdvanceKind, DynamicEntitySnapshot,
    DynamicEntitySpatialMembership, DynamicEntityTickBatch, DynamicEntityViewSource,
    DynamicEntityWorldProjection, dynamic_entity_display_view, project_dynamic_entity_view,
    semantic_dynamic_entity_presentation_class,
};

use super::{ClientRuntime, ClientViewEvent};

/// A client entity cannot enter the focused visual surface without these wire-derived facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ClientDynamicEntityViewError {
    /// The retained attachment graph contains a contradictory relationship.
    #[error(transparent)]
    Placement(#[from] ScenePlacementError),
    #[error("client entity 0x{guid:08X} is not registered")]
    NotRegistered { guid: u32 },
    #[error("client entity 0x{guid:08X} has no WCID")]
    MissingWcid { guid: u32 },
    #[error("client entity 0x{guid:08X} has no display name")]
    MissingName { guid: u32 },
    #[error("client entity 0x{guid:08X} has no setup-model data ID")]
    MissingSetup { guid: u32 },
    #[error("client entity 0x{guid:08X} has invalid translucency")]
    InvalidTranslucency { guid: u32 },
    #[error("client entity 0x{guid:08X} has no canonical runtime body")]
    MissingBody { guid: u32 },
}

/// Adapts current client authority and solver facts into the same pure projector used by Explorer.
pub fn project_client_dynamic_entity(
    world: &WorldState,
    guid: Guid,
) -> Result<Option<crate::DynamicEntityView>, ClientDynamicEntityViewError> {
    let entity = world
        .entities
        .get(guid)
        .ok_or(ClientDynamicEntityViewError::NotRegistered { guid: guid.0 })?;
    let scene_placement = world.resolve_scene_placement(guid)?;
    if matches!(scene_placement, ResolvedScenePlacement::Unresolved(_)) {
        return Ok(None);
    }
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
    let object_scale = entity.scale.effective();
    let translucency = entity
        .get_float_prop(PropertyFloat::Translucency)
        .unwrap_or(0.0);
    if !translucency.is_finite() || !(0.0..=1.0).contains(&translucency) {
        return Err(ClientDynamicEntityViewError::InvalidTranslucency { guid: guid.0 });
    }
    let translucency = translucency as f32;
    let placement = if let ResolvedScenePlacement::Attached { attachment, .. } = scene_placement {
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

    Ok(Some(project_dynamic_entity_view(DynamicEntityViewSource {
        generation: u64::from(entity.instance_sequence()),
        presentation_class: semantic_dynamic_entity_presentation_class(
            entity.flags,
            entity.item_type(),
        ),
        identity: DynamicEntityIdentityView { guid, wcid },
        display: dynamic_entity_display_view(name, entity.get_int_prop(PropertyInt::Level), guid),
        content: DynamicEntityContent {
            setup_did,
            motion_table_did: world.effective_motion_table_id_for_guid(guid),
            sound_table_did: entity.stable_id().map(|did| did.0),
            physics_effect_table_did: entity.petable_id().map(|did| did.0),
        },
        appearance: entity.appearance.clone(),
        object_scale,
        translucency,
        physics: entity.physics.effective(),
        radar: crate::DynamicEntityRadarFacts::from_authored(
            format_args!("client entity 0x{:08X}", guid.0),
            crate::semantic_dynamic_entity_map_blip_category(
                entity.flags,
                entity.item_type(),
                world
                    .weenie_types
                    .as_ref()
                    .and_then(|types| types.get(wcid)),
                entity.usable_flags(),
            ),
            entity.radar_enum().map(|value| value as i32),
            entity.get_float_prop(PropertyFloat::ObviousRadarRange),
        ),
        placement,
        motion: world.motion_runtimes.motion_presentation(guid),
    })))
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
        .filter_map(|guid| project_client_dynamic_entity(world, guid).transpose())
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
            Ok(Some(entity)) => entity,
            Ok(None) => return,
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
        body_motions: &std::collections::HashMap<Guid, ClientBodyMotion>,
    ) -> anyhow::Result<Option<DynamicEntityEvent>> {
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
            let motion = body_motions.get(&entity.identity.guid);
            let traversed = matches!(motion, Some(ClientBodyMotion::Physical(path))
                if path.legs().iter().any(|leg| leg.end() != path.initial()));
            if previous.generation != entity.generation || previous == &entity && !traversed {
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

            // Collision residency can refresh membership without integrating this body.
            if previous_pose == current_pose && !traversed {
                updates.push(Box::new(entity));
                continue;
            }

            // Only pose-only movement and snaps need an endpoint approximation.
            let endpoint_path = || DynamicEntityPlacedPath {
                initial: DynamicEntityPathPoint {
                    pose: *previous_pose,
                    spatial_membership: previous_membership.clone(),
                },
                legs: vec![DynamicEntityPathLeg {
                    end_fraction: 1.0,
                    end: DynamicEntityPathPoint {
                        pose: *current_pose,
                        spatial_membership: current_membership.clone(),
                    },
                }],
            };
            let (kind, path) =
                match motion.with_context(|| format!(
                    "changed entity placement has no simulation outcome: guid={:#010x}; previous_pose={previous_pose:?}; current_pose={current_pose:?}; previous_membership={previous_membership:?}; current_membership={current_membership:?}",
                    entity.identity.guid.0,
                ))? {
                    ClientBodyMotion::Physical(path) => (
                        DynamicEntityPlacementAdvanceKind::Integrated,
                        DynamicEntityPlacedPath::from_motion(
                            path,
                            previous_pose.rotation,
                            current_pose.rotation,
                        )?,
                    ),
                    ClientBodyMotion::PoseOnly => (
                        DynamicEntityPlacementAdvanceKind::Integrated,
                        endpoint_path(),
                    ),
                    ClientBodyMotion::CorrectionSnap => (
                        DynamicEntityPlacementAdvanceKind::CorrectionSnap,
                        endpoint_path(),
                    ),
                };
            advances.push(DynamicEntityAdvance {
                entity: Box::new(entity),
                kind,
                path,
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
        Ok(
            DynamicEntityTickBatch::new(host_time, duration_ms, advances, updates)
                .map(|batch| DynamicEntityEvent::Ticked { batch }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, ObjectDescriptionFlag, PhysicsState, PropertyDataId, PropertyFloat, PropertyInt,
        PropertyUpdate, WeenieType, WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_common::{ParentLocation, Placement, Quaternion, Vector3};
    use holtburger_content::MotionSequenceCatalog;
    use holtburger_dat::file_type::MotionTable;
    use holtburger_world::entity::Entity;
    use holtburger_world::{
        ContactState, EntityAppearance, PhysicalBodyParticipation, PhysicsAttachment,
        SpatialBodyId, resolve_effective_entity_physics_state,
    };

    use crate::client::{ClientState, builder};
    use crate::{
        DynamicEntityContent, DynamicEntityIdentity, DynamicEntityPlacementView,
        DynamicEntityPresentationClass, DynamicEntityProjectionInput, DynamicEntityViewSource,
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
        entity
            .physics
            .reconcile(resolve_effective_entity_physics_state(
                PhysicsState::GRAVITY,
            ));
        world.add_entity(entity);
        Box::new(
            project_client_dynamic_entity(&world, guid)
                .unwrap()
                .expect("resolved fixture"),
        )
    }

    #[test]
    fn stationary_door_useability_update_republishes_category_in_same_generation() {
        let guid = Guid(0x7000_0019);
        let mut entity = projectable_entity(
            guid,
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            },
        );
        entity.flags = ObjectDescriptionFlag::DOOR;
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.add_entity(entity);
        let before = project_client_dynamic_entity(&client.world, guid)
            .unwrap()
            .expect("resolved fixture");
        assert_eq!(
            before.presentation.radar.category,
            crate::DynamicEntityMapBlipCategory::Door
        );
        let mut events = client.subscribe_client_view_events();
        client
            .world
            .entities
            .get_mut(guid)
            .unwrap()
            .properties
            .ints
            .insert(
                PropertyInt::ItemUseable,
                holtburger_common::properties::Usable::NO.bits() as i32,
            );
        client.handle_world_event(&holtburger_world::WorldEvent::PropertiesUpdated {
            guid,
            updates: vec![PropertyUpdate::Int(
                PropertyInt::ItemUseable,
                holtburger_common::properties::Usable::NO.bits() as i32,
            )],
        });
        let after = std::iter::from_fn(|| events.try_recv().ok())
            .find_map(|event| match event {
                ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity }) => {
                    Some(entity)
                }
                _ => None,
            })
            .expect("stationary door update");
        assert_eq!(after.generation, before.generation);
        assert_eq!(
            after.presentation.radar.category,
            crate::DynamicEntityMapBlipCategory::DoorNoDirectUse
        );
    }

    #[test]
    fn client_projection_uses_the_world_resolved_setup_motion_table() {
        let guid = Guid(0x7000_0010);
        let setup_did = 0x0200_0010;
        let motion_table_did = 0x0900_0010;
        let mut world = WorldState::synthetic();
        world.set_motion_sequences(
            MotionSequenceCatalog::assemble(
                [MotionTable {
                    id: motion_table_did,
                    default_style: 0,
                    style_defaults: std::collections::HashMap::new(),
                    cycles: std::collections::HashMap::new(),
                    modifiers: std::collections::HashMap::new(),
                    links: std::collections::HashMap::new(),
                }],
                [],
                [(setup_did, motion_table_did)],
            )
            .expect("empty setup-fallback motion table should assemble"),
        );
        let mut entity = projectable_entity(
            guid,
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            },
        );
        entity.set_did_prop(PropertyDataId::Setup, Guid(setup_did));
        world.add_entity(entity);

        let projected = project_client_dynamic_entity(&world, guid)
            .expect("projectable entity")
            .expect("resolved fixture");

        assert_eq!(
            projected.presentation.content.motion_table_did,
            Some(motion_table_did)
        );
    }

    #[test]
    fn client_presentation_categories_use_live_semantic_facts() {
        assert_eq!(
            semantic_dynamic_entity_presentation_class(
                ObjectDescriptionFlag::PLAYER,
                Some(ItemType::CREATURE),
            ),
            DynamicEntityPresentationClass::Player
        );
        assert_eq!(
            semantic_dynamic_entity_presentation_class(
                ObjectDescriptionFlag::empty(),
                Some(ItemType::CREATURE)
            ),
            DynamicEntityPresentationClass::Npc
        );
        assert_eq!(
            semantic_dynamic_entity_presentation_class(
                ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::CREATURE),
            ),
            DynamicEntityPresentationClass::Mob
        );
        assert_eq!(
            semantic_dynamic_entity_presentation_class(
                ObjectDescriptionFlag::VENDOR | ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::CREATURE),
            ),
            DynamicEntityPresentationClass::Npc
        );
        assert_eq!(
            semantic_dynamic_entity_presentation_class(
                ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::ARMOR)
            ),
            DynamicEntityPresentationClass::Other
        );
        assert_eq!(
            semantic_dynamic_entity_presentation_class(ObjectDescriptionFlag::PORTAL, None),
            DynamicEntityPresentationClass::Portal
        );
        assert_eq!(
            semantic_dynamic_entity_presentation_class(
                ObjectDescriptionFlag::empty(),
                Some(ItemType::PORTAL),
            ),
            DynamicEntityPresentationClass::Portal
        );
        assert_eq!(
            crate::semantic_dynamic_entity_map_blip_category(
                ObjectDescriptionFlag::LIFE_STONE,
                None,
                None,
                holtburger_common::properties::Usable::UNDEF
            ),
            crate::DynamicEntityMapBlipCategory::Lifestone
        );
        assert_eq!(
            crate::semantic_dynamic_entity_map_blip_category(
                ObjectDescriptionFlag::empty(),
                Some(ItemType::LIFE_STONE),
                None,
                holtburger_common::properties::Usable::UNDEF
            ),
            crate::DynamicEntityMapBlipCategory::Lifestone
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
    fn client_projection_publishes_world_owned_absolute_script_scale() {
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
        entity.physics.reconcile(physics);
        entity.appearance = appearance.clone();
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity.properties.ints.insert(PropertyInt::Level, 12);
        entity.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        entity.set_did_prop(PropertyDataId::MotionTable, Guid(0x0900_0001));
        entity.set_property(PropertyUpdate::Float(PropertyFloat::DefaultScale, 1.25));
        entity.set_float_prop(PropertyFloat::Translucency, 0.5);

        let mut world = WorldState::synthetic();
        world.add_entity(entity);
        world
            .apply_entity_script_scale(guid, 3.0, 0.0, 1.0)
            .unwrap();
        let client = project_client_dynamic_entity(&world, guid)
            .unwrap()
            .expect("resolved fixture");
        let body = world
            .runtime_body_view(SpatialBodyId::Entity(guid))
            .unwrap();
        let explorer = project_dynamic_entity_view(DynamicEntityViewSource::from_projection(
            0,
            DynamicEntityPresentationClass::Npc,
            DynamicEntityProjectionInput {
                identity: DynamicEntityIdentity {
                    guid,
                    wcid: 42,
                    name: "Drudge".to_owned(),
                    weenie_type: WeenieType::Creature,
                },
                level: Some(12),
                content: DynamicEntityContent {
                    motion_table_did: Some(0x0900_0001),
                    setup_did: 0x0200_0001,
                    sound_table_did: None,
                    physics_effect_table_did: None,
                },
                appearance,
                object_scale: 3.0,
                translucency: 0.5,
                physics,
                radar: crate::DynamicEntityRadarFacts::from_authored(
                    "test explorer entity",
                    crate::explorer_dynamic_entity_map_blip_category(
                        WeenieType::Creature,
                        Some(ItemType::CREATURE),
                        Some(false),
                        holtburger_common::properties::Usable::UNDEF,
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
            world.motion_runtimes.motion_presentation(guid),
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
        let generation = u64::from(entity.instance_sequence());
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

        client
            .world
            .entities
            .get_mut(guid)
            .expect("spawned entity")
            .properties
            .ints
            .insert(PropertyInt::Level, 27);
        client.handle_world_event(&holtburger_world::WorldEvent::PropertiesUpdated {
            guid,
            updates: vec![PropertyUpdate::Int(PropertyInt::Level, 27)],
        });
        let updated = std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| match event {
            ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity }) => Some(entity),
            _ => None,
        });
        assert_eq!(updated.expect("level upsert").display.level, Some(27));

        client
            .world
            .entities
            .get_mut(guid)
            .expect("spawned entity")
            .set_float_prop(PropertyFloat::Translucency, 0.5);
        client.handle_world_event(&holtburger_world::WorldEvent::PropertiesUpdated {
            guid,
            updates: vec![PropertyUpdate::Float(PropertyFloat::Translucency, 0.5)],
        });
        let updated = std::iter::from_fn(|| events.try_recv().ok()).find_map(|event| match event {
            ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity }) => Some(entity),
            _ => None,
        });
        let updated = updated.expect("translucency upsert");
        assert_eq!(updated.generation, generation);
        assert_eq!(updated.physics.translucency, 0.5);

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
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        };

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

        for (guid, translucency) in [
            (8, f64::NAN),
            (9, -0.01),
            (10, 1.01),
            (11, -f64::MIN_POSITIVE),
            (12, 1.0 + f64::EPSILON),
        ] {
            let mut world = WorldState::synthetic();
            let mut invalid_translucency = projectable_entity(Guid(guid), pose);
            invalid_translucency.set_float_prop(PropertyFloat::Translucency, translucency);
            world.add_entity(invalid_translucency);
            assert_eq!(
                project_client_dynamic_entity(&world, Guid(guid)),
                Err(ClientDynamicEntityViewError::InvalidTranslucency { guid })
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
        attached.set_attachment(Some(attachment));
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
        let missing = client
            .dynamic_entity_tick_event(
                before.clone(),
                after.clone(),
                DynamicEntityHostTime::new(12.5).unwrap(),
                30.0,
                &Default::default(),
            )
            .unwrap_err();
        assert!(missing.to_string().contains("no simulation outcome"));
        let event = client
            .dynamic_entity_tick_event(
                before,
                after,
                DynamicEntityHostTime::new(12.5).expect("test host time is valid"),
                30.0,
                &std::collections::HashMap::from([(guid, ClientBodyMotion::PoseOnly)]),
            )
            .unwrap()
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
            .expect("remote should project before packet")
            .expect("placed remote");

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
            .expect("remote should project after packet")
            .expect("placed remote");
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
        let kinds = std::collections::HashMap::from([(guid, ClientBodyMotion::CorrectionSnap)]);

        let event = client
            .dynamic_entity_tick_event(
                before,
                client.current_dynamic_entity_views(),
                DynamicEntityHostTime::new(12.75).expect("test host time is valid"),
                30.0,
                &kinds,
            )
            .unwrap()
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
            .unwrap()
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
                .unwrap()
                .is_none()
        );
    }
    #[tokio::test]
    async fn retained_attachment_publishes_and_replays_its_cue_only_after_parent_arrival() {
        use holtburger_common::properties::PhysicsDescriptionFlag;
        use holtburger_protocol::messages::object::messages::description::PhysicsDescParent;
        use holtburger_protocol::messages::{GameMessage, ObjectDescriptionData, PlayScriptData};
        use holtburger_protocol::traits::ProtocolPack;

        fn creation(guid: Guid, parent: Option<Guid>) -> GameMessage {
            let mut data = ObjectDescriptionData::with_guid(guid);
            data.public_weenie_desc.name = Some("Scene fixture".into());
            data.public_weenie_desc.wcid = 42;
            data.csetup_id = Some(0x0200_0001);
            data.pos = Some(WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            });
            data.physics_flags = PhysicsDescriptionFlag::CSETUP | PhysicsDescriptionFlag::POSITION;
            if let Some(parent) = parent {
                data.parent = Some(PhysicsDescParent {
                    id: parent,
                    location_id: ParentLocation::RightHand as u32,
                });
                data.animation_frame = Some(Placement::RightHandCombat as u32);
                data.physics_flags |=
                    PhysicsDescriptionFlag::PARENT | PhysicsDescriptionFlag::ANIMATION_FRAME;
            }
            GameMessage::ObjectCreate(Box::new(data))
        }
        async fn send(client: &mut ClientRuntime, message: GameMessage) {
            let mut bytes = Vec::new();
            message.pack(&mut bytes);
            client.handle_message(&bytes).await.unwrap();
        }

        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let child = Guid(0x80001596);
        let parent = Guid(0x80001323);
        send(&mut client, creation(child, Some(parent))).await;
        send(
            &mut client,
            GameMessage::PlayScript(Box::new(PlayScriptData {
                target: child,
                script_cue: 10,
                intensity: 0.5,
            })),
        )
        .await;
        assert!(client.world.entities.get(child).is_some());
        assert!(
            project_client_dynamic_entity(&client.world, child)
                .unwrap()
                .is_none()
        );
        while let Ok(event) = events.try_recv() {
            assert!(!matches!(event, ClientViewEvent::DynamicScriptCue(_)));
            assert!(
                !matches!(event, ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity })
                if entity.identity.guid == child)
            );
        }
        send(&mut client, creation(parent, None)).await;
        let view = project_client_dynamic_entity(&client.world, child)
            .unwrap()
            .expect("resolved child");
        assert_eq!(view.generation, 0);
        assert!(
            matches!(view.placement, DynamicEntityPlacementView::Attached { parent: owner, .. } if owner == parent)
        );
        let mut admitted = false;
        let mut cue_count = 0;
        while let Ok(event) = events.try_recv() {
            match event {
                ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity })
                    if entity.identity.guid == child =>
                {
                    admitted = true
                }
                ClientViewEvent::DynamicScriptCue(cue) if cue.guid == child => {
                    assert!(
                        admitted,
                        "scene admission precedes queued presentation effects"
                    );
                    cue_count += 1;
                }
                _ => {}
            }
        }
        assert!(admitted);
        assert_eq!(cue_count, 1);

        send(
            &mut client,
            GameMessage::PickupEvent(Box::new(holtburger_protocol::messages::PickupEventData {
                guid: parent,
                instance_sequence: 0,
                position_sequence: 1,
            })),
        )
        .await;
        assert!(client.world.entities.get(child).is_some());
        assert!(
            project_client_dynamic_entity(&client.world, child)
                .unwrap()
                .is_none()
        );
        let mut withdrawals = 0;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::DynamicEntity(DynamicEntityEvent::Removed { guid, generation: 0 }) if guid == child)
            {
                withdrawals += 1;
            }
        }
        assert_eq!(withdrawals, 1);
        send(&mut client, creation(parent, None)).await;
        assert!(
            project_client_dynamic_entity(&client.world, child)
                .unwrap()
                .is_none()
        );
        send(
            &mut client,
            GameMessage::ParentEvent(Box::new(holtburger_protocol::messages::ParentEventData {
                parent_guid: parent,
                child_guid: child,
                location: ParentLocation::RightHand as u32,
                placement: Placement::RightHandCombat as u32,
                parent_instance_sequence: 0,
                child_position_sequence: 1,
            })),
        )
        .await;
        assert_eq!(
            project_client_dynamic_entity(&client.world, child)
                .unwrap()
                .expect("readmitted child")
                .generation,
            0
        );

        while events.try_recv().is_ok() {}
        let mut replacement = creation(child, Some(Guid(0x80009999)));
        let GameMessage::ObjectCreate(data) = &mut replacement else {
            unreachable!("creation helper returns ObjectCreate");
        };
        // PhysicsDesc's ninth timestamp is ObjectInstance, independent of position ordering.
        data.sequences[8] = 1;
        send(&mut client, replacement).await;
        assert_eq!(
            client
                .world
                .entities
                .get(child)
                .unwrap()
                .instance_sequence(),
            1
        );
        assert!(
            project_client_dynamic_entity(&client.world, child)
                .unwrap()
                .is_none()
        );
        let mut removed_generations = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::DynamicEntity(DynamicEntityEvent::Removed { guid, generation }) =
                event
                && guid == child
            {
                removed_generations.push(generation);
            }
        }
        assert_eq!(
            removed_generations,
            vec![0],
            "withdraw the incarnation the frontend actually holds"
        );
    }
}

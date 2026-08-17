//! Client-composition adapter into the shared focused dynamic-entity projection.

use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyString, WorldObjectExt as _, WorldObjectPropertyAccessors as _,
};
use holtburger_world::{PhysicalBodyParticipation, WorldState};
use thiserror::Error;

use crate::{
    DynamicEntityContent, DynamicEntityEvent, DynamicEntityHostTime, DynamicEntityIdentityView,
    DynamicEntitySnapshot, DynamicEntityViewSource, project_dynamic_entity_view,
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
    let body_id = world
        .runtime_body_id_for_guid(guid)
        .ok_or(ClientDynamicEntityViewError::MissingBody { guid: guid.0 })?;
    let body = world
        .runtime_body_view(body_id)
        .ok_or(ClientDynamicEntityViewError::MissingBody { guid: guid.0 })?;
    let participation = if world
        .scene
        .body(body_id)
        .is_some_and(|body| body.physical.is_some())
    {
        PhysicalBodyParticipation::Physical
    } else {
        PhysicalBodyParticipation::PoseOnly
    };

    Ok(project_dynamic_entity_view(DynamicEntityViewSource {
        generation: u64::from(entity.instance_sequence()),
        identity: DynamicEntityIdentityView { guid, wcid, name },
        content: DynamicEntityContent {
            setup_did,
            sound_table_did: entity.stable_id().map(|did| did.0),
            physics_effect_table_did: entity.petable_id().map(|did| did.0),
        },
        appearance: entity.appearance.clone(),
        object_scale,
        physics: entity.physics,
        body,
        participation,
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
    fn dynamic_entity_host_time(&self) -> DynamicEntityHostTime {
        DynamicEntityHostTime::new(self.dynamic_entity_time_origin.elapsed().as_secs_f64())
            .expect("monotonic elapsed time must be finite and nonnegative")
    }

    fn current_dynamic_entity_views(&self) -> Vec<crate::DynamicEntityView> {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PhysicsState, PropertyDataId, PropertyFloat, WeenieType,
        WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_world::entity::Entity;
    use holtburger_world::{
        EntityAppearance, PhysicalBodyParticipation, SpatialBodyId,
        resolve_effective_entity_physics_state,
    };

    use crate::client::{ClientState, builder};
    use crate::{
        DynamicEntityContent, DynamicEntityIdentity, DynamicEntityProjectionInput,
        DynamicEntityViewSource,
    };

    fn projectable_entity(guid: Guid, pose: WorldPosition) -> Entity {
        let mut entity = Entity::new(guid, "Drudge".to_owned(), pose);
        entity.wcid = Some(42);
        entity.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        entity
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
            DynamicEntityProjectionInput {
                identity: DynamicEntityIdentity {
                    guid,
                    wcid: 42,
                    name: "Drudge".to_owned(),
                    weenie_type: WeenieType::Creature,
                },
                content: DynamicEntityContent {
                    setup_did: 0x0200_0001,
                    sound_table_did: None,
                    physics_effect_table_did: None,
                },
                appearance,
                object_scale: 1.25,
                physics,
                body,
                participation: PhysicalBodyParticipation::PoseOnly,
            },
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

        client.emit_initial_view_state_snapshot();
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
}

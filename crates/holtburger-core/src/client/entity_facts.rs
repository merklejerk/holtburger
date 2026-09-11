//! Reconstructible semantic entity publication, separate from renderer motion delivery.

use std::collections::{BTreeMap, BTreeSet};

use holtburger_common::Guid;
use holtburger_world::{
    WorldEvent, WorldState, entity_facts::ClientEntityFacts, state::ScenePlacementError,
};
use serde::{Deserialize, Serialize};

/// Complete retained semantic baseline used by initial connection and recovery.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientEntitySnapshot {
    /// Deterministically GUID-ordered entity records, including pending owned identities.
    pub entities: Vec<ClientEntityFacts>,
}

impl ClientEntitySnapshot {
    /// Use exactly the same world query as incremental record publication.
    pub fn from_world(world: &WorldState) -> Result<Self, ScenePlacementError> {
        let mut entities = Vec::new();
        for guid in world.client_entity_guids() {
            if let Some(record) = world.client_entity_facts(guid)? {
                entities.push(record);
            }
        }
        Ok(Self { entities })
    }
}

/// One change to the semantic mirror, never a transaction across separate server messages.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientEntityDelta {
    /// Complete replacement records, applied together before observers run.
    pub upserts: Vec<ClientEntityFacts>,
    /// Accepted identities leaving the retained semantic domain, not renderer removals.
    pub removed: Vec<Guid>,
}

/// Last published facts plus invalidation; only core publication mutates this cache.
#[derive(Default)]
pub(super) struct EntityFactsPublication {
    records: BTreeMap<Guid, ClientEntityFacts>,
    dirty: BTreeSet<Guid>,
    owner: Option<Guid>,
}

impl EntityFactsPublication {
    pub(super) fn observe(&mut self, event: &WorldEvent) {
        let guid = match event {
            WorldEvent::EntitySpawned(entity)
            | WorldEvent::EntityReplaced(entity)
            | WorldEvent::EntityIdentified(entity) => Some(entity.guid),
            WorldEvent::PlayerInfo(data) => Some(data.entity.guid),
            WorldEvent::PropertiesUpdated { guid, .. }
            | WorldEvent::EntityScenePlacementChanged { guid, .. }
            | WorldEvent::EntityDespawned { guid, .. } => Some(*guid),
            _ => None,
        };
        if let Some(guid) = guid {
            self.dirty.insert(guid);
        }
    }

    fn collect(
        &mut self,
        world: &mut WorldState,
    ) -> Result<ClientEntityDelta, ScenePlacementError> {
        let storage_changes = world.take_storage_changes();
        if self.owner != Some(world.player.guid) {
            self.dirty.extend(self.records.keys().copied());
            self.dirty.extend(world.client_entity_guids());
            self.owner = Some(world.player.guid);
        } else if !storage_changes.is_empty() {
            // A changed container affects ownership of descendants as well as its own record.
            self.dirty.extend(
                self.records
                    .values()
                    .filter(|record| record.owned_by_player)
                    .map(|record| record.guid),
            );
            self.dirty
                .extend(holtburger_world::context::WorldContext::iter_inventory(
                    world,
                ));
        }
        self.dirty.extend(storage_changes);
        let mut delta = ClientEntityDelta::default();
        // Prepare before mutating the published cache so invalid world graphs fail coherently.
        let mut prepared = Vec::new();
        for guid in &self.dirty {
            prepared.push((*guid, world.client_entity_facts(*guid)?));
        }
        for (guid, record) in prepared {
            match record {
                Some(record) if self.records.get(&guid) != Some(&record) => {
                    self.records.insert(guid, record.clone());
                    delta.upserts.push(record);
                }
                None if self.records.remove(&guid).is_some() => delta.removed.push(guid),
                _ => {}
            }
        }
        self.dirty.clear();
        Ok(delta)
    }
}

impl super::ClientRuntime {
    /// Publish completed semantic changes without coupling them to dynamic rendering events.
    pub(super) fn publish_entity_facts(&mut self) {
        let delta = self
            .entity_facts
            .collect(&mut self.world)
            .expect("accepted world relationships must project into coherent entity facts");
        if !delta.upserts.is_empty() || !delta.removed.is_empty() {
            let _ = self
                .client_view_event_tx
                .send(super::ClientViewEvent::EntityFactsChanged(delta));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{EquipMask, InventoryEntryKind};
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
        InventoryRemoveObjectData, ObjectDescriptionData, PlayerDescriptionEventData,
        ViewContentsEventData, WieldObjectEventData,
    };

    const PLAYER: Guid = Guid(1);
    const PACK: Guid = Guid(2);
    const ITEM: Guid = Guid(3);

    fn event(event: GameEvent) -> GameMessage {
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event,
        }))
    }

    fn place(item: Guid, parent: Guid, kind: InventoryEntryKind) -> GameMessage {
        event(GameEvent::InventoryPutObjInContainer(Box::new(
            InventoryPutObjInContainerEventData {
                item_guid: item,
                container_guid: parent,
                slot: 0,
                container_type: kind,
            },
        )))
    }

    fn player_baseline() -> GameMessage {
        event(GameEvent::PlayerDescription(Box::new(
            PlayerDescriptionEventData {
                guid: PLAYER,
                sequence: 0,
                name: "Player".into(),
                wee_type: 1,
                pos: None,
                properties: Default::default(),
                positions: Default::default(),
                attributes: Default::default(),
                skills: Default::default(),
                enchantments: Vec::new(),
                spells: Default::default(),
                has_health: true,
                options1: Default::default(),
                options2: Default::default(),
                shortcuts: Vec::new(),
                hotbar_spells: Vec::new(),
                desired_comps: Vec::new(),
                spellbook_filters: 0,
                gameplay_options: Vec::new(),
                inventory: Vec::new(),
                equipped_objects: Vec::new(),
            },
        )))
    }

    fn assert_reconstructed(
        world: &mut WorldState,
        publisher: &mut EntityFactsPublication,
        mirror: &mut BTreeMap<Guid, ClientEntityFacts>,
    ) {
        let delta = publisher.collect(world).unwrap();
        for guid in delta.removed {
            mirror.remove(&guid);
        }
        for record in delta.upserts {
            mirror.insert(record.guid, record);
        }
        let fresh = ClientEntitySnapshot::from_world(world).unwrap();
        assert_eq!(mirror.values().cloned().collect::<Vec<_>>(), fresh.entities);
    }

    #[test]
    fn deltas_reconstruct_pending_hydrated_moved_and_withdrawn_storage() {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        let mut publisher = EntityFactsPublication::default();
        let mut mirror = BTreeMap::new();
        let mut description = ObjectDescriptionData::with_guid(ITEM);
        description.public_weenie_desc.name = Some("Sword".into());
        description.public_weenie_desc.container_id = Some(PLAYER);
        let messages = [
            place(PACK, PLAYER, InventoryEntryKind::Container),
            place(ITEM, PACK, InventoryEntryKind::Item),
            GameMessage::ObjectCreate(Box::new(description)),
            place(PACK, Guid(9), InventoryEntryKind::Container),
            place(PACK, PLAYER, InventoryEntryKind::Container),
            event(GameEvent::ViewContents(Box::new(ViewContentsEventData {
                container: PACK,
                items: vec![],
            }))),
            event(GameEvent::WieldObject(Box::new(WieldObjectEventData {
                object_guid: ITEM,
                equip_mask: EquipMask::MELEE_WEAPON,
            }))),
            GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
                object_guid: ITEM,
            })),
            player_baseline(),
        ];
        for message in messages {
            for change in world.handle_message(&message) {
                publisher.observe(&change);
            }
            assert_reconstructed(&mut world, &mut publisher, &mut mirror);
        }
        assert!(!mirror.contains_key(&ITEM));
        assert!(!mirror.contains_key(&PACK));
        assert!(publisher.collect(&mut world).unwrap().upserts.is_empty());
    }

    #[test]
    fn readmitted_pending_parent_survives_deferred_description_eviction() {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        let mut publisher = EntityFactsPublication::default();
        let mut mirror = BTreeMap::new();
        let mut description = ObjectDescriptionData::with_guid(PACK);
        description.public_weenie_desc.name = Some("Pack".into());
        for message in [
            GameMessage::ObjectCreate(Box::new(description.clone())),
            place(PACK, PLAYER, InventoryEntryKind::Container),
            GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
                object_guid: PACK,
            })),
            place(PACK, PLAYER, InventoryEntryKind::Container),
            place(ITEM, PACK, InventoryEntryKind::Item),
        ] {
            for event in world.handle_message(&message) {
                publisher.observe(&event);
            }
            assert_reconstructed(&mut world, &mut publisher, &mut mirror);
        }
        assert_eq!(
            mirror[&PACK].description,
            holtburger_world::entity_facts::EntityDescription::Pending
        );
        for event in world.tick() {
            publisher.observe(&event);
        }
        assert_reconstructed(&mut world, &mut publisher, &mut mirror);
        assert!(mirror[&PACK].owned_by_player);
        assert!(mirror[&ITEM].owned_by_player);
        for event in world.handle_message(&GameMessage::ObjectCreate(Box::new(description))) {
            publisher.observe(&event);
        }
        assert_reconstructed(&mut world, &mut publisher, &mut mirror);
        assert!(matches!(
            mirror[&PACK].description,
            holtburger_world::entity_facts::EntityDescription::Known { .. }
        ));
    }

    #[test]
    fn unchanged_semantics_do_not_publish_on_position_updates() {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        let mut publisher = EntityFactsPublication::default();
        publisher.collect(&mut world).unwrap();
        publisher.observe(&WorldEvent::EntityMoved {
            guid: PLAYER,
            pos: Default::default(),
        });
        assert_eq!(
            publisher.collect(&mut world).unwrap(),
            ClientEntityDelta::default()
        );
    }
}

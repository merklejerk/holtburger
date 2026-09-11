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
    fn stack_count_updates_and_late_stackability_reconstruct_inventory_snapshots() {
        use holtburger_common::properties::{ItemType, PropertyInt};
        use holtburger_protocol::messages::{
            PublicUpdatePropertyIntData, inventory::types::SetStackSizeData,
        };
        use holtburger_world::entity_facts::{EntityDescription, SceneAvailability};

        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        let mut publisher = EntityFactsPublication::default();
        let mut mirror = BTreeMap::new();
        let mut description = ObjectDescriptionData::with_guid(ITEM);
        description.public_weenie_desc.name = Some("Stack".into());
        description.public_weenie_desc.item_type = ItemType::FOOD.bits();
        description.public_weenie_desc.container_id = Some(PLAYER);
        description.public_weenie_desc.stack_size = Some(2);
        description.public_weenie_desc.max_stack_size = Some(100);
        let mut replacement = description.clone();
        replacement.public_weenie_desc.stack_size = Some(3);
        let update = |property: PropertyInt, value| {
            GameMessage::PublicUpdatePropertyInt(Box::new(PublicUpdatePropertyIntData {
                sequence: 1,
                guid: ITEM,
                property: property as u32,
                value,
            }))
        };
        for (message, expected) in [
            (GameMessage::ObjectCreate(Box::new(description)), Some(2)),
            (
                GameMessage::SetStackSize(Box::new(SetStackSizeData {
                    sequence: 1,
                    object_guid: ITEM,
                    stack_size: 1,
                    value: 0,
                })),
                Some(1),
            ),
            (update(PropertyInt::StackSize, 20), Some(20)),
            (update(PropertyInt::MaxStackSize, 1), None),
            (update(PropertyInt::StackSize, 40), None),
            (update(PropertyInt::MaxStackSize, 100), Some(40)),
            (GameMessage::ObjectCreate(Box::new(replacement)), Some(3)),
        ] {
            for event in world.handle_message(&message) {
                publisher.observe(&event);
            }
            assert_reconstructed(&mut world, &mut publisher, &mut mirror);
            let facts = &mirror[&ITEM];
            assert_eq!(facts.scene_placement, SceneAvailability::Unavailable);
            let EntityDescription::Known { stack_count, .. } = facts.description else {
                panic!("known stack");
            };
            assert_eq!(stack_count, expected);
        }
        let mut no_maximum = ObjectDescriptionData::with_guid(ITEM);
        no_maximum.public_weenie_desc.name = Some("Unestablished stack".into());
        no_maximum.public_weenie_desc.item_type = ItemType::FOOD.bits();
        no_maximum.public_weenie_desc.container_id = Some(PLAYER);
        no_maximum.public_weenie_desc.stack_size = Some(5);
        for event in world.handle_message(&GameMessage::ObjectCreate(Box::new(no_maximum))) {
            publisher.observe(&event);
        }
        assert_reconstructed(&mut world, &mut publisher, &mut mirror);
        assert!(matches!(
            mirror[&ITEM].description,
            EntityDescription::Known {
                stack_count: None,
                ..
            }
        ));
    }

    #[test]
    fn player_public_icon_wins_while_omitted_private_layers_survive_recreation() {
        use holtburger_common::properties::{PropertyDataId, PropertyInt};
        use holtburger_protocol::messages::{
            PrivateUpdatePropertyDataIdData, PrivateUpdatePropertyIntData,
        };
        use holtburger_world::entity_facts::{EntityDescription, EntityIconAppearance};

        let mut world = WorldState::synthetic();
        world.handle_message(&player_baseline());
        for (key, value) in [
            (PropertyDataId::Icon, 0x06000001),
            (PropertyDataId::IconOverlay, 0x06000002),
        ] {
            world.handle_message(&GameMessage::PrivateUpdatePropertyDataId(Box::new(
                PrivateUpdatePropertyDataIdData {
                    guid: Guid::NULL,
                    sequence: 1,
                    property: key as u32,
                    value: Guid(value),
                },
            )));
        }
        world.handle_message(&GameMessage::PrivateUpdatePropertyInt(Box::new(
            PrivateUpdatePropertyIntData {
                guid: Guid::NULL,
                sequence: 1,
                property: PropertyInt::UiEffects as u32,
                value: 7,
            },
        )));
        let mut description = ObjectDescriptionData::with_guid(PLAYER);
        description.public_weenie_desc.name = Some("Player".into());
        description.public_weenie_desc.icon_id = 0x06000003;
        for (overlay, effects, expected) in [
            (
                None,
                None,
                EntityIconAppearance {
                    base: Some(0x06000003),
                    overlay: Some(0x06000002),
                    underlay: None,
                    ui_effects: 7,
                },
            ),
            (
                Some(Guid::NULL),
                Some(0),
                EntityIconAppearance {
                    base: Some(0x06000003),
                    overlay: None,
                    underlay: None,
                    ui_effects: 0,
                },
            ),
        ] {
            description.public_weenie_desc.icon_overlay = overlay;
            description.public_weenie_desc.ui_effects = effects;
            world.handle_message(&GameMessage::ObjectCreate(Box::new(description.clone())));
            let EntityDescription::Known { icon, .. } = world
                .client_entity_facts(PLAYER)
                .unwrap()
                .unwrap()
                .description
            else {
                panic!("known player");
            };
            assert_eq!(icon, expected);
        }
    }

    #[test]
    fn icon_updates_and_recreation_reconstruct_the_same_inventory_only_facts_as_snapshots() {
        use holtburger_common::properties::{
            ItemType, PropertyDataId, PropertyInt, WorldObjectPropertyAccessors,
        };
        use holtburger_protocol::messages::{
            PublicUpdatePropertyDataIdData, PublicUpdatePropertyIntData,
        };
        use holtburger_world::entity_facts::{
            EntityDescription, EntityIconAppearance, SceneAvailability,
        };

        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        let mut publisher = EntityFactsPublication::default();
        let mut mirror = BTreeMap::new();
        let mut description = ObjectDescriptionData::with_guid(ITEM);
        description.public_weenie_desc.name = Some("Icon item".into());
        description.public_weenie_desc.item_type = ItemType::MELEE_WEAPON.bits();
        description.public_weenie_desc.container_id = Some(PLAYER);
        description.public_weenie_desc.icon_id = 0x06000001;
        description.public_weenie_desc.icon_overlay = Some(Guid(0x06000002));
        description.public_weenie_desc.icon_underlay = Some(Guid(0x06000003));
        let mut replacement = description.clone();
        replacement.public_weenie_desc.icon_id = 0x06000005;
        replacement.public_weenie_desc.icon_overlay = None;
        replacement.public_weenie_desc.icon_underlay = None;
        let update = |key: PropertyDataId, value| {
            GameMessage::PublicUpdatePropertyDataId(Box::new(PublicUpdatePropertyDataIdData {
                sequence: 1,
                guid: ITEM,
                property: key as u32,
                value: Guid(value),
            }))
        };
        let cases = [
            (
                GameMessage::ObjectCreate(Box::new(description)),
                (Some(0x06000001), Some(0x06000002), Some(0x06000003), 0),
            ),
            (
                update(PropertyDataId::Icon, 0x06000004),
                (Some(0x06000004), Some(0x06000002), Some(0x06000003), 0),
            ),
            (
                GameMessage::PublicUpdatePropertyInt(Box::new(PublicUpdatePropertyIntData {
                    sequence: 1,
                    guid: ITEM,
                    property: PropertyInt::UiEffects as u32,
                    value: 0x80000001u32 as i32,
                })),
                (
                    Some(0x06000004),
                    Some(0x06000002),
                    Some(0x06000003),
                    0x80000001,
                ),
            ),
            (
                update(PropertyDataId::IconOverlay, 0),
                (Some(0x06000004), None, Some(0x06000003), 0x80000001),
            ),
            (
                GameMessage::ObjectCreate(Box::new(replacement)),
                (Some(0x06000005), None, None, 0),
            ),
            (update(PropertyDataId::Icon, 0), (None, None, None, 0)),
        ];
        for (message, (base, overlay, underlay, ui_effects)) in cases {
            for change in world.handle_message(&message) {
                publisher.observe(&change);
            }
            assert_reconstructed(&mut world, &mut publisher, &mut mirror);
            let facts = &mirror[&ITEM];
            assert_eq!(facts.scene_placement, SceneAvailability::Unavailable);
            let EntityDescription::Known { icon, .. } = &facts.description else {
                panic!("known item");
            };
            assert_eq!(
                icon,
                &EntityIconAppearance {
                    base,
                    overlay,
                    underlay,
                    ui_effects
                }
            );
        }
        // A zero property update is the existing DID-removal primitive.
        assert_eq!(
            world
                .entities
                .get(ITEM)
                .unwrap()
                .get_data_prop(PropertyDataId::Icon),
            None
        );
        // A public description carries mandatory zero literally; the shared accessor
        // normalizes it while raw storage preserves its precedence over private values.
        let mut zero = ObjectDescriptionData::with_guid(ITEM);
        zero.public_weenie_desc.name = Some("No art".into());
        world.handle_message(&GameMessage::ObjectCreate(Box::new(zero)));
        assert_eq!(
            world
                .entities
                .get(ITEM)
                .unwrap()
                .properties
                .dids
                .get(&PropertyDataId::Icon),
            Some(&Guid::NULL)
        );
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

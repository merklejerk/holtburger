//! Narrow retained entity facts shared by inventory and selected-identity consumers.

use std::collections::BTreeSet;

use holtburger_common::{
    Guid,
    properties::{
        PropertyDataId, PropertyInt, PropertyString, WeenieType, WorldObjectExt,
        WorldObjectPropertyAccessors,
    },
};
use serde::{Deserialize, Serialize};

use crate::{
    WorldState,
    state::{
        ScenePlacementError,
        storage::{RosterCoverage, StorageLocation, StorageSlot},
    },
};

/// Whether the server supports a health subscription for the described object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthQueryEligibility {
    /// Public creature semantics; ACE health queries accept Creature instances.
    Eligible,
    /// A described non-creature has no creature-health subscription.
    Ineligible,
}

/// Server-authored inputs for UI icon composition, independent of scene appearance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIconAppearance {
    /// Base image DID; absent when no nonzero icon is supplied.
    pub base: Option<u32>,
    /// Authored artwork above the base, excluding the server's secondary-overlay scratch value.
    pub overlay: Option<u32>,
    /// Authored artwork below the working base/effects image.
    pub underlay: Option<u32>,
    /// Complete server effects mask; presentation chooses the retail mapping.
    pub ui_effects: u32,
}

/// Display facts become known independently of storage announcements.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EntityDescription {
    /// Identity exists but its public name/type are not yet known.
    Pending,
    /// Server-authored name and world-derived health applicability.
    Known {
        /// Consumed by item cells, container headers, and the selected HUD.
        name: String,
        /// Current quantity when MaxStackSize establishes stackability; consumed by item cells.
        #[serde(rename = "stackCount")]
        stack_count: Option<u32>,
        /// Consumed by inventory and other UI item-image presentation.
        icon: EntityIconAppearance,
        /// Public item classification consumed by frontend inventory type sorting.
        #[serde(rename = "itemType")]
        item_type: u32,
        /// Public object-description flags consumed by selected-entity diagnostics.
        #[serde(rename = "objectFlags")]
        object_flags: u32,
        /// Server template identity consumed by selected-entity diagnostics.
        wcid: Option<u32>,
        /// Optional local catalog classification, independent of scene residency.
        #[serde(rename = "weenieType")]
        weenie_type: Option<WeenieType>,
        /// Server-maintained coin total across the player's packs, unknown before receipt.
        #[serde(rename = "pyrealBalance")]
        pyreal_balance: Option<u32>,
        /// Consumed by the effective health subscription controller.
        #[serde(rename = "healthQuery")]
        health_query: HealthQueryEligibility,
    },
}

/// Storage relationship exposed to identity and inventory consumers without equipment masks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EntityStorageLocation {
    /// No accepted containment or equipment relationship.
    None,
    /// Direct parent and independently hydrated slot information.
    Contained {
        /// Parent identity used by frontend section grouping.
        #[serde(rename = "parentGuid")]
        parent_guid: Guid,
        /// Server placement category/order, not inferred from capacity.
        slot: StorageSlot,
    },
    /// Equipped items remain owned but do not occupy inventory grid cells.
    Equipped {
        /// Creature wearing the item, not implicitly the current player.
        #[serde(rename = "wearerGuid")]
        wearer_guid: Guid,
    },
}

/// Storage existence and roster receipt, independent of child description hydration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StorageCoverage {
    /// Neither received roster nor hydrated storage capability establishes storage.
    NotEstablished,
    /// World knows this object supplies storage, which may still await its roster.
    Container {
        /// Distinguishes known-empty storage from unknown contents.
        roster: ContainerRoster,
        /// Ordinary item-slot capacity for inventory section headers; absent before hydration.
        #[serde(rename = "itemCapacity")]
        item_capacity: Option<u32>,
        /// Pack-slot limit for the inventory container strip; absent before hydration.
        #[serde(rename = "packCapacity")]
        pack_capacity: Option<u32>,
    },
}

/// Roster coverage serialized separately from per-item pending descriptions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerRoster {
    /// No complete roster received.
    Awaiting,
    /// Complete direct roster received.
    Announced,
}

/// World placement availability is not renderer mesh residency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SceneAvailability {
    /// An independent or resolved attached placement exists.
    Available,
    /// The retained identity cannot currently be placed in the scene.
    Unavailable,
}

/// One accepted identity's facts; browser consumers never replay raw entity properties.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientEntityFacts {
    /// Stable key shared with selection and rendering.
    pub guid: Guid,
    /// Cell/header/HUD and health subscription facts.
    pub description: EntityDescription,
    /// Direct containment/equipment relationship for inventory grouping.
    pub location: EntityStorageLocation,
    /// Accepted recursive ownership, including unhydrated declarations.
    pub owned_by_player: bool,
    /// Scene capability independent of loaded renderer assets.
    pub scene_placement: SceneAvailability,
    /// Section existence and loading state.
    pub storage: StorageCoverage,
}

impl WorldState {
    /// Retained visible entities plus owned declarations and the established player root.
    pub fn client_entity_guids(&self) -> BTreeSet<Guid> {
        let mut guids: BTreeSet<_> = self
            .iter_visible_entities()
            .map(|entity| entity.guid)
            .collect();
        guids.extend(self.storage.owned_items(self.player.guid));
        if self.player.guid != Guid::NULL {
            guids.insert(self.player.guid);
        }
        guids
    }

    /// Project accepted facts without requiring rendering content or a physics body.
    pub fn client_entity_facts(
        &self,
        guid: Guid,
    ) -> Result<Option<ClientEntityFacts>, ScenePlacementError> {
        let entity = self.get_visible_entity(guid);
        let owned_by_player = self.storage.owned_by(guid, self.player.guid);
        // Deletion retires the old storage links at acceptance. Any later owned declaration
        // establishes a pending identity even while its deleted description awaits eviction.
        if entity.is_none() && !owned_by_player && (guid == Guid::NULL || guid != self.player.guid)
        {
            return Ok(None);
        }
        let description = match entity.and_then(|entity| {
            let name = entity.get_string_prop(PropertyString::Name)?;
            let item_type = entity.item_type()?;
            Some((entity, name, item_type))
        }) {
            Some((entity, name, item_type)) => EntityDescription::Known {
                name: name.to_owned(),
                stack_count: entity.is_stackable().then(|| entity.stack_size()),
                icon: EntityIconAppearance {
                    base: entity.get_data_prop(PropertyDataId::Icon).map(|id| id.0),
                    overlay: entity
                        .get_data_prop(PropertyDataId::IconOverlay)
                        .map(|id| id.0),
                    underlay: entity
                        .get_data_prop(PropertyDataId::IconUnderlay)
                        .map(|id| id.0),
                    ui_effects: entity.get_int_prop(PropertyInt::UiEffects).unwrap_or(0) as u32,
                },
                item_type: item_type.bits(),
                object_flags: entity.flags.bits(),
                wcid: entity.wcid,
                weenie_type: entity
                    .wcid
                    .and_then(|wcid| self.weenie_types.as_ref().and_then(|types| types.get(wcid))),
                pyreal_balance: entity
                    .get_int_prop(PropertyInt::CoinValue)
                    .map(|value| u32::try_from(value).expect("coin balance must be non-negative")),
                health_query: if item_type
                    .contains(holtburger_common::properties::ItemType::CREATURE)
                {
                    HealthQueryEligibility::Eligible
                } else {
                    HealthQueryEligibility::Ineligible
                },
            },
            None => EntityDescription::Pending,
        };
        let location = match self.storage_location(guid) {
            Some(StorageLocation::Contained { parent, slot }) => EntityStorageLocation::Contained {
                parent_guid: parent,
                slot,
            },
            Some(StorageLocation::Equipped { wearer, .. }) => EntityStorageLocation::Equipped {
                wearer_guid: wearer,
            },
            None => EntityStorageLocation::None,
        };
        let storage = match self.storage_coverage(guid) {
            Some(coverage) => StorageCoverage::Container {
                item_capacity: entity.and_then(|entity| entity.items_capacity()),
                pack_capacity: entity.and_then(|entity| entity.containers_capacity()),
                roster: match coverage {
                    RosterCoverage::Awaiting => ContainerRoster::Awaiting,
                    RosterCoverage::Announced => ContainerRoster::Announced,
                },
            },
            None if entity.is_some_and(|entity| entity.can_hold_items()) => {
                StorageCoverage::Container {
                    roster: ContainerRoster::Awaiting,
                    item_capacity: entity.and_then(|entity| entity.items_capacity()),
                    pack_capacity: entity.and_then(|entity| entity.containers_capacity()),
                }
            }
            None => StorageCoverage::NotEstablished,
        };
        let scene_placement = match self.resolve_scene_placement(guid)? {
            crate::ResolvedScenePlacement::Unresolved(_) => SceneAvailability::Unavailable,
            _ => SceneAvailability::Available,
        };
        Ok(Some(ClientEntityFacts {
            guid,
            description,
            location,
            owned_by_player,
            scene_placement,
            storage,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PhysicsAttachment, entity::Entity};
    use holtburger_common::{
        ParentLocation, Placement,
        properties::{EquipMask, ItemType, PropertyInt, WorldObjectPropertyAccessorsMut},
    };

    #[test]
    fn player_coin_total_is_unknown_until_the_server_supplies_it() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        world.player.guid = player;
        let mut entity = Entity::new(player, "Player".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(entity);
        assert!(matches!(
            world
                .client_entity_facts(player)
                .unwrap()
                .unwrap()
                .description,
            EntityDescription::Known {
                object_flags: 0,
                wcid: None,
                weenie_type: None,
                pyreal_balance: None,
                ..
            }
        ));
        world
            .entities
            .get_mut(player)
            .unwrap()
            .set_int_prop(PropertyInt::CoinValue, 12345);
        assert!(matches!(
            world
                .client_entity_facts(player)
                .unwrap()
                .unwrap()
                .description,
            EntityDescription::Known {
                pyreal_balance: Some(12345),
                ..
            }
        ));
    }

    #[test]
    fn container_capacity_tracks_hydration_and_property_updates() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        let bag = Guid(2);
        world.player.guid = player;
        world.storage.announce_container(bag, player);
        world.storage.replace_contents(bag, &[]);
        let storage = |world: &WorldState| world.client_entity_facts(bag).unwrap().unwrap().storage;
        assert_eq!(
            storage(&world),
            StorageCoverage::Container {
                roster: ContainerRoster::Announced,
                item_capacity: None,
                pack_capacity: None,
            }
        );
        let mut entity = Entity::new(bag, "Bag".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemsCapacity, 24);
        entity.set_int_prop(PropertyInt::ContainersCapacity, 7);
        world.entities.insert(entity);
        assert_eq!(
            storage(&world),
            StorageCoverage::Container {
                roster: ContainerRoster::Announced,
                item_capacity: Some(24),
                pack_capacity: Some(7),
            }
        );
        world
            .entities
            .get_mut(bag)
            .unwrap()
            .set_int_prop(PropertyInt::ItemsCapacity, 30);
        assert_eq!(
            storage(&world),
            StorageCoverage::Container {
                roster: ContainerRoster::Announced,
                item_capacity: Some(30),
                pack_capacity: Some(7),
            }
        );
    }

    #[test]
    fn equipped_identity_can_be_owned_and_scene_available_after_pending_hydration() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        let sword = Guid(2);
        world.player.guid = player;
        world
            .storage
            .equip(sword, player, Some(EquipMask::MELEE_WEAPON));
        let pending = world.client_entity_facts(sword).unwrap().unwrap();
        assert_eq!(pending.description, EntityDescription::Pending);
        assert!(pending.owned_by_player);
        assert_eq!(pending.scene_placement, SceneAvailability::Unavailable);
        assert_eq!(world.client_entity_guids(), BTreeSet::from([player, sword]));

        let mut root = Entity::new(player, "Player".into(), Default::default());
        root.position.landblock_id = Guid(0xda55_0001);
        world.entities.insert(root);
        let mut entity = Entity::new(sword, "Sword".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        entity.wcid = Some(123);
        entity.flags = holtburger_common::properties::ObjectDescriptionFlag::ATTACKABLE;
        entity.set_attachment(Some(PhysicsAttachment {
            parent: player,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        }));
        world.entities.insert(entity);
        let hydrated = world.client_entity_facts(sword).unwrap().unwrap();
        assert_eq!(
            hydrated.description,
            EntityDescription::Known {
                name: "Sword".into(),
                stack_count: None,
                icon: EntityIconAppearance {
                    base: None,
                    overlay: None,
                    underlay: None,
                    ui_effects: 0
                },
                item_type: ItemType::MELEE_WEAPON.bits(),
                object_flags: holtburger_common::properties::ObjectDescriptionFlag::ATTACKABLE
                    .bits(),
                wcid: Some(123),
                weenie_type: None,
                pyreal_balance: None,
                health_query: HealthQueryEligibility::Ineligible,
            }
        );
        assert!(hydrated.owned_by_player);
        assert_eq!(hydrated.scene_placement, SceneAvailability::Available);
        world.mark_entity_explicit_delete(sword);
        assert!(world.entities.get(sword).is_some());
        assert_eq!(world.client_entity_facts(sword).unwrap(), None);
    }

    #[test]
    fn missing_ancestor_does_not_delete_retained_creature_or_fabricate_parent_record() {
        let mut world = WorldState::synthetic();
        let creature = Guid(3);
        let absent_parent = Guid(4);
        let mut entity = Entity::new(creature, "Creature".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity.set_attachment(Some(PhysicsAttachment {
            parent: absent_parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        }));
        world.entities.insert(entity);
        let facts = world.client_entity_facts(creature).unwrap().unwrap();
        assert_eq!(
            facts.description,
            EntityDescription::Known {
                name: "Creature".into(),
                stack_count: None,
                icon: EntityIconAppearance {
                    base: None,
                    overlay: None,
                    underlay: None,
                    ui_effects: 0
                },
                item_type: ItemType::CREATURE.bits(),
                object_flags: 0,
                wcid: None,
                weenie_type: None,
                pyreal_balance: None,
                health_query: HealthQueryEligibility::Eligible,
            }
        );
        assert_eq!(facts.scene_placement, SceneAvailability::Unavailable);
        assert!(!facts.owned_by_player);
        assert_eq!(world.client_entity_facts(absent_parent).unwrap(), None);
        assert_eq!(world.client_entity_guids(), BTreeSet::from([creature]));
    }
}

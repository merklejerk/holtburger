//! Accepted storage relationships survive entity hydration and do not replay description parents.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use holtburger_common::{
    Guid,
    properties::{EquipMask, InventoryEntryKind},
};

/// Placement within one of the server's independent ordering domains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StorageSlot {
    /// The parent is known, but no ordered declaration has arrived.
    Pending,
    /// Ordinary inventory position.
    Item {
        /// Zero-based position in the parent's ordinary-item domain.
        index: u32,
    },
    /// Pack position, retaining the server's container/focus distinction.
    Pack {
        /// Zero-based position shared by containers and foci.
        index: u32,
        /// Received server classification; not storage capability.
        #[serde(rename = "entryKind")]
        kind: PackEntryKind,
    },
}

/// Server categories which occupy pack slots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackEntryKind {
    /// A server-classified container.
    Container,
    /// A focus; pack placement alone does not establish storage capability.
    Foci,
}

impl StorageSlot {
    /// Interpret a decoded category and its position without inspecting optional item properties.
    pub fn from_entry(kind: InventoryEntryKind, index: u32) -> Self {
        match kind {
            InventoryEntryKind::Item => Self::Item { index },
            InventoryEntryKind::Container => Self::Pack {
                index,
                kind: PackEntryKind::Container,
            },
            InventoryEntryKind::Foci => Self::Pack {
                index,
                kind: PackEntryKind::Foci,
            },
        }
    }

    fn ordered_index(self) -> Option<(bool, u32)> {
        match self {
            Self::Pending => None,
            Self::Item { index } => Some((false, index)),
            Self::Pack { index, .. } => Some((true, index)),
        }
    }

    fn set_index(&mut self, next: u32) {
        match self {
            Self::Pending => panic!("pending storage placement has no index"),
            Self::Item { index } | Self::Pack { index, .. } => *index = next,
        }
    }
}

/// One accepted storage relationship; physical attachment is a separate world fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageLocation {
    /// An item directly contained in a storage parent.
    Contained {
        /// Accepted direct storage parent.
        parent: Guid,
        /// Received placement, or explicit pending ordering.
        slot: StorageSlot,
    },
    /// An item worn by a creature; an IID can precede its equipment mask.
    Equipped {
        /// Accepted creature wearing this item.
        wearer: Guid,
        /// Absent when an IID precedes the equipment declaration.
        mask: Option<EquipMask>,
    },
}

impl StorageLocation {
    /// Immediate ownership ancestor, irrespective of description availability.
    pub fn parent(self) -> Guid {
        match self {
            Self::Contained { parent, .. } => parent,
            Self::Equipped { wearer, .. } => wearer,
        }
    }
}

/// Whether the server has announced a parent's complete direct contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RosterCoverage {
    /// Storage exists but its roster has not arrived.
    Awaiting,
    /// A roster was received; individual descriptions may still be missing.
    Announced,
}

/// Single owner of accepted storage declarations. Callers cannot independently mutate locations.
#[derive(Debug, Default)]
pub(crate) struct StorageState {
    locations: BTreeMap<Guid, StorageLocation>,
    rosters: BTreeMap<Guid, RosterCoverage>,
    changed: BTreeSet<Guid>,
}

impl StorageState {
    pub(crate) fn location(&self, guid: Guid) -> Option<StorageLocation> {
        self.locations.get(&guid).copied()
    }

    pub(crate) fn coverage(&self, parent: Guid) -> Option<RosterCoverage> {
        self.rosters.get(&parent).copied()
    }

    pub(crate) fn establish_container(&mut self, parent: Guid) {
        if let std::collections::btree_map::Entry::Vacant(entry) = self.rosters.entry(parent) {
            entry.insert(RosterCoverage::Awaiting);
            self.changed.insert(parent);
        }
    }

    pub(crate) fn owned_by(&self, guid: Guid, owner: Guid) -> bool {
        if owner == Guid::NULL || guid == owner {
            return false;
        }
        let mut current = guid;
        while let Some(location) = self.locations.get(&current) {
            current = location.parent();
            if current == owner {
                return true;
            }
        }
        false
    }

    pub(crate) fn owned_items(&self, owner: Guid) -> impl Iterator<Item = Guid> + '_ {
        self.locations
            .keys()
            .copied()
            .filter(move |guid| self.owned_by(*guid, owner))
    }

    pub(crate) fn equipment(
        &self,
        wearer: Guid,
    ) -> impl Iterator<Item = (Guid, Option<EquipMask>)> + '_ {
        self.locations
            .iter()
            .filter_map(move |(guid, location)| match location {
                StorageLocation::Equipped {
                    wearer: parent,
                    mask,
                } if *parent == wearer => Some((*guid, *mask)),
                _ => None,
            })
    }

    fn validate_parent(&self, guid: Guid, parent: Guid) {
        assert_ne!(
            parent,
            Guid::NULL,
            "null storage parent is a withdrawal, not a location"
        );
        let mut current = parent;
        loop {
            assert_ne!(
                guid, current,
                "storage declaration introduces an ownership cycle"
            );
            let Some(location) = self.locations.get(&current) else {
                break;
            };
            current = location.parent();
        }
    }

    fn shift_slots(&mut self, parent: Guid, slot: StorageSlot, insertion: bool) {
        let Some((pack_domain, index)) = slot.ordered_index() else {
            return;
        };
        for (guid, location) in &mut self.locations {
            let StorageLocation::Contained {
                parent: candidate_parent,
                slot: candidate,
            } = location
            else {
                continue;
            };
            let Some((candidate_domain, candidate_index)) = candidate.ordered_index() else {
                continue;
            };
            if *candidate_parent == parent
                && candidate_domain == pack_domain
                && (candidate_index > index || (insertion && candidate_index == index))
            {
                self.changed.insert(*guid);
                candidate.set_index(if insertion {
                    candidate_index
                        .checked_add(1)
                        .expect("storage slot index overflow")
                } else {
                    candidate_index - 1
                });
            }
        }
    }

    /// Withdraw a root relationship without destroying its retained internal contents.
    pub(crate) fn withdraw(&mut self, guid: Guid) {
        if let Some(location) = self.locations.remove(&guid) {
            self.changed.insert(guid);
            self.changed.insert(location.parent());
            if let StorageLocation::Contained { parent, slot } = location {
                self.shift_slots(parent, slot, false);
            }
        }
    }

    pub(crate) fn place(&mut self, guid: Guid, parent: Guid, slot: StorageSlot) {
        self.validate_parent(guid, parent);
        self.changed.extend([guid, parent]);
        self.withdraw(guid);
        self.shift_slots(parent, slot, true);
        self.locations
            .insert(guid, StorageLocation::Contained { parent, slot });
        self.establish_container(parent);
    }

    /// Repeated property confirmation must not erase the ordered containment declaration.
    pub(crate) fn announce_container(&mut self, guid: Guid, parent: Guid) {
        if parent == Guid::NULL {
            if matches!(self.location(guid), Some(StorageLocation::Contained { .. })) {
                self.withdraw(guid);
            }
        } else if !matches!(self.location(guid), Some(StorageLocation::Contained { parent: current, .. }) if current == parent)
        {
            self.place(guid, parent, StorageSlot::Pending);
        }
    }

    pub(crate) fn equip(&mut self, guid: Guid, wearer: Guid, mask: Option<EquipMask>) {
        self.validate_parent(guid, wearer);
        self.changed.extend([guid, wearer]);
        let mask = mask.or_else(|| match self.location(guid) {
            Some(StorageLocation::Equipped {
                wearer: previous,
                mask,
            }) if previous == wearer => mask,
            _ => None,
        });
        self.withdraw(guid);
        self.locations
            .insert(guid, StorageLocation::Equipped { wearer, mask });
    }

    /// Replace direct membership. Container and focus entries share the pack index sequence.
    pub(crate) fn replace_contents(
        &mut self,
        parent: Guid,
        entries: &[(Guid, InventoryEntryKind)],
    ) {
        let mut unique = BTreeSet::new();
        for (guid, _) in entries {
            assert!(unique.insert(*guid), "duplicate item in storage roster");
            self.validate_parent(*guid, parent);
        }
        self.changed.insert(parent);
        self.changed.extend(unique);
        self.changed.extend(self.locations.iter().filter_map(|(guid, location)| {
            matches!(location, StorageLocation::Contained { parent: current, .. } if *current == parent).then_some(*guid)
        }));
        self.locations.retain(|_, location| !matches!(location, StorageLocation::Contained { parent: current, .. } if *current == parent));
        let mut item_index = 0;
        let mut pack_index = 0;
        for (guid, kind) in entries {
            let index = if *kind == InventoryEntryKind::Item {
                &mut item_index
            } else {
                &mut pack_index
            };
            self.withdraw(*guid);
            self.locations.insert(
                *guid,
                StorageLocation::Contained {
                    parent,
                    slot: StorageSlot::from_entry(*kind, *index),
                },
            );
            *index += 1;
        }
        self.rosters.insert(parent, RosterCoverage::Announced);
    }

    /// A new player baseline cannot inherit old child rosters through matching GUIDs.
    pub(crate) fn reset(&mut self) {
        self.changed.extend(self.locations.keys().copied());
        self.changed.extend(self.rosters.keys().copied());
        self.locations.clear();
        self.rosters.clear();
    }

    /// Actual retirement disposes direct links as well as the parent's roster.
    pub(crate) fn retire(&mut self, guid: Guid) {
        self.withdraw(guid);
        self.changed.insert(guid);
        self.locations.retain(|child, location| {
            if location.parent() == guid {
                self.changed.insert(*child);
                false
            } else {
                true
            }
        });
        self.rosters.remove(&guid);
    }
}

impl super::WorldState {
    /// Drain record invalidation from storage statements, including statements for missing entities.
    /// Core also compares old/new owned closures to include descendants of changed ancestors.
    pub fn take_storage_changes(&mut self) -> BTreeSet<Guid> {
        std::mem::take(&mut self.storage.changed)
    }

    /// Accepted location, available even when the item's description has not arrived.
    pub fn storage_location(&self, guid: Guid) -> Option<StorageLocation> {
        self.storage.location(guid)
    }

    /// Current accepted player equipment, excluding masks which have not been announced yet.
    pub fn player_equipment(&self) -> impl Iterator<Item = (Guid, EquipMask)> + '_ {
        self.storage
            .equipment(self.player.guid)
            .filter_map(|(guid, mask)| mask.map(|mask| (guid, mask)))
    }

    /// Roster coverage is independent of child description hydration.
    pub fn storage_coverage(&self, guid: Guid) -> Option<RosterCoverage> {
        self.storage.coverage(guid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAYER: Guid = Guid(1);
    const PACK: Guid = Guid(2);
    const ITEM: Guid = Guid(3);
    const FOCUS: Guid = Guid(4);

    #[test]
    fn rosters_retain_missing_items_and_independent_slot_domains() {
        let mut state = StorageState::default();
        state.replace_contents(
            PLAYER,
            &[
                (PACK, InventoryEntryKind::Container),
                (ITEM, InventoryEntryKind::Item),
                (FOCUS, InventoryEntryKind::Foci),
            ],
        );
        assert_eq!(state.coverage(PLAYER), Some(RosterCoverage::Announced));
        assert_eq!(
            state.location(ITEM),
            Some(StorageLocation::Contained {
                parent: PLAYER,
                slot: StorageSlot::Item { index: 0 }
            })
        );
        assert_eq!(
            state.location(FOCUS),
            Some(StorageLocation::Contained {
                parent: PLAYER,
                slot: StorageSlot::Pack {
                    index: 1,
                    kind: PackEntryKind::Foci
                }
            })
        );
        assert_eq!(
            state.owned_items(PLAYER).collect::<Vec<_>>(),
            vec![PACK, ITEM, FOCUS]
        );
        assert_eq!(state.coverage(FOCUS), None);
    }

    #[test]
    fn replacement_does_not_withdraw_an_item_moved_to_another_parent() {
        let mut state = StorageState::default();
        state.replace_contents(
            PLAYER,
            &[
                (PACK, InventoryEntryKind::Container),
                (ITEM, InventoryEntryKind::Item),
            ],
        );
        state.place(ITEM, PACK, StorageSlot::Item { index: 0 });
        state.replace_contents(PLAYER, &[(PACK, InventoryEntryKind::Container)]);
        assert!(state.owned_by(ITEM, PLAYER));
        state.replace_contents(PACK, &[]);
        assert!(!state.owned_by(ITEM, PLAYER));
        assert_eq!(state.coverage(PACK), Some(RosterCoverage::Announced));
    }

    #[test]
    fn parent_confirmation_preserves_slot_and_withdrawal_preserves_contents() {
        let mut state = StorageState::default();
        state.place(
            PACK,
            PLAYER,
            StorageSlot::Pack {
                index: 0,
                kind: PackEntryKind::Container,
            },
        );
        state.place(ITEM, PACK, StorageSlot::Item { index: 0 });
        state.announce_container(ITEM, PACK);
        assert_eq!(
            state.location(ITEM),
            Some(StorageLocation::Contained {
                parent: PACK,
                slot: StorageSlot::Item { index: 0 }
            })
        );
        state.withdraw(PACK);
        assert!(!state.owned_by(ITEM, PLAYER));
        assert_eq!(
            state.location(ITEM).map(StorageLocation::parent),
            Some(PACK)
        );
        state.announce_container(PACK, PLAYER);
        assert!(state.owned_by(ITEM, PLAYER));
        state.retire(PACK);
        assert_eq!(state.location(ITEM), None);
    }

    #[test]
    fn moving_within_domain_shifts_only_that_domain() {
        let mut state = StorageState::default();
        state.replace_contents(
            PLAYER,
            &[
                (PACK, InventoryEntryKind::Container),
                (ITEM, InventoryEntryKind::Item),
                (FOCUS, InventoryEntryKind::Foci),
            ],
        );
        state.place(
            FOCUS,
            PLAYER,
            StorageSlot::Pack {
                index: 0,
                kind: PackEntryKind::Foci,
            },
        );
        assert_eq!(
            state.location(PACK),
            Some(StorageLocation::Contained {
                parent: PLAYER,
                slot: StorageSlot::Pack {
                    index: 1,
                    kind: PackEntryKind::Container
                }
            })
        );
        assert_eq!(
            state.location(ITEM),
            Some(StorageLocation::Contained {
                parent: PLAYER,
                slot: StorageSlot::Item { index: 0 }
            })
        );
    }

    #[test]
    fn equipment_iid_can_precede_mask_without_losing_ownership() {
        let mut state = StorageState::default();
        state.equip(ITEM, PLAYER, None);
        assert!(state.owned_by(ITEM, PLAYER));
        state.equip(ITEM, PLAYER, Some(EquipMask::MELEE_WEAPON));
        state.equip(ITEM, PLAYER, None);
        assert_eq!(
            state.equipment(PLAYER).collect::<Vec<_>>(),
            vec![(ITEM, Some(EquipMask::MELEE_WEAPON))]
        );
    }

    #[test]
    #[should_panic(expected = "storage declaration introduces an ownership cycle")]
    fn reject_parent_cycle_before_mutation() {
        let mut state = StorageState::default();
        state.announce_container(PACK, PLAYER);
        state.announce_container(ITEM, PACK);
        state.announce_container(PACK, ITEM);
    }
}

#[cfg(test)]
mod message_tests {
    use super::*;
    use crate::{WorldState, context::WorldContextExt};
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
        ObjectDescriptionData, ViewContentsEventData, ViewContentsEventItem,
    };

    const PLAYER: Guid = Guid(1);
    const PACK: Guid = Guid(2);
    const ITEM: Guid = Guid(3);

    fn apply_event(world: &mut WorldState, event: GameEvent) {
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event,
        })));
    }

    fn place(world: &mut WorldState, item: Guid, parent: Guid, kind: InventoryEntryKind) {
        apply_event(
            world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: item,
                container_guid: parent,
                slot: 0,
                container_type: kind,
            })),
        );
    }

    fn describe(world: &mut WorldState, guid: Guid, parent: Guid) {
        let mut description = ObjectDescriptionData::with_guid(guid);
        description.public_weenie_desc.name = Some("Item".into());
        description.public_weenie_desc.container_id = Some(parent);
        world.handle_message(&GameMessage::ObjectCreate(Box::new(description)));
    }

    #[test]
    fn late_description_cannot_overwrite_declared_parent_or_restore_omitted_item() {
        let mut world = WorldState::synthetic();
        world.player.guid = PLAYER;
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        place(&mut world, ITEM, PACK, InventoryEntryKind::Item);
        describe(&mut world, ITEM, PLAYER);
        assert_eq!(
            world.storage_location(ITEM),
            Some(StorageLocation::Contained {
                parent: PACK,
                slot: StorageSlot::Item { index: 0 }
            })
        );
        assert!(world.is_owned_by_player(ITEM));
        apply_event(
            &mut world,
            GameEvent::ViewContents(Box::new(ViewContentsEventData {
                container: PACK,
                items: vec![],
            })),
        );
        describe(&mut world, ITEM, PLAYER);
        assert!(!world.is_owned_by_player(ITEM));
        assert_eq!(world.storage_location(ITEM), None);
        place(&mut world, ITEM, PLAYER, InventoryEntryKind::Item);
        assert!(world.is_owned_by_player(ITEM));
    }

    #[test]
    fn accepted_parent_delete_retires_roster_before_eviction_and_readmission() {
        let mut world = WorldState::synthetic();
        world.player.guid = PLAYER;
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        describe(&mut world, PACK, PLAYER);
        place(&mut world, ITEM, PACK, InventoryEntryKind::Item);
        world.take_storage_changes();

        world.handle_message(&GameMessage::ObjectDelete(Box::new(
            holtburger_protocol::messages::ObjectDeleteData {
                guid: PACK,
                instance_sequence: 0,
            },
        )));
        assert!(
            world.entities.get(PACK).is_some(),
            "scene eviction is deferred"
        );
        assert_eq!(world.storage_coverage(PACK), None);
        assert_eq!(world.storage_location(ITEM), None);
        assert!(world.take_storage_changes().contains(&ITEM));

        // A newer incarnation and explicit location can admit the pack, not its old contents.
        let mut replacement =
            crate::entity::Entity::new(PACK, "Replacement".into(), Default::default());
        replacement.apply_remote_position_sample(Default::default(), 1, 0, 0);
        world.upsert_entity_from_create(replacement, &mut Vec::new());
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        assert!(world.is_entity_client_visible(PACK));
        assert!(world.is_owned_by_player(PACK));
        assert!(!world.is_owned_by_player(ITEM));
    }

    #[test]
    fn queued_delete_retires_pending_storage_only_when_matching_description_arrives() {
        let mut world = WorldState::synthetic();
        world.player.guid = PLAYER;
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        place(&mut world, ITEM, PACK, InventoryEntryKind::Item);
        world.handle_message(&GameMessage::ObjectDelete(Box::new(
            holtburger_protocol::messages::ObjectDeleteData {
                guid: PACK,
                instance_sequence: 0,
            },
        )));
        assert!(world.is_owned_by_player(ITEM));
        describe(&mut world, PACK, PLAYER);
        assert!(!world.is_owned_by_player(PACK));
        assert!(!world.is_owned_by_player(ITEM));
        assert_eq!(world.storage_coverage(PACK), None);
        assert_eq!(world.storage_location(ITEM), None);
    }

    #[test]
    fn later_owned_announcements_survive_eviction_of_a_deleted_description() {
        use crate::entity_facts::EntityDescription;

        let mut world = WorldState::synthetic();
        world.player.guid = PLAYER;
        describe(&mut world, PACK, PLAYER);
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        world.handle_message(&GameMessage::InventoryRemoveObject(Box::new(
            holtburger_protocol::messages::InventoryRemoveObjectData { object_guid: PACK },
        )));
        assert_eq!(world.client_entity_facts(PACK).unwrap(), None);
        // These later declarations establish a new pending identity, not its deleted description.
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        place(&mut world, ITEM, PACK, InventoryEntryKind::Item);
        let pending = world
            .client_entity_facts(PACK)
            .unwrap()
            .expect("announced parent must be represented");
        assert_eq!(pending.description, EntityDescription::Pending);
        assert!(pending.owned_by_player);

        world.tick();
        assert!(world.entities.get(PACK).is_none());
        assert_eq!(world.client_entity_facts(PACK).unwrap(), Some(pending));
        assert!(world.is_owned_by_player(ITEM));
        describe(&mut world, PACK, PLAYER);
        assert!(matches!(
            world
                .client_entity_facts(PACK)
                .unwrap()
                .unwrap()
                .description,
            EntityDescription::Known { .. }
        ));
        assert!(world.is_owned_by_player(ITEM));
    }

    #[test]
    fn announced_missing_child_blocks_readiness_until_description_arrives() {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        place(&mut world, PACK, PLAYER, InventoryEntryKind::Container);
        describe(&mut world, PACK, PLAYER);
        apply_event(
            &mut world,
            GameEvent::ViewContents(Box::new(ViewContentsEventData {
                container: PACK,
                items: vec![ViewContentsEventItem {
                    guid: ITEM,
                    container_type: InventoryEntryKind::Item,
                }],
            })),
        );
        assert!(!world.all_player_contained_objects_exist());
        assert!(world.is_owned_by_player(ITEM));
        describe(&mut world, ITEM, PACK);
        assert!(world.all_player_contained_objects_exist());
    }
}

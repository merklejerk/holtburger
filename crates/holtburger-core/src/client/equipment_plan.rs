//! Pure single-item equipment planning; no commands are sent while allocating storage.

use holtburger_common::{
    Guid,
    properties::{EquipMask, WorldObjectExt},
};
use holtburger_world::{
    WorldState,
    context::{WorldContext, WorldContextExt},
    equipment::{EquipmentFacts, EquipmentFactsError},
    state::storage::StorageLocation,
};

use super::{
    inventory_storage::{
        EquipmentStoragePolicy, InventoryInsertion, StorageAllocationError,
        allocate_equipment_storage,
    },
    types::TargetSlot,
};

/// One displaced item and the exact destination allocated before execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EquipmentUnequip {
    /// Item whose authoritative equipped location must be cleared.
    pub item: Guid,
    /// Current location used to detect an incompatible change before sending.
    pub from: EquipMask,
    /// Selected carried container, including the player root.
    pub container: Guid,
    /// Native insertion index after earlier planned unequips.
    pub placement: u32,
}

/// Complete, locally feasible replacement; server wield admission can still reject it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EquipmentPlan {
    /// Incoming item identity.
    pub item: Guid,
    /// Original ownership/location; execution preserves the relationship while indices may shift.
    pub source: StorageLocation,
    /// Insertion preference used to revalidate the remaining conflict removals.
    pub insertion: InventoryInsertion,
    /// Caller-selected preferences retained unchanged during execution revalidation.
    pub storage: EquipmentStoragePolicy,
    /// Exact wire wield location, including complete apparel coverage.
    pub target: EquipMask,
    /// Ordered removals which must succeed before wielding.
    pub unequips: Vec<EquipmentUnequip>,
}

/// Resolved equipment semantics before a caller reserves inventory destinations.
#[derive(Debug, Clone)]
pub(super) struct EquipmentReplacement {
    /// Incoming item identity.
    pub item: Guid,
    /// Accepted ownership location consumed by storage preference and movement planning.
    pub source: StorageLocation,
    /// Incoming facts also consumed by equipment-set compatibility checks.
    pub facts: EquipmentFacts,
    /// Exact wire destination, including full apparel coverage.
    pub target: EquipMask,
    /// Current conflicts; set planning reserves each displaced identity only once.
    pub conflicts: Vec<(Guid, EquipMask)>,
}

/// Local admission failures are feedback, never transport/runtime errors.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EquipmentPlanError {
    /// Description or accepted equipment location is incomplete.
    #[error("Equipment facts for {0} have not arrived")]
    MissingEntity(Guid),
    /// A replacement request is restricted to player-owned items.
    #[error("Item {0} is not owned by the player")]
    NotOwned(Guid),
    /// The requested side/location is not valid for the incoming item.
    #[error("Item cannot be equipped in that slot")]
    InvalidTarget,
    /// Public equipment fields required for safe conflict planning are missing.
    #[error(transparent)]
    Facts(#[from] EquipmentFactsError),
    /// Shared destination allocation failure.
    #[error(transparent)]
    Storage(#[from] StorageAllocationError),
}

/// Allocate replacement capacity with the caller's container and insertion preferences.
pub fn plan_equipment_change(
    world: &WorldState,
    item: Guid,
    slot: Option<TargetSlot>,
    insertion: InventoryInsertion,
    storage: &EquipmentStoragePolicy,
) -> Result<EquipmentPlan, EquipmentPlanError> {
    let replacement = resolve_equipment_change(world, item, slot)?;
    let storage_items = replacement
        .conflicts
        .iter()
        .map(|(guid, _)| {
            world
                .entities
                .get(*guid)
                .map(|entity| (*guid, entity.uses_player_container_slot()))
                .ok_or(EquipmentPlanError::MissingEntity(*guid))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let destinations = allocate_equipment_storage(world, storage, &storage_items, &[])?;
    let unequips = replacement
        .conflicts
        .into_iter()
        .zip(destinations)
        .map(|((guid, from), destination)| EquipmentUnequip {
            item: guid,
            from,
            container: destination.container,
            placement: insertion.position(destination.placement),
        })
        .collect();
    Ok(EquipmentPlan {
        insertion,
        storage: storage.clone(),
        item,
        source: replacement.source,
        target: replacement.target,
        unequips,
    })
}

/// Resolve ownership, requested location, and conflicts without allocating storage.
pub(super) fn resolve_equipment_change(
    world: &WorldState,
    item: Guid,
    slot: Option<TargetSlot>,
) -> Result<EquipmentReplacement, EquipmentPlanError> {
    if !world.is_owned_by_player(item) {
        return Err(EquipmentPlanError::NotOwned(item));
    }
    let source = world
        .storage_location(item)
        .ok_or(EquipmentPlanError::NotOwned(item))?;
    let incoming = EquipmentFacts::from_entity(
        world
            .entities
            .get(item)
            .ok_or(EquipmentPlanError::MissingEntity(item))?,
    )?;
    let equipment = world
        .iter_equipment()
        .map(|guid| {
            let mask = world
                .equipment_mask(guid)
                .ok_or(EquipmentPlanError::MissingEntity(guid))?;
            let facts = EquipmentFacts::from_entity(
                world
                    .entities
                    .get(guid)
                    .ok_or(EquipmentPlanError::MissingEntity(guid))?,
            )?;
            Ok((guid, mask, facts))
        })
        .collect::<Result<Vec<_>, EquipmentPlanError>>()?;
    let automatic = matches!(slot, None | Some(TargetSlot::PreferredSide { .. }));
    let requested = match slot {
        Some(TargetSlot::PreferredSide { alternate }) => incoming.preferred_side_request(alternate),
        Some(TargetSlot::EquipMask(mask)) => mask,
        None => incoming.valid_locations,
    };
    let target = incoming
        .resolve_location(requested)
        .or_else(|| {
            // Default jewelry use chooses a free side first, then the first allowed
            // side. An explicit multi-side request remains invalid.
            if !automatic {
                return None;
            }
            let candidates = incoming.valid_locations;
            let jewelry = EquipMask::WRIST_WEAR_LEFT
                | EquipMask::WRIST_WEAR_RIGHT
                | EquipMask::FINGER_WEAR_LEFT
                | EquipMask::FINGER_WEAR_RIGHT;
            if !jewelry.contains(candidates) {
                return None;
            }
            candidates
                .iter()
                .find(|candidate| {
                    !equipment
                        .iter()
                        .any(|(_, mask, _)| mask.intersects(*candidate))
                })
                .or_else(|| candidates.iter().next())
        })
        .ok_or(EquipmentPlanError::InvalidTarget)?;
    let conflicts = equipment
        .into_iter()
        .filter(|(guid, mask, facts)| {
            *guid != item && incoming.conflicts_with(target, *facts, *mask)
        })
        .map(|(guid, mask, _)| (guid, mask))
        .collect();
    Ok(EquipmentReplacement {
        item,
        source,
        facts: incoming,
        target,
        conflicts,
    })
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use holtburger_common::properties::{InventoryEntryKind, ItemType, PropertyInt};
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
        ViewContentsEventData, ViewContentsEventItem, WieldObjectEventData,
    };
    use holtburger_world::entity::Entity;
    use holtburger_world::equipment::MAIN_HAND_LOCATIONS;

    /// Explicit Main-Pack-first caller policy for shared planner fixtures.
    pub(in crate::client) fn storage_policy(world: &WorldState) -> EquipmentStoragePolicy {
        let mut packs: Vec<_> = world
            .container_contents(world.player.guid)
            .filter_map(|(guid, slot)| match slot {
                holtburger_world::state::storage::StorageSlot::Pack {
                    index,
                    kind: holtburger_world::state::storage::PackEntryKind::Container,
                } => Some((index, guid)),
                _ => None,
            })
            .collect();
        packs.sort_unstable();
        EquipmentStoragePolicy {
            preferred: Default::default(),
            fallback: std::iter::once(world.player.guid)
                .chain(packs.into_iter().map(|(_, guid)| guid))
                .collect(),
        }
    }

    const PLAYER: Guid = Guid(1);
    const PACK: Guid = Guid(2);
    const INCOMING: Guid = Guid(3);
    const CHEST: Guid = Guid(4);
    const ARMS: Guid = Guid(5);

    pub(in crate::client) fn event(world: &mut WorldState, event: GameEvent) {
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event,
        })));
    }

    fn roster(world: &mut WorldState, container: Guid, entries: &[(Guid, InventoryEntryKind)]) {
        event(
            world,
            GameEvent::ViewContents(Box::new(ViewContentsEventData {
                container,
                items: entries
                    .iter()
                    .map(|(guid, container_type)| ViewContentsEventItem {
                        guid: *guid,
                        container_type: *container_type,
                    })
                    .collect(),
            })),
        );
    }

    pub(in crate::client) fn outfit(root_capacity: i32, pack_capacity: i32) -> WorldState {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        world
            .entities
            .get_mut(PLAYER)
            .expect("player")
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, root_capacity);
        let mut pack = Entity::new(PACK, "Pack".into(), Default::default());
        pack.properties
            .ints
            .insert(PropertyInt::ItemsCapacity, pack_capacity);
        world.entities.insert(pack);
        let coverage = EquipMask::CHEST_ARMOR | EquipMask::UPPER_ARM_ARMOR;
        for (guid, locations, priority) in [
            (INCOMING, coverage, 3),
            (CHEST, EquipMask::CHEST_ARMOR, 1),
            (ARMS, EquipMask::UPPER_ARM_ARMOR, 2),
        ] {
            let mut item = Entity::new(guid, "Armor".into(), Default::default());
            for (property, value) in [
                (PropertyInt::ValidLocations, locations.bits() as i32),
                (PropertyInt::ClothingPriority, priority),
                (PropertyInt::ItemType, ItemType::ARMOR.bits() as i32),
            ] {
                item.properties.ints.insert(property, value);
            }
            world.entities.insert(item);
        }
        roster(&mut world, PLAYER, &[(PACK, InventoryEntryKind::Container)]);
        roster(&mut world, PACK, &[(INCOMING, InventoryEntryKind::Item)]);
        for (guid, mask) in [
            (CHEST, EquipMask::CHEST_ARMOR),
            (ARMS, EquipMask::UPPER_ARM_ARMOR),
        ] {
            event(
                &mut world,
                GameEvent::WieldObject(Box::new(WieldObjectEventData {
                    object_guid: guid,
                    equip_mask: mask,
                })),
            );
        }
        world
    }

    #[test]
    fn preferred_hand_respects_eligibility_and_other_equipment_defaults() {
        for (locations, item_type, off_target) in [
            (
                EquipMask::MELEE_WEAPON,
                ItemType::MELEE_WEAPON,
                EquipMask::SHIELD,
            ),
            (
                EquipMask::CASTER | EquipMask::SHIELD,
                ItemType::CASTER,
                EquipMask::SHIELD,
            ),
            (EquipMask::CASTER, ItemType::CASTER, EquipMask::CASTER),
            (
                EquipMask::TWO_HANDED,
                ItemType::MELEE_WEAPON,
                EquipMask::TWO_HANDED,
            ),
            (EquipMask::SHIELD, ItemType::ARMOR, EquipMask::SHIELD),
        ] {
            let mut world = outfit(10, 10);
            let item = world.entities.get_mut(INCOMING).expect("incoming");
            item.properties
                .ints
                .insert(PropertyInt::ValidLocations, locations.bits() as i32);
            item.properties
                .ints
                .insert(PropertyInt::ItemType, item_type.bits() as i32);
            for alternate in [false, true] {
                let plan = plan_equipment_change(
                    &world,
                    INCOMING,
                    Some(TargetSlot::PreferredSide { alternate }),
                    Default::default(),
                    &storage_policy(&world),
                )
                .expect("valid preference");
                let main = locations & MAIN_HAND_LOCATIONS;
                let expected = if !alternate && !main.is_empty() {
                    main
                } else {
                    off_target
                };
                assert_eq!(plan.target, expected);
            }
            event(
                &mut world,
                GameEvent::WieldObject(Box::new(WieldObjectEventData {
                    object_guid: INCOMING,
                    equip_mask: off_target,
                })),
            );
            let moved = plan_equipment_change(
                &world,
                INCOMING,
                Some(TargetSlot::PreferredSide { alternate: false }),
                Default::default(),
                &storage_policy(&world),
            )
            .expect("already worn item remains movable");
            let main = locations & MAIN_HAND_LOCATIONS;
            assert_eq!(
                moved.target,
                if main.is_empty() { off_target } else { main }
            );
        }
    }

    #[test]
    fn jewelry_side_policy_reapplies_current_occupancy_with_shift_override() {
        for (left, right) in [
            (EquipMask::FINGER_WEAR_LEFT, EquipMask::FINGER_WEAR_RIGHT),
            (EquipMask::WRIST_WEAR_LEFT, EquipMask::WRIST_WEAR_RIGHT),
        ] {
            // Incoming may be carried or already on either side. Other occupants
            // remain real blockers, including when Shift replaces an occupied right side.
            for incoming_side in [None, Some(left), Some(right)] {
                for occupied in [EquipMask::NONE, left, right, left | right] {
                    if incoming_side.is_some_and(|side| occupied.intersects(side)) {
                        continue;
                    }
                    let mut world = outfit(10, 10);
                    for guid in [INCOMING, CHEST, ARMS] {
                        let item = world.entities.get_mut(guid).expect("jewelry fixture");
                        item.properties
                            .ints
                            .insert(PropertyInt::ValidLocations, (left | right).bits() as i32);
                        item.properties
                            .ints
                            .insert(PropertyInt::ItemType, ItemType::JEWELRY.bits() as i32);
                    }
                    for (guid, side) in [(CHEST, left), (ARMS, right)] {
                        if occupied.intersects(side) {
                            event(
                                &mut world,
                                GameEvent::WieldObject(Box::new(WieldObjectEventData {
                                    object_guid: guid,
                                    equip_mask: side,
                                })),
                            );
                        } else {
                            // Remove the fixture's initial armor equipment through the world event path.
                            event(
                                &mut world,
                                GameEvent::InventoryPutObjInContainer(Box::new(
                                    InventoryPutObjInContainerEventData {
                                        item_guid: guid,
                                        container_guid: PACK,
                                        slot: 0,
                                        container_type: InventoryEntryKind::Item,
                                    },
                                )),
                            );
                        }
                    }
                    if let Some(side) = incoming_side {
                        event(
                            &mut world,
                            GameEvent::WieldObject(Box::new(WieldObjectEventData {
                                object_guid: INCOMING,
                                equip_mask: side,
                            })),
                        );
                    }
                    let all_occupied = occupied | incoming_side.unwrap_or(EquipMask::NONE);
                    for alternate in [false, true] {
                        let expected = if alternate
                            || (all_occupied.contains(left) && !all_occupied.contains(right))
                        {
                            right
                        } else {
                            left
                        };
                        let plan = plan_equipment_change(
                            &world,
                            INCOMING,
                            Some(TargetSlot::PreferredSide { alternate }),
                            Default::default(),
                            &storage_policy(&world),
                        )
                        .expect("jewelry plan");
                        assert_eq!(plan.target, expected);
                        let displaced: Vec<_> =
                            plan.unequips.iter().map(|item| item.item).collect();
                        let expected_displaced = if occupied.intersects(expected) {
                            vec![if expected == left { CHEST } else { ARMS }]
                        } else {
                            vec![]
                        };
                        assert_eq!(displaced, expected_displaced);
                    }
                }
            }
        }
    }

    #[test]
    fn reserves_all_displaced_items_before_equipping() {
        let world = outfit(2, 1);
        let plan = plan_equipment_change(
            &world,
            INCOMING,
            Some(TargetSlot::EquipMask(EquipMask::CHEST_ARMOR)),
            Default::default(),
            &storage_policy(&world),
        )
        .expect("root fits both displaced items");
        assert_eq!(
            plan.target,
            EquipMask::CHEST_ARMOR | EquipMask::UPPER_ARM_ARMOR
        );
        assert_eq!(
            plan.unequips
                .iter()
                .map(|step| (step.item, step.container, step.placement))
                .collect::<Vec<_>>(),
            [(CHEST, PLAYER, 0), (ARMS, PLAYER, 1)]
        );
        assert_eq!(world.player_equipment().count(), 2);
        assert_eq!(world.container_contents(PACK).count(), 1);
    }

    #[test]
    fn does_not_credit_the_incoming_items_future_free_slot() {
        let world = outfit(1, 1);
        assert_eq!(
            plan_equipment_change(
                &world,
                INCOMING,
                None,
                Default::default(),
                &storage_policy(&world)
            ),
            Err(EquipmentPlanError::Storage(StorageAllocationError::NoSpace))
        );
        assert_eq!(world.player_equipment().count(), 2);
    }

    #[test]
    fn uses_each_outgoing_items_preference_without_overallocating() {
        let world = outfit(1, 2);
        let mut storage = storage_policy(&world);
        storage.preferred = [(CHEST, PACK), (ARMS, PLAYER)].into();
        let plan = plan_equipment_change(&world, INCOMING, None, Default::default(), &storage)
            .expect("one slot in each container");
        assert_eq!(
            plan.unequips
                .iter()
                .map(|step| (step.container, step.placement))
                .collect::<Vec<_>>(),
            [(PACK, 1), (PLAYER, 0)]
        );
    }
    #[test]
    fn unused_unhydrated_fallback_pack_does_not_block_known_capacity() {
        let mut world = outfit(2, 1);
        event(
            &mut world,
            GameEvent::InventoryPutObjInContainer(Box::new(
                holtburger_protocol::messages::InventoryPutObjInContainerEventData {
                    item_guid: Guid(9),
                    container_guid: PLAYER,
                    slot: 1,
                    container_type: InventoryEntryKind::Container,
                },
            )),
        );
        assert!(
            plan_equipment_change(
                &world,
                INCOMING,
                None,
                Default::default(),
                &storage_policy(&world)
            )
            .is_ok()
        );
    }
}

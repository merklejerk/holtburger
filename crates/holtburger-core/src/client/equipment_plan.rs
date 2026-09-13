//! Pure single-item equipment planning; no commands are sent while allocating storage.

use holtburger_common::{
    Guid,
    properties::{EquipMask, PseudoEquipMask, WorldObjectExt},
};
use holtburger_world::{
    WorldState,
    context::{WorldContext, WorldContextExt},
    equipment::{EquipmentFacts, EquipmentFactsError, MAIN_HAND_LOCATIONS},
    state::storage::StorageLocation,
};

use super::{
    inventory_storage::{StorageAllocationError, allocate_storage},
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
    /// Original ownership/location, retained for execution validation.
    pub source: StorageLocation,
    /// Exact wire wield location, including complete apparel coverage.
    pub target: EquipMask,
    /// Ordered removals which must succeed before wielding.
    pub unequips: Vec<EquipmentUnequip>,
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

/// Allocate one equipment replacement using public conflict rules and current storage.
pub fn plan_equipment_change(
    world: &WorldState,
    item: Guid,
    slot: Option<TargetSlot>,
) -> Result<EquipmentPlan, EquipmentPlanError> {
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
    let requested = match slot {
        Some(TargetSlot::EquipMask(mask)) => mask,
        Some(TargetSlot::MainHand) => MAIN_HAND_LOCATIONS,
        Some(TargetSlot::OffHand) => EquipMask::SHIELD,
        Some(TargetSlot::TopClothes) => PseudoEquipMask::TOP_CLOTHES.into(),
        Some(TargetSlot::BottomClothes) => PseudoEquipMask::BOTTOM_CLOTHES.into(),
        None => incoming.valid_locations,
    };
    let target = incoming
        .resolve_location(requested)
        .or_else(|| {
            // Default jewelry use chooses a free side first, then the first allowed
            // side. An explicit multi-side request remains invalid.
            if slot.is_some() {
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
    let conflicts: Vec<_> = equipment
        .into_iter()
        .filter(|(guid, mask, facts)| {
            *guid != item && incoming.conflicts_with(target, *facts, *mask)
        })
        .collect();
    if conflicts.is_empty() {
        return Ok(EquipmentPlan {
            item,
            source,
            target,
            unequips: Vec::new(),
        });
    }
    let preferred = match source {
        StorageLocation::Contained { parent, .. } => parent,
        StorageLocation::Equipped { wearer, .. } => wearer,
    };
    let pack_slots = conflicts
        .iter()
        .map(|(guid, _, _)| {
            world
                .entities
                .get(*guid)
                .map(|entity| entity.uses_player_container_slot())
                .ok_or(EquipmentPlanError::MissingEntity(*guid))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let destinations = allocate_storage(world, preferred, &pack_slots)?;
    let unequips = conflicts
        .into_iter()
        .zip(destinations)
        .map(|((guid, from, _), destination)| EquipmentUnequip {
            item: guid,
            from,
            container: destination.container,
            placement: destination.placement,
        })
        .collect();
    Ok(EquipmentPlan {
        item,
        source,
        target,
        unequips,
    })
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use holtburger_common::properties::{InventoryEntryKind, ItemType, PropertyInt};
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, ViewContentsEventData, ViewContentsEventItem,
        WieldObjectEventData,
    };
    use holtburger_world::entity::Entity;

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
    fn reserves_all_displaced_items_before_equipping() {
        let world = outfit(2, 1);
        let plan = plan_equipment_change(
            &world,
            INCOMING,
            Some(TargetSlot::EquipMask(EquipMask::CHEST_ARMOR)),
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
            plan_equipment_change(&world, INCOMING, None),
            Err(EquipmentPlanError::Storage(StorageAllocationError::NoSpace))
        );
        assert_eq!(world.player_equipment().count(), 2);
    }

    #[test]
    fn uses_source_pack_first_then_falls_back_without_overallocating() {
        let world = outfit(1, 2);
        let plan =
            plan_equipment_change(&world, INCOMING, None).expect("one slot in each container");
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
        assert!(plan_equipment_change(&world, INCOMING, None).is_ok());
    }
}

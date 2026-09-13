//! Pure inventory capacity allocation shared by equipment replacement and stack splitting.
use holtburger_common::{Guid, properties::WorldObjectExt};
use holtburger_world::{
    WorldState,
    state::storage::{PackEntryKind, RosterCoverage, StorageSlot},
};

/// Failure to allocate known, currently free native storage.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StorageAllocationError {
    /// Capacity or roster is not hydrated.
    #[error("Inventory storage for {0} is incomplete")]
    IncompleteStorage(Guid),
    /// All known carried storage is full for the requested slot domain.
    #[error("No open inventory slots")]
    NoSpace,
    /// Wire placement must fit the signed protocol field.
    #[error("Inventory placement exceeds the protocol range")]
    PlacementOverflow,
}

/// One reserved append position in a carried container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageDestination {
    /// Owning container, including the player root.
    pub container: Guid,
    /// Native append position in the requested slot domain.
    pub placement: u32,
}

/// Reserve slots in preferred container, main pack, then native pack order.
/// Each boolean identifies the pack-slot domain (true) or ordinary item domain (false).
pub fn allocate_storage(
    world: &WorldState,
    preferred: Guid,
    pack_slots: &[bool],
) -> Result<Vec<StorageDestination>, StorageAllocationError> {
    let mut containers = vec![preferred];
    if preferred != world.player.guid {
        containers.push(world.player.guid);
    }
    let mut packs: Vec<_> = world
        .container_contents(world.player.guid)
        .filter_map(|(guid, slot)| match slot {
            StorageSlot::Pack {
                index,
                kind: PackEntryKind::Container,
            } if guid != preferred => Some((index, guid)),
            _ => None,
        })
        .collect();
    packs.sort_unstable();
    containers.extend(packs.into_iter().map(|(_, guid)| guid));
    let mut candidates = containers
        .into_iter()
        .map(|guid| storage_budget(world, guid));
    let mut storage: Vec<StorageBudget> = Vec::new();
    let mut destinations = Vec::with_capacity(pack_slots.len());
    for &pack_slot in pack_slots {
        // Inspect fallback packs only when the already inspected storage cannot fit this item.
        let index = loop {
            if let Some(index) = storage
                .iter()
                .position(|budget| budget.space(pack_slot) > 0)
            {
                break index;
            }
            storage.push(candidates.next().ok_or(StorageAllocationError::NoSpace)??);
        };
        let budget = &mut storage[index];
        destinations.push(StorageDestination {
            container: budget.guid,
            placement: budget.allocate(pack_slot)?,
        });
    }
    Ok(destinations)
}

/// Remaining capacity and append position for each independent native slot domain.
struct StorageBudget {
    /// Container identity consumed by the allocated unequip step.
    guid: Guid,
    /// Remaining ordinary capacity and its next append index.
    items: (u32, u32),
    /// Remaining pack capacity and its next append index.
    packs: (u32, u32),
}

impl StorageBudget {
    fn space(&self, pack_slot: bool) -> u32 {
        if pack_slot {
            self.packs.0
        } else {
            self.items.0
        }
    }

    fn allocate(&mut self, pack_slot: bool) -> Result<u32, StorageAllocationError> {
        let (space, next) = if pack_slot {
            &mut self.packs
        } else {
            &mut self.items
        };
        let placement = *next;
        i32::try_from(placement).map_err(|_| StorageAllocationError::PlacementOverflow)?;
        *space -= 1;
        *next = next
            .checked_add(1)
            .ok_or(StorageAllocationError::PlacementOverflow)?;
        Ok(placement)
    }
}

fn storage_budget(world: &WorldState, guid: Guid) -> Result<StorageBudget, StorageAllocationError> {
    if world.storage_coverage(guid) != Some(RosterCoverage::Announced) {
        return Err(StorageAllocationError::IncompleteStorage(guid));
    }
    let entity = world
        .entities
        .get(guid)
        .ok_or(StorageAllocationError::IncompleteStorage(guid))?;
    let mut items = (
        entity
            .items_capacity()
            .ok_or(StorageAllocationError::IncompleteStorage(guid))?,
        0,
    );
    // Absent pack capacity means this container has no pack slots, as in ACE
    // Container.TryAddToInventory's ContainerCapacity ?? 0 check.
    let mut packs = (entity.containers_capacity().unwrap_or(0), 0);
    for (_, slot) in world.container_contents(guid) {
        let (budget, index) = match slot {
            StorageSlot::Item { index } => (&mut items, index),
            StorageSlot::Pack { index, .. } => (&mut packs, index),
            StorageSlot::Pending => return Err(StorageAllocationError::IncompleteStorage(guid)),
        };
        budget.0 = budget.0.saturating_sub(1);
        budget.1 = budget.1.max(
            index
                .checked_add(1)
                .ok_or(StorageAllocationError::PlacementOverflow)?,
        );
    }
    Ok(StorageBudget { guid, items, packs })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::equipment_plan::tests::{event, outfit};
    use holtburger_common::properties::{InventoryEntryKind, PropertyInt};
    use holtburger_protocol::messages::{
        GameEvent, InventoryPutObjInContainerEventData, ViewContentsEventData,
    };
    use holtburger_world::entity::Entity;

    #[test]
    fn full_preferred_and_root_use_remaining_packs_in_native_order() {
        let mut world = outfit(0, 1);
        for (guid, slot) in [(Guid(9), 9), (Guid(8), 2)] {
            let mut pack = Entity::new(guid, "Fallback pack".into(), Default::default());
            pack.properties.ints.insert(PropertyInt::ItemsCapacity, 1);
            world.entities.insert(pack);
            event(
                &mut world,
                GameEvent::InventoryPutObjInContainer(Box::new(
                    InventoryPutObjInContainerEventData {
                        item_guid: guid,
                        container_guid: Guid(1),
                        slot,
                        container_type: InventoryEntryKind::Container,
                    },
                )),
            );
            event(
                &mut world,
                GameEvent::ViewContents(Box::new(ViewContentsEventData {
                    container: guid,
                    items: Vec::new(),
                })),
            );
        }
        assert_eq!(
            allocate_storage(&world, Guid(2), &[false, false]),
            Ok(vec![
                StorageDestination {
                    container: Guid(8),
                    placement: 0
                },
                StorageDestination {
                    container: Guid(9),
                    placement: 0
                },
            ])
        );
        assert_eq!(
            allocate_storage(&world, Guid(2), &[false, false, false]),
            Err(StorageAllocationError::NoSpace)
        );
    }
}

//! Pure inventory capacity allocation shared by pickup, equipment replacement, and stack splitting.
use holtburger_common::{Guid, properties::WorldObjectExt};
use holtburger_world::{
    WorldState,
    state::storage::{PackEntryKind, RosterCoverage, StorageLocation, StorageSlot},
};
use std::collections::{BTreeMap, BTreeSet};

/// Caller-owned container preferences for outgoing equipment; core only allocates capacity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EquipmentStoragePolicy {
    /// Preferred carried container for each outgoing item, independent of the incoming item.
    pub preferred: BTreeMap<Guid, Guid>,
    /// Explicit fallback order, including the player root when the caller permits it.
    pub fallback: Vec<Guid>,
}

/// Reserve each outgoing item in caller order without changing the caller's preferences.
pub(in crate::client) fn allocate_equipment_storage(
    world: &WorldState,
    policy: &EquipmentStoragePolicy,
    items: &[(Guid, bool)],
    reserved: &[(StorageDestination, bool)],
) -> Result<Vec<StorageDestination>, StorageAllocationError> {
    let mut reservations = reserved.to_vec();
    let mut destinations = Vec::with_capacity(items.len());
    for &(item, pack_slot) in items {
        let mut seen = BTreeSet::new();
        let containers = policy
            .preferred
            .get(&item)
            .copied()
            .into_iter()
            .chain(policy.fallback.iter().copied())
            .filter(|guid| seen.insert(*guid))
            // Persisted bags may have been sold or transferred. They are preferences,
            // never authorization to put equipment into unowned or external storage.
            .filter(|&guid| {
                guid == world.player.guid
                    || matches!(
                        world.storage_location(guid),
                        Some(StorageLocation::Contained { parent, slot: StorageSlot::Pack {
                            kind: PackEntryKind::Container, ..
                        } }) if parent == world.player.guid
                    )
            });
        let destination =
            allocate_in_containers(world, containers, &[pack_slot], &reservations)?[0];
        reservations.push((destination, pack_slot));
        destinations.push(destination);
    }
    Ok(destinations)
}

/// Frontend-selected placement for operations without an explicit drop position.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InventoryPlacementPolicy {
    /// Where automatically stored items enter the selected container.
    pub automatic: InventoryInsertion,
    /// Insert a split immediately after its source when the destination is the same container.
    /// Equipped sources and capacity fallbacks use `automatic` instead.
    pub split_after_source: bool,
}

/// Insertion preference within an independently ordered item or pack domain.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum InventoryInsertion {
    /// Preserve existing positions and insert after the last occupant.
    #[default]
    Append,
    /// Insert at zero, shifting existing occupants forward.
    Prepend,
}

impl InventoryInsertion {
    /// Select a position after capacity allocation has established the append boundary.
    pub(in crate::client) fn position(self, append: u32) -> u32 {
        match self {
            Self::Append => append,
            Self::Prepend => 0,
        }
    }
}

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

/// Direct ordinary contents in accepted native order. Pending placements remain the
/// caller's responsibility; this helper does not establish roster completeness.
pub(in crate::client) fn native_container_items(
    world: &WorldState,
    container: Guid,
) -> Vec<(u32, Guid)> {
    let mut items: Vec<_> = world
        .container_contents(container)
        .filter_map(|(guid, slot)| match slot {
            StorageSlot::Item { index } => Some((index, guid)),
            _ => None,
        })
        .collect();
    items.sort_unstable();
    items
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
    allocate_in_containers(world, containers, pack_slots, &[])
}

/// Capacity mechanics shared by equipment policy and ordinary pickup/split allocation.
fn allocate_in_containers(
    world: &WorldState,
    containers: impl IntoIterator<Item = Guid>,
    pack_slots: &[bool],
    reserved: &[(StorageDestination, bool)],
) -> Result<Vec<StorageDestination>, StorageAllocationError> {
    let mut candidates = containers.into_iter().map(|guid| {
        let mut budget = storage_budget(world, guid)?;
        for &(destination, pack_slot) in reserved {
            if destination.container == guid {
                let allocated = budget.allocate(pack_slot)?;
                debug_assert_eq!(allocated, destination.placement);
            }
        }
        Ok(budget)
    });
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
        if self.space(pack_slot) == 0 {
            return Err(StorageAllocationError::NoSpace);
        }
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
    fn equipment_preferences_share_capacity_and_honor_the_supplied_fallback_order() {
        let world = outfit(2, 2);
        let storage = EquipmentStoragePolicy {
            preferred: [(Guid(4), Guid(2)), (Guid(5), Guid(2))].into(),
            fallback: vec![Guid(2), Guid(1)],
        };
        assert_eq!(
            allocate_equipment_storage(
                &world,
                &storage,
                &[(Guid(4), false), (Guid(5), false)],
                &[]
            ),
            Ok(vec![
                StorageDestination {
                    container: Guid(2),
                    placement: 1
                },
                StorageDestination {
                    container: Guid(1),
                    placement: 0
                },
            ])
        );
        let storage = EquipmentStoragePolicy {
            preferred: BTreeMap::new(),
            fallback: vec![Guid(2), Guid(1)],
        };
        assert_eq!(
            allocate_equipment_storage(&world, &storage, &[(Guid(4), false)], &[]).unwrap()[0]
                .container,
            Guid(2)
        );
    }

    #[test]
    fn stale_and_external_container_preferences_cannot_authorize_a_transfer() {
        let mut world = outfit(2, 2);
        let external = Guid(99);
        let mut pack = Entity::new(external, "External pack".into(), Default::default());
        pack.properties.ints.insert(PropertyInt::ItemsCapacity, 10);
        world.entities.insert(pack);
        for preferred in [external, Guid(999)] {
            let storage = EquipmentStoragePolicy {
                preferred: [(Guid(4), preferred)].into(),
                fallback: vec![external, Guid(1)],
            };
            assert_eq!(
                allocate_equipment_storage(&world, &storage, &[(Guid(4), false)], &[]).unwrap()[0]
                    .container,
                Guid(1)
            );
        }
        let storage = EquipmentStoragePolicy {
            preferred: [(Guid(4), external)].into(),
            fallback: vec![],
        };
        assert_eq!(
            allocate_equipment_storage(&world, &storage, &[(Guid(4), false)], &[]),
            Err(StorageAllocationError::NoSpace)
        );
    }

    #[test]
    fn equipment_allocation_keeps_incomplete_storage_distinct_from_full_storage() {
        let mut world = outfit(2, 2);
        world
            .entities
            .get_mut(Guid(2))
            .unwrap()
            .properties
            .ints
            .0
            .remove(&PropertyInt::ItemsCapacity);
        let storage = EquipmentStoragePolicy {
            preferred: [(Guid(4), Guid(2))].into(),
            fallback: vec![Guid(1)],
        };
        assert_eq!(
            allocate_equipment_storage(&world, &storage, &[(Guid(4), false)], &[]),
            Err(StorageAllocationError::IncompleteStorage(Guid(2)))
        );
    }

    #[test]
    fn separate_bindings_share_reservations_without_overallocating() {
        let world = outfit(1, 2);
        let storage = EquipmentStoragePolicy {
            preferred: BTreeMap::new(),
            fallback: vec![Guid(2), Guid(1)],
        };
        let first = allocate_equipment_storage(&world, &storage, &[(Guid(4), false)], &[]).unwrap();
        let mut reserved = vec![(first[0], false)];
        let second =
            allocate_equipment_storage(&world, &storage, &[(Guid(5), false)], &reserved).unwrap();
        assert_ne!(first[0].container, second[0].container);
        reserved.push((second[0], false));
        assert_eq!(
            allocate_equipment_storage(&world, &storage, &[(Guid(6), false)], &reserved),
            Err(StorageAllocationError::NoSpace)
        );
    }

    #[test]
    fn rejected_allocation_leaves_earlier_reservations_unchanged() {
        let world = outfit(1, 2);
        let storage = EquipmentStoragePolicy {
            preferred: BTreeMap::new(),
            fallback: vec![Guid(2), Guid(1)],
        };
        let first = allocate_equipment_storage(&world, &storage, &[(Guid(4), false)], &[]).unwrap();
        let reserved = vec![(first[0], false)];
        assert_eq!(
            allocate_equipment_storage(
                &world,
                &storage,
                &[(Guid(5), false), (Guid(6), false)],
                &reserved
            ),
            Err(StorageAllocationError::NoSpace)
        );
        let admitted =
            allocate_equipment_storage(&world, &storage, &[(Guid(5), false)], &reserved).unwrap();
        assert_eq!(admitted[0].container, Guid(1));
    }

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

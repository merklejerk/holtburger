//! Shared interpretation of item targets; frontends retain gesture and sort-mode policy.

use super::{
    equipment_plan::{EquipmentPlan, EquipmentPlanError, plan_equipment_change},
    inventory_storage::{StorageAllocationError, allocate_storage},
    types::TargetSlot,
};
use holtburger_common::{
    Guid,
    properties::{EquipMask, WorldObjectExt},
};
use holtburger_world::{
    WorldState,
    context::WorldContextExt,
    state::storage::{PackEntryKind, RosterCoverage, StorageLocation, StorageSlot},
};
use serde::{Deserialize, Serialize};

/// Identity-based destination; no frontend array positions cross this boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InventoryTarget {
    /// Acquire a loose ground object into automatically allocated carried storage.
    Pickup,
    /// Drop an owned carried or equipped object near the character.
    Ground,
    /// Split this positive quantity into newly allocated carried storage.
    Split { amount: u32 },
    /// Merge when compatible with remaining capacity, otherwise insert before this item.
    Item { guid: Guid },
    /// Merge only; a changed stack must never turn this intent into a positional move.
    Stack { guid: Guid },
    /// Append to the appropriate native domain in this container.
    Container { guid: Guid },
    /// Resolve a visible equipment slot to its actual wield location.
    Equipment { mask: u32 },
    /// Exchange the source and target pack's native positions.
    Pack { guid: Guid },
}

/// One desired inventory interaction, re-evaluated against current world state on submission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventoryIntent {
    /// Source identity; pickup alone accepts an unowned ground object.
    pub item: Guid,
    /// User-selected target identity or equipment location.
    pub target: InventoryTarget,
}

/// Exact native move, also used for both steps of a pack swap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InventoryMove {
    /// Item to move or unequip.
    pub item: Guid,
    /// Destination container, including the player root.
    pub container: Guid,
    /// Native insertion position after removal from the old position.
    pub placement: u32,
}

/// A resolved operation; consumers execute these decisions without re-deriving them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InventoryPlan {
    /// One split request and the current quantity limit consumed by previews.
    Split {
        step: InventoryMove,
        amount: u32,
        max_amount: u32,
    },
    /// Self-drop or a whole-stack split has no protocol consequence.
    Noop,
    /// One server merge request transfers this exact positive quantity.
    Merge {
        source: Guid,
        destination: Guid,
        amount: u32,
    },
    /// One server container request also handles explicit unequip.
    Move(InventoryMove),
    /// One server-owned drop, including dequipping when necessary.
    Drop { item: Guid },
    /// Equipment owner executes the planned conflict removals and wield.
    Equip(EquipmentPlan),
    /// Two insertions exchange both endpoints and restore intervening native indices.
    Swap {
        first: InventoryMove,
        second: InventoryMove,
    },
}

/// Specific local rejection; the server can still reject a locally feasible operation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InventoryPlanError {
    /// Requested quantity must be positive and no larger than the current stack.
    #[error("Split amount must be between 1 and the stack quantity")]
    InvalidSplit,
    /// Shared free-space allocation failure.
    #[error(transparent)]
    Storage(#[from] StorageAllocationError),
    /// Source must be carried or equipped by this player.
    #[error("Item is not owned by the player")]
    NotOwned,
    /// Current authority does not establish a loose pickup candidate.
    #[error("This object cannot currently be picked up")]
    NotPickable,
    /// Required identity, quantity, roster, capacity, or placement is unavailable.
    #[error("Inventory facts for {0} have not arrived")]
    Pending(Guid),
    /// Main-pack and focus entries cannot be reordered as real packs.
    #[error("Only carried containers can exchange pack positions")]
    InvalidPack,
    /// Ordinary and pack positions are different server sequences.
    #[error("Item and target use different inventory slot types")]
    DifferentSlotTypes,
    /// Destination must be carried storage and accept this source's category.
    #[error("That container cannot accept this item")]
    InvalidContainer,
    /// Merge-only targeting cannot accept a full stack.
    #[error("Stack is full")]
    StackFull,
    /// The caller requested a merge without authorizing positional movement.
    #[error("These items cannot be merged")]
    IncompatibleStacks,
    /// Explicit container drops do not redirect to another pack.
    #[error("Container is full")]
    ContainerFull,
    /// Protocol positions and quantities must fit their signed fields.
    #[error("Inventory value exceeds the protocol range")]
    ProtocolRange,
    /// Equipment targeting and storage allocation use the same shared planner.
    #[error(transparent)]
    Equipment(#[from] EquipmentPlanError),
}

/// Evaluate an intent without mutation. The browser applies Native-sort restrictions
/// to a resolved Move; compatible merges remain available under every sort mode.
pub fn plan_inventory_intent(
    world: &WorldState,
    intent: InventoryIntent,
) -> Result<InventoryPlan, InventoryPlanError> {
    if intent.target != InventoryTarget::Pickup && !world.is_owned_by_player(intent.item) {
        return Err(InventoryPlanError::NotOwned);
    }
    match intent.target {
        InventoryTarget::Pickup => {
            let entity = holtburger_world::interaction::pickup_candidate(world, intent.item)
                .ok_or(InventoryPlanError::NotPickable)?;
            let destinations = allocate_storage(
                world,
                world.player.guid,
                &[entity.uses_player_container_slot()],
            )?;
            let destination = destinations[0];
            Ok(InventoryPlan::Move(InventoryMove {
                item: intent.item,
                container: destination.container,
                placement: destination.placement,
            }))
        }
        InventoryTarget::Ground => Ok(InventoryPlan::Drop { item: intent.item }),
        InventoryTarget::Split { amount } => {
            let entity = world
                .entities
                .get(intent.item)
                .ok_or(InventoryPlanError::Pending(intent.item))?;
            let quantity = entity.stack_size();
            if !entity.is_stackable() || amount == 0 || amount > quantity {
                return Err(InventoryPlanError::InvalidSplit);
            }
            if amount == quantity {
                return Ok(InventoryPlan::Noop);
            }
            i32::try_from(amount).map_err(|_| InventoryPlanError::ProtocolRange)?;
            let preferred = match world.storage_location(intent.item) {
                Some(StorageLocation::Contained { parent, .. }) => parent,
                Some(StorageLocation::Equipped { wearer, .. }) => wearer,
                None => return Err(InventoryPlanError::NotOwned),
            };
            let destinations =
                allocate_storage(world, preferred, &[entity.uses_player_container_slot()])?;
            let destination = destinations[0];
            Ok(InventoryPlan::Split {
                step: InventoryMove {
                    item: intent.item,
                    container: destination.container,
                    placement: destination.placement,
                },
                amount,
                max_amount: quantity,
            })
        }

        InventoryTarget::Equipment { mask } => Ok(InventoryPlan::Equip(plan_equipment_change(
            world,
            intent.item,
            Some(TargetSlot::EquipMask(EquipMask::from_bits_retain(mask))),
        )?)),
        InventoryTarget::Container { guid } => {
            plan_move(world, intent.item, guid, None).map(InventoryPlan::Move)
        }
        InventoryTarget::Pack { guid } => plan_pack_swap(world, intent.item, guid),
        InventoryTarget::Item { guid } | InventoryTarget::Stack { guid } => {
            if intent.item == guid {
                return Ok(InventoryPlan::Noop);
            }
            if !world.is_owned_by_player(guid) {
                return Err(InventoryPlanError::NotOwned);
            }
            let source = world
                .entities
                .get(intent.item)
                .ok_or(InventoryPlanError::Pending(intent.item))?;
            let target = world
                .entities
                .get(guid)
                .ok_or(InventoryPlanError::Pending(guid))?;
            let source_template = source
                .wcid
                .ok_or(InventoryPlanError::Pending(intent.item))?;
            let target_template = target.wcid.ok_or(InventoryPlanError::Pending(guid))?;
            if source_template == target_template && source.is_stackable() && target.is_stackable()
            {
                let amount = world
                    .resolve_merge_stack_amount(intent.item, guid, None)
                    .ok_or(InventoryPlanError::Pending(guid))?;
                if amount > 0 {
                    i32::try_from(amount).map_err(|_| InventoryPlanError::ProtocolRange)?;
                    return Ok(InventoryPlan::Merge {
                        source: intent.item,
                        destination: guid,
                        amount,
                    });
                }
                if matches!(intent.target, InventoryTarget::Stack { .. }) {
                    return Err(InventoryPlanError::StackFull);
                }
            }
            if matches!(intent.target, InventoryTarget::Stack { .. }) {
                return Err(InventoryPlanError::IncompatibleStacks);
            }
            let (container, slot) = contained(world, guid)?;
            plan_move(world, intent.item, container, Some(slot)).map(InventoryPlan::Move)
        }
    }
}

fn contained(world: &WorldState, guid: Guid) -> Result<(Guid, StorageSlot), InventoryPlanError> {
    match world.storage_location(guid) {
        Some(StorageLocation::Contained { parent, slot }) if slot != StorageSlot::Pending => {
            Ok((parent, slot))
        }
        _ => Err(InventoryPlanError::Pending(guid)),
    }
}

fn slot_index(slot: StorageSlot) -> Option<(bool, u32)> {
    match slot {
        StorageSlot::Pending => None,
        StorageSlot::Item { index } => Some((false, index)),
        StorageSlot::Pack { index, .. } => Some((true, index)),
    }
}

fn plan_move(
    world: &WorldState,
    item: Guid,
    container: Guid,
    before: Option<StorageSlot>,
) -> Result<InventoryMove, InventoryPlanError> {
    if item == container || (container != world.player.guid && !world.is_owned_by_player(container))
    {
        return Err(InventoryPlanError::InvalidContainer);
    }
    if world.storage_coverage(container) != Some(RosterCoverage::Announced) {
        return Err(InventoryPlanError::Pending(container));
    }
    let source = world
        .entities
        .get(item)
        .ok_or(InventoryPlanError::Pending(item))?;
    let destination = world
        .entities
        .get(container)
        .ok_or(InventoryPlanError::Pending(container))?;
    // ACE Player_Inventory rejects containers inside ordinary carried packs.
    if source.can_hold_items() && container != world.player.guid {
        return Err(InventoryPlanError::InvalidContainer);
    }
    let source_location = world
        .storage_location(item)
        .ok_or(InventoryPlanError::Pending(item))?;
    let (pack_domain, removed) = match source_location {
        StorageLocation::Contained { parent, slot } => {
            let (pack, index) = slot_index(slot).ok_or(InventoryPlanError::Pending(item))?;
            (pack, (parent == container).then_some(index))
        }
        StorageLocation::Equipped { .. } => (source.uses_player_container_slot(), None),
    };
    let capacity = if pack_domain {
        destination.containers_capacity()
    } else {
        destination.items_capacity()
    }
    .ok_or(InventoryPlanError::Pending(container))?;
    let mut occupied = 0;
    let mut append = 0;
    for (guid, slot) in world.container_contents(container) {
        if guid == item {
            continue;
        }
        let (pack, index) = slot_index(slot).ok_or(InventoryPlanError::Pending(guid))?;
        if pack != pack_domain {
            continue;
        }
        occupied += 1;
        let after_removal = index - u32::from(removed.is_some_and(|old| old < index));
        append = append.max(
            after_removal
                .checked_add(1)
                .ok_or(InventoryPlanError::ProtocolRange)?,
        );
    }
    if occupied >= capacity {
        return Err(InventoryPlanError::ContainerFull);
    }
    let placement = if let Some(slot) = before {
        let (pack, index) = slot_index(slot).ok_or(InventoryPlanError::Pending(container))?;
        if pack != pack_domain {
            return Err(InventoryPlanError::DifferentSlotTypes);
        }
        index - u32::from(removed.is_some_and(|old| old < index))
    } else {
        append
    };
    i32::try_from(placement).map_err(|_| InventoryPlanError::ProtocolRange)?;
    Ok(InventoryMove {
        item,
        container,
        placement,
    })
}

fn plan_pack_swap(
    world: &WorldState,
    source: Guid,
    target: Guid,
) -> Result<InventoryPlan, InventoryPlanError> {
    let pack = |guid| match world.storage_location(guid) {
        Some(StorageLocation::Contained {
            parent,
            slot:
                StorageSlot::Pack {
                    index,
                    kind: PackEntryKind::Container,
                },
        }) if parent == world.player.guid => Ok(index),
        _ => Err(InventoryPlanError::InvalidPack),
    };
    let source_index = pack(source)?;
    let target_index = pack(target)?;
    if source == target {
        return Ok(InventoryPlan::Noop);
    }
    for index in [source_index, target_index] {
        i32::try_from(index).map_err(|_| InventoryPlanError::ProtocolRange)?;
    }
    Ok(InventoryPlan::Swap {
        first: InventoryMove {
            item: source,
            container: world.player.guid,
            placement: target_index,
        },
        second: InventoryMove {
            item: target,
            container: world.player.guid,
            placement: source_index,
        },
    })
}

/// Preview identity belongs to the calling frontend's session; core echoes it unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventoryPreviewRequest {
    /// Monotonic request sequence used to discard stale target responses.
    pub sequence: u32,
    /// The same intent submitted for execution after the gesture completes.
    pub intent: InventoryIntent,
}

/// Consumer-facing consequence, derived once from the complete shared plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InventoryPreview {
    /// Maximum quantity allowed after capacity preflight; dialog bounds only, not authorization.
    Split { max_amount: u32 },
    /// Self-drop or whole-stack split requires no server command.
    Noop,
    /// Quantity that fits; the remainder stays on the source entity.
    Merge { amount: u32 },
    /// A positional move; the frontend may disallow this under non-native sorting.
    Move,
    /// Ground drop does not depend on native inventory sorting.
    Drop,
    /// Full set of displaced identities for equipment highlighting and feedback.
    Equip { displaced: Vec<Guid> },
    /// Exchange two real pack positions.
    Swap,
    /// The current facts or operation owner prohibit this intent.
    Rejected { reason: String },
}

/// Correlated preview result; it never authorizes execution against a later world state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventoryPreviewResult {
    /// Frontend request identity.
    pub sequence: u32,
    /// Shared interpretation or a specific inability to proceed.
    pub preview: InventoryPreview,
}

impl From<&InventoryPlan> for InventoryPreview {
    fn from(plan: &InventoryPlan) -> Self {
        match plan {
            InventoryPlan::Split { max_amount, .. } => Self::Split {
                max_amount: *max_amount,
            },
            InventoryPlan::Noop => Self::Noop,
            InventoryPlan::Merge { amount, .. } => Self::Merge { amount: *amount },
            InventoryPlan::Move(_) => Self::Move,
            InventoryPlan::Drop { .. } => Self::Drop,
            InventoryPlan::Equip(plan) => Self::Equip {
                displaced: plan.unequips.iter().map(|step| step.item).collect(),
            },
            InventoryPlan::Swap { .. } => Self::Swap,
        }
    }
}

impl super::ClientRuntime {
    /// Preview and submission share lifecycle, serialization, and game-rule admission.
    pub(super) fn evaluate_inventory_intent(
        &self,
        intent: InventoryIntent,
    ) -> Result<InventoryPlan, String> {
        if !matches!(self.state, super::ClientState::InWorld) || self.activation.is_some() {
            return Err("Inventory changes require an active world".into());
        }
        if self.equipment_operation.is_some()
            || self.pack_exchange.is_some()
            || self.active_busy_operation.is_some()
        {
            return Err("Another inventory operation is still pending".into());
        }
        plan_inventory_intent(&self.world, intent).map_err(|error| error.to_string())
    }

    pub(super) fn preview_inventory_intent(&self, request: InventoryPreviewRequest) {
        let preview = match self.evaluate_inventory_intent(request.intent) {
            Ok(plan) => InventoryPreview::from(&plan),
            Err(reason) => InventoryPreview::Rejected { reason },
        };
        let _ = self
            .client_view_event_tx
            .send(super::types::ClientViewEvent::InventoryPreview(
                InventoryPreviewResult {
                    sequence: request.sequence,
                    preview,
                },
            ));
    }
}

#[cfg(test)]
mod tests {
    use super::super::equipment_plan::tests::{event, outfit};
    use super::*;
    use holtburger_common::properties::{InventoryEntryKind, PropertyInt};
    use holtburger_protocol::messages::{GameEvent, InventoryPutObjInContainerEventData};
    use holtburger_world::entity::Entity;

    const PLAYER: Guid = Guid(1);
    const PACK: Guid = Guid(2);
    const SOURCE: Guid = Guid(3);
    const TARGET: Guid = Guid(6);
    const LAST: Guid = Guid(7);

    fn place(
        world: &mut WorldState,
        item: Guid,
        container: Guid,
        slot: u32,
        kind: InventoryEntryKind,
    ) {
        event(
            world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: item,
                container_guid: container,
                slot,
                container_type: kind,
            })),
        );
    }

    fn inventory() -> WorldState {
        let mut world = outfit(0, 3);
        world.entities.get_mut(SOURCE).expect("source").wcid = Some(1);
        for (guid, slot) in [(TARGET, 1), (LAST, 2)] {
            let mut entity = Entity::new(guid, "Item".into(), Default::default());
            entity.wcid = Some(guid.0);
            world.entities.insert(entity);
            place(&mut world, guid, PACK, slot, InventoryEntryKind::Item);
        }
        world
    }

    #[test]
    fn pickup_uses_pack_slots_and_requires_known_storage_capacity() {
        use holtburger_common::properties::{ItemType, PropertyBool};
        let mut world = super::super::equipment_plan::tests::outfit(0, 0);
        let ground = Guid(0x8000_0042);
        let mut bag =
            holtburger_world::entity::Entity::new(ground, "Loose bag".into(), Default::default());
        bag.position.landblock_id = Guid(0x1234_0001);
        bag.properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CONTAINER.bits() as i32);
        bag.properties
            .bools
            .insert(PropertyBool::RequiresBackpackSlot, true);
        world.add_entity(bag);
        let intent = InventoryIntent {
            item: ground,
            target: InventoryTarget::Pickup,
        };
        world
            .entities
            .get_mut(PLAYER)
            .expect("player")
            .properties
            .ints
            .insert(PropertyInt::ContainersCapacity, 2);
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Move(InventoryMove {
                item: ground,
                container: PLAYER,
                placement: 1
            }))
        );
        world
            .entities
            .get_mut(PLAYER)
            .expect("player")
            .properties
            .ints
            .0
            .remove(&PropertyInt::ItemsCapacity);
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Err(InventoryPlanError::Storage(
                StorageAllocationError::IncompleteStorage(PLAYER)
            ))
        );
    }

    #[test]
    fn pickup_allocates_root_then_pack_and_drop_needs_no_free_slot() {
        let mut world = super::super::equipment_plan::tests::outfit(1, 2);
        let ground = Guid(0x8000_0042);
        let mut entity =
            holtburger_world::entity::Entity::new(ground, "Ground item".into(), Default::default());
        entity.position.landblock_id = Guid(0x1234_0001);
        entity.properties.ints.insert(
            PropertyInt::ItemType,
            holtburger_common::properties::ItemType::FOOD.bits() as i32,
        );
        world.add_entity(entity);
        let intent = InventoryIntent {
            item: ground,
            target: InventoryTarget::Pickup,
        };
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Move(InventoryMove {
                item: ground,
                container: Guid(1),
                placement: 0
            }))
        );
        world
            .entities
            .get_mut(Guid(1))
            .expect("player")
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 0);
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Move(InventoryMove {
                item: ground,
                container: Guid(2),
                placement: 1
            }))
        );
        world
            .entities
            .get_mut(Guid(2))
            .expect("pack")
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 1);
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Err(InventoryPlanError::Storage(StorageAllocationError::NoSpace))
        );
        let equipped = world.player_equipment().next().expect("equipped armor").0;
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: equipped,
                    target: InventoryTarget::Ground
                }
            ),
            Ok(InventoryPlan::Drop { item: equipped })
        );
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: ground,
                    target: InventoryTarget::Ground
                }
            ),
            Err(InventoryPlanError::NotOwned)
        );
        super::super::equipment_plan::tests::event(
            &mut world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: ground,
                container_guid: Guid(1),
                slot: 0,
                container_type: InventoryEntryKind::Item,
            })),
        );
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Err(InventoryPlanError::NotPickable)
        );
    }

    #[test]
    fn forward_insertion_and_append_account_for_removal_even_in_a_full_pack() {
        let world = inventory();
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: SOURCE,
                    target: InventoryTarget::Item { guid: LAST }
                }
            ),
            Ok(InventoryPlan::Move(InventoryMove {
                item: SOURCE,
                container: PACK,
                placement: 1
            }))
        );
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: SOURCE,
                    target: InventoryTarget::Container { guid: PACK }
                }
            ),
            Ok(InventoryPlan::Move(InventoryMove {
                item: SOURCE,
                container: PACK,
                placement: 2
            }))
        );
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: LAST,
                    target: InventoryTarget::Item { guid: SOURCE }
                }
            ),
            Ok(InventoryPlan::Move(InventoryMove {
                item: LAST,
                container: PACK,
                placement: 0
            }))
        );
    }

    #[test]
    fn merge_only_intent_cannot_be_reinterpreted_as_a_move() {
        let world = inventory();
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: SOURCE,
                    target: InventoryTarget::Stack { guid: TARGET },
                }
            ),
            Err(InventoryPlanError::IncompatibleStacks)
        );
    }

    #[test]
    fn explicit_full_destination_does_not_fall_back_to_other_storage() {
        let world = inventory();
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: SOURCE,
                    target: InventoryTarget::Container { guid: PLAYER }
                }
            ),
            Err(InventoryPlanError::ContainerFull)
        );
    }

    #[test]
    fn split_allocates_preferred_then_root_and_rejects_full_or_invalid_requests() {
        let mut world = inventory();
        let source = world.entities.get_mut(SOURCE).expect("source");
        source.properties.ints.insert(PropertyInt::StackSize, 20);
        source
            .properties
            .ints
            .insert(PropertyInt::MaxStackSize, 100);
        let intent = InventoryIntent {
            item: SOURCE,
            target: InventoryTarget::Split { amount: 7 },
        };
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Err(InventoryPlanError::Storage(StorageAllocationError::NoSpace))
        );
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: SOURCE,
                    target: InventoryTarget::Split { amount: 20 }
                }
            ),
            Ok(InventoryPlan::Noop)
        );
        world
            .entities
            .get_mut(PLAYER)
            .expect("root")
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 1);
        assert!(matches!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Split {
                step: InventoryMove {
                    container: PLAYER,
                    placement: 0,
                    ..
                },
                amount: 7,
                max_amount: 20,
                ..
            })
        ));
        world
            .entities
            .get_mut(PACK)
            .expect("pack")
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 4);
        assert!(matches!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Split {
                step: InventoryMove {
                    container: PACK,
                    placement: 3,
                    ..
                },
                ..
            })
        ));
        for amount in [0, 21] {
            assert_eq!(
                plan_inventory_intent(
                    &world,
                    InventoryIntent {
                        item: SOURCE,
                        target: InventoryTarget::Split { amount }
                    }
                ),
                Err(InventoryPlanError::InvalidSplit)
            );
        }
    }

    #[test]
    fn partial_stacks_merge_and_full_stacks_move_only_with_positional_intent() {
        const MAXIMUM: i32 = 100;
        let mut world = inventory();
        for (guid, count) in [(SOURCE, 20), (TARGET, MAXIMUM - 10)] {
            let entity = world.entities.get_mut(guid).expect("stack");
            entity.wcid = Some(1);
            entity.properties.ints.insert(PropertyInt::StackSize, count);
            entity
                .properties
                .ints
                .insert(PropertyInt::MaxStackSize, MAXIMUM);
        }
        let intent = InventoryIntent {
            item: SOURCE,
            target: InventoryTarget::Item { guid: TARGET },
        };
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Merge {
                source: SOURCE,
                destination: TARGET,
                amount: 10
            })
        );
        world
            .entities
            .get_mut(TARGET)
            .expect("target")
            .properties
            .ints
            .insert(PropertyInt::StackSize, MAXIMUM);
        assert_eq!(
            plan_inventory_intent(&world, intent),
            Ok(InventoryPlan::Move(InventoryMove {
                item: SOURCE,
                container: PACK,
                placement: 0
            }))
        );
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: SOURCE,
                    target: InventoryTarget::Stack { guid: TARGET }
                }
            ),
            Err(InventoryPlanError::StackFull)
        );
        assert_eq!(world.entities.get(SOURCE).expect("source").stack_size(), 20);
    }

    #[test]
    fn pack_swap_retains_original_sparse_indices_and_rejects_focus_targets() {
        let mut world = inventory();
        place(&mut world, TARGET, PLAYER, 4, InventoryEntryKind::Container);
        place(&mut world, LAST, PLAYER, 2, InventoryEntryKind::Foci);
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: PACK,
                    target: InventoryTarget::Pack { guid: TARGET }
                }
            ),
            Ok(InventoryPlan::Swap {
                first: InventoryMove {
                    item: PACK,
                    container: PLAYER,
                    placement: 5
                },
                second: InventoryMove {
                    item: TARGET,
                    container: PLAYER,
                    placement: 0
                },
            })
        );
        assert_eq!(
            plan_inventory_intent(
                &world,
                InventoryIntent {
                    item: PACK,
                    target: InventoryTarget::Pack { guid: LAST }
                }
            ),
            Err(InventoryPlanError::InvalidPack)
        );
    }
}

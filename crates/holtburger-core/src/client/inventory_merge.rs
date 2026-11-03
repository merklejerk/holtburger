//! Shared stack-merge planning and the exact authoritative consequences of one request.

use super::inventory_plan::InventoryPlanError;
use holtburger_common::{
    Guid,
    properties::{PropertyInt, WorldObjectExt, WorldObjectPropertyAccessors},
};
use holtburger_protocol::messages::game_action::{GameAction, StackableMergeActionData};
use holtburger_world::{WorldState, context::WorldContextExt};

/// Expected source consequence; removal requires explicit server evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeSourceAfter {
    /// Entire source is consumed.
    Removed,
    /// Positive remainder retained on the source.
    Remaining {
        /// Exact quantity after confirmation.
        count: u32,
    },
}

/// One resolved transfer, shared by manual gestures and container consolidation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MergeStep {
    /// Existing stack supplying the transfer.
    pub source: Guid,
    /// Existing stack receiving the transfer.
    pub destination: Guid,
    /// Positive quantity bounded by the source's signed stack-size property.
    pub amount: u32,
    /// Original source quantity, used to admit intermediate updates.
    pub source_before: u32,
    /// Original destination quantity, used to admit intermediate updates.
    pub destination_before: u32,
    /// Source remainder or explicit consumption expected from the server.
    pub source_after: MergeSourceAfter,
    /// Exact destination quantity required for completion.
    pub destination_after: u32,
}

impl MergeStep {
    /// Serialize only the already resolved decision.
    pub(super) fn action(self) -> GameAction {
        GameAction::StackableMerge(Box::new(StackableMergeActionData {
            merge_from_guid: self.source,
            merge_to_guid: self.destination,
            amount: self.amount as i32,
        }))
    }
}

/// Incompatible items permit replacement; compatible stacks must merge or reject.
pub(super) fn plan_stack_merge(
    world: &WorldState,
    source: Guid,
    destination: Guid,
) -> Result<Option<MergeStep>, InventoryPlanError> {
    let from = world
        .get_visible_entity(source)
        .ok_or(InventoryPlanError::Pending(source))?;
    let to = world
        .get_visible_entity(destination)
        .ok_or(InventoryPlanError::Pending(destination))?;
    let source_template = from.wcid.ok_or(InventoryPlanError::Pending(source))?;
    let target_template = to.wcid.ok_or(InventoryPlanError::Pending(destination))?;
    if source_template != target_template {
        return Ok(None);
    }
    if !from.is_stackable() && !to.is_stackable() {
        return Ok(None);
    }
    for (guid, entity) in [(source, from), (destination, to)] {
        entity
            .get_int_prop(PropertyInt::MaxStackSize)
            .ok_or(InventoryPlanError::Pending(guid))?;
    }
    if !from.is_stackable() || !to.is_stackable() {
        return Ok(None);
    }
    let amount = world
        .resolve_merge_stack_amount(source, destination, None)
        .ok_or(InventoryPlanError::Pending(destination))?;
    if amount == 0 {
        return Err(InventoryPlanError::StackFull);
    }
    let source_before = from
        .get_int_prop(PropertyInt::StackSize)
        .and_then(|count| u32::try_from(count).ok())
        .ok_or(InventoryPlanError::Pending(source))?;
    let destination_before = to
        .get_int_prop(PropertyInt::StackSize)
        .and_then(|count| u32::try_from(count).ok())
        .ok_or(InventoryPlanError::Pending(destination))?;
    Ok(Some(MergeStep {
        source,
        destination,
        amount,
        source_before,
        destination_before,
        source_after: match source_before - amount {
            0 => MergeSourceAfter::Removed,
            count => MergeSourceAfter::Remaining { count },
        },
        destination_after: destination_before + amount,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::game_action::GameAction;
    use holtburger_world::entity::Entity;

    #[test]
    fn signed_wire_boundary_preserves_exact_quantities_and_nonpositive_stacks_cannot_merge() {
        let source = Guid(1);
        let destination = Guid(2);
        let maximum = i32::MAX;
        let mut world = WorldState::synthetic();
        for (guid, count) in [(source, maximum), (destination, 1)] {
            let mut entity = Entity::new(guid, "Stack".into(), Default::default());
            entity.wcid = Some(42);
            entity.properties.ints.insert(PropertyInt::StackSize, count);
            entity
                .properties
                .ints
                .insert(PropertyInt::MaxStackSize, maximum);
            world.entities.insert(entity);
        }
        let step = plan_stack_merge(&world, source, destination)
            .unwrap()
            .unwrap();
        assert_eq!(step.amount, (maximum - 1) as u32);
        assert_eq!(step.source_after, MergeSourceAfter::Remaining { count: 1 });
        assert_eq!(step.destination_after, maximum as u32);
        let GameAction::StackableMerge(action) = step.action() else {
            panic!("merge step must serialize a merge action")
        };
        assert_eq!(action.amount, maximum - 1);
        for invalid in [0, -1] {
            world
                .entities
                .get_mut(source)
                .unwrap()
                .properties
                .ints
                .insert(PropertyInt::StackSize, invalid);
            assert!(matches!(
                plan_stack_merge(&world, source, destination),
                Err(InventoryPlanError::Pending(_))
            ));
        }
    }
}

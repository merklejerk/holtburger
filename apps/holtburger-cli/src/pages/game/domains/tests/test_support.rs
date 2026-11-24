use super::*;

pub(super) fn apply_queued_ui_action(state: &mut GameState, action: AppUiAction) -> UpdateResult {
    let mut result = state
        .handle_action(action.into())
        .expect("UI action should produce an update result");

    while !result.actions.is_empty() {
        let actions = std::mem::take(&mut result.actions);
        for queued_action in actions {
            if let Some(next_result) = state.handle_action(queued_action) {
                result.merge(next_result);
            }
        }
    }

    result
}

pub(super) fn vendor_item_named(guid: Guid, wcid: u32, name: &str) -> CoreVendorItem {
    let mut properties = WorldObjectProperties::default();
    properties
        .strings
        .insert(PropertyString::Name, name.to_string());

    CoreVendorItem {
        guid,
        wcid,
        vendor_supply: None,
        properties,
        ..CoreVendorItem::default()
    }
}

pub(super) fn context_buffer_contains(buffer: &[Line<'static>], needle: &str) -> bool {
    buffer.iter().any(|line| line.to_string().contains(needle))
}

pub(super) fn creature_entity(guid: Guid, name: &str, position: WorldPosition) -> Entity {
    let mut entity = Entity::new(guid, name.to_string(), position);
    entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    entity.creature_profile = Some(CreatureProfile {
        flags: CreatureProfileFlags::empty(),
        health: 1,
        health_max: 1,
        attributes: None,
        buffs: None,
    });
    entity
}

pub(super) fn inventory_item_entity(guid: Guid, name: &str, container_id: Guid) -> Entity {
    let mut entity = Entity::new(guid, name.to_string(), WorldPosition::default());
    entity.set_iid_prop(PropertyInstanceId::Container, container_id);
    entity
}

pub(super) fn stacked_inventory_item_entity(
    guid: Guid,
    name: &str,
    container_id: Guid,
    stack_size: u32,
) -> Entity {
    let mut entity = inventory_item_entity(guid, name, container_id);
    entity.set_int_prop(PropertyInt::StackSize, stack_size as i32);
    entity
}

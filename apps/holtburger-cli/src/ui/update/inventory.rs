use crate::ui::state::{AppState, Page};
use holtburger_common::properties::{EquipMask, PropertyInt};
use holtburger_core::world::entity::Entity;

impl AppState {
    pub(super) fn update_inventory_and_equipment(&mut self, entity: &Entity) {
        if let Some(game) = self.game_option_mut() {
            let guid = entity.guid;
            let pguid = game.data.player_guid;

            // Handle player position if it's the player entity
            if Some(guid) == pguid {
                game.data.player_pos = Some(entity.position);
            }

            // Update inventory tracking
            if let Some(pguid) = pguid {
                if let Some(cid) = entity.container_id
                    && (cid == pguid || game.data.inventory.contains(&cid))
                {
                    game.data.inventory.insert(guid);
                } else if let Some(wid) = entity.wielder_id
                    && wid == pguid
                {
                    game.data.inventory.insert(guid);
                } else {
                    // If it's no longer in our inventory/wielded, remove it
                    game.data.inventory.remove(&guid);
                }
            }

            // Update equipment tracking
            if let Some(pguid) = pguid
                && entity.wielder_id == Some(pguid)
            {
                if let Some(mask) = entity.currently_wielded_location {
                    if mask.is_empty() {
                        game.data.equipment.remove(&guid);
                    } else {
                        game.data.equipment.insert(guid, mask);
                    }
                } else if let Some(&loc) = entity
                    .int_properties
                    .get(&(PropertyInt::CurrentWieldedLocation as u32))
                {
                    let mask = EquipMask::from_bits_truncate(loc as u32);
                    if mask.is_empty() {
                        game.data.equipment.remove(&guid);
                    } else {
                        game.data.equipment.insert(guid, mask);
                    }
                } else {
                    game.data.equipment.remove(&guid);
                }
            } else {
                game.data.equipment.remove(&guid);
            }

            game.data.entities.insert(entity.guid, entity.clone());
        }
    }

    pub(super) fn handle_entity_removed(&mut self, guid: holtburger_common::Guid) {
        if let Page::Game(_) = self.page {
            self.update_inventory_recursive(guid, false);
            if let Some(game) = self.game_option_mut() {
                game.data.entities.remove(&guid);
                game.data.equipment.remove(&guid);
                if game.view.current_debug_guid == Some(guid) {
                    game.view.current_debug_guid = None;
                }
            }
        }
    }
}

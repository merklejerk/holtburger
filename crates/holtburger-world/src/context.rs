use crate::entity::Entity;
use crate::vendor::VendorState;
use holtburger_common::Guid;
use holtburger_common::properties::{ItemType, PropertyInstanceId, WorldObjectPropertyAccessors};
use holtburger_protocol::messages::combat::CombatMode;

/// Provides access to the world state for common logic.
pub trait WorldContext {
    fn get_player_guid(&self) -> Option<Guid>;
    fn get_entity(&self, guid: Guid) -> Option<&Entity>;
    fn iter_inventory(&self) -> impl Iterator<Item = Guid> + '_;
    fn iter_equipment(&self) -> impl Iterator<Item = Guid> + '_;
    fn iter_entities(&self) -> impl Iterator<Item = &Entity> + '_;
    fn get_vendor(&self) -> Option<&VendorState>;
}

/// Common game logic shared across all clients.
pub trait WorldContextExt: WorldContext {
    fn get_pyreal_balance(&self) -> u32 {
        self.iter_inventory()
            .filter_map(|guid| self.get_entity(guid))
            .filter(|entity| {
                entity
                    .item_type()
                    .is_some_and(|it: ItemType| it.intersects(ItemType::MONEY))
            })
            .map(|entity| entity.stack_size())
            .sum()
    }

    fn get_container_counts(&self) -> std::collections::HashMap<Guid, usize> {
        let mut counts = std::collections::HashMap::new();
        for e in self.iter_entities() {
            if let Some(cid) = e.container_id() {
                *counts.entry(cid).or_default() += 1;
            }
        }
        counts
    }

    fn get_container_id(&self, guid: Guid) -> Option<Guid> {
        self.get_entity(guid)?.container_id()
    }

    fn is_in_main_pack(&self, guid: Guid) -> bool {
        if let Some(player_guid) = self.get_player_guid() {
            self.get_container_id(guid) == Some(player_guid)
        } else {
            false
        }
    }

    /// Recursively checks if an item or any of its contents are attuned or sticky.
    fn is_attuned_sticky_recursive(&self, guid: Guid) -> bool {
        let e = match self.get_entity(guid) {
            Some(e) => e,
            None => return false,
        };

        // Base case: the item itself is attuned or sticky.
        if e.is_attuned_sticky() {
            return true;
        }

        // Recursive case: check all items contained within this one
        for other_guid in self.iter_inventory() {
            if let Some(other) = self.get_entity(other_guid)
                && other.container_id() == Some(guid)
                && self.is_attuned_sticky_recursive(other_guid)
            {
                return true;
            }
        }

        false
    }

    fn is_container_empty(&self, guid: Guid) -> bool {
        let e = match self.get_entity(guid) {
            Some(e) => e,
            None => return true,
        };
        if !e
            .item_type()
            .unwrap_or_default()
            .intersects(ItemType::CONTAINER)
        {
            return true;
        }
        for other_guid in self.iter_inventory() {
            if let Some(other) = self.get_entity(other_guid)
                && other.container_id() == Some(guid)
            {
                return false;
            }
        }
        true
    }

    fn can_sell_to_vendor(&self, guid: Guid) -> bool {
        let e = match self.get_entity(guid) {
            Some(e) => e,
            None => return false,
        };

        let itype = e.item_type().unwrap_or_default();

        if itype.is_empty() || !e.is_sellable() || e.item_value() == 0 {
            return false;
        }

        // If it's a container, it must be empty.
        if !self.is_container_empty(guid) {
            return false;
        }

        if let Some(vendor) = self.get_vendor()
            && (itype.bits() & vendor.merchandise_item_types) == 0
        {
            return false;
        }

        true
    }

    fn can_add_to_trade(&self, guid: Guid) -> bool {
        let e = match self.get_entity(guid) {
            Some(e) => e,
            None => return false,
        };

        if e.is_attuned_sticky() {
            return false;
        }

        // If it's a container, it must be empty.
        if !self.is_container_empty(guid) {
            return false;
        }

        // Check for active pet
        if let Some(pet_guid) = e.get_instance_prop(PropertyInstanceId::Pet)
            && !pet_guid.is_null()
        {
            return false;
        }

        true
    }

    fn get_suggested_combat_mode(&self) -> CombatMode {
        let mut best = CombatMode::Melee;
        for guid in self.iter_equipment() {
            if let Some(entity) = self.get_entity(guid)
                && let Some(it) = entity.item_type()
            {
                if it.intersects(ItemType::CASTER) {
                    return CombatMode::Magic;
                }
                if it.intersects(ItemType::MISSILE_WEAPON) {
                    best = CombatMode::Missile;
                }
            }
        }
        best
    }

    fn is_wielding_caster(&self) -> bool {
        self.get_suggested_combat_mode() == CombatMode::Magic
    }
}

impl<T: WorldContext + ?Sized> WorldContextExt for T {}

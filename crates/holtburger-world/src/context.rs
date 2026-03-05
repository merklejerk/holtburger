use crate::entity::Entity;
use crate::vendor::VendorState;
use holtburger_common::Guid;
use holtburger_common::properties::ItemType;
use holtburger_protocol::messages::combat::CombatMode;

/// Provides access to the world state for common logic.
pub trait WorldContext {
    fn get_player_guid(&self) -> Option<Guid>;
    fn get_entity(&self, guid: Guid) -> Option<&Entity>;
    fn iter_inventory(&self) -> impl Iterator<Item = Guid> + '_;
    fn iter_equipment(&self) -> impl Iterator<Item = Guid> + '_;
    fn iter_entities(&self) -> impl Iterator<Item = &Entity> + '_;
    fn is_open_container(&self, guid: Guid) -> bool;
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

    fn get_container_counts(&self) -> std::collections::HashMap<Guid, u32> {
        let mut counts = std::collections::HashMap::new();
        for e in self.iter_entities() {
            if let Some(cid) = e.container_id() {
                *counts.entry(cid).or_default() += 1;
            }
        }
        counts
    }

    fn get_container_count(&self, container_id: Guid) -> u32 {
        let mut count = 0;
        for e in self.iter_entities() {
            if let Some(cid) = e.container_id()
                && cid == container_id
            {
                count += 1;
            }
        }
        count
    }

    fn container_space_left(&self, container_id: Guid) -> u32 {
        let Some(entity) = self.get_entity(container_id) else {
            return 0;
        };

        let capacity = entity.items_capacity().unwrap_or(0);
        let current = self.get_container_count(container_id);
        capacity.saturating_sub(current)
    }

    fn is_in_main_pack(&self, guid: Guid) -> bool {
        if let Some(player_guid) = self.get_player_guid() {
            self.get_entity(guid).and_then(|e| e.container_id()) == Some(player_guid)
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

    fn is_container_empty(&self, container_id: Guid) -> bool {
        let e = match self.get_entity(container_id) {
            Some(e) => e,
            None => return true,
        };
        self.container_space_left(container_id) == e.items_capacity().unwrap_or(0)
    }

    fn can_sell_to_vendor(&self, guid: Guid, vendor: Option<&VendorState>) -> bool {
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

        if let Some(vendor) = vendor
            && (itype.bits() & vendor.merchandise_item_types) == 0
        {
            return false;
        }

        // Check for active pet
        !e.has_active_pet()
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
        !e.has_active_pet()
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

    /// Finds a non-full container in the player's possession.
    /// If preferred_container_id is given, it is checked first.
    /// Then the player itself (main pack), then all items in the inventory that are containers.
    fn find_non_full_pack(&self, preferred_container_id: Option<Guid>) -> Option<Guid> {
        let player_guid = self.get_player_guid()?;

        // 1. Check preferred first
        if let Some(pref) = preferred_container_id
            && self.container_space_left(pref) > 0
        {
            return Some(pref);
        }

        // 2. Check player (main pack)
        if self.container_space_left(player_guid) > 0 {
            return Some(player_guid);
        }

        // 3. Check all items in inventory
        for item_guid in self.iter_inventory() {
            // Avoid double-checking player or preferred
            if Some(item_guid) == preferred_container_id || item_guid == player_guid {
                continue;
            }

            if self.container_space_left(item_guid) > 0 {
                return Some(item_guid);
            }
        }

        None
    }

    // Find the effective stack count that can be merged from src_guid into dst_guid.
    fn resolve_merge_stack_amount(
        &self,
        src_guid: Guid,
        dst_guid: Guid,
        max_src_amount: Option<u32>,
    ) -> Option<u32> {
        let src = self.get_entity(src_guid)?;
        let dst = self.get_entity(dst_guid)?;

        if src.wcid != dst.wcid {
            return None;
        }

        let max_stack_size = dst.max_stack_size()?;
        let src_count = src.stack_size().min(max_src_amount.unwrap_or(u32::MAX));
        let dst_count = dst.stack_size();
        Some(src_count.min(max_stack_size.saturating_sub(dst_count)))
    }

    fn can_move_item_into_container(&self, item_guid: Guid, container_id: Guid) -> bool {
        if self.get_player_guid() != Some(container_id)
            && !self.is_in_main_pack(container_id)
            && !self.is_open_container(container_id)
        {
            return false;
        }
        if self.container_space_left(container_id) == 0 {
            return false;
        }
        let item = match self.get_entity(item_guid) {
            Some(e) => e,
            None => return false,
        };
        // Check for active pet
        !item.has_active_pet()
    }

    fn can_use_with(&self, item_guid: Guid, target_guid: Guid) -> bool {
        let item = match self.get_entity(item_guid) {
            Some(e) => e,
            None => return false,
        };
        let target = match self.get_entity(target_guid) {
            Some(e) => e,
            None => return false,
        };
        item.target_item_type()
            .is_some_and(|t| target.item_type().unwrap_or_default().intersects(t))
    }
}

impl<T: WorldContext + ?Sized> WorldContextExt for T {}

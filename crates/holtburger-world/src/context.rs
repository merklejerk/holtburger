use crate::entity::Entity;
use crate::vendor::VendorState;
use holtburger_common::Guid;
use holtburger_common::properties::{EquipMask, ItemType, Usable, WorldObjectExt};
use holtburger_protocol::messages::combat::CombatMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatTargetStatus {
    Available,
    Unavailable,
    DeathMotionObserved,
}

impl CombatTargetStatus {
    pub const fn is_available(self) -> bool {
        matches!(self, Self::Available)
    }
}

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
    fn combat_target_status(&self, guid: Guid) -> CombatTargetStatus {
        if Some(guid) == self.get_player_guid() {
            return CombatTargetStatus::Unavailable;
        }

        let Some(entity) = self.get_entity(guid) else {
            return CombatTargetStatus::Unavailable;
        };

        if entity.position.landblock_id == Guid::NULL || !entity.is_creature() {
            return CombatTargetStatus::Unavailable;
        }

        if entity
            .motion_snapshot
            .is_some_and(|snapshot| snapshot.indicates_death_motion())
        {
            return CombatTargetStatus::DeathMotionObserved;
        }

        CombatTargetStatus::Available
    }

    fn is_in_player_inventory(&self, guid: Guid) -> bool {
        self.iter_inventory().any(|candidate| candidate == guid)
    }

    fn is_equipped_item(&self, guid: Guid) -> bool {
        self.iter_equipment().any(|candidate| candidate == guid)
    }

    fn current_usable_location_flags(&self, guid: Guid, source_guid: Option<Guid>) -> Usable {
        let Some(entity) = self.get_entity(guid) else {
            return Usable::empty();
        };

        let mut available = Usable::empty();
        let is_equipped = self.is_equipped_item(guid);
        let is_owned = is_equipped || self.is_in_player_inventory(guid);

        if is_owned {
            available |= Usable::CONTAINED;
        }

        if is_equipped {
            available |= Usable::WIELDED;
        }

        if entity
            .container_id()
            .is_some_and(|container_guid| self.is_open_container(container_guid))
        {
            available |= Usable::VIEWED;
        }

        if entity.position.landblock_id != Guid::NULL {
            available |= Usable::REMOTE;
        }

        if Some(guid) == self.get_player_guid() {
            available |= Usable::SELF;
        }

        if Some(guid) == source_guid {
            available |= Usable::OBJ_SELF;
        }

        available
    }

    fn matches_current_usable_location(
        &self,
        guid: Guid,
        required: Usable,
        source_guid: Option<Guid>,
    ) -> bool {
        let required = required.location_flags();
        if required.is_empty() {
            return false;
        }

        self.current_usable_location_flags(guid, source_guid)
            .intersects(required)
    }

    fn can_use(&self, guid: Guid) -> bool {
        let Some(item) = self.get_entity(guid) else {
            return false;
        };

        let usable = item.usable_flags();
        if usable.is_empty() {
            return true;
        }

        let source_flags = usable.source_flags();
        if source_flags == Usable::NO {
            return false;
        }

        let location_flags = source_flags.location_flags();
        if location_flags.is_empty() {
            return true;
        }

        self.matches_current_usable_location(guid, source_flags, Some(guid))
    }

    fn can_begin_use_with(&self, item_guid: Guid) -> bool {
        let Some(item) = self.get_entity(item_guid) else {
            return false;
        };

        let target_locations = item.usable_flags().target_flags().location_flags();

        item.target_item_type().is_some() && !target_locations.is_empty() && self.can_use(item_guid)
    }

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
            if let Some(entity) = self.get_entity(guid) {
                let wield_location = entity.wield_location();
                if wield_location.intersects(EquipMask::CASTER) {
                    return CombatMode::Magic;
                }
                if wield_location.intersects(EquipMask::MISSILE_WEAPON) {
                    best = CombatMode::Missile;
                }
            }
        }
        best
    }

    fn is_wielding_caster(&self) -> bool {
        self.get_suggested_combat_mode() == CombatMode::Magic
    }

    fn is_salvage_candidate(&self, guid: Guid) -> bool {
        let Some(entity) = self.get_entity(guid) else {
            return false;
        };

        if entity.is_retained() {
            return false;
        }

        let Some(item_type) = entity.item_type() else {
            return false;
        };

        if item_type.contains(ItemType::TINKERING_MATERIAL) {
            let structure = entity.structure().unwrap_or(0);
            let max_structure = entity.max_structure().unwrap_or(0);
            if structure >= max_structure && max_structure > 0 {
                return false;
            }
        }

        entity.material_type().is_some() && entity.workmanship().is_some()
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

        if !self.can_begin_use_with(item_guid) {
            return false;
        }

        if !item
            .target_item_type()
            .is_some_and(|t| target.item_type().unwrap_or_default().intersects(t))
        {
            return false;
        }

        self.matches_current_usable_location(
            target_guid,
            item.usable_flags().target_flags(),
            Some(item_guid),
        )
    }
}

impl<T: WorldContext + ?Sized> WorldContextExt for T {}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::{CombatTargetStatus, WorldContext, WorldContextExt};
    use crate::entity::{Entity, EntityMotionSnapshot};
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::EquipMask;
    use holtburger_common::properties::{ItemType, PropertyInstanceId, PropertyInt, Usable};
    use holtburger_protocol::messages::combat::CombatMode;
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};

    #[derive(Default)]
    struct TestWorld {
        player_guid: Option<Guid>,
        entities: HashMap<Guid, Entity>,
        inventory: HashSet<Guid>,
        equipment: HashSet<Guid>,
        open_containers: HashSet<Guid>,
    }

    impl WorldContext for TestWorld {
        fn get_player_guid(&self) -> Option<Guid> {
            self.player_guid
        }

        fn get_entity(&self, guid: Guid) -> Option<&Entity> {
            self.entities.get(&guid)
        }

        fn iter_inventory(&self) -> impl Iterator<Item = Guid> + '_ {
            self.inventory.iter().copied()
        }

        fn iter_equipment(&self) -> impl Iterator<Item = Guid> + '_ {
            self.equipment.iter().copied()
        }

        fn iter_entities(&self) -> impl Iterator<Item = &Entity> + '_ {
            self.entities.values()
        }

        fn is_open_container(&self, guid: Guid) -> bool {
            self.open_containers.contains(&guid)
        }
    }

    fn entity(guid: Guid, name: &str) -> Entity {
        Entity::new(guid, name.to_string(), WorldPosition::default())
    }

    #[test]
    fn suggested_combat_mode_uses_wield_location_over_item_type_noise() {
        let player_guid = Guid(0x5000_0001);
        let sword_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            equipment: HashSet::from([sword_guid]),
            ..Default::default()
        };

        let mut sword = entity(sword_guid, "Noisy Sword");
        sword.properties.ints.insert(
            PropertyInt::ItemType,
            (ItemType::MELEE_WEAPON | ItemType::MISSILE_WEAPON).bits() as i32,
        );
        sword.properties.ints.insert(
            PropertyInt::CurrentWieldedLocation,
            EquipMask::MELEE_WEAPON.bits() as i32,
        );
        world.entities.insert(sword_guid, sword);

        assert_eq!(world.get_suggested_combat_mode(), CombatMode::Melee);
    }

    #[test]
    fn suggested_combat_mode_detects_missile_and_caster_by_wield_slot() {
        let player_guid = Guid(0x5000_0001);
        let bow_guid = Guid(0x8000_0001);
        let wand_guid = Guid(0x8000_0002);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            equipment: HashSet::from([bow_guid]),
            ..Default::default()
        };

        let mut bow = entity(bow_guid, "Bow");
        bow.properties.ints.insert(
            PropertyInt::CurrentWieldedLocation,
            EquipMask::MISSILE_WEAPON.bits() as i32,
        );
        world.entities.insert(bow_guid, bow);

        assert_eq!(world.get_suggested_combat_mode(), CombatMode::Missile);

        let mut wand = entity(wand_guid, "Wand");
        wand.properties.ints.insert(
            PropertyInt::CurrentWieldedLocation,
            EquipMask::CASTER.bits() as i32,
        );
        world.entities.insert(wand_guid, wand);
        world.equipment.insert(wand_guid);

        assert_eq!(world.get_suggested_combat_mode(), CombatMode::Magic);
    }

    #[test]
    fn nearby_use_requires_matching_source_location() {
        let player_guid = Guid(0x5000_0001);
        let item_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            ..Default::default()
        };

        let mut ground_item = entity(item_guid, "Ground Item");
        ground_item.position.landblock_id = Guid(0x1234_0001);
        ground_item
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::CONTAINED.bits() as i32);
        world.entities.insert(item_guid, ground_item.clone());

        assert!(!world.can_use(item_guid));

        world
            .entities
            .get_mut(&item_guid)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::REMOTE.bits() as i32);

        assert!(world.can_use(item_guid));
    }

    #[test]
    fn combat_target_status_reports_available_creature_targets() {
        let player_guid = Guid(0x5000_0001);
        let target_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            ..Default::default()
        };

        let mut target = entity(target_guid, "Drudge");
        target.position.landblock_id = Guid(0x0100_0001);
        target
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(target_guid, target);

        assert_eq!(world.combat_target_status(target_guid), CombatTargetStatus::Available);
        assert!(world.combat_target_status(target_guid).is_available());
    }

    #[test]
    fn combat_target_status_reports_death_motion_observed() {
        let player_guid = Guid(0x5000_0001);
        let target_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            ..Default::default()
        };

        let mut target = entity(target_guid, "Drudge");
        target.position.landblock_id = Guid(0x0100_0001);
        target
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        target.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            sidestep_command: None,
            turn_command: None,
        });
        world.entities.insert(target_guid, target);

        assert_eq!(
            world.combat_target_status(target_guid),
            CombatTargetStatus::DeathMotionObserved
        );
        assert!(!world.combat_target_status(target_guid).is_available());
    }

    #[test]
    fn physics_parent_alone_does_not_make_item_remote() {
        let player_guid = Guid(0x5000_0001);
        let item_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            ..Default::default()
        };

        let mut attached_item = entity(item_guid, "Attached Item");
        attached_item.physics_parent_id = Some(Guid(0x7000_0001));
        attached_item
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::REMOTE.bits() as i32);
        world.entities.insert(item_guid, attached_item);

        assert!(!world.can_use(item_guid));
        assert_eq!(
            world.current_usable_location_flags(item_guid, None),
            Usable::empty()
        );
    }

    #[test]
    fn combine_requires_non_empty_target_location_bits() {
        let player_guid = Guid(0x5000_0001);
        let item_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            inventory: HashSet::from([item_guid]),
            ..Default::default()
        };

        let mut inventory_item = entity(item_guid, "Tool");
        inventory_item
            .properties
            .ints
            .insert(PropertyInt::TargetType, ItemType::MISC.bits() as i32);
        inventory_item
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::CONTAINED.bits() as i32);
        world.entities.insert(item_guid, inventory_item);

        assert!(!world.can_begin_use_with(item_guid));

        world
            .entities
            .get_mut(&item_guid)
            .unwrap()
            .properties
            .ints
            .insert(
                PropertyInt::ItemUseable,
                Usable::SOURCE_CONTAINED_TARGET_REMOTE.bits() as i32,
            );

        assert!(world.can_begin_use_with(item_guid));
    }

    #[test]
    fn combine_respects_target_viewed_location() {
        let player_guid = Guid(0x5000_0001);
        let source_guid = Guid(0x8000_0001);
        let container_guid = Guid(0x8000_0002);
        let target_guid = Guid(0x8000_0003);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            inventory: HashSet::from([source_guid]),
            open_containers: HashSet::from([container_guid]),
            ..Default::default()
        };

        let mut source = entity(source_guid, "Salve");
        source
            .properties
            .ints
            .insert(PropertyInt::TargetType, ItemType::MISC.bits() as i32);
        source.properties.ints.insert(
            PropertyInt::ItemUseable,
            Usable::SOURCE_CONTAINED_TARGET_VIEWED.bits() as i32,
        );
        world.entities.insert(source_guid, source);

        let mut container = entity(container_guid, "Chest");
        container.position.landblock_id = Guid(0x1234_0001);
        world.entities.insert(container_guid, container);

        let mut target = entity(target_guid, "Target");
        target
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::MISC.bits() as i32);
        target
            .properties
            .iids
            .insert(PropertyInstanceId::Container, container_guid);
        world.entities.insert(target_guid, target);

        assert!(world.can_use_with(source_guid, target_guid));

        world.open_containers.clear();
        assert!(!world.can_use_with(source_guid, target_guid));
    }
}

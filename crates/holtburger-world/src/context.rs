use crate::entity::Entity;
use crate::state::WorldState;
use crate::stats::{AttributeType, SkillType};
use crate::vendor::VendorState;
use holtburger_common::Guid;
use holtburger_common::properties::{
    EquipMask, ItemType, PropertyInt, Usable, WorldObjectExt, WorldObjectPropertyAccessors,
};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatTargetStatus {
    Available,
    Unavailable,
    DeathMotionObserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StorageUsage {
    pub item_used: u32,
    pub item_capacity: u32,
    pub container_used: u32,
    pub container_capacity: u32,
}

impl StorageUsage {
    pub const fn total_used(self) -> u32 {
        self.item_used + self.container_used
    }

    pub const fn item_space_left(self) -> u32 {
        self.item_capacity.saturating_sub(self.item_used)
    }

    pub const fn container_space_left(self) -> u32 {
        self.container_capacity.saturating_sub(self.container_used)
    }
}

impl CombatTargetStatus {
    pub const fn is_available(self) -> bool {
        matches!(self, Self::Available)
    }
}

pub fn burden_load_modifier(burden: f32) -> f32 {
    if burden < 1.0 {
        1.0
    } else if burden < 2.0 {
        2.0 - burden
    } else {
        0.0
    }
}

pub fn run_rate_from_skill_and_burden(run_skill: f32, burden: f32) -> f32 {
    if run_skill >= 800.0 {
        18.0 / 4.0
    } else {
        let load_mod = burden_load_modifier(burden);
        (load_mod * (run_skill / (run_skill + 200.0) * 11.0) + 4.0) / 4.0
    }
}

pub fn normalize_name_for_lookup(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

/// Provides access to the world state for common logic.
pub trait WorldContext {
    fn get_player_guid(&self) -> Option<Guid>;
    fn get_entity(&self, guid: Guid) -> Option<&Entity>;
    fn iter_inventory(&self) -> impl Iterator<Item = Guid> + '_;
    fn iter_equipment(&self) -> impl Iterator<Item = Guid> + '_;
    fn iter_entities(&self) -> impl Iterator<Item = &Entity> + '_;
    fn is_open_container(&self, guid: Guid) -> bool;

    fn get_player_attribute_current(&self, _attr: AttributeType) -> Option<u32> {
        None
    }

    fn get_player_skill_current(&self, _skill: SkillType) -> Option<u32> {
        None
    }

    fn get_player_int_property(&self, _prop: PropertyInt) -> Option<i32> {
        None
    }
}

impl WorldContext for WorldState {
    fn get_player_guid(&self) -> Option<Guid> {
        (self.player.guid != Guid::NULL).then_some(self.player.guid)
    }

    fn get_entity(&self, guid: Guid) -> Option<&Entity> {
        self.entities.get(guid)
    }

    fn iter_inventory(&self) -> impl Iterator<Item = Guid> + '_ {
        self.player.inventory.iter().copied()
    }

    fn iter_equipment(&self) -> impl Iterator<Item = Guid> + '_ {
        self.player.equipment.keys().copied()
    }

    fn iter_entities(&self) -> impl Iterator<Item = &Entity> + '_ {
        self.entities.iter()
    }

    fn is_open_container(&self, guid: Guid) -> bool {
        self.open_containers.contains(&guid)
    }

    fn get_player_attribute_current(&self, attr: AttributeType) -> Option<u32> {
        self.player
            .attributes
            .get(&attr)
            .map(|attribute| attribute.current)
    }

    fn get_player_skill_current(&self, skill: SkillType) -> Option<u32> {
        self.player.skills.get(&skill).map(|skill| skill.current)
    }

    fn get_player_int_property(&self, prop: PropertyInt) -> Option<i32> {
        self.player_int_property(prop)
    }
}

/// Common game logic shared across all clients.
pub trait WorldContextExt: WorldContext {
    fn resolve_player_guid_by_name(&self, name: &str) -> Option<Guid> {
        let normalized_name = normalize_name_for_lookup(name);
        if normalized_name.is_empty() {
            return None;
        }

        self.iter_entities()
            .find(|entity| normalize_name_for_lookup(entity.name()) == normalized_name)
            .map(|entity| entity.guid)
    }

    fn get_player_monarch_guid(&self) -> Option<Guid> {
        let player_guid = self.get_player_guid()?;
        self.get_entity(player_guid)?.monarch_id()
    }

    fn player_encumbrance(&self) -> Option<f32> {
        let player_guid = self.get_player_guid()?;

        let mut encumbrance = 0.0;
        for guid in self.iter_inventory() {
            let item = self.get_entity(guid)?;

            if let Some(container_id) = item.container_id()
                && self.is_in_player_inventory(container_id)
                && container_id != player_guid
            {
                continue;
            }

            encumbrance += item.get_int_prop(PropertyInt::EncumbranceVal).unwrap_or(0) as f32;
        }

        Some(encumbrance)
    }

    fn player_capacity(&self) -> Option<f32> {
        self.get_player_guid()?;

        let strength = self.get_player_attribute_current(AttributeType::StrengthAttr)? as f32;
        if strength <= 0.0 {
            return Some(0.0);
        }

        let num_augs = self
            .get_player_int_property(PropertyInt::AugmentationIncreasedCarryingCapacity)
            .unwrap_or(0)
            .max(0) as f32;
        Some((150.0 * strength) + (num_augs * 30.0 * strength))
    }

    fn player_burden(&self) -> Option<f32> {
        let encumbrance = self.player_encumbrance()?;
        let capacity = self.player_capacity()?;

        if capacity <= 0.0 {
            return Some(3.0);
        }

        Some(encumbrance / capacity)
    }

    fn player_run_rate(&self) -> Option<f32> {
        let run_skill = self.get_player_skill_current(SkillType::Run)? as f32;
        let burden = self.player_burden().unwrap_or(3.0);
        Some(run_rate_from_skill_and_burden(run_skill, burden))
    }

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
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
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

    fn is_owned_by_player(&self, guid: Guid) -> bool {
        self.is_equipped_item(guid) || self.is_in_player_inventory(guid)
    }

    fn current_usable_location_flags(&self, guid: Guid, source_guid: Option<Guid>) -> Usable {
        let Some(entity) = self.get_entity(guid) else {
            return Usable::empty();
        };

        let mut available = Usable::empty();
        let is_equipped = self.is_equipped_item(guid);
        let is_owned = self.is_owned_by_player(guid);

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
        self.storage_usage(container_id)
            .map(StorageUsage::total_used)
            .unwrap_or(0)
    }

    fn storage_usage(&self, container_id: Guid) -> Option<StorageUsage> {
        let entity = self.get_entity(container_id)?;
        let is_player = Some(container_id) == self.get_player_guid();

        let mut usage = StorageUsage {
            item_capacity: entity.items_capacity().unwrap_or(0),
            container_capacity: if is_player {
                entity.containers_capacity().unwrap_or(0)
            } else {
                0
            },
            ..StorageUsage::default()
        };

        for child in self.iter_entities() {
            if child.container_id() != Some(container_id) {
                continue;
            }

            if is_player && child.uses_player_container_slot() {
                usage.container_used += 1;
            } else {
                usage.item_used += 1;
            }
        }

        Some(usage)
    }

    fn container_space_left(&self, container_id: Guid) -> u32 {
        self.storage_usage(container_id)
            .map(StorageUsage::item_space_left)
            .unwrap_or(0)
    }

    fn container_can_accept_item(&self, container_id: Guid, item_guid: Guid) -> bool {
        let Some(item) = self.get_entity(item_guid) else {
            return false;
        };

        if Some(container_id) == self.get_player_guid() {
            let Some(usage) = self.storage_usage(container_id) else {
                return false;
            };

            if item.uses_player_container_slot() {
                return usage.container_space_left() > 0;
            }

            return usage.item_space_left() > 0;
        }

        self.container_space_left(container_id) > 0
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

    /// Finds a non-full container in the player's possession that can accept the item.
    /// If preferred_container_id is given, it is checked first.
    /// Then the player itself (main pack), then all items in the inventory that are containers.
    fn find_non_full_pack(
        &self,
        item_guid: Guid,
        preferred_container_id: Option<Guid>,
    ) -> Option<Guid> {
        let player_guid = self.get_player_guid()?;

        // 1. Check preferred first
        if let Some(pref) = preferred_container_id
            && self.container_can_accept_item(pref, item_guid)
        {
            return Some(pref);
        }

        // 2. Check player (main pack)
        if self.container_can_accept_item(player_guid, item_guid) {
            return Some(player_guid);
        }

        // 3. Check all items in inventory
        for pack_guid in self.iter_inventory() {
            // Avoid double-checking player or preferred
            if Some(pack_guid) == preferred_container_id || pack_guid == player_guid {
                continue;
            }

            if self.container_can_accept_item(pack_guid, item_guid) {
                return Some(pack_guid);
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
        if !self.container_can_accept_item(container_id, item_guid) {
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

    use super::{
        CombatTargetStatus, WorldContext, WorldContextExt, burden_load_modifier,
        run_rate_from_skill_and_burden,
    };
    use crate::entity::{Entity, EntityMotionSnapshot};
    use crate::stats::{AttributeType, SkillType};
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::EquipMask;
    use holtburger_common::properties::{
        ItemType, PropertyBool, PropertyInstanceId, PropertyInt, Usable,
    };
    use holtburger_protocol::messages::combat::CombatMode;
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};

    #[derive(Default)]
    struct TestWorld {
        player_guid: Option<Guid>,
        entities: HashMap<Guid, Entity>,
        inventory: HashSet<Guid>,
        equipment: HashSet<Guid>,
        open_containers: HashSet<Guid>,
        player_attributes: HashMap<AttributeType, u32>,
        player_skills: HashMap<SkillType, u32>,
        player_int_properties: Vec<(PropertyInt, i32)>,
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

        fn get_player_attribute_current(&self, attr: AttributeType) -> Option<u32> {
            self.player_attributes.get(&attr).copied()
        }

        fn get_player_skill_current(&self, skill: SkillType) -> Option<u32> {
            self.player_skills.get(&skill).copied()
        }

        fn get_player_int_property(&self, prop: PropertyInt) -> Option<i32> {
            self.player_int_properties
                .iter()
                .find_map(|(candidate, value)| (*candidate == prop).then_some(*value))
        }
    }

    fn entity(guid: Guid, name: &str) -> Entity {
        Entity::new(guid, name.to_string(), WorldPosition::default())
    }

    fn item_in_container(guid: Guid, container_id: Guid, name: &str) -> Entity {
        let mut item = entity(guid, name);
        item.properties
            .iids
            .insert(PropertyInstanceId::Container, container_id);
        item
    }

    #[test]
    fn burden_load_modifier_matches_ace_thresholds() {
        assert_eq!(burden_load_modifier(0.5), 1.0);
        assert_eq!(burden_load_modifier(1.25), 0.75);
        assert_eq!(burden_load_modifier(2.0), 0.0);
    }

    #[test]
    fn player_run_rate_uses_nested_container_burden_and_ace_formula() {
        let player_guid = Guid(0x5000_0001);
        let side_pack_guid = Guid(0x8000_0001);
        let nested_item_guid = Guid(0x8000_0002);
        let equipped_item_guid = Guid(0x8000_0003);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            inventory: HashSet::from([side_pack_guid, nested_item_guid, equipped_item_guid]),
            equipment: HashSet::from([equipped_item_guid]),
            player_attributes: HashMap::from([(AttributeType::StrengthAttr, 100)]),
            player_skills: HashMap::from([(SkillType::Run, 300)]),
            player_int_properties: vec![(PropertyInt::AugmentationIncreasedCarryingCapacity, 1)],
            ..Default::default()
        };

        let mut side_pack = item_in_container(side_pack_guid, player_guid, "Side Pack");
        side_pack
            .properties
            .ints
            .insert(PropertyInt::EncumbranceVal, 120);
        world.entities.insert(side_pack_guid, side_pack);

        let mut nested_item = item_in_container(nested_item_guid, side_pack_guid, "Nested Item");
        nested_item
            .properties
            .ints
            .insert(PropertyInt::EncumbranceVal, 9999);
        world.entities.insert(nested_item_guid, nested_item);

        let mut equipped_item = entity(equipped_item_guid, "Wand");
        equipped_item
            .properties
            .ints
            .insert(PropertyInt::EncumbranceVal, 180);
        world.entities.insert(equipped_item_guid, equipped_item);

        let expected_burden = 300.0 / 18000.0;
        assert_eq!(world.player_encumbrance(), Some(300.0));
        assert_eq!(world.player_capacity(), Some(18_000.0));
        assert_eq!(world.player_burden(), Some(expected_burden));
        assert_eq!(
            world.player_run_rate(),
            Some(run_rate_from_skill_and_burden(300.0, expected_burden))
        );
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
    fn player_slot_counts_split_main_pack_items_from_container_slots() {
        let player_guid = Guid(0x5000_0001);
        let sword_guid = Guid(0x8000_0001);
        let side_pack_guid = Guid(0x8000_0002);
        let focus_guid = Guid(0x8000_0003);
        let nested_item_guid = Guid(0x8000_0004);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            inventory: HashSet::from([sword_guid, side_pack_guid, focus_guid, nested_item_guid]),
            ..Default::default()
        };

        let mut player = entity(player_guid, "Player");
        player
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 10);
        player
            .properties
            .ints
            .insert(PropertyInt::ContainersCapacity, 3);
        world.entities.insert(player_guid, player);

        world.entities.insert(
            sword_guid,
            item_in_container(sword_guid, player_guid, "Sword"),
        );

        let mut side_pack = item_in_container(side_pack_guid, player_guid, "Side Pack");
        side_pack
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 24);
        world.entities.insert(side_pack_guid, side_pack);

        let mut focus = item_in_container(focus_guid, player_guid, "Focus");
        focus
            .properties
            .bools
            .insert(PropertyBool::RequiresBackpackSlot, true);
        world.entities.insert(focus_guid, focus);

        world.entities.insert(
            nested_item_guid,
            item_in_container(nested_item_guid, side_pack_guid, "Apple"),
        );

        assert_eq!(world.get_container_count(player_guid), 3);
        let usage = world
            .storage_usage(player_guid)
            .expect("player should have storage usage");
        assert_eq!(usage.item_used, 1);
        assert_eq!(usage.container_used, 2);
        assert_eq!(usage.item_space_left(), 9);
        assert_eq!(usage.container_space_left(), 1);
    }

    #[test]
    fn find_non_full_pack_uses_player_slot_type_for_item() {
        let player_guid = Guid(0x5000_0001);
        let regular_item_guid = Guid(0x8000_0001);
        let container_item_guid = Guid(0x8000_0002);
        let side_pack_guid = Guid(0x8000_0003);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            inventory: HashSet::from([regular_item_guid, container_item_guid, side_pack_guid]),
            ..Default::default()
        };

        let mut player = entity(player_guid, "Player");
        player.properties.ints.insert(PropertyInt::ItemsCapacity, 0);
        player
            .properties
            .ints
            .insert(PropertyInt::ContainersCapacity, 2);
        world.entities.insert(player_guid, player);

        world.entities.insert(
            regular_item_guid,
            item_in_container(regular_item_guid, Guid::NULL, "Sword"),
        );

        let mut container_item = item_in_container(container_item_guid, Guid::NULL, "Pack");
        container_item
            .properties
            .bools
            .insert(PropertyBool::RequiresBackpackSlot, true);
        world.entities.insert(container_item_guid, container_item);

        let mut side_pack = item_in_container(side_pack_guid, player_guid, "Side Pack");
        side_pack
            .properties
            .ints
            .insert(PropertyInt::ItemsCapacity, 24);
        world.entities.insert(side_pack_guid, side_pack);

        assert_eq!(
            world.find_non_full_pack(regular_item_guid, None),
            Some(side_pack_guid)
        );
        assert_eq!(
            world.find_non_full_pack(container_item_guid, None),
            Some(player_guid)
        );
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

        assert_eq!(
            world.combat_target_status(target_guid),
            CombatTargetStatus::Available
        );
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
            ..Default::default()
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

    #[test]
    fn player_owned_helper_includes_inventory_and_equipment() {
        let player_guid = Guid(0x5000_0001);
        let inventory_guid = Guid(0x8000_0001);
        let equipped_guid = Guid(0x8000_0002);
        let other_guid = Guid(0x8000_0003);

        let world = TestWorld {
            player_guid: Some(player_guid),
            inventory: HashSet::from([inventory_guid]),
            equipment: HashSet::from([equipped_guid]),
            ..Default::default()
        };

        assert!(world.is_owned_by_player(inventory_guid));
        assert!(world.is_owned_by_player(equipped_guid));
        assert!(!world.is_owned_by_player(other_guid));
    }

    #[test]
    fn get_player_monarch_guid_returns_player_monarch() {
        let player_guid = Guid(0x5000_0001);
        let monarch_guid = Guid(0x8000_0001);

        let mut world = TestWorld {
            player_guid: Some(player_guid),
            ..Default::default()
        };

        let mut player = entity(player_guid, "Player");
        player
            .properties
            .iids
            .insert(PropertyInstanceId::Monarch, monarch_guid);
        world.entities.insert(player_guid, player);

        assert_eq!(world.get_player_monarch_guid(), Some(monarch_guid));
    }

    #[test]
    fn resolve_player_guid_by_name_ignores_whitespace_and_case() {
        let target_guid = Guid(0x8000_0001);
        let mut world = TestWorld::default();
        world
            .entities
            .insert(target_guid, entity(target_guid, "Sir   Loin"));

        assert_eq!(
            world.resolve_player_guid_by_name("sirloin"),
            Some(target_guid)
        );
        assert_eq!(
            world.resolve_player_guid_by_name(" S I R   L O I N "),
            Some(target_guid)
        );
        assert_eq!(world.resolve_player_guid_by_name("   \t  "), None);
    }
}

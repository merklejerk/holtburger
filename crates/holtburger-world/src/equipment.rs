//! Client-visible equipment conflicts; server-only wield admission remains authoritative.

use holtburger_common::properties::{
    CombatUse, EquipMask, ItemType, PropertyInt, WorldObjectExt, WorldObjectPropertyAccessors,
};

use crate::entity::Entity;
use holtburger_common::stats::SkillType;

/// Actual hand locations, independent of which weapon class occupies the main hand.
pub const MAIN_HAND_LOCATIONS: EquipMask = EquipMask::from_bits_retain(
    EquipMask::MELEE_WEAPON.bits()
        | EquipMask::MISSILE_WEAPON.bits()
        | EquipMask::CASTER.bits()
        | EquipMask::TWO_HANDED.bits(),
);

/// Retail's apparel family includes full clothing coverage and cloak.
/// `CPlayerSystem::AutoWearIsLegal`, acclient.c:380111.
const APPAREL_LOCATIONS: EquipMask = EquipMask::from_bits_retain(0x0800_7fff);

/// Public equipment facts required to plan replacement, captured once per entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EquipmentFacts {
    /// Allowed locations; apparel is equipped with its complete coverage.
    pub valid_locations: EquipMask,
    /// Clothing priority is an independent conflict domain, not a wield-location mask.
    clothing_priority: Option<u32>,
    /// Retail's public classification for weapons that exclude an offhand item.
    blocks_off_hand: bool,
    /// Nonzero ammo classification, shared by launchers and ammunition.
    ammo_type: Option<u32>,
}

/// An incomplete public description cannot support an equipment plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EquipmentFactsError {
    /// Slot eligibility has not arrived yet.
    #[error("Equipment locations have not arrived")]
    MissingLocations,
    /// Item type supplies retail's caster classification.
    #[error("Equipment item type has not arrived")]
    MissingItemType,
    /// Apparel conflict coverage has not arrived yet.
    #[error("Clothing priority has not arrived")]
    MissingClothingPriority,
}

impl EquipmentFacts {
    /// Public omitted combat-use/ammo fields have zero defaults in the retail
    /// description. Do not require server-only DefaultCombatStyle to hydrate.
    pub fn from_entity(entity: &Entity) -> Result<Self, EquipmentFactsError> {
        let valid_locations = EquipMask::from_bits_retain(
            entity
                .get_int_prop(PropertyInt::ValidLocations)
                .ok_or(EquipmentFactsError::MissingLocations)? as u32,
        );
        let item_type = entity
            .item_type()
            .ok_or(EquipmentFactsError::MissingItemType)?;
        let ammo_type = entity.ammo_type().filter(|value| *value != 0);
        let clothing_priority = if valid_locations.intersects(APPAREL_LOCATIONS) {
            Some(
                entity
                    .priority()
                    .ok_or(EquipmentFactsError::MissingClothingPriority)?,
            )
        } else {
            None
        };
        // ACCWeenieObject::BlocksUseOfShield, acclient.c:378448. This uses
        // public combat use/ammo/item type, not ACE's private combat style.
        let combat_use = entity.combat_use();
        // ACE WorldObject.cs:77 classifies legacy two-handers by weapon skill
        // because their allowed locations may still say MeleeWeapon. Appraisal
        // supplies this live fact when available; normal public prediction remains usable without it.
        let known_two_handed = entity
            .weapon_profile
            .as_ref()
            .is_some_and(|profile| profile.weapon_skill == SkillType::TwoHandedCombat as u32);
        let blocks_off_hand = known_two_handed
            || item_type.intersects(ItemType::CASTER)
            || combat_use == Some(CombatUse::TwoHanded as u32)
            || (combat_use == Some(CombatUse::Missile as u32) && ammo_type.is_some());
        Ok(Self {
            valid_locations,
            clothing_priority,
            blocks_off_hand,
            ammo_type,
        })
    }

    /// A displayed apparel cell selects the whole item; other targets select
    /// one allowed location. ACE permits a melee weapon in the offhand slot.
    pub fn resolve_location(self, requested: EquipMask) -> Option<EquipMask> {
        let allowed = self.valid_locations & requested;
        if self.clothing_priority.is_some() {
            return (!allowed.is_empty()).then_some(self.valid_locations);
        }
        if requested == EquipMask::SHIELD
            && self.valid_locations == EquipMask::MELEE_WEAPON
            && !self.blocks_off_hand
        {
            return Some(EquipMask::SHIELD);
        }
        // Multi-slot jewelry eligibility is not a request to equip both sides.
        (allowed.bits().count_ones() == 1).then_some(allowed)
    }

    /// Preferred-side request shared by equipment execution and alternate-side UI availability.
    /// Ordinary jewelry keeps both candidates so conflict planning can choose a free side.
    pub fn preferred_side_request(self, alternate: bool) -> EquipMask {
        match self.resolve_location(MAIN_HAND_LOCATIONS) {
            Some(main) => {
                if alternate {
                    self.resolve_location(EquipMask::SHIELD).unwrap_or(main)
                } else {
                    main
                }
            }
            None => {
                let right = self.valid_locations
                    & (EquipMask::WRIST_WEAR_RIGHT | EquipMask::FINGER_WEAR_RIGHT);
                if alternate {
                    self.resolve_location(right).unwrap_or(self.valid_locations)
                } else {
                    self.valid_locations
                }
            }
        }
    }

    /// Whether an existing equipped item must leave before this assignment.
    /// Callers deduplicate by item identity and exclude the incoming item itself.
    pub fn conflicts_with(self, target: EquipMask, existing: Self, current: EquipMask) -> bool {
        if let (Some(incoming), Some(worn)) = (self.clothing_priority, existing.clothing_priority) {
            // ACE Creature_Equipment.GetEquippedItems and retail AutoWearIsLegal
            // use priority overlap even when valid-location masks overlap differently.
            return incoming & worn != 0;
        }
        if target.intersects(current) {
            return true;
        }
        let incoming_main = target.intersects(MAIN_HAND_LOCATIONS);
        let existing_main = current.intersects(MAIN_HAND_LOCATIONS);
        if incoming_main && existing_main {
            return true;
        }
        if (incoming_main && current == EquipMask::SHIELD && self.blocks_off_hand)
            || (target == EquipMask::SHIELD && existing_main && existing.blocks_off_hand)
        {
            return true;
        }
        // ACE CheckWeaponCollision checks launcher/ammo agreement in both directions.
        let ammo_pair = (target == EquipMask::MISSILE_WEAPON && current == EquipMask::MISSILE_AMMO)
            || (target == EquipMask::MISSILE_AMMO && existing_main);
        ammo_pair && matches!((self.ammo_type, existing.ammo_type), (Some(a), Some(b)) if a != b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;

    fn facts(location: EquipMask, kind: ItemType, combat: CombatUse, ammo: u32) -> EquipmentFacts {
        let mut entity = Entity::new(Guid(1), "Equipment".into(), Default::default());
        for (property, value) in [
            (PropertyInt::ValidLocations, location.bits()),
            (PropertyInt::ItemType, kind.bits()),
            (PropertyInt::CombatUse, combat as u32),
            (PropertyInt::AmmoType, ammo),
        ] {
            entity.properties.ints.insert(property, value as i32);
        }
        EquipmentFacts::from_entity(&entity).expect("complete public equipment facts")
    }

    #[test]
    fn alternate_side_requires_a_distinct_equipment_request() {
        for (locations, kind, combat, expected) in [
            (
                EquipMask::MELEE_WEAPON,
                ItemType::MELEE_WEAPON,
                CombatUse::Melee,
                true,
            ),
            (
                EquipMask::MELEE_WEAPON,
                ItemType::MELEE_WEAPON,
                CombatUse::TwoHanded,
                false,
            ),
            (EquipMask::SHIELD, ItemType::ARMOR, CombatUse::Shield, false),
            (
                EquipMask::FINGER_WEAR_LEFT | EquipMask::FINGER_WEAR_RIGHT,
                ItemType::JEWELRY,
                CombatUse::None,
                true,
            ),
            (
                EquipMask::FINGER_WEAR_RIGHT,
                ItemType::JEWELRY,
                CombatUse::None,
                false,
            ),
        ] {
            let item = facts(locations, kind, combat, 0);
            assert_eq!(
                item.preferred_side_request(false) != item.preferred_side_request(true),
                expected
            );
        }
    }

    #[test]
    fn offhand_replacement_inspects_the_existing_main_hand() {
        let melee = facts(
            EquipMask::MELEE_WEAPON,
            ItemType::MELEE_WEAPON,
            CombatUse::Melee,
            0,
        );
        let two_handed = facts(
            EquipMask::TWO_HANDED,
            ItemType::MELEE_WEAPON,
            CombatUse::TwoHanded,
            0,
        );
        assert!(melee.conflicts_with(EquipMask::SHIELD, two_handed, EquipMask::TWO_HANDED));
        assert!(!melee.conflicts_with(EquipMask::SHIELD, melee, EquipMask::MELEE_WEAPON));
    }

    #[test]
    fn appraisal_identifies_legacy_two_handed_weapons_with_melee_locations() {
        let mut entity = Entity::new(Guid(1), "Legacy two-hander".into(), Default::default());
        entity.properties.ints.insert(
            PropertyInt::ValidLocations,
            EquipMask::MELEE_WEAPON.bits() as i32,
        );
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        entity.weapon_profile = Some(
            holtburger_protocol::messages::object::types::WeaponProfile {
                weapon_skill: SkillType::TwoHandedCombat as u32,
                damage_type: 0,
                weapon_time: 0,
                damage: 0,
                damage_variance: 0.0,
                damage_mod: 0.0,
                weapon_length: 0.0,
                max_velocity: 0.0,
                weapon_offense: 0.0,
                max_velocity_estimated: 0,
            },
        );
        let legacy = EquipmentFacts::from_entity(&entity).expect("appraised weapon");
        let shield = facts(EquipMask::SHIELD, ItemType::ARMOR, CombatUse::Shield, 0);
        assert_eq!(legacy.resolve_location(EquipMask::SHIELD), None);
        assert!(legacy.conflicts_with(EquipMask::MELEE_WEAPON, shield, EquipMask::SHIELD));
        assert!(shield.conflicts_with(EquipMask::SHIELD, legacy, EquipMask::MELEE_WEAPON));
    }

    #[test]
    fn thrown_weapons_allow_a_shield_but_launchers_do_not() {
        let shield = facts(EquipMask::SHIELD, ItemType::ARMOR, CombatUse::Shield, 0);
        let thrown = facts(
            EquipMask::MISSILE_WEAPON,
            ItemType::MISSILE_WEAPON,
            CombatUse::Missile,
            0,
        );
        let launcher = facts(
            EquipMask::MISSILE_WEAPON,
            ItemType::MISSILE_WEAPON,
            CombatUse::Missile,
            1,
        );
        assert!(!thrown.conflicts_with(EquipMask::MISSILE_WEAPON, shield, EquipMask::SHIELD));
        assert!(launcher.conflicts_with(EquipMask::MISSILE_WEAPON, shield, EquipMask::SHIELD));
    }

    #[test]
    fn clothing_uses_priority_and_resolves_full_coverage() {
        let mut entity = Entity::new(Guid(1), "Robe".into(), Default::default());
        let coverage = EquipMask::CHEST_ARMOR | EquipMask::UPPER_ARM_ARMOR;
        entity
            .properties
            .ints
            .insert(PropertyInt::ValidLocations, coverage.bits() as i32);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::ARMOR.bits() as i32);
        assert_eq!(
            EquipmentFacts::from_entity(&entity),
            Err(EquipmentFactsError::MissingClothingPriority)
        );
        entity
            .properties
            .ints
            .insert(PropertyInt::ClothingPriority, 1);
        let incoming = EquipmentFacts::from_entity(&entity).expect("priority received");
        assert_eq!(
            incoming.resolve_location(EquipMask::CHEST_ARMOR),
            Some(coverage)
        );
        entity
            .properties
            .ints
            .insert(PropertyInt::ClothingPriority, 2);
        let independent = EquipmentFacts::from_entity(&entity).expect("independent layer");
        assert!(!incoming.conflicts_with(coverage, independent, coverage));
        assert!(incoming.conflicts_with(coverage, incoming, coverage));
    }

    #[test]
    fn jewelry_requires_one_side_and_melee_can_resolve_offhand() {
        let sides = EquipMask::FINGER_WEAR_LEFT | EquipMask::FINGER_WEAR_RIGHT;
        let ring = facts(sides, ItemType::JEWELRY, CombatUse::None, 0);
        assert_eq!(ring.resolve_location(sides), None);
        assert_eq!(
            ring.resolve_location(EquipMask::FINGER_WEAR_RIGHT),
            Some(EquipMask::FINGER_WEAR_RIGHT)
        );
        let melee = facts(
            EquipMask::MELEE_WEAPON,
            ItemType::MELEE_WEAPON,
            CombatUse::Melee,
            0,
        );
        assert_eq!(
            melee.resolve_location(EquipMask::SHIELD),
            Some(EquipMask::SHIELD)
        );
        assert_eq!(melee.resolve_location(EquipMask::HEAD_WEAR), None);
    }
}

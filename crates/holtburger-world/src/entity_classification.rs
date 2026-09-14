//! Color-independent entity categories shared by nameplates, maps, and selected identity UI.

use holtburger_common::properties::{ItemType, ObjectDescriptionFlag, Usable, WeenieType};
use serde::{Deserialize, Serialize};

/// Narrow producer-resolved class consumed only by client presentation policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntityPresentationClass {
    Player,
    Npc,
    Mob,
    /// Portal objects, independently selectable by frontend presentation policy.
    Portal,
    Other,
}

/// Producer-resolved semantic category shared by map markers and selected-entity text.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntityMapBlipCategory {
    Player,
    Npc,
    Mob,
    Portal,
    Lifestone,
    /// Door permitting direct Use; server locks and other constraints remain independent.
    Door,
    /// Door explicitly disabling direct Use in its public useability.
    DoorNoDirectUse,
    /// Native ACE Switch, including lever/button variants and other activatable scenery.
    Switch,
    #[default]
    Other,
}

/// Classifies live entity facts once for overhead-map marker presentation.
pub fn semantic_dynamic_entity_map_blip_category(
    flags: ObjectDescriptionFlag,
    item_type: Option<ItemType>,
    weenie_type: Option<WeenieType>,
    usable: Usable,
) -> DynamicEntityMapBlipCategory {
    if flags.contains(ObjectDescriptionFlag::DOOR) {
        return door_map_category(usable);
    }
    if weenie_type == Some(WeenieType::Switch) {
        return DynamicEntityMapBlipCategory::Switch;
    }
    let presentation_class = semantic_dynamic_entity_presentation_class(flags, item_type);
    map_blip_category(
        presentation_class,
        flags.intersects(ObjectDescriptionFlag::LIFE_STONE | ObjectDescriptionFlag::BIND_STONE)
            || item_type.is_some_and(|value| value.contains(ItemType::LIFE_STONE)),
    )
}

/// Classifies live entity facts once for frontend presentation policy.
///
/// This is the color-independent semantic decision already consumed by radar fallback coloring.
/// Vendors are friendly NPCs; their attackable flag does not promote them to mobs.
pub fn semantic_dynamic_entity_presentation_class(
    flags: ObjectDescriptionFlag,
    item_type: Option<ItemType>,
) -> DynamicEntityPresentationClass {
    if flags.contains(ObjectDescriptionFlag::PLAYER) {
        return DynamicEntityPresentationClass::Player;
    }
    if flags.contains(ObjectDescriptionFlag::VENDOR) {
        return DynamicEntityPresentationClass::Npc;
    }
    if flags.contains(ObjectDescriptionFlag::PORTAL)
        || item_type.is_some_and(|value| value.contains(ItemType::PORTAL))
    {
        return DynamicEntityPresentationClass::Portal;
    }
    if item_type.is_some_and(|value| value.contains(ItemType::CREATURE)) {
        return if flags.contains(ObjectDescriptionFlag::ATTACKABLE) {
            DynamicEntityPresentationClass::Mob
        } else {
            DynamicEntityPresentationClass::Npc
        };
    }
    DynamicEntityPresentationClass::Other
}

/// Classifies the equivalent static facts available to Explorer.
///
/// ACE defaults an absent `Attackable` property to true. Admin and Sentinel templates retain the
/// minimap's established friendly classification rather than inheriting that generic default.
pub fn explorer_dynamic_entity_presentation_class(
    weenie_type: WeenieType,
    item_type: Option<ItemType>,
    attackable: Option<bool>,
) -> DynamicEntityPresentationClass {
    if weenie_type == WeenieType::Vendor {
        return DynamicEntityPresentationClass::Npc;
    }
    if matches!(weenie_type, WeenieType::Admin | WeenieType::Sentinel) {
        return DynamicEntityPresentationClass::Npc;
    }
    if matches!(weenie_type, WeenieType::Portal | WeenieType::HousePortal)
        || item_type.is_some_and(|value| value.contains(ItemType::PORTAL))
    {
        return DynamicEntityPresentationClass::Portal;
    }
    let is_creature = matches!(
        weenie_type,
        WeenieType::Creature
            | WeenieType::Cow
            | WeenieType::AI
            | WeenieType::Pet
            | WeenieType::CombatPet
    ) || item_type.is_some_and(|value| value.contains(ItemType::CREATURE));
    if !is_creature {
        return DynamicEntityPresentationClass::Other;
    }
    if attackable.unwrap_or(true) {
        DynamicEntityPresentationClass::Mob
    } else {
        DynamicEntityPresentationClass::Npc
    }
}

/// Classifies the equivalent static facts available to Explorer for overhead-map markers.
pub fn explorer_dynamic_entity_map_blip_category(
    weenie_type: WeenieType,
    item_type: Option<ItemType>,
    attackable: Option<bool>,
    usable: Usable,
) -> DynamicEntityMapBlipCategory {
    if weenie_type == WeenieType::Door {
        return door_map_category(usable);
    }
    if weenie_type == WeenieType::Switch {
        return DynamicEntityMapBlipCategory::Switch;
    }
    let presentation_class =
        explorer_dynamic_entity_presentation_class(weenie_type, item_type, attackable);
    map_blip_category(
        presentation_class,
        matches!(
            weenie_type,
            WeenieType::LifeStone | WeenieType::AllegianceBindstone
        ) || item_type.is_some_and(|value| value.contains(ItemType::LIFE_STONE)),
    )
}

/// Resolve the same useability predicate consumed by direct-use admission.
fn door_map_category(usable: Usable) -> DynamicEntityMapBlipCategory {
    if usable.allows_direct_use() {
        DynamicEntityMapBlipCategory::Door
    } else {
        DynamicEntityMapBlipCategory::DoorNoDirectUse
    }
}

/// Refines the general presentation class only where map semantics require another landmark.
fn map_blip_category(
    presentation_class: DynamicEntityPresentationClass,
    is_lifestone: bool,
) -> DynamicEntityMapBlipCategory {
    match presentation_class {
        DynamicEntityPresentationClass::Player => DynamicEntityMapBlipCategory::Player,
        DynamicEntityPresentationClass::Npc => DynamicEntityMapBlipCategory::Npc,
        DynamicEntityPresentationClass::Mob => DynamicEntityMapBlipCategory::Mob,
        DynamicEntityPresentationClass::Portal => DynamicEntityMapBlipCategory::Portal,
        DynamicEntityPresentationClass::Other if is_lifestone => {
            DynamicEntityMapBlipCategory::Lifestone
        }
        DynamicEntityPresentationClass::Other => DynamicEntityMapBlipCategory::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interactable_categories_share_direct_use_semantics_across_modes() {
        for (usable, expected) in [
            (Usable::UNDEF, DynamicEntityMapBlipCategory::Door),
            (Usable::REMOTE, DynamicEntityMapBlipCategory::Door),
            (Usable::NO, DynamicEntityMapBlipCategory::DoorNoDirectUse),
            (
                Usable::NO | Usable::REMOTE,
                DynamicEntityMapBlipCategory::DoorNoDirectUse,
            ),
        ] {
            // Network door identity remains usable without a catalog, and wins over stale metadata.
            for kind in [None, Some(WeenieType::Switch)] {
                assert_eq!(
                    semantic_dynamic_entity_map_blip_category(
                        ObjectDescriptionFlag::DOOR,
                        None,
                        kind,
                        usable
                    ),
                    expected
                );
            }
            assert_eq!(
                explorer_dynamic_entity_map_blip_category(WeenieType::Door, None, None, usable),
                expected
            );
            assert_eq!(
                semantic_dynamic_entity_map_blip_category(
                    ObjectDescriptionFlag::empty(),
                    None,
                    Some(WeenieType::Switch),
                    usable
                ),
                DynamicEntityMapBlipCategory::Switch
            );
            assert_eq!(
                explorer_dynamic_entity_map_blip_category(WeenieType::Switch, None, None, usable),
                DynamicEntityMapBlipCategory::Switch
            );
        }
        assert_eq!(
            semantic_dynamic_entity_map_blip_category(
                ObjectDescriptionFlag::empty(),
                None,
                None,
                Usable::REMOTE
            ),
            DynamicEntityMapBlipCategory::Other
        );
    }

    #[test]
    fn live_map_categories_are_independent_from_radar_color() {
        let cases = [
            (
                "player",
                ObjectDescriptionFlag::PLAYER,
                Some(ItemType::CREATURE),
                DynamicEntityMapBlipCategory::Player,
            ),
            (
                "mob",
                ObjectDescriptionFlag::ATTACKABLE,
                Some(ItemType::CREATURE),
                DynamicEntityMapBlipCategory::Mob,
            ),
            (
                "npc",
                ObjectDescriptionFlag::VENDOR,
                Some(ItemType::CREATURE),
                DynamicEntityMapBlipCategory::Npc,
            ),
            (
                "portal",
                ObjectDescriptionFlag::PORTAL,
                None,
                DynamicEntityMapBlipCategory::Portal,
            ),
            (
                "lifestone",
                ObjectDescriptionFlag::LIFE_STONE,
                None,
                DynamicEntityMapBlipCategory::Lifestone,
            ),
            (
                "other",
                ObjectDescriptionFlag::empty(),
                None,
                DynamicEntityMapBlipCategory::Other,
            ),
        ];

        for (name, flags, item_type, expected) in cases {
            assert_eq!(
                semantic_dynamic_entity_map_blip_category(
                    flags,
                    item_type,
                    None,
                    holtburger_common::properties::Usable::UNDEF
                ),
                expected,
                "{name}"
            );
        }
    }
    #[test]
    fn explorer_map_categories_match_live_semantics() {
        let cases = [
            (
                "portal",
                WeenieType::Portal,
                None,
                None,
                DynamicEntityMapBlipCategory::Portal,
            ),
            (
                "mob",
                WeenieType::Creature,
                Some(ItemType::CREATURE),
                Some(true),
                DynamicEntityMapBlipCategory::Mob,
            ),
            (
                "npc",
                WeenieType::Vendor,
                Some(ItemType::CREATURE),
                None,
                DynamicEntityMapBlipCategory::Npc,
            ),
            (
                "lifestone",
                WeenieType::LifeStone,
                Some(ItemType::LIFE_STONE),
                None,
                DynamicEntityMapBlipCategory::Lifestone,
            ),
            (
                "other",
                WeenieType::Generic,
                None,
                None,
                DynamicEntityMapBlipCategory::Other,
            ),
        ];

        for (name, weenie_type, item_type, attackable, expected) in cases {
            assert_eq!(
                explorer_dynamic_entity_map_blip_category(
                    weenie_type,
                    item_type,
                    attackable,
                    holtburger_common::properties::Usable::UNDEF
                ),
                expected,
                "{name}"
            );
        }
    }
}

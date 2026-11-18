//! Color-independent entity categories shared by nameplates, maps, scripting, and selected identity UI.

use crate::entity::Entity;
use crate::vendor::CoreVendorItem;
use holtburger_common::properties::{
    ItemType, ObjectDescriptionFlag, PhysicsState, PropertyBool, PropertyInt, Usable, WeenieType,
    WorldObjectExt, WorldObjectProperties, WorldObjectPropertyAccessors,
};
use holtburger_protocol::messages::object::messages::PublicWeenieDescription;
use serde::{Deserialize, Serialize};

/// Semantic classification for live entities, vendor items, and weenie descriptions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityClass {
    Player,
    Npc,
    Vendor,
    Monster,
    Weapon,     // Includes shields
    Apparel,    // Clothing, Jewelry, Chest, etc.
    Container,  // Bags, Packs
    Item,       // General attackable but not stuck item
    Consumable, // Food, Gems, Spell Components, Mana Stones
    Money,      // Pyreals, Notes
    Key,        // Keys, Lockpicks
    Writable,   // Books, Scrolls
    HealingKit,
    ManaStone,
    Door,
    Portal,
    LifeStone,
    Chest, // Stuck, Attackable, Container
    Wand,
    Tool,
    StaticObject,
    Unknown,
}

impl EntityClass {
    pub fn is_creature(&self) -> bool {
        matches!(
            self,
            EntityClass::Player | EntityClass::Npc | EntityClass::Vendor | EntityClass::Monster
        )
    }
}

pub fn classify_entity(entity: &Entity) -> EntityClass {
    classify_world_object(entity.flags, entity)
}

pub fn classify_vendor_item(item: &CoreVendorItem) -> EntityClass {
    classify_properties(&item.properties)
}

pub fn classify_properties(props: &WorldObjectProperties) -> EntityClass {
    let physics_state = props
        .get_int_prop(PropertyInt::PhysicsState)
        .map(|v| PhysicsState::from_bits_truncate(v as u32))
        .unwrap_or(PhysicsState::empty());

    // Build synthetic flags from static properties when no live ObjectDescriptionFlag is available.
    let mut flags = ObjectDescriptionFlag::empty();
    if physics_state.contains(PhysicsState::STATIC) || props.is_stuck() {
        flags |= ObjectDescriptionFlag::STUCK;
    }
    if props.get_bool_prop(PropertyBool::Attackable) {
        flags |= ObjectDescriptionFlag::ATTACKABLE;
    }

    classify_world_object(flags, props)
}

pub fn classify_description(desc: &PublicWeenieDescription) -> EntityClass {
    classify_raw(
        desc.obj_desc_flags,
        Some(ItemType::from_bits_truncate(desc.item_type)),
    )
}

pub fn classify_world_object<T: WorldObjectExt>(
    flags: ObjectDescriptionFlag,
    object: &T,
) -> EntityClass {
    classify_raw(flags, object.item_type())
}

fn classify_raw(flags: ObjectDescriptionFlag, item_type: Option<ItemType>) -> EntityClass {
    if flags.intersects(ObjectDescriptionFlag::PLAYER) {
        return EntityClass::Player;
    }
    let is_stuck = flags.intersects(ObjectDescriptionFlag::STUCK);
    let is_attackable = flags.intersects(ObjectDescriptionFlag::ATTACKABLE);
    let is_food = flags.intersects(ObjectDescriptionFlag::FOOD);
    let is_container = item_type.is_some_and(|it| it.intersects(ItemType::CONTAINER));

    // If something is Stuck and Attackable and a Container then it's a chest.
    if is_stuck && is_attackable && is_container {
        return EntityClass::Chest;
    }

    // Creatures
    let is_creature = item_type.is_some_and(|it| it.intersects(ItemType::CREATURE));

    if is_creature {
        if is_attackable {
            return EntityClass::Monster;
        }
        if flags.intersects(ObjectDescriptionFlag::VENDOR) {
            return EntityClass::Vendor;
        }
        return EntityClass::Npc;
    }

    // General purpose refinement for items
    let mut refined_class = None;
    if let Some(it) = item_type {
        if it.intersects(ItemType::MELEE_WEAPON | ItemType::MISSILE_WEAPON) {
            refined_class = Some(EntityClass::Weapon);
        } else if it.intersects(ItemType::CASTER) {
            refined_class = Some(EntityClass::Wand);
        } else if it.intersects(ItemType::ARMOR | ItemType::CLOTHING | ItemType::JEWELRY) {
            refined_class = Some(EntityClass::Apparel);
        } else if it.intersects(ItemType::CONTAINER) {
            refined_class = Some(EntityClass::Container);
        } else if it.intersects(ItemType::PORTAL) {
            refined_class = Some(EntityClass::Portal);
        } else if it.intersects(ItemType::LIFE_STONE) {
            refined_class = Some(EntityClass::LifeStone);
        } else if it.intersects(ItemType::MANA_STONE) {
            refined_class = Some(EntityClass::ManaStone);
        } else if is_food
            || it.intersects(
                ItemType::FOOD
                    | ItemType::GEM
                    | ItemType::SPELL_COMPONENTS
                    | ItemType::CRAFT_COOKING_BASE
                    | ItemType::CRAFT_ALCHEMY_BASE
                    | ItemType::CRAFT_FLETCHING_BASE
                    | ItemType::CRAFT_ALCHEMY_INTERMEDIATE
                    | ItemType::CRAFT_FLETCHING_INTERMEDIATE,
            )
        {
            refined_class = Some(EntityClass::Consumable);
        } else if it.intersects(ItemType::MONEY | ItemType::PROMISSORY_NOTE) {
            refined_class = Some(EntityClass::Money);
        } else if it.intersects(ItemType::KEY | ItemType::LOCKABLE) {
            refined_class = Some(EntityClass::Key);
        } else if it.intersects(ItemType::WRITABLE) {
            refined_class = Some(EntityClass::Writable);
        } else if it.intersects(ItemType::TINKERING_TOOL) {
            refined_class = Some(EntityClass::Tool);
        }
    }

    // Flag based overrides
    if flags.intersects(ObjectDescriptionFlag::PORTAL) {
        return EntityClass::Portal;
    }
    if flags.intersects(ObjectDescriptionFlag::DOOR) {
        return EntityClass::Door;
    }
    if flags.intersects(ObjectDescriptionFlag::VENDOR) {
        return EntityClass::Vendor;
    }
    if flags.intersects(ObjectDescriptionFlag::PLAYER) {
        return EntityClass::Player;
    }
    if flags.intersects(ObjectDescriptionFlag::HEALER) {
        return EntityClass::HealingKit;
    }

    // Rule: item class for things that are Attackable but not stuck.
    if is_attackable && !is_stuck {
        return refined_class.unwrap_or(EntityClass::Item);
    }

    // If we have a refined class from ItemType, use it even if not attackable
    if let Some(rc) = refined_class {
        return rc;
    }

    if flags.intersects(ObjectDescriptionFlag::STUCK) {
        return EntityClass::StaticObject;
    }

    EntityClass::Unknown
}

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
    /// Explorer-only server template identity; live entities do not expose this distinction.
    Switch,
    #[default]
    Other,
}

/// Classifies live entity facts once for overhead-map marker presentation.
pub fn semantic_dynamic_entity_map_blip_category(
    flags: ObjectDescriptionFlag,
    item_type: Option<ItemType>,
    usable: Usable,
) -> DynamicEntityMapBlipCategory {
    if flags.contains(ObjectDescriptionFlag::DOOR) {
        return door_map_category(usable);
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
    fn door_categories_follow_public_use_admission() {
        for (usable, expected) in [
            (Usable::UNDEF, DynamicEntityMapBlipCategory::Door),
            (Usable::REMOTE, DynamicEntityMapBlipCategory::Door),
            (Usable::NO, DynamicEntityMapBlipCategory::DoorNoDirectUse),
            (
                Usable::NO | Usable::REMOTE,
                DynamicEntityMapBlipCategory::DoorNoDirectUse,
            ),
        ] {
            assert_eq!(
                semantic_dynamic_entity_map_blip_category(
                    ObjectDescriptionFlag::DOOR,
                    None,
                    usable
                ),
                expected
            );
            assert_eq!(
                explorer_dynamic_entity_map_blip_category(WeenieType::Door, None, None, usable),
                expected
            );
        }
    }

    #[test]
    fn explorer_switch_category_uses_its_server_template() {
        assert_eq!(
            explorer_dynamic_entity_map_blip_category(
                WeenieType::Switch,
                None,
                None,
                Usable::REMOTE
            ),
            DynamicEntityMapBlipCategory::Switch
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

use holtburger_common::properties::{
    ItemType, ObjectDescriptionFlag, PropertyBool, PropertyInt, WorldObjectExt,
    WorldObjectProperties, WorldObjectPropertyAccessors,
};
use holtburger_protocol::messages::object::messages::PublicWeenieDescription;
use holtburger_scripting::ScriptEntityKind;
use holtburger_world::entity::Entity;
use holtburger_world::vendor::CoreVendorItem;
use ratatui::style::Color;

#[derive(Debug, Clone, Copy, PartialEq)]
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
    pub fn emoji(&self) -> &'static str {
        match self {
            EntityClass::Player => "🧙",
            EntityClass::Npc => "🙋",
            EntityClass::Vendor => "🛒",
            EntityClass::Monster => "😈",
            EntityClass::Weapon => "🔪",
            EntityClass::Wand => "🪄",
            EntityClass::Apparel => "👕",
            EntityClass::Container => "💼",
            EntityClass::Item => "📦️",
            EntityClass::Consumable => "🍗",
            EntityClass::Money => "💲",
            EntityClass::Key => "🔑",
            EntityClass::Writable => "📖",
            EntityClass::Door => "🚪",
            EntityClass::Portal => "🌀",
            EntityClass::LifeStone => "🪦",
            EntityClass::Chest => "🧰",
            EntityClass::Tool => "🔧",
            EntityClass::StaticObject => "🪧",
            EntityClass::HealingKit => "🩹",
            EntityClass::ManaStone => "🔋",
            EntityClass::Unknown => "❓",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            EntityClass::Player => "Player",
            EntityClass::Npc => "NPC",
            EntityClass::Vendor => "Vendor",
            EntityClass::Monster => "Mob",
            EntityClass::Weapon => "Weapon",
            EntityClass::Wand => "Wand",
            EntityClass::Apparel => "Apparel",
            EntityClass::Container => "Container",
            EntityClass::Item => "Item",
            EntityClass::Consumable => "Eat",
            EntityClass::Money => "Pyreal",
            EntityClass::Key => "Key",
            EntityClass::Writable => "Note",
            EntityClass::Door => "Door",
            EntityClass::Portal => "Portal",
            EntityClass::LifeStone => "LifeStone",
            EntityClass::Chest => "Chest",
            EntityClass::Tool => "Tool",
            EntityClass::StaticObject => "Static",
            EntityClass::HealingKit => "Healing Kit",
            EntityClass::ManaStone => "Mana Stone",
            EntityClass::Unknown => "?",
        }
    }

    pub fn kind(&self) -> ScriptEntityKind {
        match self {
            EntityClass::Player => ScriptEntityKind::Player,
            EntityClass::Npc => ScriptEntityKind::Npc,
            EntityClass::Vendor => ScriptEntityKind::Vendor,
            EntityClass::Monster => ScriptEntityKind::Monster,
            EntityClass::Weapon => ScriptEntityKind::Weapon,
            EntityClass::Wand => ScriptEntityKind::Wand,
            EntityClass::Apparel => ScriptEntityKind::Apparel,
            EntityClass::Container => ScriptEntityKind::Container,
            EntityClass::Item => ScriptEntityKind::Item,
            EntityClass::Consumable => ScriptEntityKind::Consumable,
            EntityClass::Money => ScriptEntityKind::Money,
            EntityClass::Key => ScriptEntityKind::Key,
            EntityClass::Writable => ScriptEntityKind::Writable,
            EntityClass::HealingKit => ScriptEntityKind::HealingKit,
            EntityClass::ManaStone => ScriptEntityKind::ManaStone,
            EntityClass::Door => ScriptEntityKind::Door,
            EntityClass::Portal => ScriptEntityKind::Portal,
            EntityClass::LifeStone => ScriptEntityKind::LifeStone,
            EntityClass::Chest => ScriptEntityKind::Chest,
            EntityClass::Tool => ScriptEntityKind::Tool,
            EntityClass::StaticObject => ScriptEntityKind::StaticObject,
            EntityClass::Unknown => ScriptEntityKind::Unknown,
        }
    }

    pub fn is_creature(&self) -> bool {
        matches!(
            self,
            EntityClass::Player | EntityClass::Npc | EntityClass::Vendor | EntityClass::Monster
        )
    }
}

pub fn get_entity_color(class: EntityClass) -> Color {
    match class {
        EntityClass::Player => Color::Yellow,
        EntityClass::Npc => Color::LightGreen,
        EntityClass::Vendor => Color::LightGreen,
        EntityClass::Monster => Color::Red,
        EntityClass::Container | EntityClass::Chest => Color::White,
        EntityClass::LifeStone => Color::Blue,
        EntityClass::ManaStone => Color::Cyan,
        EntityClass::Portal => Color::LightMagenta,
        EntityClass::Door | EntityClass::StaticObject => Color::White,
        EntityClass::Unknown => Color::DarkGray,
        EntityClass::HealingKit => Color::LightMagenta,
        _ => Color::White,
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
        .map(|v| holtburger_common::properties::PhysicsState::from_bits_truncate(v as u32))
        .unwrap_or(holtburger_common::properties::PhysicsState::empty());

    // Let's create dummy flags for classify_raw based on what we know.
    let mut flags = ObjectDescriptionFlag::empty();
    if physics_state.contains(holtburger_common::properties::PhysicsState::STATIC) {
        flags |= ObjectDescriptionFlag::STUCK;
    }
    if props.is_stuck() {
        flags |= ObjectDescriptionFlag::STUCK;
    }
    if props.get_bool_prop(PropertyBool::Attackable) {
        flags |= ObjectDescriptionFlag::ATTACKABLE;
    }
    // Note: ItemType does not have a PLAYER flag, it's in ObjectDescriptionFlag.
    // We can't easily deduce it from properties alone unless we have a specific property.

    classify_world_object(flags, props)
}

pub fn classify_description(desc: &PublicWeenieDescription) -> EntityClass {
    classify_raw(
        desc.obj_desc_flags,
        Some(ItemType::from_bits_truncate(desc.item_type)),
    )
}

fn classify_raw(flags: ObjectDescriptionFlag, item_type: Option<ItemType>) -> EntityClass {
    if flags.intersects(ObjectDescriptionFlag::PLAYER) {
        return EntityClass::Player;
    }
    let is_stuck = flags.intersects(ObjectDescriptionFlag::STUCK);
    let is_attackable = flags.intersects(ObjectDescriptionFlag::ATTACKABLE);
    let is_food = flags.intersects(ObjectDescriptionFlag::FOOD);
    let is_container = if let Some(it) = item_type {
        it.intersects(ItemType::CONTAINER)
    } else {
        false
    };

    // If something is Stuck and Attackable and a Container then it's a chest.
    if is_stuck && is_attackable && is_container {
        return EntityClass::Chest;
    }

    // Creatures - Check ItemType or GUID range
    let is_creature = if let Some(it) = item_type {
        it.intersects(ItemType::CREATURE)
    } else {
        false
    };

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

fn classify_world_object<T: WorldObjectExt>(
    flags: ObjectDescriptionFlag,
    object: &T,
) -> EntityClass {
    classify_raw(flags, object.item_type())
}

#[cfg(test)]
mod tests {
    use super::EntityClass;
    use holtburger_scripting::ScriptEntityKind;

    #[test]
    fn entity_class_kind_returns_stable_machine_readable_ids() {
        assert_eq!(EntityClass::Player.kind(), ScriptEntityKind::Player);
        assert_eq!(EntityClass::Monster.kind(), ScriptEntityKind::Monster);
        assert_eq!(
            EntityClass::StaticObject.kind(),
            ScriptEntityKind::StaticObject
        );
        assert_eq!(EntityClass::HealingKit.kind(), ScriptEntityKind::HealingKit);
    }
}

use holtburger_core::world::entity::Entity;
use holtburger_core::world::properties::{ItemType, ObjectDescriptionFlag, WeenieType};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EntityClass {
    Player,
    Npc,
    Monster,
    Weapon,    // Includes shields
    Apparel,   // Clothing, Jewelry, Chest, etc.
    Container, // Bags, Packs
    Item,      // General attackable but not stuck item
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
            EntityClass::Monster => "😈",
            EntityClass::Weapon => "🔪",
            EntityClass::Wand => "🪄",
            EntityClass::Apparel => "👕",
            EntityClass::Container => "💼",
            EntityClass::Item => "📦️",
            EntityClass::Door => "🚪",
            EntityClass::Portal => "🌀",
            EntityClass::LifeStone => "🪦",
            EntityClass::Chest => "🧰",
            EntityClass::Tool => "🔧",
            EntityClass::StaticObject => "🪧",
            EntityClass::Unknown => "❓",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            EntityClass::Player => "Player",
            EntityClass::Npc => "NPC",
            EntityClass::Monster => "Mob",
            EntityClass::Weapon => "Weapon",
            EntityClass::Wand => "Wand",
            EntityClass::Apparel => "Apparel",
            EntityClass::Container => "Container",
            EntityClass::Item => "Item",
            EntityClass::Door => "Door",
            EntityClass::Portal => "Portal",
            EntityClass::LifeStone => "LifeStone",
            EntityClass::Chest => "Chest",
            EntityClass::Tool => "Tool",
            EntityClass::StaticObject => "Static",
            EntityClass::Unknown => "?",
        }
    }
}

pub fn classify_entity(entity: &Entity) -> EntityClass {
    let guid = entity.guid;

    if (0x50000001..=0x5FFFFFFF).contains(&guid) {
        return EntityClass::Player;
    }

    let is_stuck = entity.flags.intersects(ObjectDescriptionFlag::STUCK);
    let is_attackable = entity.flags.intersects(ObjectDescriptionFlag::ATTACKABLE);
    let is_container = if let Some(it) = entity.item_type {
        it.intersects(ItemType::CONTAINER)
    } else {
        false
    } || if let Some(wcid) = entity.wcid {
        wcid == WeenieType::Container as u32 || wcid == WeenieType::Chest as u32
    } else {
        false
    };

    // If something is Stuck and Attackable and a Container then it's a chest.
    if is_stuck && is_attackable && is_container {
        return EntityClass::Chest;
    }

    // Creatures - Check WeenieType or ItemType or GUID range
    let is_creature = if let Some(it) = entity.item_type {
        it.intersects(ItemType::CREATURE)
    } else {
        false
    } || if let Some(wcid) = entity.wcid {
        wcid == WeenieType::Creature as u32 || wcid == WeenieType::Vendor as u32
    } else {
        false
    };

    if is_creature {
        if is_attackable {
            return EntityClass::Monster;
        }
        return EntityClass::Npc;
    }

    // General purpose refinement for items
    let mut refined_class = None;
    if let Some(it) = entity.item_type {
        if it.intersects(ItemType::MELEE_WEAPON | ItemType::MISSILE_WEAPON) {
            refined_class = Some(EntityClass::Weapon);
        } else if it.intersects(ItemType::CASTER) {
            refined_class = Some(EntityClass::Wand);
        } else if it.intersects(ItemType::ARMOR | ItemType::CLOTHING | ItemType::JEWELRY) {
            // Apparel covers non-weapon/shield wearables.
            // For now, Shields also have ItemType::ARMOR, but we'll categorize them as Apparel
            // unless we add specific shield detection.
            refined_class = Some(EntityClass::Apparel);
        } else if it.intersects(ItemType::CONTAINER) {
            refined_class = Some(EntityClass::Container);
        } else if it.intersects(ItemType::PORTAL) {
            refined_class = Some(EntityClass::Portal);
        } else if it.intersects(ItemType::LIFE_STONE) {
            refined_class = Some(EntityClass::LifeStone);
        }
    }

    // Specific WeenieType overrides
    if let Some(wcid) = entity.wcid {
        match wcid {
            w if w == WeenieType::LifeStone as u32 => return EntityClass::LifeStone,
            w if w == WeenieType::Door as u32 => return EntityClass::Door,
            w if w == WeenieType::Portal as u32 => return EntityClass::Portal,
            w if w == WeenieType::Vendor as u32 => return EntityClass::Npc,
            w if w == WeenieType::Chest as u32 => return EntityClass::Chest,
            _ => {}
        }
    }

    // Flag based overrides
    if entity.flags.intersects(ObjectDescriptionFlag::PORTAL) {
        return EntityClass::Portal;
    }
    if entity.flags.intersects(ObjectDescriptionFlag::DOOR) {
        return EntityClass::Door;
    }
    if entity.flags.intersects(ObjectDescriptionFlag::VENDOR) {
        return EntityClass::Npc;
    }

    // Rule: item class for things that are Attackable but not stuck.
    if is_attackable && !is_stuck {
        return refined_class.unwrap_or(EntityClass::Item);
    }

    // If we have a refined class from ItemType, use it even if not attackable
    if let Some(rc) = refined_class {
        return rc;
    }

    if entity.flags.intersects(ObjectDescriptionFlag::STUCK) {
        return EntityClass::StaticObject;
    }

    EntityClass::Unknown
}

pub fn is_targetable(entity: &Entity) -> bool {
    // Targetable heuristic:
    // 1. Not UI_HIDDEN
    // 2. Class-based: Players and Dynamic objects are usually targetable even without names
    if entity.flags.intersects(ObjectDescriptionFlag::UI_HIDDEN) {
        return false;
    }

    match classify_entity(entity) {
        EntityClass::Player
        | EntityClass::Npc
        | EntityClass::Monster
        | EntityClass::Weapon
        | EntityClass::Apparel
        | EntityClass::Container
        | EntityClass::Item
        | EntityClass::Door
        | EntityClass::Portal
        | EntityClass::LifeStone
        | EntityClass::Chest
        | EntityClass::Wand
        | EntityClass::Tool
        | EntityClass::StaticObject => !entity.name.trim().is_empty(),
        EntityClass::Unknown => false,
    }
}

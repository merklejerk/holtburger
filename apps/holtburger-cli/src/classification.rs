use holtburger_core::world::entity::Entity;
use holtburger_core::world::properties::{ItemType, ObjectDescriptionFlag, PropertyInt, WeenieType};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EntityClass {
    Player,
    Npc,
    Monster,
    Weapon,
    Armor,
    Jewelry,
    Apparel,
    Door,
    Portal,
    LifeStone,
    Chest,
    Tool,
    StaticObject,
    Dynamic,
    Unknown,
}

pub fn classify_entity(entity: &Entity) -> EntityClass {
    let guid = entity.guid;

    if (0x50000001..=0x5FFFFFFF).contains(&guid) {
        return EntityClass::Player;
    }

    // Check WCID/WeenieType first if we have it
    if let Some(wcid) = entity.wcid {
        match wcid {
            w if w == WeenieType::LifeStone as u32 => return EntityClass::LifeStone,
            w if w == WeenieType::Chest as u32 => return EntityClass::Chest,
            w if w == WeenieType::Door as u32 => return EntityClass::Door,
            w if w == WeenieType::Portal as u32 => return EntityClass::Portal,
            w if w == WeenieType::Vendor as u32 => return EntityClass::Npc,
            w if w == WeenieType::Creature as u32 => {
                // Creatures could be NPCs or Monsters
                if entity.flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                    return EntityClass::Monster;
                }
                return EntityClass::Npc;
            }
            _ => {}
        }
    }

    // Check ItemType mask
    if let Some(it) = entity.item_type {
        if it.intersects(ItemType::LIFE_STONE) {
            return EntityClass::LifeStone;
        }
        if it.intersects(ItemType::PORTAL) {
            return EntityClass::Portal;
        }
        if it.intersects(ItemType::CREATURE) {
            if entity.flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                return EntityClass::Monster;
            }
            return EntityClass::Npc;
        }
        // Fallback to ItemType masks for categorization
        if it.intersects(ItemType::MELEE_WEAPON | ItemType::MISSILE_WEAPON) {
            return EntityClass::Weapon;
        }
        if it.intersects(ItemType::ARMOR) {
            return EntityClass::Armor;
        }
        if it.intersects(ItemType::CLOTHING) {
            return EntityClass::Apparel;
        }
        if it.intersects(ItemType::JEWELRY) {
            return EntityClass::Jewelry;
        }
    }

    // Fallbacks for when ItemType is missing or unmapped
    if entity.flags.intersects(ObjectDescriptionFlag::PORTAL) {
        return EntityClass::Portal;
    }
    if entity.flags.intersects(ObjectDescriptionFlag::DOOR) {
        return EntityClass::Door;
    }
    if entity.flags.intersects(ObjectDescriptionFlag::VENDOR) {
        return EntityClass::Npc;
    }

    // Monsters usually have ATTACKABLE flag
    if (0x80000000..=0xFFFFFFFE).contains(&guid) {
        if entity.flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
            return EntityClass::Monster;
        }

        let type_id = entity
            .int_properties
            .get(&(PropertyInt::ItemType as u32))
            .cloned()
            .unwrap_or(0); // Type ID
        match type_id {
            1..=3 => EntityClass::Monster,
            20 => EntityClass::Tool,
            _ => EntityClass::Dynamic,
        }
    } else if (0x70000000..=0x7FFFFFFF).contains(&guid) {
        EntityClass::StaticObject
    } else {
        EntityClass::Unknown
    }
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
        | EntityClass::Armor
        | EntityClass::Jewelry
        | EntityClass::Apparel
        | EntityClass::Door
        | EntityClass::Portal
        | EntityClass::LifeStone
        | EntityClass::Chest
        | EntityClass::Tool
        | EntityClass::Dynamic => true,
        EntityClass::StaticObject => !entity.name.trim().is_empty(),
        EntityClass::Unknown => false,
    }
}

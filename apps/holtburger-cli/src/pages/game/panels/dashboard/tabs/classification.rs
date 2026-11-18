use holtburger_world::entity::Entity;
pub use holtburger_world::entity_classification::{
    EntityClass, classify_description, classify_entity, classify_properties, classify_vendor_item,
};
use ratatui::style::Color;

pub fn emoji(class: EntityClass) -> &'static str {
    match class {
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

pub fn label(class: EntityClass) -> &'static str {
    match class {
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

/// Name palette is independent from creature identity, scripting kind and interaction policy.
pub fn entity_name_color(entity: &Entity) -> Color {
    get_entity_color(if entity.summon_owner().is_some() {
        EntityClass::Player
    } else {
        classify_entity(entity)
    })
}

#[cfg(test)]
mod tests {
    use super::EntityClass;

    #[test]
    fn summon_names_share_player_palette_without_changing_creature_kind() {
        use holtburger_common::{
            Guid,
            position::WorldPosition,
            properties::{
                ItemType, ObjectDescriptionFlag, PropertyInstanceId, PropertyInt,
                WorldObjectPropertyAccessorsMut,
            },
        };
        let mut summon = holtburger_world::entity::Entity::new(
            Guid(7),
            "Owner's Golem".into(),
            WorldPosition::default(),
        );
        summon.flags = ObjectDescriptionFlag::ATTACKABLE;
        summon.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        summon.set_iid_prop(PropertyInstanceId::PetOwner, Guid(1));
        assert_eq!(super::classify_entity(&summon), EntityClass::Monster);
        assert_eq!(
            super::entity_name_color(&summon),
            super::get_entity_color(EntityClass::Player)
        );
    }
}

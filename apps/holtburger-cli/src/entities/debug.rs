use crate::entities::classification;
use crate::ui::types::CommandTarget;
use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyString,
};
use ratatui::text::Line;

/// Generates a list of strings representing the debug information for a target.
pub fn get_debug_info(
    target: &CommandTarget,
    name_lookup: impl Fn(Guid) -> Option<String>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    match target {
        CommandTarget::Entity(e) => {
            lines.push(Line::from(format!("DEBUG INFO: {}", e.name)));
            lines.push(Line::from(format!("GUID:   {:08X}", e.guid)));
            let class = classification::classify_entity(e);
            lines.push(Line::from(format!(
                "Class:  {} ({:?})",
                class.label(),
                class
            )));

            if let Some(parent_id) = e.physics_parent_id {
                let parent_name = name_lookup(parent_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(Line::from(format!(
                    "Phys Parent: {:08X} ({})",
                    parent_id, parent_name
                )));
            }

            if let Some(container_id) = e.container_id {
                let container_name =
                    name_lookup(container_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(Line::from(format!(
                    "Container:   {:08X} ({})",
                    container_id, container_name
                )));
            }

            if let Some(wielder_id) = e.wielder_id {
                let wielder_name = name_lookup(wielder_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(Line::from(format!(
                    "Wielder:     {:08X} ({})",
                    wielder_id, wielder_name
                )));
            }

            lines.push(Line::from(format!("WCID:   {:?}", e.wcid)));
            lines.push(Line::from(format!("GfxID:  {:?}", e.gfx_id)));
            lines.push(Line::from(format!("Vel:    {:?}", e.velocity)));
            lines.push(Line::from(format!("Flags:  {:08X}", e.flags.bits())));
            for (name, _) in e.flags.iter_names() {
                lines.push(Line::from(format!("  [X] {}", name)));
            }

            lines.push(Line::from(format!(
                "Phys:   {:08X}",
                e.physics_state.bits()
            )));
            for (name, _) in e.physics_state.iter_names() {
                lines.push(Line::from(format!("  [X] {}", name)));
            }

            if let Some(it) = e.item_type {
                lines.push(Line::from(format!("IType:  {:08X}", it.bits())));
                for (name, _) in it.iter_names() {
                    lines.push(Line::from(format!("  [X] {}", name)));
                }
            }
            lines.push(Line::from(format!(
                "Pos:    {}",
                e.position.to_world_coords()
            )));
            lines.push(Line::from(format!(
                "LB:     {:08X}",
                e.position.landblock_id
            )));
            lines.push(Line::from(format!("Coords: {:?}", e.position.coords)));

            if let Some(profile) = &e.creature_profile {
                lines.push(Line::from("-- Creature Profile --"));
                lines.push(Line::from(format!(
                    "  Health:  {}/{}",
                    profile.health, profile.health_max
                )));
                if let Some(attr) = &profile.attributes {
                    lines.push(Line::from(format!(
                        "  Stamina: {}/{}",
                        attr.stamina, attr.stamina_max
                    )));
                    lines.push(Line::from(format!(
                        "  Mana:    {}/{}",
                        attr.mana, attr.mana_max
                    )));
                    lines.push(Line::from(format!("  STR: {}", attr.strength)));
                    lines.push(Line::from(format!("  END: {}", attr.endurance)));
                    lines.push(Line::from(format!("  COR: {}", attr.coordination)));
                    lines.push(Line::from(format!("  QUI: {}", attr.quickness)));
                    lines.push(Line::from(format!("  FOC: {}", attr.focus)));
                    lines.push(Line::from(format!("  SEL: {}", attr.self_attr)));
                }
            }

            if let Some(profile) = &e.armor_profile {
                lines.push(Line::from("-- Armor Profile --"));
                let p = profile;
                lines.push(Line::from(format!(
                    "  Slash: {:.2}, Pierce: {:.2}, Blunt: {:.2}",
                    p.slashing, p.piercing, p.bludgeoning
                )));
                lines.push(Line::from(format!(
                    "  Fire: {:.2}, Cold: {:.2}, Acid: {:.2}, Light: {:.2}, Nether: {:.2}",
                    p.fire, p.cold, p.acid, p.lightning, p.nether
                )));
            }

            if let Some(profile) = &e.weapon_profile {
                lines.push(Line::from("-- Weapon Profile --"));
                lines.push(Line::from(format!(
                    "  Damage: {}, Speed: {}, Skill: {}",
                    profile.damage, profile.weapon_time, profile.weapon_skill
                )));
                lines.push(Line::from(format!(
                    "  Var: {:.2}, Mod: {:.2}, Range: {:.2}",
                    profile.damage_variance, profile.damage_mod, profile.weapon_length
                )));
            }

            if !e.int_properties.is_empty() {
                lines.push(Line::from("-- Int Properties --"));
                let mut sorted_keys: Vec<_> = e.int_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInt::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!("  {}: {}", name, e.int_properties[&k])));
                }
            }
            if !e.int64_properties.is_empty() {
                lines.push(Line::from("-- Int64 Properties --"));
                let mut sorted_keys: Vec<_> = e.int64_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInt64::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!(
                        "  {}: {}",
                        name, e.int64_properties[&k]
                    )));
                }
            }
            if !e.bool_properties.is_empty() {
                lines.push(Line::from("-- Bool Properties --"));
                let mut sorted_keys: Vec<_> = e.bool_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyBool::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!("  {}: {}", name, e.bool_properties[&k])));
                }
            }
            if !e.float_properties.is_empty() {
                lines.push(Line::from("-- Float Properties --"));
                let mut sorted_keys: Vec<_> = e.float_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyFloat::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!(
                        "  {}: {:.4}",
                        name, e.float_properties[&k]
                    )));
                }
            }
            if !e.string_properties.is_empty() {
                lines.push(Line::from("-- String Properties --"));
                let mut sorted_keys: Vec<_> = e.string_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyString::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!(
                        "  {}: {}",
                        name, e.string_properties[&k]
                    )));
                }
            }
            if !e.did_properties.is_empty() {
                lines.push(Line::from("-- DataID Properties --"));
                let mut sorted_keys: Vec<_> = e.did_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyDataId::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!(
                        "  {}: {:08X}",
                        name, e.did_properties[&k]
                    )));
                }
            }
            if !e.iid_properties.is_empty() {
                lines.push(Line::from("-- InstanceID Properties --"));
                let mut sorted_keys: Vec<_> = e.iid_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInstanceId::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(Line::from(format!(
                        "  {}: {:08X}",
                        name, e.iid_properties[&k]
                    )));
                }
            }
        }
        CommandTarget::Enchantment(enchant) => {
            lines.push(Line::from(format!(
                "DEBUG ENCHANTMENT: Spell #{}",
                enchant.spell_id
            )));
            lines.push(Line::from(format!("Layer:          {}", enchant.layer)));
            lines.push(Line::from(format!(
                "Category:       {}",
                enchant.spell_category
            )));
            lines.push(Line::from(format!(
                "Power Level:    {}",
                enchant.power_level
            )));
            lines.push(Line::from(format!(
                "Duration:       {:.1}s",
                enchant.duration
            )));
            lines.push(Line::from(format!(
                "Stat Mod Type:  0x{:08X}",
                enchant.stat_mod_type
            )));
            lines.push(Line::from(format!(
                "Stat Mod Key:   {}",
                enchant.stat_mod_key
            )));
            lines.push(Line::from(format!(
                "Stat Mod Value: {:.2}",
                enchant.stat_mod_value
            )));
            lines.push(Line::from(format!(
                "Caster GUID:    {:08X}",
                enchant.caster_guid
            )));
            lines.push(Line::from(format!(
                "Degrade Limit:  {:.2}",
                enchant.degrade_limit
            )));
            lines.push(Line::from(format!(
                "Last Degraded:  {:.1}",
                enchant.last_time_degraded
            )));
        }
        CommandTarget::None => {}
    }

    lines
}

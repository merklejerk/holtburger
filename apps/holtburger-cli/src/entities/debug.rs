use crate::entities::classification;
use crate::ui::types::CommandTarget;
use holtburger_core::protocol::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyString,
};
use holtburger_core::world::guid::Guid;

/// Generates a list of strings representing the debug information for a target.
pub fn get_debug_info(
    target: &CommandTarget,
    name_lookup: impl Fn(Guid) -> Option<String>,
) -> Vec<String> {
    let mut lines = Vec::new();

    match target {
        CommandTarget::Entity(e) => {
            lines.push(format!("DEBUG INFO: {}", e.name));
            lines.push(format!("GUID:   {:08X}", e.guid));
            let class = classification::classify_entity(e);
            lines.push(format!("Class:  {} ({:?})", class.label(), class));

            if let Some(parent_id) = e.physics_parent_id {
                let parent_name = name_lookup(parent_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!("Phys Parent: {:08X} ({})", parent_id, parent_name));
            }

            if let Some(container_id) = e.container_id {
                let container_name =
                    name_lookup(container_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!(
                    "Container:   {:08X} ({})",
                    container_id, container_name
                ));
            }

            if let Some(wielder_id) = e.wielder_id {
                let wielder_name = name_lookup(wielder_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(format!(
                    "Wielder:     {:08X} ({})",
                    wielder_id, wielder_name
                ));
            }

            lines.push(format!("WCID:   {:?}", e.wcid));
            lines.push(format!("GfxID:  {:?}", e.gfx_id));
            lines.push(format!("Vel:    {:?}", e.velocity));
            lines.push(format!("Flags:  {:08X}", e.flags.bits()));
            for (name, _) in e.flags.iter_names() {
                lines.push(format!("  [X] {}", name));
            }

            lines.push(format!("Phys:   {:08X}", e.physics_state.bits()));
            for (name, _) in e.physics_state.iter_names() {
                lines.push(format!("  [X] {}", name));
            }

            if let Some(it) = e.item_type {
                lines.push(format!("IType:  {:08X}", it.bits()));
                for (name, _) in it.iter_names() {
                    lines.push(format!("  [X] {}", name));
                }
            }
            lines.push(format!("Pos:    {}", e.position.to_world_coords()));
            lines.push(format!("LB:     {:08X}", e.position.landblock_id));
            lines.push(format!("Coords: {:?}", e.position.coords));

            if !e.int_properties.is_empty() {
                lines.push("-- Int Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.int_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInt::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.int_properties[&k]));
                }
            }
            if !e.int64_properties.is_empty() {
                lines.push("-- Int64 Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.int64_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInt64::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.int64_properties[&k]));
                }
            }
            if !e.bool_properties.is_empty() {
                lines.push("-- Bool Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.bool_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyBool::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.bool_properties[&k]));
                }
            }
            if !e.float_properties.is_empty() {
                lines.push("-- Float Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.float_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyFloat::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {:.4}", name, e.float_properties[&k]));
                }
            }
            if !e.string_properties.is_empty() {
                lines.push("-- String Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.string_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyString::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {}", name, e.string_properties[&k]));
                }
            }
            if !e.did_properties.is_empty() {
                lines.push("-- DataID Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.did_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyDataId::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {:08X}", name, e.did_properties[&k]));
                }
            }
            if !e.iid_properties.is_empty() {
                lines.push("-- InstanceID Properties --".to_string());
                let mut sorted_keys: Vec<_> = e.iid_properties.keys().collect();
                sorted_keys.sort();
                for &k in sorted_keys {
                    let name = PropertyInstanceId::from_repr(k)
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| k.to_string());
                    lines.push(format!("  {}: {:08X}", name, e.iid_properties[&k]));
                }
            }
        }
        CommandTarget::Enchantment(enchant) => {
            lines.push(format!("DEBUG ENCHANTMENT: Spell #{}", enchant.spell_id));
            lines.push(format!("Layer:          {}", enchant.layer));
            lines.push(format!("Category:       {}", enchant.spell_category));
            lines.push(format!("Power Level:    {}", enchant.power_level));
            lines.push(format!("Duration:       {:.1}s", enchant.duration));
            lines.push(format!("Stat Mod Type:  0x{:08X}", enchant.stat_mod_type));
            lines.push(format!("Stat Mod Key:   {}", enchant.stat_mod_key));
            lines.push(format!("Stat Mod Value: {:.2}", enchant.stat_mod_value));
            lines.push(format!("Caster GUID:    {:08X}", enchant.caster_guid));
            lines.push(format!("Degrade Limit:  {:.2}", enchant.degrade_limit));
            lines.push(format!("Last Degraded:  {:.1}", enchant.last_time_degraded));
        }
        CommandTarget::None => {}
    }

    lines
}

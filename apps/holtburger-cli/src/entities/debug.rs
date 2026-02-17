use crate::entities::classification;
use crate::ui::types::CommandTarget;
use holtburger_common::Guid;
use holtburger_common::properties::{
    EnchantmentTypeFlags, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId,
    PropertyInt, PropertyInt64, PropertyString,
};
use holtburger_core::world::stats::{Attribute, AttributeType, Skill, SkillType, Vital, VitalType};
use holtburger_protocol::messages::magic::Enchantment;
use ratatui::text::Line;
use std::collections::HashMap;

pub struct PlayerDebugInfo<'a> {
    pub attributes: &'a HashMap<AttributeType, Attribute>,
    pub vitals: &'a HashMap<VitalType, Vital>,
    pub skills: &'a HashMap<SkillType, Skill>,
    pub enchantments: &'a [Enchantment],
}

/// Generates a list of strings representing the debug information for a target.
pub fn get_debug_info(
    target: &CommandTarget,
    name_lookup: impl Fn(Guid) -> Option<String>,
    spell_lookup: Option<
        &std::collections::HashMap<u32, Box<holtburger_dat::file_type::spell_table::SpellBase>>,
    >,
    player_info: Option<PlayerDebugInfo>,
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
            lines.push(Line::from(format!("IconID: {:?}", e.icon_id)));
            lines.push(Line::from(format!("Vel:    {:?}", e.velocity)));
            lines.push(Line::from(format!("Accel:  {:?}", e.acceleration)));
            lines.push(Line::from(format!("Omega:  {:?}", e.omega)));
            lines.push(Line::from(format!("Flags:  {:08X}", e.flags.bits())));
            for (name, _) in e.flags.iter_names() {
                lines.push(Line::from(format!("  [X] {}", name)));
            }

            lines.push(Line::from(format!("WFlags: {:08X}", e.weenie_flags.bits())));
            for (name, _) in e.weenie_flags.iter_names() {
                lines.push(Line::from(format!("  [X] {}", name)));
            }

            lines.push(Line::from(format!(
                "WFlag2: {:08X}",
                e.weenie_flags2.bits()
            )));
            for (name, _) in e.weenie_flags2.iter_names() {
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

            if let Some(s) = e.obj_scale {
                lines.push(Line::from(format!("Scale:  {:.4}", s)));
            }
            if let Some(f) = e.friction {
                lines.push(Line::from(format!("Frict:  {:.4}", f)));
            }
            if let Some(el) = e.elasticity {
                lines.push(Line::from(format!("Elast:  {:.4}", el)));
            }
            if let Some(t) = e.translucency {
                lines.push(Line::from(format!("Transl: {:.4}", t)));
            }

            if e.plural_name.is_some()
                || e.items_capacity.is_some()
                || e.containers_capacity.is_some()
                || e.ammo_type.is_some()
                || e.value.is_some()
                || e.usable.is_some()
                || e.use_radius.is_some()
                || e.workmanship.is_some()
                || e.burden.is_some()
                || e.target_type.is_some()
                || e.ui_effects.is_some()
                || e.combat_use.is_some()
                || e.stack_size.is_some()
                || e.valid_locations.is_some()
                || e.currently_wielded_location.is_some()
            {
                lines.push(Line::from("-- Weenie Data --"));
                if let Some(p) = &e.plural_name {
                    lines.push(Line::from(format!("  Plural:    {}", p)));
                }
                if let Some(v) = e.items_capacity {
                    lines.push(Line::from(format!("  ICapacity: {}", v)));
                }
                if let Some(v) = e.containers_capacity {
                    lines.push(Line::from(format!("  CCapacity: {}", v)));
                }
                if let Some(v) = e.ammo_type {
                    lines.push(Line::from(format!("  AmmoType:  {}", v)));
                }
                if let Some(v) = e.value {
                    lines.push(Line::from(format!("  Value:     {}", v)));
                }
                if let Some(v) = e.usable {
                    lines.push(Line::from(format!("  Usable:    {:08X}", v.bits())));
                    for (name, _) in v.iter_names() {
                        lines.push(Line::from(format!("    - {}", name)));
                    }
                }
                if let Some(v) = e.use_radius {
                    lines.push(Line::from(format!("  UseRadius: {:.2}", v)));
                }
                if let Some(v) = e.workmanship {
                    lines.push(Line::from(format!("  Work:      {:.2}", v)));
                }
                if let Some(v) = e.burden {
                    lines.push(Line::from(format!("  Burden:    {}", v)));
                }
                if let Some(v) = e.target_type {
                    lines.push(Line::from(format!("  TargetTyp: {:08X}", v.bits())));
                    for (name, _) in v.iter_names() {
                        lines.push(Line::from(format!("    - {}", name)));
                    }
                }
                if let Some(v) = e.ui_effects {
                    lines.push(Line::from(format!("  UIEffects: 0x{:08X}", v)));
                }
                if let Some(v) = e.combat_use {
                    lines.push(Line::from(format!("  CombatUse: {} ({:02X})", v, v as u32)));
                }
                if let Some(v) = e.structure {
                    lines.push(Line::from(format!(
                        "  Struct:    {}/{}",
                        v,
                        e.max_structure.unwrap_or(0)
                    )));
                }
                if let Some(v) = e.stack_size {
                    lines.push(Line::from(format!(
                        "  Stack:     {}/{}",
                        v,
                        e.max_stack_size.unwrap_or(0)
                    )));
                }
                if let Some(v) = e.valid_locations {
                    lines.push(Line::from(format!("  ValidLocs: {:08X}", v.bits())));
                    for (name, _) in v.iter_names() {
                        lines.push(Line::from(format!("    - {}", name)));
                    }
                }
                if let Some(v) = e.currently_wielded_location {
                    lines.push(Line::from(format!("  WieldLoc:  {:08X}", v.bits())));
                    for (name, _) in v.iter_names() {
                        lines.push(Line::from(format!("    - {}", name)));
                    }
                }
                if let Some(v) = e.priority {
                    lines.push(Line::from(format!("  Priority:  {}", v)));
                }
                if let Some(v) = e.radar_blip_color {
                    lines.push(Line::from(format!("  RadarBlip: {} ({:?})", v, v)));
                }
                if let Some(v) = e.radar_enum {
                    lines.push(Line::from(format!("  RadarEnum: {} ({:?})", v, v)));
                }
                if let Some(v) = e.pscript {
                    lines.push(Line::from(format!("  PScript:   {}", v)));
                }
                if let Some(v) = e.spell {
                    lines.push(Line::from(format!("  Spell:     {}", v)));
                }
                if let Some(v) = e.cooldown_id {
                    lines.push(Line::from(format!(
                        "  CD:        #{} ({:.1}s)",
                        v,
                        e.cooldown_duration.unwrap_or(0.0)
                    )));
                }
            }

            if e.mtable_id.is_some()
                || e.stable_id.is_some()
                || e.petable_id.is_some()
                || e.csetup_id.is_some()
                || e.parent_loc.is_some()
                || e.default_script_id.is_some()
                || e.autonomous_movement.is_some()
                || e.animation_frame.is_some()
            {
                lines.push(Line::from("-- Technical Data --"));
                if let Some(v) = e.mtable_id {
                    lines.push(Line::from(format!("  MTable:    0x{:08X}", v)));
                }
                if let Some(v) = e.stable_id {
                    lines.push(Line::from(format!("  STable:    0x{:08X}", v)));
                }
                if let Some(v) = e.petable_id {
                    lines.push(Line::from(format!("  PETable:   0x{:08X}", v)));
                }
                if let Some(v) = e.csetup_id {
                    lines.push(Line::from(format!("  CSetup:    0x{:08X}", v)));
                }
                if let Some(v) = e.parent_loc {
                    lines.push(Line::from(format!("  ParentLoc: 0x{:08X}", v)));
                }
                if let Some(v) = e.default_script_id {
                    lines.push(Line::from(format!(
                        "  DefScript: {} ({:.2})",
                        v,
                        e.default_script_intensity.unwrap_or(0.0)
                    )));
                }
                if let Some(v) = e.autonomous_movement {
                    lines.push(Line::from(format!("  AutoMove:  {}", v)));
                }
                if let Some(v) = e.animation_frame {
                    lines.push(Line::from(format!("  AnimFrame: 0x{:08X}", v)));
                }
            }

            if e.house_owner.is_some() || e.monarch_id.is_some() || e.pet_owner.is_some() {
                lines.push(Line::from("-- Ownership --"));
                if let Some(v) = e.house_owner {
                    lines.push(Line::from(format!("  HouseOwn:  {:08X}", v)));
                }
                if let Some(v) = e.monarch_id {
                    lines.push(Line::from(format!("  Monarch:   {:08X}", v)));
                }
                if let Some(v) = e.pet_owner {
                    lines.push(Line::from(format!("  PetOwner:  {:08X}", v)));
                }
            }

            if e.icon_overlay_id.is_some()
                || e.icon_underlay_id.is_some()
                || e.material_type.is_some()
            {
                lines.push(Line::from("-- Appearance Overlay --"));
                if let Some(v) = e.icon_overlay_id {
                    lines.push(Line::from(format!("  Overlay:   0x{:08X}", v)));
                }
                if let Some(v) = e.icon_underlay_id {
                    lines.push(Line::from(format!("  Underlay:  0x{:08X}", v)));
                }
                if let Some(v) = e.material_type {
                    lines.push(Line::from(format!("  Material:  0x{:08X}", v)));
                }
            }

            lines.push(Line::from(format!("Sequences: {:?}", e.sequences)));

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
                if let Some(buffs) = &profile.buffs {
                    lines.push(Line::from(format!(
                        "  Highlights: {:04X}, Colors: {:04X}",
                        buffs.highlights, buffs.colors
                    )));
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
                    "  DType:  0x{:08X}, Speed: {}, Skill: {}",
                    profile.damage_type, profile.weapon_time, profile.weapon_skill
                )));
                lines.push(Line::from(format!(
                    "  Damage: {}, Var: {:.2}, Mod: {:.2}",
                    profile.damage, profile.damage_variance, profile.damage_mod
                )));
                lines.push(Line::from(format!(
                    "  Range: {:.2}, MaxVel: {:.2}, Offense: {:.2}",
                    profile.weapon_length, profile.max_velocity, profile.weapon_offense
                )));
                lines.push(Line::from(format!(
                    "  MaxVelEst: {}",
                    profile.max_velocity_estimated
                )));
            }

            if e.hook_type.is_some() || e.hook_item_types.is_some() || e.hook_profile.is_some() {
                lines.push(Line::from("-- Hooks --"));
                if let Some(v) = e.hook_type {
                    lines.push(Line::from(format!("  Type:      0x{:04X}", v)));
                }
                if let Some(v) = e.hook_item_types {
                    lines.push(Line::from(format!("  ItemTypes: {:?}", v)));
                }
                if let Some(hook) = &e.hook_profile {
                    lines.push(Line::from(format!(
                        "  Flags: 0x{:08X}, Locations: {:?}",
                        hook.flags, hook.valid_locations
                    )));
                    lines.push(Line::from(format!("  AmmoType: {}", hook.ammo_type)));
                }
            }

            if let Some(al) = &e.armor_levels {
                lines.push(Line::from("-- Armor Levels --"));
                lines.push(Line::from(format!(
                    "  Head: {}, Chest: {}, Abd: {}",
                    al.head, al.chest, al.abdomen
                )));
                lines.push(Line::from(format!(
                    "  UArm: {}, LArm: {}, Hand: {}",
                    al.upper_arm, al.lower_arm, al.hand
                )));
                lines.push(Line::from(format!(
                    "  ULeg: {}, LLeg: {}, Foot: {}",
                    al.upper_leg, al.lower_leg, al.foot
                )));
            }

            if !e.spell_book.is_empty() {
                lines.push(Line::from("-- Spell Book --"));
                for &spell_id in &e.spell_book {
                    let name = spell_lookup
                        .and_then(|m| m.get(&spell_id))
                        .map(|s| s.name.as_str())
                        .unwrap_or("Unknown");
                    lines.push(Line::from(format!("  #{} - {}", spell_id, name)));
                }
            }

            if let Some(h) = e.armor_highlight {
                lines.push(Line::from(format!(
                    "Armor Highlight:  {:04X}, Color: {:04X}",
                    h,
                    e.armor_color.unwrap_or(0)
                )));
            }
            if let Some(h) = e.weapon_highlight {
                lines.push(Line::from(format!(
                    "Weapon Highlight: {:04X}, Color: {:04X}",
                    h,
                    e.weapon_color.unwrap_or(0)
                )));
            }
            if let Some(h) = e.resist_highlight {
                lines.push(Line::from(format!(
                    "Resist Highlight: {:04X}, Color: {:04X}",
                    h,
                    e.resist_color.unwrap_or(0)
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

            if let Some(info) = player_info {
                lines.push(Line::from("-- Player Attributes --"));
                let mut attr_keys: Vec<_> = info.attributes.keys().copied().collect();
                attr_keys.sort();
                for k in attr_keys {
                    let a = &info.attributes[&k];
                    lines.push(Line::from(format!(
                        "  {:<12} cur: {}, base: {}, start: {}, ranks: {}",
                        k.to_string(),
                        a.current,
                        a.base,
                        a.start,
                        a.ranks
                    )));
                }

                lines.push(Line::from("-- Player Vitals --"));
                let mut vital_keys: Vec<_> = info.vitals.keys().copied().collect();
                vital_keys.sort();
                for k in vital_keys {
                    let v = &info.vitals[&k];
                    lines.push(Line::from(format!(
                        "  {:<12} cur: {}, base: {}, bmax: {}, start: {}, ranks: {}",
                        k.to_string(),
                        v.current,
                        v.base,
                        v.buffed_max,
                        v.start,
                        v.ranks
                    )));
                }

                lines.push(Line::from("-- Player Skills --"));
                let mut skill_keys: Vec<_> = info.skills.keys().copied().collect();
                skill_keys.sort();
                for k in skill_keys {
                    let s = &info.skills[&k];
                    lines.push(Line::from(format!(
                        "  {:<20} tr: {:?}, cur: {}, base: {}, start: {}, ranks: {}",
                        k.to_string(),
                        s.training,
                        s.current,
                        s.base,
                        s.init,
                        s.ranks
                    )));
                }

                if !info.enchantments.is_empty() {
                    lines.push(Line::from("-- Player Enchantments --"));
                    for enc in info.enchantments {
                        let name = spell_lookup
                            .and_then(|m| m.get(&(enc.spell_id as u32)))
                            .map(|s| s.name.as_str())
                            .unwrap_or("Unknown Spell");
                        lines.push(Line::from(format!(
                            "  #{} - {} (dur: {:.1}s)",
                            enc.spell_id, name, enc.duration
                        )));
                    }
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
            let flags = EnchantmentTypeFlags::from_bits_truncate(enchant.stat_mod_type);
            for (name, _) in flags.iter_names() {
                lines.push(Line::from(format!("  [X] {}", name)));
            }

            let key_name = if flags.contains(EnchantmentTypeFlags::ATTRIBUTE) {
                AttributeType::from_repr(enchant.stat_mod_key).map(|a| a.to_string())
            } else if flags.contains(EnchantmentTypeFlags::SECOND_ATT) {
                VitalType::from_id(enchant.stat_mod_key).map(|v| format!("Max {}", v))
            } else if flags.contains(EnchantmentTypeFlags::SKILL) {
                SkillType::from_repr(enchant.stat_mod_key).map(|s| s.to_string())
            } else if flags.contains(EnchantmentTypeFlags::INT) {
                PropertyInt::from_repr(enchant.stat_mod_key).map(|p| p.to_string())
            } else if flags.contains(EnchantmentTypeFlags::FLOAT) {
                PropertyFloat::from_repr(enchant.stat_mod_key).map(|p| p.to_string())
            } else if flags.contains(EnchantmentTypeFlags::BODY_ARMOR_VALUE) {
                Some("Armor".to_string())
            } else {
                None
            };

            let key_display = key_name.unwrap_or_else(|| format!("{}", enchant.stat_mod_key));
            lines.push(Line::from(format!("Stat Mod Key:   {}", key_display)));
            lines.push(Line::from(format!(
                "Stat Mod Value: {:.2}",
                enchant.stat_mod_value
            )));
            if let Some(set_id) = enchant.spell_set_id {
                lines.push(Line::from(format!("Spell Set ID:   {}", set_id)));
            }
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
        CommandTarget::Stat(st, xp_cost, sp_cost) => {
            lines.push(Line::from(format!("DEBUG INFO: {:?}", st)));
            lines.push(Line::from(format!("XP Cost:    {:?}", xp_cost)));
            lines.push(Line::from(format!("SP Cost:    {:?}", sp_cost)));
        }
        CommandTarget::Spell(spell_id) => {
            lines.push(Line::from(format!("DEBUG INFO: Spell {}", spell_id)));
            lines.push(Line::from(format!("Spell ID:   {}", spell_id)));

            if let Some(info) = spell_lookup.and_then(|m| m.get(spell_id)) {
                lines.push(Line::from(format!("Name:       {}", info.name)));
                lines.push(Line::from(format!("Level:      {}", info.power)));
                lines.push(Line::from(format!("Mana:       {}", info.base_mana)));
                lines.push(Line::from(format!("School:     {:?}", info.school)));
                lines.push(Line::from(format!("Category:   {}", info.category)));
                lines.push(Line::from(format!("Desc:       {}", info.description)));
                lines.push(Line::from(format!("Mana Mod:   {}", info.mana_mod)));

                // Formula Version: 1=I, 2=II, etc.
                lines.push(Line::from(format!("Formula V:  {}", info.formula_version)));

                // Components (8 slots)
                let comps: Vec<String> = info
                    .raw_components
                    .iter()
                    .map(|id| format!("{:#X}", id))
                    .collect();
                lines.push(Line::from(format!("Comps:      {}", comps.join(", "))));
            } else {
                lines.push(Line::from("Info:       (Loading...)".to_string()));
            }
        }
        CommandTarget::None => {}
    }

    lines
}

use super::tabs::classification;
use crate::pages::game::GameData;
use crate::pages::game::ViewState;
use crate::types::InspectTarget;
use holtburger_common::Guid;
use holtburger_common::properties::{
    EnchantmentTypeFlags, PropertyFloat, PropertyInt, WorldObjectExt,
};
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::SpatialEntitySample;
use holtburger_world::context::WorldContextExt;
use holtburger_world::inspect::InspectableObject;
use holtburger_world::spell::SpellCatalog;
use holtburger_world::stats::{Attribute, AttributeType, Skill, SkillType, Vital, VitalType};
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
    data: &GameData,
    view: Option<&ViewState>,
    target: InspectTarget,
    projected_sample: Option<SpatialEntitySample>,
    name_lookup: impl Fn(Guid) -> Option<String>,
    spell_lookup: Option<&SpellCatalog>,
    player_info: Option<PlayerDebugInfo>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    match target {
        InspectTarget::VendorItem(guid) => {
            let Some(v) = view
                .and_then(|v| v.vendor.as_ref())
                .and_then(|vendor| vendor.items.iter().find(|i| i.guid == guid))
            else {
                return lines;
            };
            let object = InspectableObject::from_vendor_item(v);
            lines.push(Line::from(format!("ITEM: {}", v.name())));
            push_object_debug_info(data, &mut lines, &object, spell_lookup);
        }
        InspectTarget::Entity(guid) => {
            let Some(e) = data.entities.get(&guid) else {
                return lines;
            };
            let player_storage = (Some(guid) == data.player_guid)
                .then(|| data.storage_usage(guid))
                .flatten();
            lines.push(Line::from(format!("DEBUG INFO: {}", e.name())));
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

            if let Some(container_id) = e.container_id() {
                let container_name =
                    name_lookup(container_id).unwrap_or_else(|| "Unknown".to_string());
                lines.push(Line::from(format!(
                    "Container:   {:08X} ({})",
                    container_id, container_name
                )));
            }

            if let Some(wielder_id) = e.wielder_id() {
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

            if let Some(it) = e.item_type() {
                lines.push(Line::from(format!("IType:  {:08X}", it.bits())));
                for (name, _) in it.iter_names() {
                    lines.push(Line::from(format!("  [X] {}", name)));
                }
            }
            lines.push(Line::from(format!(
                "Pos:    {}",
                e.position.to_world_coords()
            )));
            if let Some(projected_sample) = projected_sample {
                lines.push(Line::from(format!(
                    "PPos:   {}",
                    projected_sample.projected_pose.to_world_coords()
                )));
                lines.push(Line::from(format!(
                    "PMode:  {:?}",
                    projected_sample.projection_mode
                )));
                lines.push(Line::from(format!(
                    "PCoords: {:?}",
                    projected_sample.projected_pose.coords
                )));
            }
            lines.push(Line::from(format!(
                "LB:     {:08X}",
                e.position.landblock_id
            )));
            lines.push(Line::from(format!("Coords: {:?}", e.position.coords)));

            if let Some(s) = e.obj_scale() {
                lines.push(Line::from(format!("Scale:  {:.4}", s)));
            }
            if let Some(f) = e.friction() {
                lines.push(Line::from(format!("Frict:  {:.4}", f)));
            }
            if let Some(el) = e.elasticity() {
                lines.push(Line::from(format!("Elast:  {:.4}", el)));
            }
            if let Some(t) = e.translucency() {
                lines.push(Line::from(format!("Transl: {:.4}", t)));
            }

            if e.plural_name().is_some()
                || e.items_capacity().is_some()
                || e.containers_capacity().is_some()
                || e.ammo_type().is_some()
                || e.item_value() > 0
                || e.usable().is_some()
                || e.use_radius().is_some()
                || e.workmanship().is_some()
                || e.burden().is_some()
                || e.target_type().is_some()
                || e.ui_effects().is_some()
                || e.combat_use().is_some()
                || e.stack_size() > 1
                || !e.valid_locations().is_empty()
                || !e.wield_location().is_empty()
            {
                lines.push(Line::from("-- Weenie Data --"));
                if let Some(p) = &e.plural_name() {
                    lines.push(Line::from(format!("  Plural:    {}", p)));
                }
                if let Some(v) = e.items_capacity() {
                    if Some(e.guid) == data.player_guid {
                        lines.push(Line::from(format!(
                            "  ICapacity: {}/{}",
                            player_storage.map(|usage| usage.item_used).unwrap_or(0),
                            v
                        )));
                    } else {
                        lines.push(Line::from(format!("  ICapacity: {}", v)));
                    }
                }
                if let Some(v) = e.containers_capacity() {
                    if Some(e.guid) == data.player_guid {
                        lines.push(Line::from(format!(
                            "  CCapacity: {}/{}",
                            player_storage
                                .map(|usage| usage.container_used)
                                .unwrap_or(0),
                            v
                        )));
                    } else {
                        lines.push(Line::from(format!("  CCapacity: {}", v)));
                    }
                }
                if let Some(v) = e.ammo_type() {
                    lines.push(Line::from(format!("  AmmoType:  {}", v)));
                }
                if e.item_value() > 0 {
                    lines.push(Line::from(format!("  Value:     {}", e.item_value())));
                }
                if let Some(v) = e.usable() {
                    lines.push(Line::from(format!("  Usable:    0x{:08X}", v)));
                }
                if let Some(v) = e.use_radius() {
                    lines.push(Line::from(format!("  UseRadius: {:.2}", v)));
                }
                if let Some(v) = e.workmanship() {
                    lines.push(Line::from(format!("  Work:      {:.2}", v)));
                }
                if let Some(v) = e.burden() {
                    lines.push(Line::from(format!("  Burden:    {}", v)));
                }
                if let Some(v) = e.target_type() {
                    lines.push(Line::from(format!("  TargetTyp: 0x{:08X}", v)));
                }
                if let Some(v) = e.ui_effects() {
                    lines.push(Line::from(format!("  UIEffects: 0x{:08X}", v)));
                }
                if let Some(v) = e.combat_use() {
                    lines.push(Line::from(format!("  CombatUse: {} ({:02X})", v, v)));
                }
                if let Some(v) = e.structure() {
                    lines.push(Line::from(format!(
                        "  Struct:    {}/{}",
                        v,
                        e.max_structure().unwrap_or(0)
                    )));
                }
                if e.stack_size() > 1 || e.max_stack_size().unwrap_or(0) > 1 {
                    lines.push(Line::from(format!(
                        "  Stack:     {}/{}",
                        e.stack_size(),
                        e.max_stack_size().unwrap_or(0)
                    )));
                }
                let valid = e.valid_locations();
                if !valid.is_empty() {
                    lines.push(Line::from(format!("  ValidLocs: {:08X}", valid.bits())));
                    for (name, _) in valid.iter_names() {
                        lines.push(Line::from(format!("    - {}", name)));
                    }
                }
                let wield = e.wield_location();
                if !wield.is_empty() {
                    lines.push(Line::from(format!("  WieldLoc:  {:08X}", wield.bits())));
                    for (name, _) in wield.iter_names() {
                        lines.push(Line::from(format!("    - {}", name)));
                    }
                }
                if let Some(v) = e.priority() {
                    lines.push(Line::from(format!("  Priority:  {}", v)));
                }
                if let Some(v) = e.radar_blip_color() {
                    lines.push(Line::from(format!("  RadarBlip: {} ({:?})", v, v)));
                }
                if let Some(v) = e.radar_enum() {
                    lines.push(Line::from(format!("  RadarEnum: {} ({:?})", v, v)));
                }
                if let Some(v) = e.pscript() {
                    lines.push(Line::from(format!("  PScript:   {}", v)));
                }
                if let Some(v) = e.spell() {
                    lines.push(Line::from(format!("  Spell:     {}", v)));
                }
                if let Some(v) = e.cooldown_id() {
                    lines.push(Line::from(format!(
                        "  CD:        #{} ({})",
                        v,
                        format_duration(e.cooldown_duration().unwrap_or(0.0))
                    )));
                }
            }

            if e.mtable_id().is_some()
                || e.stable_id().is_some()
                || e.petable_id().is_some()
                || e.csetup_id().is_some()
                || e.physics_parent_id.is_some()
                || e.default_script_id().is_some()
                || e.autonomous_movement
            {
                lines.push(Line::from("-- Technical Data --"));
                if let Some(v) = e.mtable_id() {
                    lines.push(Line::from(format!("  MTable:    0x{:08X}", v.0)));
                }
                if let Some(v) = e.stable_id() {
                    lines.push(Line::from(format!("  STable:    0x{:08X}", v.0)));
                }
                if let Some(v) = e.petable_id() {
                    lines.push(Line::from(format!("  PETable:   0x{:08X}", v.0)));
                }
                if let Some(v) = e.csetup_id() {
                    lines.push(Line::from(format!("  CSetup:    0x{:08X}", v.0)));
                }
                if let Some(v) = e.physics_parent_id {
                    lines.push(Line::from(format!("  PhysParentId: 0x{:08X}", v.0)));
                }
                if let Some(v) = e.default_script_id() {
                    lines.push(Line::from(format!(
                        "  DefScript: {} ({:.2})",
                        v,
                        e.default_script_intensity().unwrap_or(0.0)
                    )));
                }
                if e.autonomous_movement {
                    lines.push(Line::from(format!(
                        "  AutoMove:  {}",
                        e.autonomous_movement
                    )));
                }
            }

            if e.house_owner_id().is_some()
                || e.monarch_id().is_some()
                || e.pet_owner_id().is_some()
            {
                lines.push(Line::from("-- Ownership --"));
                if let Some(v) = e.house_owner_id() {
                    lines.push(Line::from(format!("  HouseOwn:  {:08X}", v.0)));
                }
                if let Some(v) = e.monarch_id() {
                    lines.push(Line::from(format!("  Monarch:   {:08X}", v.0)));
                }
                if let Some(v) = e.pet_owner_id() {
                    lines.push(Line::from(format!("  PetOwner:  {:08X}", v.0)));
                }
            }

            if e.icon_overlay_id().is_some()
                || e.icon_underlay_id().is_some()
                || e.material_type().is_some()
            {
                lines.push(Line::from("-- Extra --"));
                if let Some(v) = e.icon_overlay_id() {
                    lines.push(Line::from(format!("  IconOver:  0x{:08X}", v.0)));
                }
                if let Some(v) = e.icon_underlay_id() {
                    lines.push(Line::from(format!("  IconUnder: 0x{:08X}", v.0)));
                }
                if let Some(v) = e.material_type() {
                    lines.push(Line::from(format!(
                        "  Material:  {} (0x{:08X})",
                        v, v as u32
                    )));
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

            if e.hook_type().is_some() || e.hook_item_types().is_some() || e.hook_profile.is_some()
            {
                lines.push(Line::from("-- Hooks --"));
                if let Some(v) = e.hook_type() {
                    lines.push(Line::from(format!("  Type:      0x{:04X}", v)));
                }
                if let Some(v) = e.hook_item_types() {
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
                        .and_then(|m| m.get(spell_id))
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

            if !e.properties.ints.0.is_empty() {
                lines.push(Line::from("-- Int Properties --"));
                for (k, v) in e.properties.ints.iter() {
                    lines.push(Line::from(format!("  {:?}: {}", k, v)));
                }
            }
            if !e.properties.int64s.0.is_empty() {
                lines.push(Line::from("-- Int64 Properties --"));
                for (k, v) in e.properties.int64s.iter() {
                    lines.push(Line::from(format!("  {:?}: {}", k, v)));
                }
            }
            if !e.properties.bools.0.is_empty() {
                lines.push(Line::from("-- Bool Properties --"));
                for (k, v) in e.properties.bools.iter() {
                    lines.push(Line::from(format!("  {:?}: {}", k, v)));
                }
            }
            if !e.properties.floats.0.is_empty() {
                lines.push(Line::from("-- Float Properties --"));
                for (k, v) in e.properties.floats.iter() {
                    lines.push(Line::from(format!("  {:?}: {:.4}", k, v)));
                }
            }
            if !e.properties.strings.0.is_empty() {
                lines.push(Line::from("-- String Properties --"));
                for (k, v) in e.properties.strings.iter() {
                    lines.push(Line::from(format!("  {:?}: {}", k, v)));
                }
            }
            if !e.properties.dids.0.is_empty() {
                lines.push(Line::from("-- DataID Properties --"));
                for (k, v) in e.properties.dids.iter() {
                    lines.push(Line::from(format!("  {:?}: {}", k, v)));
                }
            }
            if !e.properties.iids.0.is_empty() {
                lines.push(Line::from("-- InstanceID Properties --"));
                for (k, v) in e.properties.iids.iter() {
                    lines.push(Line::from(format!("  {:?}: {}", k, v)));
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
                            .and_then(|m| m.get(enc.spell_id as u32))
                            .map(|s| s.name.as_str())
                            .unwrap_or("Unknown Spell");
                        lines.push(Line::from(format!(
                            "  #{} - {} (dur: {})",
                            enc.spell_id,
                            name,
                            format_duration(enc.duration)
                        )));
                    }
                }
            }
        }
    }

    lines
}

fn push_object_debug_info(
    data: &GameData,
    lines: &mut Vec<Line<'static>>,
    object: &InspectableObject<'_>,
    spell_lookup: Option<&SpellCatalog>,
) {
    let player_storage = (Some(object.guid) == data.player_guid)
        .then(|| data.storage_usage(object.guid))
        .flatten();

    lines.push(Line::from(format!("GUID:   {:08X}", object.guid)));
    lines.push(Line::from(format!("Value:  {}", object.item_value())));
    lines.push(Line::from(format!("WCID:   {:?}", object.wcid)));

    if object.plural_name().is_some()
        || object.items_capacity().is_some()
        || object.containers_capacity().is_some()
        || object.ammo_type().is_some()
        || object.item_value() > 0
        || object.usable().is_some()
        || object.use_radius().is_some()
        || object.workmanship().is_some()
        || object.burden().is_some()
        || object.target_type().is_some()
        || object.ui_effects().is_some()
        || object.combat_use().is_some()
        || object.stack_size() > 1
        || !object.valid_locations().is_empty()
        || !object.wield_location().is_empty()
    {
        lines.push(Line::from("-- Weenie Data --"));
        if let Some(p) = &object.plural_name() {
            lines.push(Line::from(format!("  Plural:    {}", p)));
        }
        if let Some(v) = object.items_capacity() {
            if Some(object.guid) == data.player_guid {
                lines.push(Line::from(format!(
                    "  ICapacity: {}/{}",
                    player_storage.map(|usage| usage.item_used).unwrap_or(0),
                    v
                )));
            } else {
                lines.push(Line::from(format!("  ICapacity: {}", v)));
            }
        }
        if let Some(v) = object.containers_capacity() {
            if Some(object.guid) == data.player_guid {
                lines.push(Line::from(format!(
                    "  CCapacity: {}/{}",
                    player_storage
                        .map(|usage| usage.container_used)
                        .unwrap_or(0),
                    v
                )));
            } else {
                lines.push(Line::from(format!("  CCapacity: {}", v)));
            }
        }
        if let Some(v) = object.ammo_type() {
            lines.push(Line::from(format!("  AmmoType:  {}", v)));
        }
        if object.item_value() > 0 {
            lines.push(Line::from(format!("  Value:     {}", object.item_value())));
        }
        if let Some(v) = object.usable() {
            lines.push(Line::from(format!("  Usable:    0x{:08X}", v)));
        }
        if let Some(v) = object.use_radius() {
            lines.push(Line::from(format!("  UseRadius: {:.2}", v)));
        }
        if let Some(v) = object.workmanship() {
            lines.push(Line::from(format!("  Work:      {:.2}", v)));
        }
        if let Some(v) = object.burden() {
            lines.push(Line::from(format!("  Burden:    {}", v)));
        }
        if let Some(v) = object.target_type() {
            lines.push(Line::from(format!("  TargetTyp: 0x{:08X}", v)));
        }
        if let Some(v) = object.ui_effects() {
            lines.push(Line::from(format!("  UIEffects: 0x{:08X}", v)));
        }
        if let Some(v) = object.combat_use() {
            lines.push(Line::from(format!("  CombatUse: {} ({:02X})", v, v)));
        }
        if let Some(v) = object.structure() {
            lines.push(Line::from(format!(
                "  Struct:    {}/{}",
                v,
                object.max_structure().unwrap_or(0)
            )));
        }
        if object.stack_size() > 1 || object.max_stack_size().unwrap_or(0) > 1 {
            lines.push(Line::from(format!(
                "  Stack:     {}/{}",
                object.stack_size(),
                object.max_stack_size().unwrap_or(0)
            )));
        }
        let valid = object.valid_locations();
        if !valid.is_empty() {
            lines.push(Line::from(format!("  ValidLocs: {:08X}", valid.bits())));
            for (name, _) in valid.iter_names() {
                lines.push(Line::from(format!("    - {}", name)));
            }
        }
        let wield = object.wield_location();
        if !wield.is_empty() {
            lines.push(Line::from(format!("  WieldLoc:  {:08X}", wield.bits())));
            for (name, _) in wield.iter_names() {
                lines.push(Line::from(format!("    - {}", name)));
            }
        }
    }

    let mut wrote_extra_header = false;
    if let Some(v) = object.icon_overlay_id() {
        if !wrote_extra_header {
            lines.push(Line::from("-- Extra --"));
            wrote_extra_header = true;
        }
        lines.push(Line::from(format!("  IconOver:  0x{:08X}", v.0)));
    }
    if let Some(v) = object.icon_underlay_id() {
        if !wrote_extra_header {
            lines.push(Line::from("-- Extra --"));
            wrote_extra_header = true;
        }
        lines.push(Line::from(format!("  IconUnder: 0x{:08X}", v.0)));
    }
    if let Some(v) = object.material_type() {
        if !wrote_extra_header {
            lines.push(Line::from("-- Extra --"));
        }
        lines.push(Line::from(format!(
            "  Material:  {} (0x{:08X})",
            v, v as u32
        )));
    }

    if let Some(profile) = object.creature_profile {
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

    if let Some(profile) = object.armor_profile {
        lines.push(Line::from("-- Armor Profile --"));
        lines.push(Line::from(format!(
            "  Slash: {:.2}, Pierce: {:.2}, Blunt: {:.2}",
            profile.slashing, profile.piercing, profile.bludgeoning
        )));
        lines.push(Line::from(format!(
            "  Fire: {:.2}, Cold: {:.2}, Acid: {:.2}, Light: {:.2}, Nether: {:.2}",
            profile.fire, profile.cold, profile.acid, profile.lightning, profile.nether
        )));
    }

    if let Some(profile) = object.weapon_profile {
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

    if !object.spell_book.is_empty() {
        lines.push(Line::from("-- Spell Book --"));
        for &spell_id in object.spell_book {
            let name = spell_lookup
                .and_then(|m| m.get(spell_id))
                .map(|s| s.name.as_str())
                .unwrap_or("Unknown");
            lines.push(Line::from(format!("  #{} - {}", spell_id, name)));
        }
    }

    if !object.properties.ints.0.is_empty() {
        lines.push(Line::from("-- Int Properties --"));
        for (k, v) in object.properties.ints.iter() {
            lines.push(Line::from(format!("  {:?}: {}", k, v)));
        }
    }
    if !object.properties.int64s.0.is_empty() {
        lines.push(Line::from("-- Int64 Properties --"));
        for (k, v) in object.properties.int64s.iter() {
            lines.push(Line::from(format!("  {:?}: {}", k, v)));
        }
    }
    if !object.properties.bools.0.is_empty() {
        lines.push(Line::from("-- Bool Properties --"));
        for (k, v) in object.properties.bools.iter() {
            lines.push(Line::from(format!("  {:?}: {}", k, v)));
        }
    }
    if !object.properties.floats.0.is_empty() {
        lines.push(Line::from("-- Float Properties --"));
        for (k, v) in object.properties.floats.iter() {
            lines.push(Line::from(format!("  {:?}: {:.4}", k, v)));
        }
    }
    if !object.properties.strings.0.is_empty() {
        lines.push(Line::from("-- String Properties --"));
        for (k, v) in object.properties.strings.iter() {
            lines.push(Line::from(format!("  {:?}: {}", k, v)));
        }
    }
    if !object.properties.dids.0.is_empty() {
        lines.push(Line::from("-- DataID Properties --"));
        for (k, v) in object.properties.dids.iter() {
            lines.push(Line::from(format!("  {:?}: {}", k, v)));
        }
    }
    if !object.properties.iids.0.is_empty() {
        lines.push(Line::from("-- InstanceID Properties --"));
        for (k, v) in object.properties.iids.iter() {
            lines.push(Line::from(format!("  {:?}: {}", k, v)));
        }
    }
}

pub fn get_spell_debug_info(
    spell_id: u32,
    spell_lookup: Option<&SpellCatalog>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

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
        lines.push(Line::from(format!("Formula V:  {}", info.formula_version)));

        let comps: Vec<String> = info
            .components
            .iter()
            .map(|id| format!("{:#X}", id))
            .collect();
        lines.push(Line::from(format!("Comps:      {}", comps.join(", "))));
    } else {
        lines.push(Line::from("Info:       (Loading...)".to_string()));
    }

    lines
}

pub fn get_enchantment_debug_info(
    enchant: &Enchantment,
    _spell_lookup: Option<&SpellCatalog>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

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
        "Duration:       {}",
        format_duration(enchant.duration)
    )));
    lines.push(Line::from(format!(
        "Stat Mod Type:  0x{:08X}",
        enchant.stat_mod_type
    )));
    let flags = EnchantmentTypeFlags::from_bits_truncate(enchant.stat_mod_type);
    for (name, _) in flags.iter_names() {
        lines.push(Line::from(format!("  [X] {}", name)));
    }

    let key_name = enchantment_stat_key_name(enchant, flags);
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

    lines
}

pub fn get_spell_details_info(
    spell_id: u32,
    spell_lookup: Option<&SpellCatalog>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    if let Some(info) = spell_lookup.and_then(|m| m.get(spell_id)) {
        lines.push(Line::from(info.name.clone()));
        lines.push(Line::from(format!("ID: {}", spell_id)));
        lines.push(Line::from(format!("School: {:?}", info.school)));
        lines.push(Line::from(format!("Power: {}", info.power)));
        lines.push(Line::from(format!("Mana Cost: {}", info.base_mana)));

        if !info.description.trim().is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(info.description.clone()));
        }
    } else {
        lines.push(Line::from(format!("Spell #{}", spell_id)));
        lines.push(Line::from(
            "Details unavailable (spell data still loading).",
        ));
    }

    lines
}

pub fn get_enchantment_details_info(
    enchant: &Enchantment,
    spell_lookup: Option<&SpellCatalog>,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    let spell_name = spell_lookup
        .and_then(|m| m.get(enchant.spell_id as u32))
        .map(|s| s.name.clone())
        .unwrap_or_else(|| format!("Spell #{}", enchant.spell_id));

    lines.push(Line::from(spell_name));
    lines.push(Line::from(format!(
        "Duration: {}",
        format_duration(enchant.duration)
    )));

    let flags = EnchantmentTypeFlags::from_bits_truncate(enchant.stat_mod_type);
    if let Some(key_display) = enchantment_stat_key_name(enchant, flags) {
        let sign = if enchant.stat_mod_value >= 0.0 {
            "+"
        } else {
            ""
        };
        lines.push(Line::from(format!(
            "Effect: {}{} {}",
            sign, enchant.stat_mod_value, key_display
        )));
    }

    lines.push(Line::from(format!("Layer: {}", enchant.layer)));
    lines.push(Line::from(format!("Category: {}", enchant.spell_category)));

    lines
}

fn enchantment_stat_key_name(enchant: &Enchantment, flags: EnchantmentTypeFlags) -> Option<String> {
    if flags.contains(EnchantmentTypeFlags::ATTRIBUTE) {
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
    }
}

fn format_duration(seconds: f64) -> String {
    if !(0.0..=86400.0 * 365.0).contains(&seconds) {
        "Inf".to_string()
    } else if seconds < 0.1 {
        format!("{:.3}s", seconds)
    } else if seconds < 1.0 {
        format!("{:.2}s", seconds)
    } else if seconds < 60.0 {
        format!("{:.1}s", seconds)
    } else if seconds < 3600.0 {
        let m = (seconds / 60.0) as u32;
        let s = (seconds % 60.0) as u32;
        if s == 0 {
            format!("{}m", m)
        } else {
            format!("{}m {}s", m, s)
        }
    } else if seconds < 86400.0 {
        let h = (seconds / 3600.0) as u32;
        let m = ((seconds % 3600.0) / 60.0) as u32;
        if m == 0 {
            format!("{}h", h)
        } else {
            format!("{}h {}m", h, m)
        }
    } else {
        let d = (seconds / 86400.0) as u32;
        let h = ((seconds % 86400.0) / 3600.0) as u32;
        if h == 0 {
            format!("{}d", d)
        } else {
            format!("{}d {}h", d, h)
        }
    }
}

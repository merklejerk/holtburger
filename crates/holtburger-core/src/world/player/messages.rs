use super::PlayerState;
use super::types::SkillBase;
use super::types::VitalBase;
use crate::world::StateEvent;
use crate::world::stats;
use holtburger_common::Guid;
use holtburger_common::properties::PropertyString;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::*;

use holtburger_protocol::messages::EquipMask;

impl PlayerState {
    pub fn handle_message(
        &mut self,
        msg: &GameMessage,
        events: &mut Vec<StateEvent>,
        xp_table: Option<&holtburger_dat::file_type::XpTable>,
    ) -> bool {
        match msg {
            GameMessage::ObjectCreate(data) => {
                if data.public_weenie_desc.guid == self.guid && self.guid != Guid::NULL {
                    if let Some(pos) = data.pos {
                        self.position = pos;
                    }
                    return false;
                }
            }
            GameMessage::UpdatePosition(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    let old_forced_seq = self.force_position_sequence;

                    self.position = data.pos.pos;
                    self.instance_sequence = data.pos.instance_sequence;
                    self.position_sequence = data.pos.position_sequence;
                    self.teleport_sequence = data.pos.teleport_sequence;
                    self.force_position_sequence = data.pos.force_position_sequence;

                    if is_newer_u16(self.force_position_sequence, old_forced_seq) {
                        events.push(StateEvent::ForcedReposition {
                            guid: self.guid,
                            pos: self.position,
                            sequence: self.force_position_sequence,
                        });
                    }

                    return false;
                }
            }
            GameMessage::PrivateUpdatePosition(data) => {
                self.position = data.pos;
                return false;
            }
            GameMessage::PublicUpdatePosition(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    self.position = data.pos;
                    return false;
                }
            }
            GameMessage::VectorUpdate(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    self.instance_sequence = data.instance_sequence;
                    events.push(StateEvent::EntityVectorUpdated {
                        guid: data.guid,
                        velocity: data.velocity,
                        omega: data.omega,
                    });
                    return true;
                }
            }
            GameMessage::UpdateMotion(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    self.instance_sequence = data.object_instance_sequence;
                    self.server_control_sequence = data.server_control_sequence;
                    self.movement_sequence = data.movement_sequence;

                    // We don't update position here as it's just a request/animation
                    // But we emit an event if it's a non-autonomous move (server request)
                    if !data.is_autonomous {
                        // For MoveToObject/MoveToPosition, we might want a specific event
                        // but for now, the TUI can see the GameMessage if it wants.
                    }
                    return true;
                }
            }
            GameMessage::PlayerTeleport(data) => {
                self.teleport_sequence = data.teleport_sequence;
                return true;
            }
            GameMessage::PrivateUpdateAttribute(data) => {
                let UpdateAttribute {
                    attribute,
                    ranks,
                    start,
                    xp,
                    ..
                } = &**data;
                if let Some(attr_type) = stats::AttributeType::from_repr(*attribute) {
                    let base = start + ranks;
                    let mult = self.get_attribute_multiplier(attr_type);
                    let add = self.get_attribute_additive(attr_type);
                    let current = ((base as f32 * mult) + add).round() as u32;

                    let attr_obj = stats::Attribute {
                        attr_type,
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_attribute_rank_xp(*ranks)),
                        base,
                        current,
                    };

                    self.attributes.insert(attr_type, attr_obj.clone());

                    events.push(StateEvent::AttributeUpdated(attr_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PublicUpdateAttribute(data) => {
                let UpdateAttribute {
                    attribute,
                    ranks,
                    start,
                    xp,
                    ..
                } = &**data;
                if let Some(attr_type) = stats::AttributeType::from_repr(*attribute) {
                    let base = start + ranks;
                    let mult = self.get_attribute_multiplier(attr_type);
                    let add = self.get_attribute_additive(attr_type);
                    let current = ((base as f32 * mult) + add).round() as u32;

                    let attr_obj = stats::Attribute {
                        attr_type,
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_attribute_rank_xp(*ranks)),
                        base,
                        current,
                    };

                    self.attributes.insert(attr_type, attr_obj.clone());

                    events.push(StateEvent::AttributeUpdated(attr_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PrivateUpdateSkill(data) => {
                let UpdateSkill {
                    skill,
                    ranks,
                    status,
                    init,
                    xp,
                    ..
                } = &**data;
                if let Some(skill_type) = stats::SkillType::from_repr(*skill) {
                    let training = match status {
                        1 => stats::TrainingLevel::Untrained,
                        2 => stats::TrainingLevel::Trained,
                        3 => stats::TrainingLevel::Specialized,
                        _ => stats::TrainingLevel::Unusable,
                    };

                    self.skill_bases.insert(
                        skill_type,
                        SkillBase {
                            ranks: *ranks,
                            init: *init,
                        },
                    );

                    let base_val = self.derive_skill_value(skill_type, *ranks, *init, false);
                    let current_val = self.derive_skill_value(skill_type, *ranks, *init, true);

                    let skill_obj = stats::Skill {
                        skill_type,
                        ranks: *ranks,
                        init: *init,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| {
                            t.get_next_skill_rank_xp(
                                *ranks,
                                training == stats::TrainingLevel::Specialized,
                            )
                        }),
                        base: base_val,
                        current: current_val,
                        training,
                    };

                    self.skills.insert(skill_type, skill_obj.clone());

                    events.push(StateEvent::SkillUpdated(skill_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PublicUpdateSkill(data) => {
                let UpdateSkill {
                    skill,
                    ranks,
                    status,
                    init,
                    xp,
                    ..
                } = &**data;
                if let Some(skill_type) = stats::SkillType::from_repr(*skill) {
                    let training = match status {
                        1 => stats::TrainingLevel::Untrained,
                        2 => stats::TrainingLevel::Trained,
                        3 => stats::TrainingLevel::Specialized,
                        _ => stats::TrainingLevel::Unusable,
                    };

                    self.skill_bases.insert(
                        skill_type,
                        SkillBase {
                            ranks: *ranks,
                            init: *init,
                        },
                    );

                    let base_val = self.derive_skill_value(skill_type, *ranks, *init, false);
                    let current_val = self.derive_skill_value(skill_type, *ranks, *init, true);

                    let skill_obj = stats::Skill {
                        skill_type,
                        ranks: *ranks,
                        init: *init,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| {
                            t.get_next_skill_rank_xp(
                                *ranks,
                                training == stats::TrainingLevel::Specialized,
                            )
                        }),
                        base: base_val,
                        current: current_val,
                        training,
                    };

                    self.skills.insert(skill_type, skill_obj.clone());

                    events.push(StateEvent::SkillUpdated(skill_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PrivateUpdateVital(data) => {
                let UpdateVital {
                    vital,
                    ranks,
                    start,
                    current,
                    xp,
                    ..
                } = &**data;
                if let Some(vital_type) = stats::VitalType::from_id(*vital) {
                    self.vital_bases.insert(
                        vital_type,
                        VitalBase {
                            ranks: *ranks,
                            start: *start,
                        },
                    );

                    let base = self.calculate_vital_base(vital_type);
                    let buffed_max = self.calculate_vital_current(vital_type);
                    let final_base = if base == 0 { *current } else { base };

                    let vital_obj = stats::Vital {
                        vital_type,
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_vital_rank_xp(*ranks)),
                        base: final_base,
                        buffed_max,
                        current: *current,
                    };
                    self.vitals.insert(vital_type, vital_obj.clone());

                    events.push(StateEvent::VitalUpdated(vital_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PublicUpdateVital(data) => {
                let UpdateVital {
                    vital,
                    ranks,
                    start,
                    current,
                    xp,
                    ..
                } = &**data;
                if let Some(vital_type) = stats::VitalType::from_id(*vital) {
                    self.vital_bases.insert(
                        vital_type,
                        VitalBase {
                            ranks: *ranks,
                            start: *start,
                        },
                    );

                    let base = self.calculate_vital_base(vital_type);
                    let buffed_max = self.calculate_vital_current(vital_type);
                    let final_base = if base == 0 { *current } else { base };

                    let vital_obj = stats::Vital {
                        vital_type,
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_vital_rank_xp(*ranks)),
                        base: final_base,
                        buffed_max,
                        current: *current,
                    };
                    self.vitals.insert(vital_type, vital_obj.clone());

                    events.push(StateEvent::VitalUpdated(vital_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PrivateUpdateVitalCurrent(data) => {
                let UpdateVitalCurrent { vital, current, .. } = &**data;
                if let Some(vital_type) = stats::VitalType::from_id(*vital)
                    && let Some(vital_obj) = self.vitals.get_mut(&vital_type)
                {
                    vital_obj.current = *current;
                    events.push(StateEvent::VitalUpdated(vital_obj.clone()));
                    return true;
                }
            }
            GameMessage::GameEvent(ev) => {
                return match &ev.event {
                    GameEvent::PlayerDescription(data) => {
                        self.guid = data.guid;
                        self.enchantments = data.enchantments.clone();
                        self.properties = data.properties.clone();

                        // Ensure name is in properties if it was sent as a field
                        self.properties
                            .strings
                            .0
                            .entry(PropertyString::Name)
                            .or_insert_with(|| data.name.clone());

                        self.spells = data.spells.clone();
                        self.hotbar_spells = data.hotbar_spells.clone();

                        // Attributes & Vitals
                        self.attributes.clear();
                        self.vital_bases.clear();
                        self.vitals.clear();

                        for (at_type, attr) in &data.attributes {
                            let at_type = *at_type;
                            let ranks = attr.ranks;
                            let start = attr.start;

                            if at_type <= 6 {
                                if let Some(attr_type) = stats::AttributeType::from_repr(at_type) {
                                    let base = ranks + start;
                                    let attr_obj = stats::Attribute {
                                        attr_type,
                                        ranks,
                                        start,
                                        spent_xp: attr.xp,
                                        next_rank_xp: xp_table
                                            .and_then(|t| t.get_next_attribute_rank_xp(ranks)),
                                        base,
                                        current: base,
                                    };
                                    self.attributes.insert(attr_type, attr_obj);
                                }
                            } else if (7..=9).contains(&at_type) {
                                let vital_type = match at_type {
                                    7 => stats::VitalType::Health,
                                    8 => stats::VitalType::Stamina,
                                    9 => stats::VitalType::Mana,
                                    _ => continue,
                                };

                                self.vital_bases
                                    .insert(vital_type, VitalBase { ranks, start });

                                let base = self.calculate_vital_base(vital_type);
                                let current = attr.current.unwrap_or(0);
                                let final_base = if base == 0 { current } else { base };

                                let vital = stats::Vital {
                                    vital_type,
                                    ranks,
                                    start,
                                    spent_xp: attr.xp,
                                    next_rank_xp: xp_table
                                        .and_then(|t| t.get_next_vital_rank_xp(ranks)),
                                    base: final_base,
                                    buffed_max: final_base,
                                    current,
                                };
                                self.vitals.insert(vital_type, vital);
                            }
                        }

                        // Skills
                        self.skills.clear();
                        self.skill_bases.clear();
                        for (sk_type, s) in &data.skills {
                            if let Some(skill_type) = stats::SkillType::from_repr(*sk_type) {
                                let training = stats::TrainingLevel::from_repr(s.status)
                                    .unwrap_or(stats::TrainingLevel::Untrained);

                                self.skill_bases.insert(
                                    skill_type,
                                    SkillBase {
                                        ranks: s.ranks,
                                        init: s.init,
                                    },
                                );

                                let base_val =
                                    self.derive_skill_value(skill_type, s.ranks, s.init, false);
                                let skill = stats::Skill {
                                    skill_type,
                                    ranks: s.ranks,
                                    init: s.init,
                                    spent_xp: s.xp,
                                    next_rank_xp: xp_table.and_then(|t| {
                                        t.get_next_skill_rank_xp(
                                            s.ranks,
                                            training == stats::TrainingLevel::Specialized,
                                        )
                                    }),
                                    base: base_val,
                                    current: base_val,
                                    training,
                                };
                                self.skills.insert(skill_type, skill);
                            }
                        }

                        // Inventory & Equipment
                        self.inventory.clear();
                        for (item_guid, _container_type) in &data.inventory {
                            self.add_to_inventory(*item_guid);
                        }

                        self.equipment.clear();
                        for (item_guid, slot, _priority) in &data.equipped_objects {
                            if let Some(mask) = EquipMask::from_bits(*slot) {
                                self.wield_item(*item_guid, mask);
                            }
                        }

                        if let Some(p) = data.pos {
                            self.position = p;
                        }

                        // Emit derived stats to calculate armor/resists
                        self.emit_derived_stats(events);

                        false // Let WorldState handle the world/entity sync
                    }
                    GameEvent::MagicUpdateEnchantment(data) => {
                        let MagicUpdateEnchantmentEventData {
                            target,
                            enchantment,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            if let Some(existing) = self.enchantments.iter_mut().find(|e| {
                                e.spell_id == enchantment.spell_id && e.layer == enchantment.layer
                            }) {
                                *existing = *enchantment;
                            } else {
                                self.enchantments.push(*enchantment);
                            }
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicUpdateMultipleEnchantments(data) => {
                        let MagicUpdateMultipleEnchantmentsEventData {
                            target,
                            enchantments,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            for enchantment in enchantments {
                                if let Some(existing) = self.enchantments.iter_mut().find(|e| {
                                    e.spell_id == enchantment.spell_id
                                        && e.layer == enchantment.layer
                                }) {
                                    *existing = *enchantment;
                                } else {
                                    self.enchantments.push(*enchantment);
                                }
                            }
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicRemoveEnchantment(data) => {
                        let MagicRemoveEnchantmentEventData {
                            target,
                            spell_id,
                            layer,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            self.enchantments
                                .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicRemoveMultipleEnchantments(data) => {
                        let MagicRemoveMultipleEnchantmentsEventData { target, spells, .. } =
                            &**data;
                        if *target == self.guid {
                            for (spell_id, layer) in spells {
                                self.enchantments
                                    .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                            }
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicDispelEnchantment(data) => {
                        let MagicDispelEnchantmentEventData {
                            target,
                            spell_id,
                            layer,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            self.enchantments
                                .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicDispelMultipleEnchantments(data) => {
                        let MagicDispelMultipleEnchantmentsEventData { target, spells, .. } =
                            &**data;
                        if *target == self.guid {
                            for (spell_id, layer) in spells {
                                self.enchantments
                                    .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                            }
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicPurgeEnchantments(data) => {
                        let MagicPurgeEnchantmentsEventData { target, .. } = &**data;
                        if *target == self.guid {
                            self.enchantments.retain(|e| {
                                let flags = holtburger_common::properties::EnchantmentTypeFlags::from_bits_truncate(e.stat_mod_type);
                                flags.contains(holtburger_common::properties::EnchantmentTypeFlags::VITAE)
                            });
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicPurgeBadEnchantments(data) => {
                        let MagicPurgeBadEnchantmentsEventData { target, .. } = &**data;
                        if *target == self.guid {
                            self.enchantments.retain(|e| {
                                let flags = holtburger_common::properties::EnchantmentTypeFlags::from_bits_truncate(e.stat_mod_type);
                                flags.contains(holtburger_common::properties::EnchantmentTypeFlags::BENEFICIAL)
                                    || flags.contains(holtburger_common::properties::EnchantmentTypeFlags::VITAE)
                            });
                            events.push(StateEvent::PlayerEnchantmentsUpdated {
                                enchantments: self.enchantments.clone(),
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicUpdateSpell(data) => {
                        let spell_id = data.spell_id as u32;
                        self.spells.insert(spell_id, 0.0);
                        events.push(StateEvent::SpellUpdated {
                            spell_id,
                            name: None,
                        });
                        true
                    }
                    GameEvent::MagicRemoveSpell(data) => {
                        let spell_id = data.spell_id as u32;
                        self.spells.remove(&spell_id);
                        events.push(StateEvent::SpellRemoved { spell_id });
                        true
                    }
                    GameEvent::UpdateHealth(data) => {
                        let UpdateHealthEventData { target, health } = &**data;
                        let target_guid = if *target == Guid::NULL {
                            self.guid
                        } else {
                            *target
                        };

                        if target_guid == self.guid
                            && target_guid != Guid::NULL
                            && let Some(vital_obj) = self.vitals.get_mut(&stats::VitalType::Health)
                        {
                            // UpdateHealth is a percentage float (0.0 to 1.0)
                            let new_current = (*health * vital_obj.buffed_max as f32) as u32;
                            vital_obj.current = new_current;
                            events.push(StateEvent::VitalUpdated(vital_obj.clone()));
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::InventoryPutObjInContainer(data) => {
                        // Update player inventory tracking
                        if data.container_guid == self.guid
                            || self.inventory.contains(&data.container_guid)
                        {
                            self.add_to_inventory(data.item_guid);
                        }
                        false // Let WorldState handle the entity update
                    }
                    GameEvent::InventoryPutObjectIn3D(data) => {
                        self.remove_from_inventory(data.object_guid);
                        false // Let WorldState handle the entity update
                    }
                    GameEvent::WieldObject(data) => {
                        if ev.target == self.guid {
                            self.wield_item(data.object_guid, data.equip_mask);
                        }
                        false // Let WorldState handle the entity update
                    }
                    _ => false,
                };
            }
            GameMessage::InventoryRemoveObject(data) => {
                self.remove_from_inventory(data.object_guid);
                return false; // Let WorldState handle the entity delete
            }
            _ => {}
        }
        false
    }
}

use super::PlayerState;
use crate::StateEvent;
use crate::player::types::{SkillBase, VitalBase};
use crate::stats;
use holtburger_common::Guid;
use holtburger_common::properties::{EnchantmentTypeFlags, PropertyString};
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::*;

pub struct SkillUpdateParams<'a> {
    pub skill_id: u32,
    pub ranks: u32,
    pub status: u32,
    pub init: u32,
    pub xp: u32,
    pub xp_table: Option<&'a holtburger_dat::file_type::XpTable>,
    pub skill_table: Option<&'a holtburger_dat::file_type::SkillTable>,
}

pub struct VitalUpdateParams<'a> {
    pub vital_id: u32,
    pub ranks: u32,
    pub start: u32,
    pub current: u32,
    pub xp: u32,
    pub xp_table: Option<&'a holtburger_dat::file_type::XpTable>,
}

impl PlayerState {
    /// Hydrates an attribute from a network update message.
    pub fn update_attribute(
        &mut self,
        attr_id: u32,
        ranks: u32,
        start: u32,
        xp: u32,
        xp_table: Option<&holtburger_dat::file_type::XpTable>,
        events: &mut Vec<StateEvent>,
    ) {
        if let Some(attr_type) = stats::AttributeType::from_repr(attr_id) {
            let base = start + ranks;
            let mult = self.get_attribute_multiplier(attr_type);
            let add = self.get_attribute_additive(attr_type);
            let current = ((base as f32 * mult) + add).round() as u32;

            let attr_obj = stats::Attribute {
                attr_type,
                ranks,
                start,
                spent_xp: xp,
                next_rank_xp: xp_table.and_then(|t| t.get_next_attribute_rank_xp(ranks)),
                base,
                current,
            };

            self.attributes.insert(attr_type, attr_obj.clone());
            events.push(StateEvent::AttributeUpdated(attr_obj));
            self.emit_derived_stats(events);
        }
    }

    /// Hydrates a skill from a network update message.
    pub fn update_skill(&mut self, params: SkillUpdateParams, events: &mut Vec<StateEvent>) {
        let SkillUpdateParams {
            skill_id,
            ranks,
            status,
            init,
            xp,
            xp_table,
            skill_table,
        } = params;

        if let Some(skill_type) = stats::SkillType::from_repr(skill_id) {
            let training = match status {
                1 => stats::TrainingLevel::Untrained,
                2 => stats::TrainingLevel::Trained,
                3 => stats::TrainingLevel::Specialized,
                _ => stats::TrainingLevel::Unusable,
            };

            self.skill_bases
                .insert(skill_type, SkillBase { ranks, init });

            let base_val = self.derive_skill_value(skill_type, ranks, init, false);
            let current_val = self.derive_skill_value(skill_type, ranks, init, true);

            let (trained_cost, specialized_cost) = skill_table
                .and_then(|t| t.skill_base_hash.get(&(skill_type as u32)))
                .map(|b| (b.trained_cost as u32, b.specialized_cost as u32))
                .unwrap_or((0, 0));

            let skill_obj = stats::Skill {
                skill_type,
                ranks,
                init,
                spent_xp: xp,
                next_rank_xp: xp_table.and_then(|t| {
                    t.get_next_skill_rank_xp(ranks, training == stats::TrainingLevel::Specialized)
                }),
                base: base_val,
                current: current_val,
                training,
                trained_cost,
                specialized_cost,
            };

            self.skills.insert(skill_type, skill_obj.clone());
            events.push(StateEvent::SkillUpdated(skill_obj));
            self.emit_derived_stats(events);
        }
    }

    /// Hydrates a vital from a network update message.
    pub fn update_vital(&mut self, params: VitalUpdateParams, events: &mut Vec<StateEvent>) {
        let VitalUpdateParams {
            vital_id,
            ranks,
            start,
            current,
            xp,
            xp_table,
        } = params;

        if let Some(vital_type) = stats::VitalType::from_id(vital_id) {
            self.vital_bases
                .insert(vital_type, VitalBase { ranks, start });

            let base = self.calculate_vital_base(vital_type);
            let buffed_max = self.calculate_vital_current(vital_type);
            let final_base = if base == 0 { current } else { base };

            let vital_obj = stats::Vital {
                vital_type,
                ranks,
                start,
                spent_xp: xp,
                next_rank_xp: xp_table.and_then(|t| t.get_next_vital_rank_xp(ranks)),
                base: final_base,
                buffed_max,
                current,
            };
            self.vitals.insert(vital_type, vital_obj.clone());
            events.push(StateEvent::VitalUpdated(vital_obj));
            self.emit_derived_stats(events);
        }
    }

    /// Updates the current value of a vital.
    pub fn update_vital_current(
        &mut self,
        vital_id: u32,
        current: u32,
        events: &mut Vec<StateEvent>,
    ) {
        if let Some(vital_type) = stats::VitalType::from_id(vital_id)
            && let Some(vital_obj) = self.vitals.get_mut(&vital_type)
        {
            vital_obj.current = current;
            events.push(StateEvent::VitalUpdated(vital_obj.clone()));
        }
    }

    /// Updates the player's world position and associated sequences.
    pub fn update_position_from_server(
        &mut self,
        pos_pack: &PositionPack,
        events: &mut Vec<StateEvent>,
    ) {
        let old_forced_seq = self.force_position_sequence;
        let old_grounded = self.server_grounded;

        self.position = pos_pack.pos;
        self.instance_sequence = pos_pack.instance_sequence;
        self.position_sequence = pos_pack.position_sequence;
        self.teleport_sequence = pos_pack.teleport_sequence;
        self.force_position_sequence = pos_pack.force_position_sequence;
        let is_grounded = pos_pack
            .flags
            .contains(UpdatePositionFlag::IS_GROUNDED);
        self.server_grounded = Some(is_grounded);

        if old_grounded != Some(is_grounded) {
            events.push(StateEvent::PlayerGroundedUpdated {
                grounded: is_grounded,
            });
        }

        if is_newer_u16(self.force_position_sequence, old_forced_seq) {
            events.push(StateEvent::ForcedReposition {
                guid: self.guid,
                pos: self.position,
                sequence: self.force_position_sequence,
            });
        }
    }

    /// Returns whether a server-authored player position update should be accepted.
    ///
    /// Teleport sequence is the primary ordering key. Within the same teleport epoch,
    /// force-position sequence distinguishes newer rubber-band corrections from older ones.
    pub fn should_accept_server_position_sequences(
        &self,
        teleport_sequence: u16,
        force_position_sequence: u16,
    ) -> bool {
        if is_newer_u16(self.teleport_sequence, teleport_sequence) {
            return false;
        }

        if teleport_sequence == self.teleport_sequence
            && is_newer_u16(self.force_position_sequence, force_position_sequence)
        {
            return false;
        }

        true
    }

    /// Applies a server-authored player position update when its sequencing is current.
    pub fn apply_position_from_server(
        &mut self,
        pos_pack: &PositionPack,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        if !self.should_accept_server_position_sequences(
            pos_pack.teleport_sequence,
            pos_pack.force_position_sequence,
        ) {
            return false;
        }

        self.update_position_from_server(pos_pack, events);
        true
    }

    pub fn update_motion_sequences(
        &mut self,
        instance_sequence: u16,
        server_control_sequence: u16,
        movement_sequence: u16,
    ) {
        self.instance_sequence = instance_sequence;
        self.server_control_sequence = server_control_sequence;
        self.movement_sequence = movement_sequence;
    }

    pub fn update_last_server_motion_style(&mut self, current_style: u16) {
        if current_style != 0
            && let Some(current_style) =
                holtburger_protocol::messages::movement::MotionStance::from_interpreted(
                    current_style,
                )
        {
            self.last_server_motion_style = Some(current_style);
        }
    }

    pub fn update_vector_sequence(&mut self, instance_sequence: u16) {
        self.instance_sequence = instance_sequence;
    }

    pub fn set_teleport_sequence(&mut self, teleport_sequence: u16) {
        self.teleport_sequence = teleport_sequence;
    }

    pub fn hydrate_from_player_description(
        &mut self,
        data: &PlayerDescriptionEventData,
        xp_table: Option<&holtburger_dat::file_type::XpTable>,
        skill_table: Option<&holtburger_dat::file_type::SkillTable>,
        events: &mut Vec<StateEvent>,
    ) {
        self.guid = data.guid;
        self.enchantments = data.enchantments.clone();
        self.properties = data.properties.clone();
        self.properties
            .strings
            .0
            .entry(PropertyString::Name)
            .or_insert_with(|| data.name.clone());

        self.spells = data.spells.clone();
        self.hotbar_spells = data.hotbar_spells.clone();

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
                        next_rank_xp: xp_table.and_then(|t| t.get_next_attribute_rank_xp(ranks)),
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
                    next_rank_xp: xp_table.and_then(|t| t.get_next_vital_rank_xp(ranks)),
                    base: final_base,
                    buffed_max: final_base,
                    current,
                };
                self.vitals.insert(vital_type, vital);
            }
        }

        self.skills.clear();
        self.skill_bases.clear();
        for (sk_type, skill) in &data.skills {
            if let Some(skill_type) = stats::SkillType::from_repr(*sk_type) {
                let training = stats::TrainingLevel::from_repr(skill.status)
                    .unwrap_or(stats::TrainingLevel::Untrained);

                self.skill_bases.insert(
                    skill_type,
                    SkillBase {
                        ranks: skill.ranks,
                        init: skill.init,
                    },
                );

                let base_val = self.derive_skill_value(skill_type, skill.ranks, skill.init, false);

                let (trained_cost, specialized_cost) = skill_table
                    .and_then(|t| t.skill_base_hash.get(&(skill_type as u32)))
                    .map(|b| (b.trained_cost as u32, b.specialized_cost as u32))
                    .unwrap_or((0, 0));

                let skill_obj = stats::Skill {
                    skill_type,
                    ranks: skill.ranks,
                    init: skill.init,
                    spent_xp: skill.xp,
                    next_rank_xp: xp_table.and_then(|t| {
                        t.get_next_skill_rank_xp(
                            skill.ranks,
                            training == stats::TrainingLevel::Specialized,
                        )
                    }),
                    base: base_val,
                    current: base_val,
                    training,
                    trained_cost,
                    specialized_cost,
                };
                self.skills.insert(skill_type, skill_obj);
            }
        }

        self.inventory.clear();
        for (item_guid, _) in &data.inventory {
            self.add_to_inventory(*item_guid);
        }

        self.equipment.clear();
        for (item_guid, slot, _) in &data.equipped_objects {
            if let Some(mask) = EquipMask::from_bits(*slot) {
                self.wield_item(*item_guid, mask);
            }
        }

        if let Some(pos) = data.pos {
            self.position = pos;
        }

        self.emit_derived_stats(events);
    }

    pub fn upsert_enchantment(
        &mut self,
        target: Guid,
        enchantment: Enchantment,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        if target != self.guid {
            return false;
        }

        if let Some(existing) = self
            .enchantments
            .iter_mut()
            .find(|e| e.spell_id == enchantment.spell_id && e.layer == enchantment.layer)
        {
            *existing = enchantment;
        } else {
            self.enchantments.push(enchantment);
        }

        self.emit_enchantments_updated(events);
        true
    }

    pub fn upsert_multiple_enchantments(
        &mut self,
        target: Guid,
        enchantments: &[Enchantment],
        events: &mut Vec<StateEvent>,
    ) -> bool {
        if target != self.guid {
            return false;
        }

        for enchantment in enchantments {
            if let Some(existing) = self
                .enchantments
                .iter_mut()
                .find(|e| e.spell_id == enchantment.spell_id && e.layer == enchantment.layer)
            {
                *existing = *enchantment;
            } else {
                self.enchantments.push(*enchantment);
            }
        }

        self.emit_enchantments_updated(events);
        true
    }

    pub fn remove_enchantment(
        &mut self,
        target: Guid,
        spell_id: u16,
        layer: u16,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        if target != self.guid {
            return false;
        }

        self.enchantments
            .retain(|e| e.spell_id != spell_id || e.layer != layer);
        self.emit_enchantments_updated(events);
        true
    }

    pub fn remove_multiple_enchantments(
        &mut self,
        target: Guid,
        spells: &[(u16, u16)],
        events: &mut Vec<StateEvent>,
    ) -> bool {
        if target != self.guid {
            return false;
        }

        for (spell_id, layer) in spells {
            self.enchantments
                .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
        }

        self.emit_enchantments_updated(events);
        true
    }

    pub fn purge_enchantments(
        &mut self,
        target: Guid,
        keep_bad: bool,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        if target != self.guid {
            return false;
        }

        self.enchantments.retain(|e| {
            let flags = EnchantmentTypeFlags::from_bits_truncate(e.stat_mod_type);
            if keep_bad {
                flags.contains(EnchantmentTypeFlags::BENEFICIAL)
                    || flags.contains(EnchantmentTypeFlags::VITAE)
            } else {
                flags.contains(EnchantmentTypeFlags::VITAE)
            }
        });

        self.emit_enchantments_updated(events);
        true
    }

    pub fn add_spell(&mut self, spell_id: u32, events: &mut Vec<StateEvent>) {
        self.spells.insert(spell_id, 0.0);
        events.push(StateEvent::SpellUpdated {
            spell_id,
            name: None,
        });
    }

    pub fn remove_spell(&mut self, spell_id: u32, events: &mut Vec<StateEvent>) {
        self.spells.remove(&spell_id);
        events.push(StateEvent::SpellRemoved { spell_id });
    }

    pub fn update_health_fraction(
        &mut self,
        target: Guid,
        health: f32,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        let target_guid = if target == Guid::NULL {
            self.guid
        } else {
            target
        };

        if target_guid != self.guid || target_guid == Guid::NULL {
            return false;
        }

        if let Some(vital_obj) = self.vitals.get_mut(&stats::VitalType::Health) {
            let new_current = (health * vital_obj.buffed_max as f32) as u32;
            vital_obj.current = new_current;
            events.push(StateEvent::VitalUpdated(vital_obj.clone()));
            true
        } else {
            false
        }
    }

    fn emit_enchantments_updated(&mut self, events: &mut Vec<StateEvent>) {
        events.push(StateEvent::PlayerEnchantmentsUpdated {
            enchantments: self.enchantments.clone(),
        });
        self.emit_derived_stats(events);
    }
}

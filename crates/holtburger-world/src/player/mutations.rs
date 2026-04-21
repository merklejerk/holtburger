use super::PlayerState;
use crate::WorldEvent;
use crate::player::types::{SkillBase, VitalBase};
use crate::stats;
use holtburger_common::Guid;
use holtburger_common::properties::EnchantmentTypeFlags;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::*;

pub struct SkillUpdateParams<'a> {
    pub skill_id: u32,
    pub ranks: u32,
    pub status: u32,
    pub init: u32,
    pub xp: u32,
    pub xp_table: &'a holtburger_dat::file_type::XpTable,
    pub skill_table: &'a holtburger_dat::file_type::SkillTable,
}

pub struct VitalUpdateParams<'a> {
    pub vital_id: u32,
    pub ranks: u32,
    pub start: u32,
    pub current: u32,
    pub xp: u32,
    pub xp_table: &'a holtburger_dat::file_type::XpTable,
}

impl PlayerState {
    fn current_spell_ids(&self) -> Vec<u32> {
        let mut spell_ids: Vec<u32> = self.spells.keys().cloned().collect();
        spell_ids.sort();
        spell_ids
    }

    /// Applies a server-authored attribute update and refreshes derived player stats.
    pub fn update_attribute(
        &mut self,
        attr_id: u32,
        ranks: u32,
        start: u32,
        xp: u32,
        xp_table: &holtburger_dat::file_type::XpTable,
        events: &mut Vec<WorldEvent>,
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
                next_rank_xp: xp_table.get_next_attribute_rank_xp(ranks),
                base,
                current,
            };

            self.attributes.insert(attr_type, attr_obj.clone());
            events.push(WorldEvent::AttributeUpdated(attr_obj));
        }
    }

    /// Applies a server-authored skill update and refreshes derived player stats.
    pub fn update_skill(&mut self, params: SkillUpdateParams, events: &mut Vec<WorldEvent>) {
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
                .skill_base_hash
                .get(&(skill_type as u32))
                .map(|b| (b.trained_cost as u32, b.specialized_cost as u32))
                .unwrap_or((0, 0));

            let skill_obj = stats::Skill {
                skill_type,
                ranks,
                init,
                spent_xp: xp,
                next_rank_xp: xp_table
                    .get_next_skill_rank_xp(ranks, training == stats::TrainingLevel::Specialized),
                base: base_val,
                current: current_val,
                training,
                trained_cost,
                specialized_cost,
            };

            self.skills.insert(skill_type, skill_obj.clone());
            events.push(WorldEvent::SkillUpdated(skill_obj));
        }
    }

    /// Applies a server-authored vital update and refreshes derived player stats.
    pub fn update_vital(&mut self, params: VitalUpdateParams, events: &mut Vec<WorldEvent>) {
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
                next_rank_xp: xp_table.get_next_vital_rank_xp(ranks),
                base: final_base,
                buffed_max,
                current,
            };
            self.vitals.insert(vital_type, vital_obj.clone());
            events.push(WorldEvent::VitalUpdated(vital_obj));
        }
    }

    /// Updates a vital's current pool without recalculating unrelated derived stats.
    pub fn update_vital_current(
        &mut self,
        vital_id: u32,
        current: u32,
        events: &mut Vec<WorldEvent>,
    ) {
        if let Some(vital_type) = stats::VitalType::from_id(vital_id)
            && let Some(vital_obj) = self.vitals.get_mut(&vital_type)
        {
            vital_obj.current = current;
            events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
        }
    }

    /// Updates the player entity's authoritative position sequencing and cached grounded
    /// state, then emits grounded or forced-reposition events when those outcomes change.
    pub fn update_position_from_server(
        &mut self,
        pos_pack: &PositionPack,
        events: &mut Vec<WorldEvent>,
    ) {
        let old_forced_seq = self.force_position_sequence;
        let old_grounded = self.last_server_grounded;

        self.instance_sequence = pos_pack.instance_sequence;
        self.position_sequence = pos_pack.position_sequence;
        self.teleport_sequence = pos_pack.teleport_sequence;
        self.force_position_sequence = pos_pack.force_position_sequence;
        let is_grounded = pos_pack.flags.contains(UpdatePositionFlag::IS_GROUNDED);
        self.last_server_grounded = Some(is_grounded);

        if old_grounded != Some(is_grounded) {
            events.push(WorldEvent::PlayerGroundedUpdated {
                grounded: is_grounded,
            });
        }

        if is_newer_u16(self.force_position_sequence, old_forced_seq) {
            events.push(WorldEvent::ForcedReposition {
                guid: self.guid,
                pos: pos_pack.pos,
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

    /// Applies a server-authored player position update only when its teleport and
    /// force-position sequencing is still current.
    pub fn apply_position_from_server(
        &mut self,
        pos_pack: &PositionPack,
        events: &mut Vec<WorldEvent>,
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

    /// Returns whether a self non-autonomous `UpdateMotion` packet is current.
    ///
    /// ACE increments `server_control_sequence` for non-autonomous `UpdateMotion`, so older or
    /// duplicate epochs must not be re-applied or forwarded into the client heartbeat path.
    pub fn should_accept_server_controlled_motion(&self, server_control_sequence: u16) -> bool {
        if server_control_sequence == self.server_control_sequence {
            return false;
        }

        !is_newer_u16(self.server_control_sequence, server_control_sequence)
    }

    /// Applies self `UpdateMotion` sequencing and cached server style only when the packet is
    /// current.
    pub fn apply_self_update_motion(&mut self, data: &MovementEventData) -> bool {
        if !data.is_autonomous
            && !self.should_accept_server_controlled_motion(data.server_control_sequence)
        {
            return false;
        }

        self.update_motion_sequences(
            data.object_instance_sequence,
            data.server_control_sequence,
            data.movement_sequence,
        );
        self.update_last_server_motion_style(data.current_style);
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
        xp_table: &holtburger_dat::file_type::XpTable,
        skill_table: &holtburger_dat::file_type::SkillTable,
        _events: &mut Vec<WorldEvent>,
    ) {
        self.guid = data.guid;
        self.enchantments = data.enchantments.clone();

        self.spells = data.spells.clone();
        self.options1 = data.options1;
        self.options2 = data.options2;
        self.hotbar_spells = data.hotbar_spells.clone();
        self.desired_comps = data.desired_comps.clone();
        self.spellbook_filters = data.spellbook_filters;
        self.gameplay_options = data.gameplay_options.clone();

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
                        next_rank_xp: xp_table.get_next_attribute_rank_xp(ranks),
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
                    next_rank_xp: xp_table.get_next_vital_rank_xp(ranks),
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
                    .skill_base_hash
                    .get(&(skill_type as u32))
                    .map(|b| (b.trained_cost as u32, b.specialized_cost as u32))
                    .unwrap_or((0, 0));

                let skill_obj = stats::Skill {
                    skill_type,
                    ranks: skill.ranks,
                    init: skill.init,
                    spent_xp: skill.xp,
                    next_rank_xp: xp_table.get_next_skill_rank_xp(
                        skill.ranks,
                        training == stats::TrainingLevel::Specialized,
                    ),
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
    }

    pub fn upsert_enchantment(
        &mut self,
        target: Guid,
        enchantment: Enchantment,
        events: &mut Vec<WorldEvent>,
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
        events: &mut Vec<WorldEvent>,
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
        events: &mut Vec<WorldEvent>,
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
        events: &mut Vec<WorldEvent>,
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
        events: &mut Vec<WorldEvent>,
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

    pub fn add_spell(&mut self, spell_id: u32, events: &mut Vec<WorldEvent>) {
        self.spells.insert(spell_id, 0.0);
        events.push(WorldEvent::SpellUpdated {
            spell_id,
            name: None,
            spell_ids: self.current_spell_ids(),
        });
    }

    pub fn remove_spell(&mut self, spell_id: u32, events: &mut Vec<WorldEvent>) {
        self.spells.remove(&spell_id);
        events.push(WorldEvent::SpellRemoved {
            spell_id,
            spell_ids: self.current_spell_ids(),
        });
    }

    fn emit_enchantments_updated(&mut self, events: &mut Vec<WorldEvent>) {
        events.push(WorldEvent::PlayerEnchantmentsUpdated {
            enchantments: self.enchantments.clone(),
        });
    }
}

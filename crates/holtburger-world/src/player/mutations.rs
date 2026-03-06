use super::PlayerState;
use crate::stats;
use crate::player::types::{SkillBase, VitalBase};
use crate::StateEvent;

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
    pub fn update_skill(
        &mut self,
        skill_id: u32,
        ranks: u32,
        status: u32,
        init: u32,
        xp: u32,
        xp_table: Option<&holtburger_dat::file_type::XpTable>,
        skill_table: Option<&holtburger_dat::file_type::SkillTable>,
        events: &mut Vec<StateEvent>,
    ) {
        if let Some(skill_type) = stats::SkillType::from_repr(skill_id) {
            let training = match status {
                1 => stats::TrainingLevel::Untrained,
                2 => stats::TrainingLevel::Trained,
                3 => stats::TrainingLevel::Specialized,
                _ => stats::TrainingLevel::Unusable,
            };

            self.skill_bases.insert(
                skill_type,
                SkillBase {
                    ranks,
                    init,
                },
            );

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
                    t.get_next_skill_rank_xp(
                        ranks,
                        training == stats::TrainingLevel::Specialized,
                    )
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
    pub fn update_vital(
        &mut self,
        vital_id: u32,
        ranks: u32,
        start: u32,
        current: u32,
        xp: u32,
        xp_table: Option<&holtburger_dat::file_type::XpTable>,
        events: &mut Vec<StateEvent>,
    ) {
        if let Some(vital_type) = stats::VitalType::from_id(vital_id) {
            self.vital_bases.insert(
                vital_type,
                VitalBase {
                    ranks,
                    start,
                },
            );

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
        pos: holtburger_common::position::WorldPosition,
        instance_seq: u16,
        pos_seq: u16,
        teleport_seq: u16,
        force_seq: u16,
        events: &mut Vec<StateEvent>,
    ) {
        use holtburger_common::sequence::is_newer_u16;
        let old_forced_seq = self.force_position_sequence;

        self.position = pos;
        self.instance_sequence = instance_seq;
        self.position_sequence = pos_seq;
        self.teleport_sequence = teleport_seq;
        self.force_position_sequence = force_seq;

        if is_newer_u16(self.force_position_sequence, old_forced_seq) {
            events.push(StateEvent::ForcedReposition {
                guid: self.guid,
                pos: self.position,
                sequence: self.force_position_sequence,
            });
        }
    }
}

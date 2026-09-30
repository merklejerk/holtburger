//! Character advancement quotes derived from authoritative player state and portal XP tables.

use crate::WorldState;
use crate::stats::{AttributeType, SkillType, TrainingLevel, VitalType};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

/// Decimal transport for character XP totals that may exceed JS's exact integer range.
pub mod decimal_u64 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
    }
}

/// A single server-owned attribute, vital, or skill that can gain ranks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StatTarget {
    Attribute(AttributeType),
    Vital(VitalType),
    Skill(SkillType),
}

/// The player's requested advancement, independent of frontend button layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ProgressionIntent {
    Raise { target: StatTarget, ranks: u32 },
    RaiseMax { target: StatTarget },
    Train { skill: SkillType },
}

impl ProgressionIntent {
    pub const fn target(self) -> StatTarget {
        match self {
            Self::Raise { target, .. } | Self::RaiseMax { target } => target,
            Self::Train { skill } => StatTarget::Skill(skill),
        }
    }
}

/// Authoritative target fields that must still match when a quote is submitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressionTargetState {
    pub training: Option<TrainingLevel>,
    pub ranks: u32,
    pub spent_xp: u32,
}

/// One exact server-wire spend and the facts from which it was calculated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressionQuote {
    /// Character whose authoritative target and balance produced the quote.
    pub character: Guid,
    pub intent: ProgressionIntent,
    pub target_state: ProgressionTargetState,
    pub resulting_ranks: u32,
    pub xp_spent: u32,
    pub credits_spent: u32,
    #[serde(with = "decimal_u64")]
    pub available_xp: u64,
    pub available_credits: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProgressionUnavailable {
    CharacterUnavailable,
    TargetUnavailable,
    NotTrainable,
    AlreadyTrained,
    SkillNotTrained,
    InvalidRankCount,
    RankCap,
    InsufficientXp {
        required: u32,
        #[serde(with = "decimal_u64")]
        available: u64,
    },
    InsufficientCredits {
        required: u32,
        available: u32,
    },
    InconsistentExperience,
}

impl WorldState {
    /// The server-owned fields that release a pending submission when they change.
    pub fn progression_target_state(&self, target: StatTarget) -> Option<ProgressionTargetState> {
        if self.player.guid == Guid::NULL {
            None
        } else {
            self.progression_target(target).map(|(state, _)| state)
        }
    }

    fn progression_target(&self, target: StatTarget) -> Option<(ProgressionTargetState, &[u32])> {
        match target {
            StatTarget::Attribute(attribute) => {
                let stat = self.player.attributes.get(&attribute)?;
                Some((
                    ProgressionTargetState {
                        training: None,
                        ranks: stat.ranks,
                        spent_xp: stat.spent_xp,
                    },
                    self.xp_table.attribute_xp_list.as_slice(),
                ))
            }
            StatTarget::Vital(vital) => {
                let stat = self.player.vitals.get(&vital)?;
                Some((
                    ProgressionTargetState {
                        training: None,
                        ranks: stat.ranks,
                        spent_xp: stat.spent_xp,
                    },
                    self.xp_table.vital_xp_list.as_slice(),
                ))
            }
            StatTarget::Skill(skill) => {
                let stat = self.player.skills.get(&skill)?;
                let thresholds = if stat.training == TrainingLevel::Specialized {
                    self.xp_table.specialized_skill_xp_list.as_slice()
                } else {
                    self.xp_table.trained_skill_xp_list.as_slice()
                };
                Some((
                    ProgressionTargetState {
                        training: Some(stat.training),
                        ranks: stat.ranks,
                        spent_xp: stat.spent_xp,
                    },
                    thresholds,
                ))
            }
        }
    }

    /// Quote a purchase from current world facts; no balance or stat is reserved here.
    pub fn evaluate_progression(
        &self,
        intent: ProgressionIntent,
    ) -> Result<ProgressionQuote, ProgressionUnavailable> {
        use ProgressionUnavailable as Unavailable;

        if self.player.guid == Guid::NULL {
            return Err(Unavailable::CharacterUnavailable);
        }

        let target = intent.target();
        let (target_state, thresholds) = self
            .progression_target(target)
            .ok_or(Unavailable::TargetUnavailable)?;

        let level = self.get_level_info();
        let mut quote = ProgressionQuote {
            character: self.player.guid,
            intent,
            target_state,
            resulting_ranks: target_state.ranks,
            xp_spent: 0,
            credits_spent: 0,
            available_xp: level.unspent_xp,
            available_credits: level.unspent_skill_points,
        };

        match intent {
            ProgressionIntent::Train { skill } => {
                if target_state.training == Some(TrainingLevel::Unusable) {
                    return Err(Unavailable::NotTrainable);
                }
                if target_state.training != Some(TrainingLevel::Untrained) {
                    return Err(Unavailable::AlreadyTrained);
                }
                let definition = self
                    .skill_table
                    .skill_base_hash
                    .get(&(skill as u32))
                    .ok_or(Unavailable::NotTrainable)?;
                let cost = u32::try_from(definition.trained_cost)
                    .map_err(|_| Unavailable::NotTrainable)?;
                if level.unspent_skill_points < cost {
                    return Err(Unavailable::InsufficientCredits {
                        required: cost,
                        available: level.unspent_skill_points,
                    });
                }
                quote.credits_spent = cost;
                // ACE TrainSkill resets an untrained skill's invested ranks before applying
                // augmentation-specific post-training behavior.
                quote.resulting_ranks = 0;
            }
            ProgressionIntent::Raise { .. } | ProgressionIntent::RaiseMax { .. } => {
                if target_state.training.is_some_and(|training| {
                    !matches!(
                        training,
                        TrainingLevel::Trained | TrainingLevel::Specialized
                    )
                }) {
                    return Err(Unavailable::SkillNotTrained);
                }
                if matches!(intent, ProgressionIntent::Raise { ranks: 0, .. }) {
                    return Err(Unavailable::InvalidRankCount);
                }
                let next_rank = target_state
                    .ranks
                    .checked_add(1)
                    .ok_or(Unavailable::RankCap)?;
                let next_index = usize::try_from(next_rank).map_err(|_| Unavailable::RankCap)?;
                let next_threshold = thresholds.get(next_index).ok_or(Unavailable::RankCap)?;
                if *next_threshold <= target_state.spent_xp {
                    return Err(Unavailable::InconsistentExperience);
                }

                let target_rank = match intent {
                    ProgressionIntent::Raise { ranks, .. } => target_state
                        .ranks
                        .checked_add(ranks)
                        .ok_or(Unavailable::RankCap)?,
                    ProgressionIntent::RaiseMax { .. } => thresholds
                        .iter()
                        .enumerate()
                        .skip(next_index)
                        .take_while(|(_, threshold)| {
                            threshold
                                .checked_sub(target_state.spent_xp)
                                .is_some_and(|spend| u64::from(spend) <= level.unspent_xp)
                        })
                        .last()
                        .map(|(rank, _)| rank as u32)
                        .ok_or(Unavailable::InsufficientXp {
                            required: next_threshold - target_state.spent_xp,
                            available: level.unspent_xp,
                        })?,
                    ProgressionIntent::Train { .. } => unreachable!(),
                };
                let target_index =
                    usize::try_from(target_rank).map_err(|_| Unavailable::RankCap)?;
                let threshold = thresholds.get(target_index).ok_or(Unavailable::RankCap)?;
                let spend = threshold
                    .checked_sub(target_state.spent_xp)
                    .ok_or(Unavailable::InconsistentExperience)?;
                if spend == 0 {
                    return Err(Unavailable::InconsistentExperience);
                }
                if u64::from(spend) > level.unspent_xp {
                    return Err(Unavailable::InsufficientXp {
                        required: spend,
                        available: level.unspent_xp,
                    });
                }
                quote.resulting_ranks = target_rank;
                quote.xp_spent = spend;
            }
        }
        Ok(quote)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::{Attribute, Skill};
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PropertyInt, PropertyInt64, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_dat::file_type::XpTable;
    use holtburger_dat::file_type::skill_table::{SkillBase, SkillFormula, SkillTable};
    use std::sync::Arc;

    fn world_with_xp(xp: u64) -> WorldState {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(Guid(0x5000_0001), "Progression", WorldPosition::default());
        world
            .player_entity_mut()
            .expect("seeded player")
            .properties
            .set_int64_prop(PropertyInt64::AvailableExperience, xp as i64);
        world.xp_table = Arc::new(XpTable {
            attribute_xp_list: vec![0, 100, 300, 600, 1000],
            trained_skill_xp_list: vec![0, 100, 300, 600],
            specialized_skill_xp_list: vec![0, 50, 150, 300],
            ..XpTable::default()
        });
        world.player.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 1,
                start: 10,
                spent_xp: 125,
                next_rank_xp: Some(300),
                base: 11,
                current: 11,
                breakdown: Default::default(),
            },
        );
        world.player.skills.insert(
            SkillType::MeleeDefense,
            Skill {
                skill_type: SkillType::MeleeDefense,
                ranks: 1,
                init: 0,
                spent_xp: 100,
                next_rank_xp: Some(300),
                base: 1,
                current: 1,
                training: TrainingLevel::Trained,
                trained_cost: 10,
                specialized_cost: 20,
                breakdown: Default::default(),
            },
        );
        world
    }

    #[test]
    fn quotes_exact_rank_cost_from_cumulative_xp() {
        let world = world_with_xp(475);
        let target = StatTarget::Attribute(AttributeType::StrengthAttr);
        let one = world
            .evaluate_progression(ProgressionIntent::Raise { target, ranks: 1 })
            .unwrap();
        assert_eq!((one.resulting_ranks, one.xp_spent), (2, 175));
        let two = world
            .evaluate_progression(ProgressionIntent::Raise { target, ranks: 2 })
            .unwrap();
        assert_eq!((two.resulting_ranks, two.xp_spent), (3, 475));
        let max = world
            .evaluate_progression(ProgressionIntent::RaiseMax { target })
            .unwrap();
        assert_eq!((max.resulting_ranks, max.xp_spent), (3, 475));
    }

    #[test]
    fn exact_rank_request_does_not_shrink_when_unaffordable() {
        let world = world_with_xp(200);
        let target = StatTarget::Attribute(AttributeType::StrengthAttr);
        assert_eq!(
            world.evaluate_progression(ProgressionIntent::Raise { target, ranks: 2 }),
            Err(ProgressionUnavailable::InsufficientXp {
                required: 475,
                available: 200,
            })
        );
        assert_eq!(
            world
                .evaluate_progression(ProgressionIntent::RaiseMax { target })
                .unwrap()
                .resulting_ranks,
            2
        );
    }

    #[test]
    fn capped_target_never_produces_a_zero_spend_or_an_extra_rank() {
        let mut world = world_with_xp(500);
        let target = StatTarget::Attribute(AttributeType::StrengthAttr);
        let attribute = world
            .player
            .attributes
            .get_mut(&AttributeType::StrengthAttr)
            .unwrap();
        attribute.ranks = 4;
        attribute.spent_xp = 1000;
        for intent in [
            ProgressionIntent::Raise { target, ranks: 1 },
            ProgressionIntent::RaiseMax { target },
        ] {
            assert_eq!(
                world.evaluate_progression(intent),
                Err(ProgressionUnavailable::RankCap)
            );
        }
    }

    #[test]
    fn specialized_skill_uses_its_own_curve() {
        let mut world = world_with_xp(500);
        let skill = world
            .player
            .skills
            .get_mut(&SkillType::MeleeDefense)
            .unwrap();
        skill.training = TrainingLevel::Specialized;
        skill.spent_xp = 50;
        let quote = world
            .evaluate_progression(ProgressionIntent::Raise {
                target: StatTarget::Skill(SkillType::MeleeDefense),
                ranks: 1,
            })
            .unwrap();
        assert_eq!((quote.resulting_ranks, quote.xp_spent), (2, 100));
    }

    #[test]
    fn rejects_inconsistent_target_and_zero_ranks() {
        let mut world = world_with_xp(1000);
        let target = StatTarget::Attribute(AttributeType::StrengthAttr);
        assert_eq!(
            world.evaluate_progression(ProgressionIntent::Raise { target, ranks: 0 }),
            Err(ProgressionUnavailable::InvalidRankCount)
        );
        world
            .player
            .attributes
            .get_mut(&AttributeType::StrengthAttr)
            .unwrap()
            .spent_xp = 300;
        assert_eq!(
            world.evaluate_progression(ProgressionIntent::RaiseMax { target }),
            Err(ProgressionUnavailable::InconsistentExperience)
        );
    }

    #[test]
    fn training_uses_the_authored_credit_cost() {
        let mut world = world_with_xp(0);
        world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_int_prop(PropertyInt::AvailableSkillCredits, 8);
        world
            .player
            .skills
            .get_mut(&SkillType::MeleeDefense)
            .unwrap()
            .training = TrainingLevel::Untrained;
        world.skill_table = Arc::new(SkillTable {
            id: SkillTable::FILE_ID,
            skill_base_hash: [(
                SkillType::MeleeDefense as u32,
                SkillBase {
                    description: String::new(),
                    name: "Melee Defense".into(),
                    icon_id: 0,
                    trained_cost: 8,
                    specialized_cost: 16,
                    category: 0,
                    chargen_use: 0,
                    min_level: 1,
                    formula: SkillFormula {
                        w: 0,
                        x: 1,
                        y: 1,
                        z: 3,
                        attr1: AttributeType::QuicknessAttr as u32,
                        attr2: AttributeType::CoordinationAttr as u32,
                    },
                    upper_bound: 0.0,
                    lower_bound: 0.0,
                    learn_mod: 0.0,
                    _align1: (),
                    _align2: (),
                },
            )]
            .into(),
        });
        let quote = world
            .evaluate_progression(ProgressionIntent::Train {
                skill: SkillType::MeleeDefense,
            })
            .unwrap();
        assert_eq!(quote.credits_spent, 8);
        assert_eq!(quote.resulting_ranks, 0);
        world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_int_prop(PropertyInt::AvailableSkillCredits, 7);
        assert_eq!(
            world.evaluate_progression(quote.intent),
            Err(ProgressionUnavailable::InsufficientCredits {
                required: 8,
                available: 7,
            })
        );

        let definition = Arc::get_mut(&mut world.skill_table)
            .unwrap()
            .skill_base_hash
            .get_mut(&(SkillType::MeleeDefense as u32))
            .unwrap();
        definition.trained_cost = 0;
        let free = world.evaluate_progression(quote.intent).unwrap();
        assert_eq!(free.credits_spent, 0);

        Arc::get_mut(&mut world.skill_table)
            .unwrap()
            .skill_base_hash
            .get_mut(&(SkillType::MeleeDefense as u32))
            .unwrap()
            .trained_cost = -1;
        assert_eq!(
            world.evaluate_progression(quote.intent),
            Err(ProgressionUnavailable::NotTrainable)
        );
    }
}

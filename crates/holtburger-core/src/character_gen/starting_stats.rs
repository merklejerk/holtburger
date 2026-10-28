//! Normal creation seeds applied to the existing world stat calculator.

use super::{
    CharacterGenBuilder, CharacterGenHeritageBenefits, CharacterGenInnateAugmentation,
    character_gen_heritage_benefits, minimum_skill_advancement_for_heritage,
};
use anyhow::{Context, Result, ensure};
use holtburger_common::stats::AttributeType::{
    CoordinationAttr, EnduranceAttr, FocusAttr, QuicknessAttr, SelfAttr, StrengthAttr,
};
use holtburger_common::stats::{AttributeType, SkillType, TrainingLevel, VitalType};
use holtburger_content::character_gen::is_unavailable_character_gen_skill_cost;
use holtburger_dat::file_type::{SecondaryAttributeTable, SkillTable};
use holtburger_protocol::messages::SkillAdvancementClass;
use holtburger_world::player::PlayerState;
use holtburger_world::player::stats_calc::{SkillAugmentations, SkillCalculationContext};
use holtburger_world::stat_breakdown::SkillFormulaBreakdown;

/// Creation-trained skills receive five ranks, not the specialized initial-level bonus.
/// ACE Player_Skills.cs:TrainSkill(applyCreationBonusXP: true).
pub const CREATION_TRAINED_RANKS: u32 = 5;
/// ACE Player_Skills.cs:SpecializeSkill resets ranks and sets InitLevel to ten.
pub const CREATION_SPECIALIZED_INITIAL_LEVEL: u32 = 10;

/// A skill's effective starting value and whether the character can actually use it.
#[derive(Debug, PartialEq, Eq)]
pub struct StartingSkill {
    /// Stable game skill identity.
    pub skill: SkillType,
    /// Includes creation advancement and applicable innate augmentation effects.
    pub value: u32,
    /// A bonus can produce a nonzero value even when a skill is unusable.
    pub usable: bool,
}

/// Numerical starting build for normal creation, or the explicit server-defined Olthoi path.
#[derive(Debug, PartialEq, Eq)]
pub enum StartingStats {
    /// Both Olthoi variants bypass normal allocation in ACE PlayerFactory.Create.
    Olthoi,
    /// Unenchanted, unequipped starting pools and skills; no purchased progression.
    Standard {
        /// Full starting pools, in Health, Stamina, Mana order.
        vitals: [u32; 3],
        /// Every active creation skill, in stable skill-ID order.
        skills: Vec<StartingSkill>,
    },
}

impl CharacterGenBuilder {
    /// Preview a legal editable allocation without requiring a name, appearance, or exact spend.
    /// Normal ACE human template (WCID 1) has zero vital InitLevel/ranks and no skill records;
    /// PlayerFactory replaces primary attributes and initializes every submitted active skill.
    pub fn starting_stats(
        &self,
        heritage_id: u32,
        attributes: [u32; 6],
        advancements: &[SkillAdvancementClass],
        skill_table: &SkillTable,
        vital_table: &SecondaryAttributeTable,
    ) -> Result<StartingStats> {
        let heritage = self
            .catalog
            .heritage_group(heritage_id)
            .with_context(|| format!("Unknown creation heritage {heritage_id}"))?;
        let benefits = character_gen_heritage_benefits(heritage_id)
            .with_context(|| format!("No starting rules for heritage {heritage_id}"))?;
        let CharacterGenHeritageBenefits::Standard {
            innate_augmentation,
            ..
        } = benefits
        else {
            return Ok(StartingStats::Olthoi);
        };
        let mut errors = Vec::new();
        Self::validate_attributes(&attributes, heritage.attribute_credits, false, &mut errors);
        self.validate_skills(heritage_id, advancements, heritage, &mut errors);
        ensure!(
            errors.is_empty(),
            "Invalid starting allocation: {}",
            errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ")
        );

        let attribute_types = [
            StrengthAttr,
            EnduranceAttr,
            CoordinationAttr,
            QuicknessAttr,
            FocusAttr,
            SelfAttr,
        ];
        let player = PlayerState::from_base_attributes(attribute_types.into_iter().zip(attributes));
        let context = SkillCalculationContext {
            table: skill_table,
            augmentations: SkillAugmentations {
                jack_of_all_trades: u32::from(
                    innate_augmentation == CharacterGenInnateAugmentation::JackOfAllTrades,
                ),
                ..SkillAugmentations::default()
            },
            vitae: 1.0,
        };
        let mut skills = Vec::new();
        for (id, advancement) in advancements.iter().copied().enumerate() {
            let id = u32::try_from(id).context("Creation skill ID overflow")?;
            let minimum = minimum_skill_advancement_for_heritage(&self.catalog, heritage_id, id);
            ensure!(
                (advancement as u32) >= minimum as u32,
                "Skill {id} is below its required starting advancement"
            );
            if advancement == SkillAdvancementClass::Inactive {
                continue;
            }
            let costs = self
                .catalog
                .skill_costs_for_heritage(heritage_id, id)
                .with_context(|| format!("Missing creation costs for skill {id}"))?;
            ensure!(
                advancement == SkillAdvancementClass::Untrained
                    || !is_unavailable_character_gen_skill_cost(costs.trained_cost),
                "Training is unavailable for skill {id}"
            );
            ensure!(
                advancement != SkillAdvancementClass::Specialized
                    || !is_unavailable_character_gen_skill_cost(costs.specialization_upgrade_cost),
                "Specialization is unavailable for skill {id}"
            );
            let skill =
                SkillType::from_repr(id).with_context(|| format!("Unknown creation skill {id}"))?;
            let definition = skill_table
                .skill_base_hash
                .get(&id)
                .with_context(|| format!("Missing stat definition for skill {id}"))?;
            validate_formula(&definition.formula)?;
            let (training, ranks, init) = match advancement {
                SkillAdvancementClass::Untrained => (TrainingLevel::Untrained, 0, 0),
                SkillAdvancementClass::Trained => {
                    (TrainingLevel::Trained, CREATION_TRAINED_RANKS, 0)
                }
                SkillAdvancementClass::Specialized => (
                    TrainingLevel::Specialized,
                    0,
                    CREATION_SPECIALIZED_INITIAL_LEVEL,
                ),
                SkillAdvancementClass::Inactive => unreachable!(),
            };
            let (_, value, breakdown) =
                player.evaluate_skill(skill, ranks, init, training, context);
            skills.push(StartingSkill {
                skill,
                value,
                usable: !matches!(breakdown.formula, SkillFormulaBreakdown::Unusable),
            });
        }
        for formula in [
            &vital_table.max_health,
            &vital_table.max_stamina,
            &vital_table.max_mana,
        ] {
            validate_formula(formula)?;
        }
        let vitals = [VitalType::Health, VitalType::Stamina, VitalType::Mana]
            .map(|vital| player.calculate_vital_base(vital, vital_table));
        Ok(StartingStats::Standard { vitals, skills })
    }
}

/// The world calculator trusts parsed formula inputs; reject malformed static content at this boundary.
fn validate_formula(formula: &holtburger_dat::file_type::skill_table::SkillFormula) -> Result<()> {
    if formula.x == 0 {
        return Ok(());
    }
    ensure!(formula.z != 0, "Starting-stat formula has a zero divisor");
    ensure!(
        AttributeType::from_repr(formula.attr1).is_some(),
        "Starting-stat formula has unknown first attribute {}",
        formula.attr1
    );
    ensure!(
        formula.attr2 == 0 || AttributeType::from_repr(formula.attr2).is_some(),
        "Starting-stat formula has unknown second attribute {}",
        formula.attr2
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::character_gen::CharacterGenSkillDefinition;
    use holtburger_dat::file_type::skill_table::{SkillBase, SkillFormula};
    use std::sync::Arc;

    fn fixture() -> (CharacterGenBuilder, SkillTable, Vec<SkillAdvancementClass>) {
        let mut catalog = super::super::tests::test_catalog();
        let catalog_mut = Arc::make_mut(&mut catalog);
        let mut heritage = catalog_mut.heritage_groups[&6].clone();
        heritage.skill_overrides.clear();
        for template in &mut heritage.templates {
            template.normal_skills.clear();
            template.primary_skills.clear();
        }
        for id in [1, 6, 12, 13] {
            heritage.heritage_id = id;
            catalog_mut.heritage_groups.insert(id, heritage.clone());
        }
        catalog_mut.skill_definitions.clear();
        let mut table = SkillTable::default();
        for (skill, attr1, attr2, divisor, min_level) in [
            (
                SkillType::MeleeDefense,
                QuicknessAttr,
                CoordinationAttr as u32,
                3,
                1,
            ),
            (SkillType::MissileDefense, SelfAttr, 0, 2, 2),
            (SkillType::ArcaneLore, FocusAttr, 0, 1, 2),
        ] {
            let id = skill as u32;
            let formula = SkillFormula {
                w: 0,
                x: u32::from(skill != SkillType::ArcaneLore),
                y: 1,
                z: divisor,
                attr1: attr1 as u32,
                attr2,
            };
            catalog_mut.skill_definitions.insert(
                id,
                CharacterGenSkillDefinition {
                    skill_id: id,
                    skill_type: Some(skill),
                    name: skill.to_string(),
                    description: String::new(),
                    formula: (formula.x != 0).then(|| formula.clone()),
                    available_at_creation: true,
                    trained_cost: 1,
                    specialization_total_cost: 2,
                },
            );
            table.skill_base_hash.insert(
                id,
                SkillBase {
                    name: skill.to_string(),
                    description: String::new(),
                    _align1: (),
                    _align2: (),
                    icon_id: 0,
                    trained_cost: 1,
                    specialized_cost: 2,
                    category: 0,
                    chargen_use: 1,
                    min_level,
                    formula,
                    upper_bound: 0.0,
                    lower_bound: 0.0,
                    learn_mod: 0.0,
                },
            );
        }
        catalog_mut.expected_skill_slots = SkillType::ArcaneLore as usize + 1;
        let mut tiers = vec![SkillAdvancementClass::Inactive; catalog_mut.expected_skill_slots];
        for id in catalog_mut.skill_definitions.keys() {
            tiers[*id as usize] = SkillAdvancementClass::Untrained;
        }
        (CharacterGenBuilder::new(catalog), table, tiers)
    }

    #[test]
    fn starting_values_include_rounding_advancement_and_racial_current_bonus() {
        let (builder, table, mut tiers) = fixture();
        tiers[SkillType::MeleeDefense as usize] = SkillAdvancementClass::Trained;
        tiers[SkillType::MissileDefense as usize] = SkillAdvancementClass::Specialized;
        tiers[SkillType::ArcaneLore as usize] = SkillAdvancementClass::Trained;
        for (heritage, racial_bonus) in [(6, 0), (1, 5)] {
            let StartingStats::Standard { vitals, skills } = builder
                .starting_stats(
                    heritage,
                    [55; 6],
                    &tiers,
                    &table,
                    &SecondaryAttributeTable::synthetic(),
                )
                .unwrap()
            else {
                panic!("normal race");
            };
            assert_eq!(vitals, [28, 55, 55]);
            assert_eq!(
                skills,
                vec![
                    StartingSkill {
                        skill: SkillType::MeleeDefense,
                        value: 37 + CREATION_TRAINED_RANKS + racial_bonus,
                        usable: true
                    },
                    StartingSkill {
                        skill: SkillType::MissileDefense,
                        value: 28 + CREATION_SPECIALIZED_INITIAL_LEVEL + racial_bonus,
                        usable: true
                    },
                    StartingSkill {
                        skill: SkillType::ArcaneLore,
                        value: CREATION_TRAINED_RANKS + racial_bonus,
                        usable: true
                    },
                ]
            );
        }
        let mut build = super::super::tests::test_build();
        build.skill_advancement_classes = tiers;
        [
            build.strength_ability,
            build.endurance_ability,
            build.coordination_ability,
            build.quickness_ability,
            build.focus_ability,
            build.self_ability,
        ] = [55; 6];
        assert!(builder.build_request(build).is_ok());
    }

    #[test]
    fn incomplete_allocation_and_untrained_usability_are_independent_of_nonzero_bonuses() {
        let (builder, table, tiers) = fixture();
        let StartingStats::Standard { vitals, skills } = builder
            .starting_stats(
                1,
                [10; 6],
                &tiers,
                &table,
                &SecondaryAttributeTable::synthetic(),
            )
            .unwrap()
        else {
            panic!("normal race");
        };
        assert_eq!(vitals, [5, 10, 10]);
        assert_eq!(skills[0].value, 12);
        assert!(skills[0].usable);
        assert_eq!(skills[1].value, 5);
        assert!(!skills[1].usable);
        assert_eq!(skills[2].value, 5);
        assert!(!skills[2].usable);
    }

    #[test]
    fn both_olthoi_variants_are_explicitly_excluded() {
        let (builder, table, _) = fixture();
        for heritage in [12, 13] {
            assert_eq!(
                builder
                    .starting_stats(
                        heritage,
                        [0; 6],
                        &[],
                        &table,
                        &SecondaryAttributeTable::synthetic()
                    )
                    .unwrap(),
                StartingStats::Olthoi
            );
        }
    }

    #[test]
    fn shared_browser_fixture_matches_starting_skill_tiers_and_vital_pools() {
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/character_creation_starting_stats.json"
        ))
        .unwrap();
        let attributes: [u32; 6] = serde_json::from_value(expected["attributes"].clone()).unwrap();
        let heritage: u32 = serde_json::from_value(expected["heritage"].clone()).unwrap();
        let (builder, table, mut tiers) = fixture();
        for (tier, field) in [
            (SkillAdvancementClass::Untrained, "untrained"),
            (SkillAdvancementClass::Trained, "trained"),
            (SkillAdvancementClass::Specialized, "specialized"),
        ] {
            tiers[SkillType::MeleeDefense as usize] = tier;
            let StartingStats::Standard { vitals, skills } = builder
                .starting_stats(
                    heritage,
                    attributes,
                    &tiers,
                    &table,
                    &SecondaryAttributeTable::synthetic(),
                )
                .unwrap()
            else {
                panic!("normal race");
            };
            assert_eq!(serde_json::json!(vitals), expected["vitals"]);
            let skill = skills
                .iter()
                .find(|skill| skill.skill == SkillType::MeleeDefense)
                .unwrap();
            assert_eq!(serde_json::json!(skill.value), expected["skill"][field]);
            assert!(skill.usable);
        }
    }

    #[test]
    fn rejects_invalid_inputs_and_malformed_static_formulas() {
        let (builder, mut table, mut tiers) = fixture();
        let vitals = SecondaryAttributeTable::synthetic();
        assert!(
            builder
                .starting_stats(99, [10; 6], &tiers, &table, &vitals)
                .is_err()
        );
        assert!(
            builder
                .starting_stats(1, [u32::MAX; 6], &tiers, &table, &vitals)
                .is_err()
        );
        assert!(
            builder
                .starting_stats(1, [10; 6], &[], &table, &vitals)
                .is_err()
        );
        tiers[SkillType::MeleeDefense as usize] = SkillAdvancementClass::Inactive;
        assert!(
            builder
                .starting_stats(1, [10; 6], &tiers, &table, &vitals)
                .unwrap_err()
                .to_string()
                .contains("required starting advancement")
        );
        tiers[SkillType::MeleeDefense as usize] = SkillAdvancementClass::Untrained;
        table
            .skill_base_hash
            .get_mut(&(SkillType::MeleeDefense as u32))
            .unwrap()
            .formula
            .z = 0;
        assert!(
            builder
                .starting_stats(1, [10; 6], &tiers, &table, &vitals)
                .unwrap_err()
                .to_string()
                .contains("zero divisor")
        );
    }
}

use holtburger_common::properties::WeaponType;
use holtburger_content::CharacterGenCatalog;
use holtburger_content::character_gen::{
    CharacterGenHeritageGroup, CharacterGenSkillCosts, CharacterGenTemplate,
};
use holtburger_protocol::messages::{
    CharacterCreateAppearanceData, CharacterCreateRequestData, SkillAdvancementClass,
};
use rand::RngExt;
use std::collections::BTreeSet;
use std::sync::Arc;
use thiserror::Error;

pub mod starting_stats;

pub const CHARACTER_GEN_UNKNOWN_CONSTANT: u32 = 1;
pub const CHARACTER_GEN_DEFAULT_CLASS_ID: u32 = 1;
pub const CHARACTER_GEN_MIN_ATTRIBUTE: u32 = 10;
pub const CHARACTER_GEN_MAX_ATTRIBUTE: u32 = 100;

/// Innate augmentation kinds granted by ACE's normal heritage creation path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterGenInnateAugmentation {
    /// Flat skill bonus.
    JackOfAllTrades,
    /// Critical chance rating bonus.
    CriticalExpertise,
    /// Damage resistance rating bonus.
    DamageReduction,
    /// Critical damage rating bonus.
    CriticalPower,
    /// Increased burden limit.
    IncreasedCarryingCapacity,
    /// Life Magic focus without a carried focus item.
    InfusedLifeMagic,
    /// Chance to resist a critical hit.
    CriticalDefense,
}

/// Server-granted heritage benefits, separate from DAT training costs and frontend wording.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CharacterGenHeritageBenefits {
    /// Normal character creation grants both a racial weapon pair and an innate augmentation.
    Standard {
        /// Melee/ranged affinities; servers with universal masteries ignore these restrictions.
        racial_weapon_masteries: [WeaponType; 2],
        /// Augmentation property granted once at creation.
        innate_augmentation: CharacterGenInnateAugmentation,
    },
    /// Olthoi creation follows the server's separate path, without these benefits.
    Olthoi,
}

/// ACE PlayerFactory.cs:GetMasteries/SetInnateAugmentations. Unknown heritages are not guessed.
pub fn character_gen_heritage_benefits(heritage: u32) -> Option<CharacterGenHeritageBenefits> {
    use CharacterGenInnateAugmentation::*;
    use holtburger_common::properties::WeaponType::*;
    let (melee, ranged, augmentation) = match heritage {
        1 => (Dagger, Bow, JackOfAllTrades),
        2 => (Staff, Magic, JackOfAllTrades),
        3 => (Unarmed, Bow, JackOfAllTrades),
        4 => (Sword, Crossbow, JackOfAllTrades),
        5 | 10 => (Unarmed, Crossbow, CriticalExpertise),
        6 => (Mace, Crossbow, DamageReduction),
        7 => (Spear, Thrown, CriticalPower),
        8 => (Axe, Thrown, IncreasedCarryingCapacity),
        9 => (Sword, Magic, InfusedLifeMagic),
        11 => (Axe, Thrown, CriticalDefense),
        12 | 13 => return Some(CharacterGenHeritageBenefits::Olthoi),
        _ => return None,
    };
    Some(CharacterGenHeritageBenefits::Standard {
        racial_weapon_masteries: [melee, ranged],
        innate_augmentation: augmentation,
    })
}

pub fn custom_template_for_heritage(
    heritage: &CharacterGenHeritageGroup,
) -> Option<&CharacterGenTemplate> {
    heritage
        .templates
        .iter()
        .find(|template| template.name.eq_ignore_ascii_case("Custom"))
        .or_else(|| {
            heritage
                .templates
                .iter()
                .find(|template| template.template_option == 0)
        })
        .or_else(|| heritage.templates.first())
}

pub fn minimum_skill_advancement_for_heritage(
    catalog: &CharacterGenCatalog,
    heritage_id: u32,
    skill_id: u32,
) -> SkillAdvancementClass {
    // Unavailable definitions still occupy their original wire slots, but must not inherit
    // a retired skill's zero-cost training or an obsolete template requirement.
    if !catalog
        .skill_definition(skill_id)
        .is_some_and(|skill| skill.available_at_creation)
    {
        return SkillAdvancementClass::Inactive;
    }

    let Some(heritage) = catalog.heritage_group(heritage_id) else {
        return SkillAdvancementClass::Untrained;
    };

    let Some(template) = custom_template_for_heritage(heritage) else {
        return SkillAdvancementClass::Untrained;
    };

    minimum_skill_advancement_for_template(
        template,
        catalog.skill_costs_for_heritage(heritage_id, skill_id),
        skill_id,
    )
}

pub fn minimum_skill_advancement_for_template(
    template: &CharacterGenTemplate,
    costs: Option<CharacterGenSkillCosts>,
    skill_id: u32,
) -> SkillAdvancementClass {
    if template.primary_skills.contains(&skill_id) {
        SkillAdvancementClass::Specialized
    } else if template.normal_skills.contains(&skill_id)
        || costs.is_some_and(|costs| costs.trained_cost == 0)
    {
        SkillAdvancementClass::Trained
    } else {
        SkillAdvancementClass::Untrained
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenBuild {
    pub heritage: u32,
    pub gender: u32,
    pub appearance: CharacterCreateAppearanceData,
    pub template_option: i32,
    pub strength_ability: u32,
    pub endurance_ability: u32,
    pub coordination_ability: u32,
    pub quickness_ability: u32,
    pub focus_ability: u32,
    pub self_ability: u32,
    pub skill_advancement_classes: Vec<SkillAdvancementClass>,
    pub name: String,
    pub start_area: u32,
    pub is_admin: bool,
    pub is_sentinel: bool,
}

impl CharacterGenBuild {
    /// Primary attributes in character-creation protocol order.
    pub fn attributes(&self) -> [u32; 6] {
        [
            self.strength_ability,
            self.endurance_ability,
            self.coordination_ability,
            self.quickness_ability,
            self.focus_ability,
            self.self_ability,
        ]
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenPolicy {
    pub unknown_constant: u32,
    pub class_id: u32,
    pub allow_admin_flag: bool,
    pub allow_sentinel_flag: bool,
    pub disabled_heritages: BTreeSet<u32>,
    pub enforce_heritage_start_area_membership: bool,
    pub require_nonempty_name: bool,
}

impl Default for CharacterGenPolicy {
    fn default() -> Self {
        Self {
            unknown_constant: CHARACTER_GEN_UNKNOWN_CONSTANT,
            class_id: CHARACTER_GEN_DEFAULT_CLASS_ID,
            allow_admin_flag: false,
            allow_sentinel_flag: false,
            disabled_heritages: BTreeSet::new(),
            enforce_heritage_start_area_membership: false,
            require_nonempty_name: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenBuilder {
    catalog: Arc<CharacterGenCatalog>,
    policy: CharacterGenPolicy,
}

impl CharacterGenBuilder {
    pub fn new(catalog: Arc<CharacterGenCatalog>) -> Self {
        Self::with_policy(catalog, CharacterGenPolicy::default())
    }

    pub fn with_policy(catalog: Arc<CharacterGenCatalog>, policy: CharacterGenPolicy) -> Self {
        Self { catalog, policy }
    }

    pub fn catalog(&self) -> &CharacterGenCatalog {
        self.catalog.as_ref()
    }

    pub fn policy(&self) -> &CharacterGenPolicy {
        &self.policy
    }

    pub fn validate(
        &self,
        build: &CharacterGenBuild,
    ) -> Result<(), Vec<CharacterGenValidationError>> {
        let errors = self.collect_errors(build);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    pub fn build_request(
        &self,
        build: CharacterGenBuild,
    ) -> Result<CharacterCreateRequestData, Vec<CharacterGenValidationError>> {
        self.validate(&build)?;

        Ok(CharacterCreateRequestData {
            account_name: String::new(),
            unknown_constant: self.policy.unknown_constant,
            heritage: build.heritage,
            gender: build.gender,
            appearance: build.appearance,
            template_option: build.template_option,
            strength_ability: build.strength_ability,
            endurance_ability: build.endurance_ability,
            coordination_ability: build.coordination_ability,
            quickness_ability: build.quickness_ability,
            focus_ability: build.focus_ability,
            self_ability: build.self_ability,
            // Assigned by ClientRuntime against its current authoritative roster before sending.
            character_slot: 0,
            class_id: self.policy.class_id,
            skill_advancement_classes: build.skill_advancement_classes,
            name: build.name,
            start_area: build.start_area,
            is_admin: build.is_admin,
            is_sentinel: build.is_sentinel,
        })
    }

    pub fn randomize_appearance(
        &self,
        heritage_id: u32,
        gender_id: u32,
    ) -> CharacterCreateAppearanceData {
        let Some(appearance) = self
            .catalog
            .heritage_group(heritage_id)
            .and_then(|heritage| heritage.genders.get(&gender_id))
            .map(|gender| &gender.appearance)
        else {
            return empty_appearance();
        };

        let mut rng = rand::rng();
        let (headgear_style, headgear_color) =
            random_clothing(&mut rng, &appearance.headgear, u32::MAX);
        let (shirt_style, shirt_color) = random_clothing(&mut rng, &appearance.shirts, 0);
        let (pants_style, pants_color) = random_clothing(&mut rng, &appearance.pants, 0);
        let (footwear_style, footwear_color) = random_clothing(&mut rng, &appearance.footwear, 0);

        CharacterCreateAppearanceData {
            eyes: random_required_index(&mut rng, appearance.eye_strips.len()),
            nose: random_required_index(&mut rng, appearance.nose_strips.len()),
            mouth: random_required_index(&mut rng, appearance.mouth_strips.len()),
            hair_color: random_required_index(&mut rng, appearance.hair_color_ids.len()),
            eye_color: random_required_index(&mut rng, appearance.eye_color_ids.len()),
            hair_style: random_required_index(&mut rng, appearance.hair_styles.len()),
            headgear_style,
            headgear_color,
            shirt_style,
            shirt_color,
            pants_style,
            pants_color,
            footwear_style,
            footwear_color,
            skin_hue: rng.random::<f64>(),
            hair_hue: rng.random::<f64>(),
            headgear_hue: if headgear_style == u32::MAX {
                0.0
            } else {
                rng.random::<f64>()
            },
            shirt_hue: rng.random::<f64>(),
            pants_hue: rng.random::<f64>(),
            footwear_hue: rng.random::<f64>(),
        }
    }

    fn collect_errors(&self, build: &CharacterGenBuild) -> Vec<CharacterGenValidationError> {
        let mut errors = Vec::new();

        if self.policy.require_nonempty_name && build.name.trim().is_empty() {
            errors.push(CharacterGenValidationError::EmptyName);
        }

        if build.is_admin && !self.policy.allow_admin_flag {
            errors.push(CharacterGenValidationError::AdminFlagNotAllowed);
        }

        if build.is_sentinel && !self.policy.allow_sentinel_flag {
            errors.push(CharacterGenValidationError::SentinelFlagNotAllowed);
        }

        if self.policy.disabled_heritages.contains(&build.heritage) {
            errors.push(CharacterGenValidationError::DisabledHeritage {
                heritage_id: build.heritage,
            });
        }

        let Some(heritage) = self.catalog.heritage_group(build.heritage) else {
            errors.push(CharacterGenValidationError::UnknownHeritage {
                heritage_id: build.heritage,
            });
            return errors;
        };

        let Some(gender) = heritage.genders.get(&build.gender) else {
            errors.push(CharacterGenValidationError::UnknownGender {
                heritage_id: build.heritage,
                gender_id: build.gender,
            });
            return errors;
        };

        if build.template_option < 0 || build.template_option as usize >= heritage.templates.len() {
            errors.push(CharacterGenValidationError::InvalidTemplateOption {
                heritage_id: build.heritage,
                template_option: build.template_option,
            });
        }

        if self.catalog.starter_area(build.start_area).is_none() {
            errors.push(CharacterGenValidationError::InvalidStartArea {
                start_area_id: build.start_area,
            });
        } else if self.policy.enforce_heritage_start_area_membership {
            let allowed = self
                .catalog
                .allowed_start_area_ids_for_heritage(build.heritage)
                .unwrap_or_default();
            if !allowed.contains(&build.start_area) {
                errors.push(
                    CharacterGenValidationError::StartAreaNotAllowedForHeritage {
                        heritage_id: build.heritage,
                        start_area_id: build.start_area,
                    },
                );
            }
        }

        Self::validate_attributes(
            &build.attributes(),
            heritage.attribute_credits,
            true,
            &mut errors,
        );
        self.validate_skills(
            build.heritage,
            &build.skill_advancement_classes,
            heritage,
            &mut errors,
        );
        self.validate_appearance(build, gender, &mut errors);

        errors
    }

    fn validate_attributes(
        attributes: &[u32; 6],
        attribute_budget: u32,
        require_complete: bool,
        errors: &mut Vec<CharacterGenValidationError>,
    ) {
        for (field, value) in [
            "strength",
            "endurance",
            "coordination",
            "quickness",
            "focus",
            "self",
        ]
        .into_iter()
        .zip(attributes.iter().copied())
        {
            if !(CHARACTER_GEN_MIN_ATTRIBUTE..=CHARACTER_GEN_MAX_ATTRIBUTE).contains(&value) {
                errors.push(CharacterGenValidationError::AttributeOutOfRange {
                    field,
                    value,
                    min: CHARACTER_GEN_MIN_ATTRIBUTE,
                    max: CHARACTER_GEN_MAX_ATTRIBUTE,
                });
            }
        }

        let total = attributes.iter().copied().map(u64::from).sum();
        if total > u64::from(attribute_budget) {
            errors.push(CharacterGenValidationError::AttributeBudgetExceeded {
                total,
                budget: attribute_budget,
            });
        } else if require_complete && total < u64::from(attribute_budget) {
            errors.push(CharacterGenValidationError::AttributeBudgetIncomplete {
                total,
                budget: attribute_budget,
                remaining: u64::from(attribute_budget) - total,
            });
        }
    }

    fn validate_skills(
        &self,
        heritage_id: u32,
        skills: &[SkillAdvancementClass],
        heritage: &holtburger_content::character_gen::CharacterGenHeritageGroup,
        errors: &mut Vec<CharacterGenValidationError>,
    ) {
        if skills.len() != self.catalog.expected_skill_slots {
            errors.push(CharacterGenValidationError::SkillSlotCountMismatch {
                expected: self.catalog.expected_skill_slots,
                actual: skills.len(),
            });
            return;
        }

        let mut spent_credits = 0i64;

        for (skill_id, advancement) in skills.iter().enumerate() {
            if *advancement == SkillAdvancementClass::Inactive {
                continue;
            }

            let skill_id = skill_id as u32;
            let Some(skill_definition) = self.catalog.skill_definition(skill_id) else {
                errors.push(CharacterGenValidationError::UnknownSkill { skill_id });
                continue;
            };

            if !skill_definition.available_at_creation
                && *advancement != SkillAdvancementClass::Untrained
            {
                errors.push(
                    CharacterGenValidationError::SkillUnavailableAtCharacterCreation { skill_id },
                );
                continue;
            }

            let Some(costs) = self.catalog.skill_costs_for_heritage(heritage_id, skill_id) else {
                errors.push(CharacterGenValidationError::UnknownSkill { skill_id });
                continue;
            };

            match advancement {
                SkillAdvancementClass::Trained => {
                    spent_credits += i64::from(costs.trained_cost);
                }
                SkillAdvancementClass::Specialized => {
                    spent_credits +=
                        i64::from(costs.trained_cost + costs.specialization_upgrade_cost);
                }
                SkillAdvancementClass::Untrained | SkillAdvancementClass::Inactive => {}
            }
        }

        if spent_credits > i64::from(heritage.skill_credits) {
            errors.push(CharacterGenValidationError::SkillBudgetExceeded {
                spent: spent_credits,
                budget: i64::from(heritage.skill_credits),
            });
        }
    }

    fn validate_appearance(
        &self,
        build: &CharacterGenBuild,
        gender: &holtburger_content::character_gen::CharacterGenGenderDefinition,
        errors: &mut Vec<CharacterGenValidationError>,
    ) {
        errors.extend(
            character_gen_appearance_choices(&build.appearance)
                .validate(&gender.appearance)
                .into_iter()
                .map(CharacterGenValidationError::Appearance),
        );
    }
}

/// Adapt indexed wire appearance choices into the content-owned validation/resolution input.
pub fn character_gen_appearance_choices(
    appearance: &CharacterCreateAppearanceData,
) -> holtburger_content::character_gen::appearance::CharacterGenAppearanceChoices {
    holtburger_content::character_gen::appearance::CharacterGenAppearanceChoices {
        body: holtburger_content::character_gen::body::BodyAppearanceChoices {
            eyes: appearance.eyes,
            nose: appearance.nose,
            mouth: appearance.mouth,
            hair_color: appearance.hair_color,
            eye_color: appearance.eye_color,
            hair_style: appearance.hair_style,
            skin_hue: appearance.skin_hue,
            hair_hue: appearance.hair_hue,
        },
        headgear_style: appearance.headgear_style,
        headgear_color: appearance.headgear_color,
        shirt_style: appearance.shirt_style,
        shirt_color: appearance.shirt_color,
        pants_style: appearance.pants_style,
        pants_color: appearance.pants_color,
        footwear_style: appearance.footwear_style,
        footwear_color: appearance.footwear_color,
        headgear_hue: appearance.headgear_hue,
        shirt_hue: appearance.shirt_hue,
        pants_hue: appearance.pants_hue,
        footwear_hue: appearance.footwear_hue,
    }
}

fn empty_appearance() -> CharacterCreateAppearanceData {
    CharacterCreateAppearanceData {
        eyes: 0,
        nose: 0,
        mouth: 0,
        hair_color: 0,
        eye_color: 0,
        hair_style: 0,
        headgear_style: u32::MAX,
        headgear_color: 0,
        shirt_style: 0,
        shirt_color: 0,
        pants_style: 0,
        pants_color: 0,
        footwear_style: 0,
        footwear_color: 0,
        skin_hue: 0.0,
        hair_hue: 0.0,
        headgear_hue: 0.0,
        shirt_hue: 0.0,
        pants_hue: 0.0,
        footwear_hue: 0.0,
    }
}

fn random_required_index(rng: &mut impl RngExt, options_len: usize) -> u32 {
    if options_len == 0 {
        0
    } else {
        rng.random_range(0..options_len) as u32
    }
}

/// Pick an actual palette-template key from the chosen garment, never its display ordinal.
fn random_clothing(
    rng: &mut impl RngExt,
    styles: &[holtburger_content::character_gen::CharacterGenGear],
    empty_style: u32,
) -> (u32, u32) {
    if styles.is_empty() {
        return (empty_style, 0);
    }
    let style = rng.random_range(0..styles.len());
    let colors = &styles[style].palette_template_ids;
    // Content catalog assembly supplies at least one key, including explicit no-overlay zero
    // for garments without eligible palette effects. An empty list violates that contract.
    (style as u32, colors[rng.random_range(0..colors.len())])
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CharacterGenValidationError {
    #[error("character name cannot be empty")]
    EmptyName,
    #[error("heritage {heritage_id} is disabled by local policy")]
    DisabledHeritage { heritage_id: u32 },
    #[error("unknown heritage {heritage_id}")]
    UnknownHeritage { heritage_id: u32 },
    #[error("unknown gender {gender_id} for heritage {heritage_id}")]
    UnknownGender { heritage_id: u32, gender_id: u32 },
    #[error("invalid template option {template_option} for heritage {heritage_id}")]
    InvalidTemplateOption {
        heritage_id: u32,
        template_option: i32,
    },
    #[error("invalid start area {start_area_id}")]
    InvalidStartArea { start_area_id: u32 },
    #[error("start area {start_area_id} is not allowed for heritage {heritage_id}")]
    StartAreaNotAllowedForHeritage {
        heritage_id: u32,
        start_area_id: u32,
    },
    #[error("attribute {field} value {value} must be between {min} and {max}")]
    AttributeOutOfRange {
        field: &'static str,
        value: u32,
        min: u32,
        max: u32,
    },
    #[error("attribute total {total} exceeds budget {budget}")]
    AttributeBudgetExceeded { total: u64, budget: u32 },
    #[error("attribute total {total} leaves {remaining} of {budget} points unallocated")]
    AttributeBudgetIncomplete {
        total: u64,
        budget: u32,
        remaining: u64,
    },
    #[error("expected {expected} skill slots but got {actual}")]
    SkillSlotCountMismatch { expected: usize, actual: usize },
    #[error("unknown skill {skill_id}")]
    UnknownSkill { skill_id: u32 },
    #[error("skill {skill_id} is not available at character creation")]
    SkillUnavailableAtCharacterCreation { skill_id: u32 },
    #[error("skill credits spent {spent} exceed budget {budget}")]
    SkillBudgetExceeded { spent: i64, budget: i64 },
    /// Content-owned appearance validation shared with pre-game preview resolution.
    #[error(transparent)]
    Appearance(#[from] holtburger_content::character_gen::appearance::CharacterGenAppearanceError),
    #[error("admin flag is not allowed by local policy")]
    AdminFlagNotAllowed,
    #[error("sentinel flag is not allowed by local policy")]
    SentinelFlagNotAllowed,
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::character_gen::{
        CharacterGenAppearanceOptions, CharacterGenCatalog, CharacterGenGenderDefinition,
        CharacterGenHeritageGroup, CharacterGenSkillDefinition, CharacterGenStarterArea,
        CharacterGenStarterLocation, CharacterGenTemplate,
    };
    use std::collections::BTreeMap;

    #[test]
    fn heritage_benefits_distinguish_traditional_affinities_innate_augmentations_and_olthoi() {
        use super::character_gen_heritage_benefits;
        use holtburger_common::properties::WeaponType;
        assert_eq!(
            character_gen_heritage_benefits(1),
            Some(super::CharacterGenHeritageBenefits::Standard {
                racial_weapon_masteries: [WeaponType::Dagger, WeaponType::Bow],
                innate_augmentation: super::CharacterGenInnateAugmentation::JackOfAllTrades,
            })
        );
        assert_eq!(
            character_gen_heritage_benefits(5),
            character_gen_heritage_benefits(10)
        );
        for heritage in [12, 13] {
            assert_eq!(
                character_gen_heritage_benefits(heritage),
                Some(super::CharacterGenHeritageBenefits::Olthoi)
            );
        }
        assert!(character_gen_heritage_benefits(0).is_none());
    }

    pub(super) fn test_catalog() -> Arc<CharacterGenCatalog> {
        Arc::new(CharacterGenCatalog {
            starter_areas: vec![CharacterGenStarterArea {
                start_area_id: 0,
                name: "Holtburg".to_string(),
                locations: vec![CharacterGenStarterLocation {
                    obj_cell_id: 1,
                    frame: Default::default(),
                }],
            }],
            heritage_groups: BTreeMap::from([(
                6,
                CharacterGenHeritageGroup {
                    heritage_id: 6,
                    name: "Sho".to_string(),
                    icon_image: 0,
                    setup_id: 0,
                    environment_setup_id: 0,
                    attribute_credits: 330,
                    skill_credits: 10,
                    uses_starter_clothing: false,
                    primary_start_area_ids: vec![0],
                    secondary_start_area_ids: vec![],
                    skill_overrides: BTreeMap::from([(
                        1,
                        holtburger_content::character_gen::CharacterGenSkillOverride {
                            skill_id: 1,
                            skill_type: None,
                            trained_cost: 4,
                            specialization_upgrade_cost: 6,
                        },
                    )]),
                    templates: vec![
                        CharacterGenTemplate {
                            template_option: 0,
                            name: "Adventurer".to_string(),
                            icon_image: 0,
                            title_id: 1,
                            strength: 100,
                            endurance: 10,
                            coordination: 100,
                            quickness: 100,
                            focus: 10,
                            self_stat: 10,
                            normal_skills: vec![],
                            primary_skills: vec![],
                        },
                        CharacterGenTemplate {
                            template_option: 1,
                            name: "Custom".to_string(),
                            icon_image: 0,
                            title_id: 2,
                            strength: 10,
                            endurance: 10,
                            coordination: 10,
                            quickness: 10,
                            focus: 10,
                            self_stat: 10,
                            normal_skills: vec![1],
                            primary_skills: vec![3],
                        },
                    ],
                    genders: BTreeMap::from([(
                        1,
                        CharacterGenGenderDefinition {
                            gender_id: 1,
                            name: "Male".to_string(),
                            scale: 100,
                            setup_id: 0,
                            sound_table: 0,
                            icon_image: 0,
                            base_palette: 0,
                            skin_palette_set: 0,
                            physics_table: 0,
                            motion_table: 0,
                            combat_table: 0,
                            appearance: CharacterGenAppearanceOptions {
                                hair_color_ids: vec![1],
                                hair_styles: vec![],
                                eye_color_ids: vec![1],
                                eye_strips: vec![
                                    holtburger_content::character_gen::CharacterGenEyeStrip {
                                        icon_image: 1,
                                        icon_image_bald: 1,
                                    },
                                ],
                                nose_strips: vec![
                                    holtburger_content::character_gen::CharacterGenFaceStrip {
                                        icon_image: 1,
                                    },
                                ],
                                mouth_strips: vec![
                                    holtburger_content::character_gen::CharacterGenFaceStrip {
                                        icon_image: 1,
                                    },
                                ],
                                headgear: vec![],
                                shirts: vec![holtburger_content::character_gen::CharacterGenGear {
                                    name: "Shirt".to_string(),
                                    clothing_table: 1,
                                    weenie_default: 1,
                                    palette_template_ids: vec![17],
                                }],
                                pants: vec![holtburger_content::character_gen::CharacterGenGear {
                                    name: "Pants".to_string(),
                                    clothing_table: 1,
                                    weenie_default: 1,
                                    palette_template_ids: vec![17],
                                }],
                                footwear: vec![
                                    holtburger_content::character_gen::CharacterGenGear {
                                        name: "Boots".to_string(),
                                        clothing_table: 1,
                                        weenie_default: 1,
                                        palette_template_ids: vec![17],
                                    },
                                ],
                            },
                        },
                    )]),
                },
            )]),
            skill_definitions: BTreeMap::from([
                (
                    0,
                    CharacterGenSkillDefinition {
                        skill_id: 0,
                        skill_type: None,
                        name: "Inactive".to_string(),
                        description: "Inactive".to_string(),
                        formula: None,
                        available_at_creation: true,
                        trained_cost: 0,
                        specialization_total_cost: 0,
                    },
                ),
                (
                    1,
                    CharacterGenSkillDefinition {
                        skill_id: 1,
                        skill_type: None,
                        name: "Axe".to_string(),
                        description: "Axe".to_string(),
                        formula: None,
                        available_at_creation: true,
                        trained_cost: 6,
                        specialization_total_cost: 10,
                    },
                ),
                (
                    2,
                    CharacterGenSkillDefinition {
                        skill_id: 2,
                        skill_type: None,
                        name: "Bow".to_string(),
                        description: "Bow".to_string(),
                        formula: None,
                        available_at_creation: true,
                        trained_cost: 0,
                        specialization_total_cost: 4,
                    },
                ),
                (
                    3,
                    CharacterGenSkillDefinition {
                        skill_id: 3,
                        skill_type: None,
                        name: "Crossbow".to_string(),
                        description: "Crossbow".to_string(),
                        formula: None,
                        available_at_creation: true,
                        trained_cost: 6,
                        specialization_total_cost: 10,
                    },
                ),
                (
                    4,
                    CharacterGenSkillDefinition {
                        skill_id: 4,
                        skill_type: None,
                        name: "Hidden".to_string(),
                        description: "Hidden".to_string(),
                        formula: None,
                        available_at_creation: false,
                        trained_cost: 6,
                        specialization_total_cost: 10,
                    },
                ),
            ]),
            expected_skill_slots: 5,
        })
    }

    pub(super) fn test_build() -> CharacterGenBuild {
        CharacterGenBuild {
            heritage: 6,
            gender: 1,
            appearance: CharacterCreateAppearanceData {
                eyes: 0,
                nose: 0,
                mouth: 0,
                hair_color: 0,
                eye_color: 0,
                hair_style: 0,
                headgear_style: u32::MAX,
                headgear_color: 0,
                shirt_style: 0,
                shirt_color: 17,
                pants_style: 0,
                pants_color: 17,
                footwear_style: 0,
                footwear_color: 17,
                skin_hue: 1.0,
                hair_hue: 1.0,
                headgear_hue: 0.0,
                shirt_hue: 0.0,
                pants_hue: 0.0,
                footwear_hue: 0.0,
            },
            template_option: 0,
            strength_ability: 100,
            endurance_ability: 10,
            coordination_ability: 100,
            quickness_ability: 100,
            focus_ability: 10,
            self_ability: 10,
            skill_advancement_classes: vec![
                SkillAdvancementClass::Inactive,
                SkillAdvancementClass::Specialized,
                SkillAdvancementClass::Untrained,
                SkillAdvancementClass::Inactive,
                SkillAdvancementClass::Inactive,
            ],
            name: "Bestie".to_string(),
            start_area: 0,
            is_admin: false,
            is_sentinel: false,
        }
    }

    #[test]
    fn shared_reconciled_build_obeys_authoritative_budgets() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        /// Inputs and expected semantic output shared with the browser reconciliation test.
        struct Fixture {
            /// Target heritage key in the synthetic core catalog.
            heritage: u32,
            /// Attribute pool expected by both consumers.
            attribute_credits: u32,
            /// Target skill pool for this reconciliation scenario.
            skill_credits: u32,
            /// Attribute allocation preserved by the browser helper.
            attributes: [u32; 6],
            /// Unaffordable skill choices before reconciliation.
            requested_skills: Vec<u32>,
            /// Browser-produced tiers to admit through the shared builder.
            expected_skills: Vec<u32>,
            /// Target cost and requirement facts verified against the core catalog.
            skills: Vec<FixtureSkill>,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        /// A resolved training rule consumed on both sides of the contract.
        struct FixtureSkill {
            /// Wire skill slot.
            id: u32,
            /// Credits needed for training.
            trained_cost: i32,
            /// Additional credits needed for specialization.
            specialization_upgrade_cost: i32,
            /// Required starting advancement tier.
            minimum_advancement: u32,
        }
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../tests/fixtures/character_creation_reconciliation.json"
        ))
        .unwrap();
        let mut catalog = test_catalog();
        Arc::make_mut(&mut catalog)
            .heritage_groups
            .get_mut(&fixture.heritage)
            .unwrap()
            .skill_credits = fixture.skill_credits;
        let heritage = catalog.heritage_group(fixture.heritage).unwrap();
        assert_eq!(heritage.attribute_credits, fixture.attribute_credits);
        assert_eq!(heritage.skill_credits, fixture.skill_credits);
        for skill in fixture.skills {
            let costs = catalog
                .skill_costs_for_heritage(fixture.heritage, skill.id)
                .unwrap();
            assert_eq!(costs.trained_cost, skill.trained_cost);
            assert_eq!(
                costs.specialization_upgrade_cost,
                skill.specialization_upgrade_cost
            );
            assert_eq!(
                minimum_skill_advancement_for_heritage(&catalog, fixture.heritage, skill.id) as u32,
                skill.minimum_advancement
            );
        }
        let mut build = test_build();
        build.heritage = fixture.heritage;
        build.template_option = custom_template_for_heritage(heritage)
            .unwrap()
            .template_option;
        [
            build.strength_ability,
            build.endurance_ability,
            build.coordination_ability,
            build.quickness_ability,
            build.focus_ability,
            build.self_ability,
        ] = fixture.attributes;
        let tiers = |values: Vec<u32>| {
            values
                .into_iter()
                .map(|value| SkillAdvancementClass::from_repr(value).unwrap())
                .collect()
        };
        build.skill_advancement_classes = tiers(fixture.requested_skills);
        let builder = CharacterGenBuilder::new(catalog);
        assert!(
            builder
                .validate(&build)
                .unwrap_err()
                .iter()
                .any(|error| matches!(
                    error,
                    CharacterGenValidationError::SkillBudgetExceeded { .. }
                ))
        );
        build.skill_advancement_classes = tiers(fixture.expected_skills);
        assert!(builder.build_request(build).is_ok());
    }

    #[test]
    fn full_build_uses_content_shade_validation() {
        use holtburger_content::character_gen::appearance::CharacterGenAppearanceError;
        let builder = CharacterGenBuilder::new(test_catalog());
        for shade in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
            let mut build = test_build();
            build.appearance.skin_hue = shade;
            assert!(
                builder
                    .validate(&build)
                    .expect_err("invalid shade must reject full creation")
                    .contains(&CharacterGenValidationError::Appearance(
                        CharacterGenAppearanceError::InvalidShade { field: "skin_hue" }
                    ))
            );
        }
    }

    #[test]
    fn full_build_charges_a_base_specialization_total_without_charging_training_twice() {
        let mut catalog = (*test_catalog()).clone();
        catalog
            .heritage_groups
            .get_mut(&6)
            .unwrap()
            .skill_overrides
            .clear();
        let builder = CharacterGenBuilder::new(Arc::new(catalog));
        // Raw base training 6 + upgrade 4 exactly fills the heritage's 10-credit budget.
        builder
            .validate(&test_build())
            .expect("base total should exactly fill the budget");
    }

    #[test]
    fn untrusted_attribute_values_report_errors_without_overflow() {
        let builder = CharacterGenBuilder::new(test_catalog());
        let mut build = test_build();
        build.strength_ability = u32::MAX;
        build.endurance_ability = u32::MAX;
        let errors = builder.validate(&build).unwrap_err();
        assert!(errors.iter().any(|error| matches!(error,
            CharacterGenValidationError::AttributeBudgetExceeded { total, .. } if *total > u64::from(u32::MAX))));
    }

    #[test]
    fn build_request_uses_policy_defaults() {
        let builder = CharacterGenBuilder::new(test_catalog());
        let request = builder
            .build_request(test_build())
            .expect("build should validate");

        assert_eq!(request.unknown_constant, CHARACTER_GEN_UNKNOWN_CONSTANT);
        assert_eq!(request.class_id, CHARACTER_GEN_DEFAULT_CLASS_ID);
        assert_eq!(request.name, "Bestie");
        assert_eq!(request.appearance.shirt_color, 17);
        assert_eq!(request.appearance.pants_color, 17);
        assert_eq!(request.appearance.footwear_color, 17);
    }

    #[test]
    fn full_build_rejects_a_color_ordinal_in_place_of_a_garment_template_key() {
        use holtburger_content::character_gen::appearance::CharacterGenAppearanceError;
        let builder = CharacterGenBuilder::new(test_catalog());
        let mut build = test_build();
        build.appearance.shirt_color = 0;
        assert!(
            builder
                .build_request(build)
                .expect_err("ordinal zero is not template 17")
                .contains(&CharacterGenValidationError::Appearance(
                    CharacterGenAppearanceError::ClothingColorUnavailable {
                        field: "shirt_color",
                        selected: 0,
                    }
                ))
        );
    }

    #[test]
    fn randomize_appearance_uses_valid_catalog_ranges() {
        let builder = CharacterGenBuilder::new(test_catalog());

        let appearance = builder.randomize_appearance(6, 1);

        assert_eq!(appearance.eyes, 0);
        assert_eq!(appearance.nose, 0);
        assert_eq!(appearance.mouth, 0);
        assert_eq!(appearance.hair_color, 0);
        assert_eq!(appearance.eye_color, 0);
        assert_eq!(appearance.hair_style, 0);
        assert_eq!(appearance.headgear_style, u32::MAX);
        assert_eq!(appearance.headgear_color, 0);
        assert_eq!(appearance.shirt_style, 0);
        assert_eq!(appearance.shirt_color, 17);
        assert_eq!(appearance.pants_color, 17);
        assert_eq!(appearance.footwear_color, 17);
        assert_eq!(appearance.pants_style, 0);
        assert_eq!(appearance.footwear_style, 0);
        assert!((0.0..1.0).contains(&appearance.skin_hue));
        assert!((0.0..1.0).contains(&appearance.hair_hue));
        assert_eq!(appearance.headgear_hue, 0.0);
        assert!((0.0..1.0).contains(&appearance.shirt_hue));
        assert!((0.0..1.0).contains(&appearance.pants_hue));
        assert!((0.0..1.0).contains(&appearance.footwear_hue));
    }

    #[test]
    fn validate_rejects_attribute_budget_overrun() {
        let builder = CharacterGenBuilder::new(test_catalog());
        let mut build = test_build();
        build.focus_ability = 50;

        let errors = builder.validate(&build).expect_err("build should fail");
        assert!(errors.iter().any(|error| matches!(
            error,
            CharacterGenValidationError::AttributeBudgetExceeded { .. }
        )));
    }

    #[test]
    fn validate_rejects_unspent_attribute_budget() {
        let builder = CharacterGenBuilder::new(test_catalog());
        let mut build = test_build();
        build.self_ability = 5;

        let errors = builder.validate(&build).expect_err("build should fail");
        assert!(errors.iter().any(|error| matches!(
            error,
            CharacterGenValidationError::AttributeBudgetIncomplete {
                total: 325,
                budget: 330,
                remaining: 5,
            }
        )));
    }

    #[test]
    fn validate_rejects_skill_budget_overrun() {
        let builder = CharacterGenBuilder::new(test_catalog());
        let mut build = test_build();
        build.skill_advancement_classes[3] = SkillAdvancementClass::Specialized;

        let errors = builder.validate(&build).expect_err("build should fail");
        assert!(errors.iter().any(|error| matches!(
            error,
            CharacterGenValidationError::SkillBudgetExceeded { .. }
        )));
    }

    #[test]
    fn validate_rejects_unavailable_creation_skill() {
        let builder = CharacterGenBuilder::new(test_catalog());
        let mut build = test_build();
        build.skill_advancement_classes[4] = SkillAdvancementClass::Trained;

        let errors = builder.validate(&build).expect_err("build should fail");
        assert!(errors.iter().any(|error| matches!(
            error,
            CharacterGenValidationError::SkillUnavailableAtCharacterCreation { skill_id: 4 }
        )));
    }

    #[test]
    fn unavailable_skills_stay_inactive_despite_zero_costs_or_obsolete_templates() {
        let mut catalog = (*test_catalog()).clone();
        let skill = catalog.skill_definitions.get_mut(&4).unwrap();
        skill.trained_cost = 0;
        skill.specialization_total_cost = 0;
        for template in &mut catalog.heritage_groups.get_mut(&6).unwrap().templates {
            template.primary_skills.push(4);
        }
        assert_eq!(
            minimum_skill_advancement_for_heritage(&catalog, 6, 4),
            SkillAdvancementClass::Inactive
        );

        let builder = CharacterGenBuilder::new(Arc::new(catalog));
        for advancement in [
            SkillAdvancementClass::Trained,
            SkillAdvancementClass::Specialized,
        ] {
            let mut build = test_build();
            build.skill_advancement_classes[4] = advancement;
            let errors = builder.validate(&build).expect_err("unavailable training");
            assert!(errors.iter().any(|error| matches!(
                error,
                CharacterGenValidationError::SkillUnavailableAtCharacterCreation { skill_id: 4 }
            )));
        }
    }

    #[test]
    fn custom_template_for_heritage_prefers_named_custom_template() {
        let catalog = test_catalog();
        let heritage = catalog
            .heritage_group(6)
            .expect("test heritage should exist");

        let template = custom_template_for_heritage(heritage).expect("custom template expected");

        assert_eq!(template.name, "Custom");
        assert_eq!(template.template_option, 1);
    }

    #[test]
    fn minimum_skill_advancement_uses_template_lists_and_zero_cost_floor() {
        let catalog = test_catalog();

        assert_eq!(
            minimum_skill_advancement_for_heritage(catalog.as_ref(), 6, 1),
            SkillAdvancementClass::Trained
        );
        assert_eq!(
            minimum_skill_advancement_for_heritage(catalog.as_ref(), 6, 2),
            SkillAdvancementClass::Trained
        );
        assert_eq!(
            minimum_skill_advancement_for_heritage(catalog.as_ref(), 6, 3),
            SkillAdvancementClass::Specialized
        );
    }

    #[test]
    fn minimum_skill_advancement_for_template_prefers_primary_normal_and_zero_cost_floor() {
        let template = CharacterGenTemplate {
            template_option: 0,
            name: "Custom".to_string(),
            icon_image: 0,
            title_id: 0,
            strength: 0,
            endurance: 0,
            coordination: 0,
            quickness: 0,
            focus: 0,
            self_stat: 0,
            normal_skills: vec![1],
            primary_skills: vec![2],
        };

        assert_eq!(
            minimum_skill_advancement_for_template(
                &template,
                Some(CharacterGenSkillCosts {
                    trained_cost: 6,
                    specialization_upgrade_cost: 4,
                }),
                2,
            ),
            SkillAdvancementClass::Specialized
        );
        assert_eq!(
            minimum_skill_advancement_for_template(
                &template,
                Some(CharacterGenSkillCosts {
                    trained_cost: 6,
                    specialization_upgrade_cost: 4,
                }),
                1,
            ),
            SkillAdvancementClass::Trained
        );
        assert_eq!(
            minimum_skill_advancement_for_template(
                &template,
                Some(CharacterGenSkillCosts {
                    trained_cost: 0,
                    specialization_upgrade_cost: 4,
                }),
                3,
            ),
            SkillAdvancementClass::Trained
        );
        assert_eq!(
            minimum_skill_advancement_for_template(
                &template,
                Some(CharacterGenSkillCosts {
                    trained_cost: 6,
                    specialization_upgrade_cost: 4,
                }),
                4,
            ),
            SkillAdvancementClass::Untrained
        );
    }
}

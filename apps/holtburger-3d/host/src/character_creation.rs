//! Pre-game choice projection and semantic draft adaptation; rules remain in core/content.

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow};
use holtburger_common::stats::AttributeType;
use holtburger_content::CharacterGenCatalog;
use holtburger_content::character_creation_text::CREATION_ATTRIBUTE_DESCRIPTIONS;
use holtburger_content::character_gen::is_unavailable_character_gen_skill_cost;
use holtburger_content::{ContentRepository, MotionClip};
use holtburger_core::character_gen::starting_stats::StartingStats;
use holtburger_core::character_gen::{
    CHARACTER_GEN_MAX_ATTRIBUTE, CHARACTER_GEN_MIN_ATTRIBUTE, CharacterGenBuild,
    CharacterGenBuilder, CharacterGenHeritageBenefits, CharacterGenInnateAugmentation,
    character_gen_appearance_choices, character_gen_heritage_benefits,
    custom_template_for_heritage, minimum_skill_advancement_for_heritage,
};
use holtburger_core::client::object_preview::{
    ObjectPreviewClip, ObjectPreviewPose, ObjectPreviewVisual,
};
use holtburger_dat::file_type::{SecondaryAttributeTable, SkillTable};
use holtburger_protocol::messages::{
    CharacterCreateAppearanceData, CharacterCreateRequestData, SkillAdvancementClass,
};
use serde::{Deserialize, Serialize};

/// Allocation-only query, independent of appearance, identity, and submission completeness.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCreationStatsRequest {
    /// Selected heritage catalog key.
    heritage: u32,
    /// Strength, endurance, coordination, quickness, focus, self in protocol order.
    attributes: [u32; 6],
    /// Complete advancement vector, including inactive slots.
    skills: Vec<u32>,
}

/// Starting stat projection with an explicit exclusion for server-defined Olthoi builds.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CharacterCreationStats {
    /// Both Olthoi variants use a separate server initialization path.
    Olthoi,
    /// Effective unenchanted starting values under normal creation rules.
    Standard {
        /// Full starting pools, in health, stamina, mana order.
        vitals: [u32; 3],
        /// Values and usability keyed by stable skill ID.
        skills: Vec<CreationStartingSkill>,
    },
}

/// The UI must not infer usability from a value: innate bonuses can affect unusable skills.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationStartingSkill {
    /// Stable skill identity.
    id: u32,
    /// Effective starting value, including applicable innate bonuses.
    value: u32,
    /// Whether the skill can be used at its chosen advancement.
    usable: bool,
}

/// Parsed rules retained for the static creator lifetime, without a live player session.
struct CreationStatsRules {
    /// Shared creation initializer and allocation validation.
    builder: CharacterGenBuilder,
    /// Authored skill formulas and untrained usability.
    skills: SkillTable,
    /// Authored maximum pool formulas.
    vitals: SecondaryAttributeTable,
}

/// Lazy static calculation service; allocation edits never reread the archives.
#[derive(Default)]
pub struct CharacterCreationStatsService {
    /// One coherent parsed ruleset, installed only after every required table loads.
    rules: Mutex<Option<Arc<CreationStatsRules>>>,
}

impl CharacterCreationStatsService {
    /// Keep parsing outside the allocation path once the coherent ruleset is installed.
    fn rules(&self, repository: &ContentRepository) -> Result<Arc<CreationStatsRules>> {
        let mut cached = self
            .rules
            .lock()
            .map_err(|_| anyhow!("Creation stat rules lock poisoned"))?;
        if let Some(rules) = cached.as_ref() {
            return Ok(Arc::clone(rules));
        }
        let rules = Arc::new(CreationStatsRules {
            builder: CharacterGenBuilder::new(Arc::new(repository.read_character_gen_catalog()?)),
            skills: repository.read_asset::<SkillTable>("creation skill stats")?,
            vitals: repository.read_asset::<SecondaryAttributeTable>("creation vital stats")?,
        });
        *cached = Some(Arc::clone(&rules));
        Ok(rules)
    }

    /// Read static rules once, then evaluate editable drafts without world activation.
    pub fn resolve(
        &self,
        request: CharacterCreationStatsRequest,
        repository: &ContentRepository,
    ) -> Result<CharacterCreationStats> {
        let rules = self.rules(repository)?;
        let skills = request
            .skills
            .into_iter()
            .enumerate()
            .map(|(index, value)| {
                SkillAdvancementClass::from_repr(value).with_context(|| {
                    format!("Unknown advancement class {value} at skill slot {index}")
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let result = rules.builder.starting_stats(
            request.heritage,
            request.attributes,
            &skills,
            &rules.skills,
            &rules.vitals,
        )?;
        Ok(match result {
            StartingStats::Olthoi => CharacterCreationStats::Olthoi,
            StartingStats::Standard { vitals, skills } => CharacterCreationStats::Standard {
                vitals,
                skills: skills
                    .into_iter()
                    .map(|skill| CreationStartingSkill {
                        id: skill.skill as u32,
                        value: skill.value,
                        usable: skill.usable,
                    })
                    .collect(),
            },
        })
    }
}

/// Appearance-only query; name, skill and attribute validity do not gate preview editing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCreationAppearanceRequest {
    /// Authored heritage key.
    pub heritage: u32,
    /// Authored gender key within the heritage.
    pub gender: u32,
    /// Style ordinals, clothing template keys and shades, validated by content rather than trusted from the browser.
    pub appearance: CharacterCreateAppearanceData,
}

/// Pre-game visual facts consumed by the same model preparation as captured creatures.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCreationPreview {
    /// Identity-free character visual with the retail creation idle.
    body: ObjectPreviewVisual,
    /// Independent authored background, excluded from character framing.
    background_setup_did: Option<u32>,
}

impl CharacterCreationAppearanceRequest {
    /// Interpret static content without starting world systems or joining a live entity.
    pub fn resolve(self, repository: &ContentRepository) -> Result<CharacterCreationPreview> {
        let visual = repository.resolve_character_gen_visual(
            self.heritage,
            self.gender,
            &character_gen_appearance_choices(&self.appearance),
        )?;
        let pose = |clip: &MotionClip| ObjectPreviewPose::DefaultIdle {
            clips: vec![ObjectPreviewClip {
                animation_id: clip.animation.id,
                low_frame: clip.low_frame,
                high_frame: clip.high_frame,
                framerate: clip.framerate,
            }],
            first_cyclic_clip: 0,
        };
        Ok(CharacterCreationPreview {
            body: ObjectPreviewVisual {
                setup_did: visual.setup_id,
                appearance: (&visual.appearance).into(),
                scale: visual.scale,
                translucency: 0.0,
                pose: pose(&visual.idle),
            },
            background_setup_did: visual.background_setup_id,
        })
    }
}

/// User-editable build only; account, slot assignment and privileged flags are authority-owned.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCreationDraft {
    /// Selected heritage catalog key.
    pub heritage: u32,
    /// Selected gender key within that heritage.
    pub gender: u32,
    /// Style ordinals, clothing template keys and shades, validated by the shared builder.
    pub appearance: CharacterCreateAppearanceData,
    /// Strength, endurance, coordination, quickness, focus, self, in protocol order.
    pub attributes: [u32; 6],
    /// Indexed advancement classes for every catalog skill slot.
    pub skills: Vec<u32>,
    /// Requested character name; server acceptance remains final.
    pub name: String,
    /// Selected starting-area catalog key.
    pub start_area: u32,
}

impl CharacterCreationDraft {
    /// Apply core validation before crossing from the host adapter into the network command.
    pub fn build_request(
        self,
        catalog: Arc<CharacterGenCatalog>,
    ) -> Result<CharacterCreateRequestData> {
        let heritage = catalog
            .heritage_group(self.heritage)
            .with_context(|| format!("Unknown creation heritage {}.", self.heritage))?;
        let template_option = custom_template_for_heritage(heritage)
            .context("Creation heritage has no custom/default template")?
            .template_option;
        let skills = self
            .skills
            .into_iter()
            .enumerate()
            .map(|(index, value)| {
                SkillAdvancementClass::from_repr(value).ok_or_else(|| {
                    anyhow!("Unknown advancement class {value} at skill slot {index}.")
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let [
            strength_ability,
            endurance_ability,
            coordination_ability,
            quickness_ability,
            focus_ability,
            self_ability,
        ] = self.attributes;
        CharacterGenBuilder::new(catalog)
            .build_request(CharacterGenBuild {
                heritage: self.heritage,
                gender: self.gender,
                appearance: self.appearance,
                template_option,
                strength_ability,
                endurance_ability,
                coordination_ability,
                quickness_ability,
                focus_ability,
                self_ability,
                skill_advancement_classes: skills,
                name: self.name,
                start_area: self.start_area,
                is_admin: false,
                is_sentinel: false,
            })
            .map_err(|errors| {
                anyhow!(
                    errors
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            })
    }
}

/// UI choices stripped of geometry, spawn locations and transport constants.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCreationCatalog {
    /// Retail attribute help in the same order as the draft's attribute tuple.
    attribute_descriptions: [&'static str; 6],
    /// Shared attribute slider lower bound.
    minimum_attribute: u32,
    /// Shared attribute slider upper bound.
    maximum_attribute: u32,
    /// Required length of a submitted skill advancement vector.
    skill_slots: usize,
    /// Authored starting-area names in catalog order.
    start_areas: Vec<NamedChoice>,
    /// Complete heritage-dependent creation choices.
    heritages: Vec<HeritageChoice>,
}

/// A stable catalog key and its display name.
#[derive(Debug, Serialize)]
struct NamedChoice {
    /// Authored choice identity, independent of UI ordering.
    id: u32,
    /// Authored label.
    name: String,
}

/// Budgets, custom defaults, skill costs and body choices for one heritage.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeritageChoice {
    /// Authored localized lore paragraphs, rendered as plain text.
    lore: Vec<String>,
    /// Applicable racial rules and required-training explanations, prepared once for the Race page.
    benefits: HeritageBenefits,
    /// Heritage identity/name used by the heritage selector.
    #[serde(flatten)]
    identity: NamedChoice,
    /// Total attribute budget enforced by the builder.
    attribute_credits: u32,
    /// Training/specialization budget enforced by the builder.
    skill_credits: u32,
    /// Authored starting areas offered for this heritage, independent of submission policy.
    start_area_ids: Vec<u32>,
    /// Whether the creator should offer starter-clothing controls for this heritage.
    uses_starter_clothing: bool,
    /// Body and appearance options belonging to this heritage.
    genders: Vec<GenderChoice>,
    /// Shared custom/default attributes and complete advancement vector.
    defaults: CharacterCreationDefaults,
    /// Usable creation skills with heritage overrides already applied.
    skills: Vec<SkillChoice>,
}

/// App-local racial explanations and itemized starting skill groups.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeritageBenefits {
    /// Prose explaining innate benefits, weapon affinities, or exceptional server rules.
    descriptions: Vec<String>,
    /// Nonempty training groups shown under one heading each on the Race page.
    skill_groups: Vec<CreationSkillGroup>,
}

/// Starting skills sharing one training entitlement or requirement.
#[derive(Debug, Serialize)]
struct CreationSkillGroup {
    /// Group heading, such as "Free skills".
    label: &'static str,
    /// Authored skill names, alphabetized for browsing.
    skills: Vec<String>,
}

/// One body option and its indexed appearance controls.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenderChoice {
    /// Gender identity/name within the heritage.
    #[serde(flatten)]
    identity: NamedChoice,
    /// Number of authored hair/body styles.
    hair_styles: usize,
    /// Display swatches for each authored hair-color set, in shade order.
    hair_colors: Vec<Vec<String>>,
    /// Skin swatches in authored shade order.
    skin_colors: Vec<String>,
    /// Number of authored eye strip choices.
    eyes: usize,
    /// Display swatches in authored eye-palette order.
    eye_colors: Vec<String>,
    /// Number of authored nose strips.
    noses: usize,
    /// Number of authored mouth strips.
    mouths: usize,
    /// Optional headgear names; no-headgear uses the shared appearance sentinel.
    headgear: Vec<GarmentChoice>,
    /// Authored shirt choices.
    shirts: Vec<GarmentChoice>,
    /// Authored pants choices.
    pants: Vec<GarmentChoice>,
    /// Authored footwear choices.
    footwear: Vec<GarmentChoice>,
}

/// One garment and the actual wire-compatible color keys it offers.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GarmentChoice {
    /// Authored display name; its position in the garment list is the style ordinal.
    name: String,
    /// Content-filtered palette-template keys; UI ordering never changes key identity.
    palette_template_ids: Vec<u32>,
}

impl From<&holtburger_content::character_gen::CharacterGenGear> for GarmentChoice {
    fn from(gear: &holtburger_content::character_gen::CharacterGenGear) -> Self {
        Self {
            name: gear.name.clone(),
            palette_template_ids: gear.palette_template_ids.clone(),
        }
    }
}

/// Starting values from the shared custom/default selection; no frontend template policy.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterCreationDefaults {
    /// Strength/endurance/coordination/quickness/focus/self values.
    attributes: [u32; 6],
    /// Complete advancement vector after shared template minimum selection.
    skills: Vec<u32>,
}

/// Costs and mandatory baseline for a displayed skill, resolved at the host boundary.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillChoice {
    /// Stable skill slot and label.
    #[serde(flatten)]
    identity: NamedChoice,
    /// Authored explanatory text for the skill editor.
    description: String,
    /// DAT-backed base-attribute expression for the expandable skill details.
    formula: Option<CreationSkillFormula>,
    /// Training cost, or unavailable.
    trained_cost: Option<u32>,
    /// Additional specialization cost, or unavailable.
    specialization_upgrade_cost: Option<u32>,
    /// Mandatory heritage advancement baseline.
    minimum_advancement: u32,
}

/// Attribute names and divisor interpreted once from the static DAT formula.
#[derive(Debug, Serialize)]
struct CreationSkillFormula {
    /// Required first attribute label.
    first: String,
    /// Optional second attribute label; DAT zero means no second input.
    second: Option<String>,
    /// Positive divisor applied to the sum, matching ACE AttributeFormula.cs:55–72.
    divisor: u32,
}

impl CreationSkillFormula {
    fn from_dat(formula: &holtburger_dat::file_type::skill_table::SkillFormula) -> Result<Self> {
        let attribute = |id| {
            AttributeType::from_repr(id)
                .map(|attribute| attribute.to_string())
                .with_context(|| {
                    format!("Creation skill formula references unknown attribute {id}")
                })
        };
        anyhow::ensure!(formula.z != 0, "Creation skill formula has a zero divisor");
        Ok(Self {
            first: attribute(formula.attr1)?,
            second: (formula.attr2 != 0)
                .then(|| attribute(formula.attr2))
                .transpose()?,
            divisor: formula.z,
        })
    }
}

/// Average the actual substituted color interval for an unlit UI swatch. The model still
/// owns texture and lighting; retail substitutions use absolute palette offsets.
fn palette_swatch(
    repository: &ContentRepository,
    id: u32,
    range: std::ops::Range<usize>,
) -> Result<String> {
    let [red, green, blue] = repository.read_appearance_palette_swatch(id, range)?;
    Ok(format!("#{red:02x}{green:02x}{blue:02x}"))
}

/// Keep palette-set ordering so the frontend can choose the corresponding wire shade.
fn palette_set_swatches(
    repository: &ContentRepository,
    id: u32,
    range: std::ops::Range<usize>,
) -> Result<Vec<String>> {
    let set = repository.read_palette_set(id)?;
    anyhow::ensure!(
        !set.palette_ids.is_empty(),
        "Creation swatch palette set has no shades"
    );
    set.palette_ids
        .iter()
        .map(|id| palette_swatch(repository, *id, range.clone()))
        .collect()
}

impl CharacterCreationCatalog {
    /// Project one static catalog without loading any world scene or browser assets.
    pub fn from_catalog(
        catalog: &CharacterGenCatalog,
        repository: &ContentRepository,
    ) -> Result<Self> {
        let reference_text = repository.read_character_creation_text()?;
        let heritages = catalog
            .heritage_groups
            .values()
            .map(|heritage| {
                let genders = heritage
                    .genders
                    .values()
                    .map(|gender| {
                        let a = &gender.appearance;
                        Ok(GenderChoice {
                            identity: NamedChoice {
                                id: gender.gender_id,
                                name: gender.name.clone(),
                            },
                            hair_styles: a.hair_styles.len(),
                            hair_colors: a
                                .hair_color_ids
                                .iter()
                                .map(|id| palette_set_swatches(repository, *id, 192..256))
                                .collect::<Result<_>>()?,
                            skin_colors: palette_set_swatches(
                                repository,
                                gender.skin_palette_set,
                                0..192,
                            )?,
                            eyes: a.eye_strips.len(),
                            eye_colors: a
                                .eye_color_ids
                                .iter()
                                .map(|id| palette_swatch(repository, *id, 256..320))
                                .collect::<Result<_>>()?,
                            noses: a.nose_strips.len(),
                            mouths: a.mouth_strips.len(),
                            headgear: a.headgear.iter().map(GarmentChoice::from).collect(),
                            shirts: a.shirts.iter().map(GarmentChoice::from).collect(),
                            pants: a.pants.iter().map(GarmentChoice::from).collect(),
                            footwear: a.footwear.iter().map(GarmentChoice::from).collect(),
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                let template = custom_template_for_heritage(heritage)
                    .context("Creation heritage has no custom/default template")?;
                let defaults = CharacterCreationDefaults {
                    attributes: template.attribute_values().map(|(_, value)| value),
                    skills: (0..catalog.expected_skill_slots as u32)
                        .map(|skill| {
                            minimum_skill_advancement_for_heritage(
                                catalog,
                                heritage.heritage_id,
                                skill,
                            ) as u32
                        })
                        .collect(),
                };
                let cost = |value: i32| {
                    (!is_unavailable_character_gen_skill_cost(value)).then_some(value.max(0) as u32)
                };
                let skills = catalog
                    .skill_definitions
                    .values()
                    .filter(|skill| skill.available_at_creation)
                    .map(|skill| {
                        let costs = catalog
                            .skill_costs_for_heritage(heritage.heritage_id, skill.skill_id)
                            .context("Creation skill is absent from its own catalog")?;
                        Ok(SkillChoice {
                            identity: NamedChoice {
                                id: skill.skill_id,
                                name: skill.name.clone(),
                            },
                            description: skill.description.clone(),
                            formula: skill
                                .formula
                                .as_ref()
                                .map(CreationSkillFormula::from_dat)
                                .transpose()?,
                            trained_cost: cost(costs.trained_cost),
                            specialization_upgrade_cost: cost(costs.specialization_upgrade_cost),
                            minimum_advancement: minimum_skill_advancement_for_heritage(
                                catalog,
                                heritage.heritage_id,
                                skill.skill_id,
                            ) as u32,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(HeritageChoice {
                    lore: reference_text.lore(heritage.heritage_id)?.to_vec(),
                    benefits: heritage_benefit_text(heritage.heritage_id, &skills)?,
                    identity: NamedChoice {
                        id: heritage.heritage_id,
                        name: heritage.name.clone(),
                    },
                    attribute_credits: heritage.attribute_credits,
                    skill_credits: heritage.skill_credits,
                    start_area_ids: catalog
                        .allowed_start_area_ids_for_heritage(heritage.heritage_id)
                        .context("Creation heritage is absent from its own catalog")?,
                    uses_starter_clothing: heritage.uses_starter_clothing,
                    genders,
                    defaults,
                    skills,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            attribute_descriptions: CREATION_ATTRIBUTE_DESCRIPTIONS,
            minimum_attribute: CHARACTER_GEN_MIN_ATTRIBUTE,
            maximum_attribute: CHARACTER_GEN_MAX_ATTRIBUTE,
            skill_slots: catalog.expected_skill_slots,
            start_areas: catalog
                .starter_areas
                .iter()
                .map(|area| NamedChoice {
                    id: area.start_area_id,
                    name: area.name.clone(),
                })
                .collect(),
            heritages,
        })
    }
}

/// Wording is app-local; the shared creation rules own which server benefits each heritage gets.
fn heritage_benefit_text(heritage: u32, skills: &[SkillChoice]) -> Result<HeritageBenefits> {
    let facts = character_gen_heritage_benefits(heritage)
        .with_context(|| format!("Unknown heritage benefits for {heritage}"))?;
    let CharacterGenHeritageBenefits::Standard {
        racial_weapon_masteries: [melee, ranged],
        innate_augmentation,
    } = facts
    else {
        // ACE PlayerFactory.Create bypasses normal attribute/skill allocation for both Olthoi.
        return Ok(HeritageBenefits {
            descriptions: vec!["Olthoi use server-defined attributes and skills rather than normal character-creation allocations.".to_owned()],
            skill_groups: Vec::new(),
        });
    };
    let mut descriptions = vec![format!(
        "Traditional weapon affinities: {melee} (melee) and {ranged} (ranged). These apply on servers using racial mastery rules; servers with universal masteries do not restrict this benefit by race."
    )];
    // Effects verified in ACE CreatureSkill.GetAugBonus_Current, Creature_Rating,
    // DamageEvent, Player_Spells.HasFoci, and Player_Inventory.GetEncumbranceCapacity.
    let description = match innate_augmentation {
        CharacterGenInnateAugmentation::JackOfAllTrades => "Jack of All Trades: +5 to skills.",
        CharacterGenInnateAugmentation::CriticalExpertise => {
            "Critical Expertise: increased critical-hit chance rating."
        }
        CharacterGenInnateAugmentation::DamageReduction => {
            "Damage Reduction: increased damage resistance rating."
        }
        CharacterGenInnateAugmentation::CriticalPower => {
            "Critical Power: increased critical-hit damage rating."
        }
        CharacterGenInnateAugmentation::IncreasedCarryingCapacity => {
            "Increased Carrying Capacity: carry more before becoming burdened."
        }
        CharacterGenInnateAugmentation::InfusedLifeMagic => {
            "Infused Life Magic: an innate Life Magic focus, without carrying a focus item."
        }
        CharacterGenInnateAugmentation::CriticalDefense => {
            "Critical Defense: a chance to resist incoming critical hits."
        }
    };
    descriptions.push(description.to_owned());
    let mut free = Vec::new();
    let mut trained = Vec::new();
    let mut specialized = Vec::new();
    for skill in skills.iter().filter(|skill| skill.minimum_advancement >= 2) {
        let group = if skill.minimum_advancement == 3 {
            &mut specialized
        } else if skill.trained_cost == Some(0) {
            &mut free
        } else {
            &mut trained
        };
        group.push(skill.identity.name.clone());
    }
    let skill_groups = [
        ("Free skills", free),
        ("Required training", trained),
        ("Required specialization", specialized),
    ]
    .into_iter()
    .filter_map(|(label, mut skills)| {
        if skills.is_empty() {
            return None;
        }
        skills.sort();
        Some(CreationSkillGroup { label, skills })
    })
    .collect();
    Ok(HeritageBenefits {
        descriptions,
        skill_groups,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn heritage_help_distinguishes_normal_training_from_server_owned_olthoi_allocations() {
        let skill = |name: &str, cost, minimum| SkillChoice {
            identity: NamedChoice {
                id: 1,
                name: name.to_owned(),
            },
            description: String::new(),
            formula: None,
            trained_cost: Some(cost),
            specialization_upgrade_cost: Some(2),
            minimum_advancement: minimum,
        };
        let skills = [
            skill("Beta", 0, 2),
            skill("Alpha", 0, 2),
            skill("Required", 4, 2),
            skill("Specialized", 0, 3),
            skill("Optional", 4, 1),
        ];
        let normal = heritage_benefit_text(1, &skills).unwrap();
        assert_eq!(normal.skill_groups.len(), 3);
        assert_eq!(normal.skill_groups[0].label, "Free skills");
        assert_eq!(normal.skill_groups[0].skills, ["Alpha", "Beta"]);
        assert_eq!(normal.skill_groups[1].label, "Required training");
        assert_eq!(normal.skill_groups[1].skills, ["Required"]);
        assert_eq!(normal.skill_groups[2].label, "Required specialization");
        assert_eq!(normal.skill_groups[2].skills, ["Specialized"]);
        assert!(
            normal
                .descriptions
                .iter()
                .any(|text| text.contains("universal masteries"))
        );
        for heritage in [12, 13] {
            let olthoi = heritage_benefit_text(heritage, &skills).unwrap();
            assert!(olthoi.skill_groups.is_empty());
            assert_eq!(olthoi.descriptions.len(), 1);
            assert!(olthoi.descriptions[0].contains("server-defined attributes and skills"));
        }
        assert!(heritage_benefit_text(0, &[]).is_err());
    }

    #[test]
    fn skill_formula_projection_preserves_attribute_identity_and_rejects_invalid_inputs() {
        let mut formula = holtburger_dat::file_type::skill_table::SkillFormula {
            w: 0,
            x: 1,
            y: 0,
            z: 3,
            attr1: AttributeType::StrengthAttr as u32,
            attr2: AttributeType::CoordinationAttr as u32,
        };
        let projected = CreationSkillFormula::from_dat(&formula).unwrap();
        assert_eq!(
            serde_json::to_value(projected).unwrap(),
            json!({"first": "Strength", "second": "Coordination", "divisor": formula.z})
        );
        formula.attr2 = 0;
        assert!(
            CreationSkillFormula::from_dat(&formula)
                .unwrap()
                .second
                .is_none()
        );
        formula.z = 0;
        assert!(CreationSkillFormula::from_dat(&formula).is_err());
        formula.z = 1;
        formula.attr1 = u32::MAX;
        assert!(CreationSkillFormula::from_dat(&formula).is_err());
    }

    fn draft_value() -> serde_json::Value {
        json!({
            "heritage": 1, "gender": 1, "name": "Amy", "startArea": 0,
            "attributes": [100, 10, 100, 100, 10, 10], "skills": [],
            "appearance": {
                "eyes": 0, "nose": 0, "mouth": 0, "hairColor": 0, "eyeColor": 0, "hairStyle": 0,
                "headgearStyle": u32::MAX, "headgearColor": 0, "shirtStyle": 0, "shirtColor": 0,
                "pantsStyle": 0, "pantsColor": 0, "footwearStyle": 0, "footwearColor": 0,
                "skinHue": 0.5, "hairHue": 0.5, "headgearHue": 0.0, "shirtHue": 0.0,
                "pantsHue": 0.0, "footwearHue": 0.0
            }
        })
    }

    #[test]
    fn semantic_draft_rejects_noneditable_authority_fields() {
        let draft = draft_value();
        assert!(serde_json::from_value::<CharacterCreationDraft>(draft.clone()).is_ok());
        for (field, value) in [
            ("isAdmin", json!(true)),
            ("isSentinel", json!(true)),
            ("accountName", json!("another account")),
            ("characterSlot", json!(99)),
            ("templateOption", json!(1)),
        ] {
            let mut invalid = draft.clone();
            invalid[field] = value;
            assert!(
                serde_json::from_value::<CharacterCreationDraft>(invalid).is_err(),
                "accepted {field}"
            );
        }
    }
}

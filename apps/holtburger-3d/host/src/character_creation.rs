//! Pre-game choice projection and semantic draft adaptation; rules remain in core/content.

use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use holtburger_content::CharacterGenCatalog;
use holtburger_content::character_gen::is_unavailable_character_gen_skill_cost;
use holtburger_content::{ContentRepository, MotionClip};
use holtburger_core::character_gen::{
    CHARACTER_GEN_MAX_ATTRIBUTE, CHARACTER_GEN_MIN_ATTRIBUTE, CharacterGenBuild,
    CharacterGenBuilder, character_gen_appearance_choices, custom_template_for_heritage,
    minimum_skill_advancement_for_heritage,
};
use holtburger_core::client::object_preview::{
    ObjectPreviewClip, ObjectPreviewPose, ObjectPreviewVisual,
};
use holtburger_protocol::messages::{
    CharacterCreateAppearanceData, CharacterCreateRequestData, SkillAdvancementClass,
};
use serde::{Deserialize, Serialize};

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

/// One body option and its indexed appearance controls.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenderChoice {
    /// Gender identity/name within the heritage.
    #[serde(flatten)]
    identity: NamedChoice,
    /// Number of authored hair/body styles.
    hair_styles: usize,
    /// Number of authored hair-color palette sets.
    hair_colors: usize,
    /// Number of authored eye strip choices.
    eyes: usize,
    /// Number of authored eye palettes.
    eye_colors: usize,
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
    /// Training cost, or unavailable.
    trained_cost: Option<u32>,
    /// Additional specialization cost, or unavailable.
    specialization_upgrade_cost: Option<u32>,
    /// Mandatory heritage advancement baseline.
    minimum_advancement: u32,
}

impl CharacterCreationCatalog {
    /// Project one static catalog without loading any world scene or browser assets.
    pub fn from_catalog(catalog: &CharacterGenCatalog) -> Result<Self> {
        let heritages = catalog
            .heritage_groups
            .values()
            .map(|heritage| {
                let genders = heritage
                    .genders
                    .values()
                    .map(|gender| {
                        let a = &gender.appearance;
                        GenderChoice {
                            identity: NamedChoice {
                                id: gender.gender_id,
                                name: gender.name.clone(),
                            },
                            hair_styles: a.hair_styles.len(),
                            hair_colors: a.hair_color_ids.len(),
                            eyes: a.eye_strips.len(),
                            eye_colors: a.eye_color_ids.len(),
                            noses: a.nose_strips.len(),
                            mouths: a.mouth_strips.len(),
                            headgear: a.headgear.iter().map(GarmentChoice::from).collect(),
                            shirts: a.shirts.iter().map(GarmentChoice::from).collect(),
                            pants: a.pants.iter().map(GarmentChoice::from).collect(),
                            footwear: a.footwear.iter().map(GarmentChoice::from).collect(),
                        }
                    })
                    .collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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

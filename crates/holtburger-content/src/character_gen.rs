use anyhow::{Context, Result};
use holtburger_common::stats::{AttributeType, SkillType};
use holtburger_dat::file_type::char_gen::{
    CharacterGenGender, CharacterTemplate, EyeStrip, FaceStrip, Gear, HairStyle, HeritageGroup,
    StarterArea, StarterLocation,
};
use holtburger_dat::file_type::material::ClothingTable;
use holtburger_dat::file_type::{CharGen, SkillTable};
use holtburger_dat::graphics::Frame;
use std::collections::BTreeMap;

pub mod appearance;

/// Authored cost at or above this value disables the corresponding creation advancement.
pub const CHARACTER_GEN_UNAVAILABLE_SKILL_COST: i32 = 999;

/// Preserve unavailable totals before subtracting training; 999 must not become an offered 993.
pub fn is_unavailable_character_gen_skill_cost(cost: i32) -> bool {
    cost >= CHARACTER_GEN_UNAVAILABLE_SKILL_COST
}

/// Gear and Olthoi bodies do not wear starter clothing (ACE `PlayerFactory.Create`). Retail hides
/// their clothing controls in `gmCGAppearancePage::Update`, acclient.c:178956/179017.
pub fn uses_starter_clothing(heritage_id: u32) -> bool {
    !matches!(heritage_id, 6 | 12 | 13)
}

impl crate::ContentRepository {
    /// Assemble creation choices independently of world bootstrap or network authority.
    pub fn read_character_gen_catalog(&self) -> anyhow::Result<CharacterGenCatalog> {
        let char_gen = self.read_asset::<CharGen>("character generator table")?;
        let skills = self.read_asset::<SkillTable>("character generator skills")?;
        let clothing = read_clothing_tables(
            self,
            char_gen
                .heritage_groups
                .iter()
                .filter(|(id, _)| uses_starter_clothing(**id))
                .flat_map(|(_, group)| group.genders.values()),
        )?;
        CharacterGenCatalog::from_assets(&char_gen, &skills, &clothing)
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenCatalog {
    pub starter_areas: Vec<CharacterGenStarterArea>,
    pub heritage_groups: BTreeMap<u32, CharacterGenHeritageGroup>,
    pub skill_definitions: BTreeMap<u32, CharacterGenSkillDefinition>,
    pub expected_skill_slots: usize,
}

impl CharacterGenCatalog {
    /// Assemble parsed creation records and their clothing closure into validated choice lists.
    pub fn from_assets(
        char_gen: &CharGen,
        skill_table: &SkillTable,
        clothing: &BTreeMap<u32, ClothingTable>,
    ) -> Result<Self> {
        let starter_areas = char_gen
            .starter_areas
            .iter()
            .enumerate()
            .map(|(index, area)| CharacterGenStarterArea::from_asset(index as u32, area))
            .collect();

        let heritage_groups = char_gen
            .heritage_groups
            .iter()
            .map(|(heritage_id, group)| {
                Ok((
                    *heritage_id,
                    CharacterGenHeritageGroup::from_asset(*heritage_id, group, clothing)?,
                ))
            })
            .collect::<Result<_>>()?;

        let skill_definitions = skill_table
            .skill_base_hash
            .iter()
            .map(|(skill_id, skill)| {
                let skill_type = SkillType::from_repr(*skill_id);
                (
                    *skill_id,
                    CharacterGenSkillDefinition {
                        skill_id: *skill_id,
                        skill_type,
                        name: skill.name.clone(),
                        description: skill.description.clone(),
                        formula: (skill.formula.x != 0).then(|| skill.formula.clone()),
                        available_at_creation: skill.chargen_use != 0
                            && skill_type.is_some_and(|skill| skill.is_eor()),
                        trained_cost: skill.trained_cost,
                        specialization_total_cost: skill.specialized_cost,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();

        let expected_skill_slots = skill_definitions
            .keys()
            .next_back()
            .map(|skill_id| *skill_id as usize + 1)
            .unwrap_or(0);

        Ok(Self {
            starter_areas,
            heritage_groups,
            skill_definitions,
            expected_skill_slots,
        })
    }

    pub fn heritage_group(&self, heritage_id: u32) -> Option<&CharacterGenHeritageGroup> {
        self.heritage_groups.get(&heritage_id)
    }

    pub fn starter_area(&self, start_area_id: u32) -> Option<&CharacterGenStarterArea> {
        self.starter_areas
            .get(start_area_id as usize)
            .filter(|area| area.start_area_id == start_area_id)
    }

    pub fn skill_definition(&self, skill_id: u32) -> Option<&CharacterGenSkillDefinition> {
        self.skill_definitions.get(&skill_id)
    }

    pub fn skill_costs_for_heritage(
        &self,
        heritage_id: u32,
        skill_id: u32,
    ) -> Option<CharacterGenSkillCosts> {
        let base = self.skill_definition(skill_id)?;
        let override_costs = self
            .heritage_group(heritage_id)
            .and_then(|group| group.skill_overrides.get(&skill_id));

        Some(CharacterGenSkillCosts {
            trained_cost: override_costs
                .map(|costs| costs.trained_cost)
                .unwrap_or(base.trained_cost),
            // SkillTable stores the total; CharGen PrimaryCost already stores the upgrade.
            // ACE PlayerFactory.cs:184–192 and SkillBase.UpgradeCostFromTrainedToSpecialized.
            specialization_upgrade_cost: override_costs.map_or_else(
                || {
                    if is_unavailable_character_gen_skill_cost(base.specialization_total_cost) {
                        base.specialization_total_cost
                    } else {
                        base.specialization_total_cost - base.trained_cost
                    }
                },
                |costs| costs.specialization_upgrade_cost,
            ),
        })
    }

    pub fn allowed_start_area_ids_for_heritage(&self, heritage_id: u32) -> Option<Vec<u32>> {
        let group = self.heritage_group(heritage_id)?;
        Some(
            group
                .primary_start_area_ids
                .iter()
                .chain(group.secondary_start_area_ids.iter())
                .filter_map(|start_area_id| u32::try_from(*start_area_id).ok())
                .collect(),
        )
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenStarterArea {
    pub start_area_id: u32,
    pub name: String,
    pub locations: Vec<CharacterGenStarterLocation>,
}

impl CharacterGenStarterArea {
    fn from_asset(start_area_id: u32, area: &StarterArea) -> Self {
        Self {
            start_area_id,
            name: area.name.clone(),
            locations: area
                .locations
                .iter()
                .map(CharacterGenStarterLocation::from_asset)
                .collect(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenStarterLocation {
    pub obj_cell_id: u32,
    pub frame: Frame,
}

impl CharacterGenStarterLocation {
    fn from_asset(location: &StarterLocation) -> Self {
        Self {
            obj_cell_id: location.obj_cell_id,
            frame: location.frame.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenHeritageGroup {
    pub heritage_id: u32,
    pub name: String,
    pub icon_image: u32,
    pub setup_id: u32,
    pub environment_setup_id: u32,
    pub attribute_credits: u32,
    pub skill_credits: u32,
    /// Whether this body's creation flow offers/equips separate starter clothing.
    pub uses_starter_clothing: bool,
    pub primary_start_area_ids: Vec<i32>,
    pub secondary_start_area_ids: Vec<i32>,
    pub skill_overrides: BTreeMap<u32, CharacterGenSkillOverride>,
    pub templates: Vec<CharacterGenTemplate>,
    pub genders: BTreeMap<u32, CharacterGenGenderDefinition>,
}

impl CharacterGenHeritageGroup {
    fn from_asset(
        heritage_id: u32,
        group: &HeritageGroup,
        clothing: &BTreeMap<u32, ClothingTable>,
    ) -> Result<Self> {
        Ok(Self {
            heritage_id,
            name: group.name.clone(),
            icon_image: group.icon_image,
            setup_id: group.setup_id,
            environment_setup_id: group.environment_setup_id,
            attribute_credits: group.attribute_credits,
            skill_credits: group.skill_credits,
            uses_starter_clothing: uses_starter_clothing(heritage_id),
            primary_start_area_ids: group.primary_start_areas.clone(),
            secondary_start_area_ids: group.secondary_start_areas.clone(),
            skill_overrides: group
                .skills
                .iter()
                .map(|skill| {
                    (
                        skill.skill_num,
                        CharacterGenSkillOverride {
                            skill_id: skill.skill_num,
                            skill_type: SkillType::from_repr(skill.skill_num),
                            trained_cost: skill.normal_cost,
                            specialization_upgrade_cost: skill.primary_cost,
                        },
                    )
                })
                .collect(),
            templates: group
                .templates
                .iter()
                .enumerate()
                .map(|(index, template)| CharacterGenTemplate::from_asset(index as i32, template))
                .collect(),
            genders: group
                .genders
                .iter()
                .map(|(gender_id, gender)| {
                    let gender_id =
                        u32::try_from(*gender_id).context("negative creation gender identity")?;
                    Ok((
                        gender_id,
                        CharacterGenGenderDefinition::from_asset(
                            gender_id,
                            gender,
                            uses_starter_clothing(heritage_id),
                            clothing,
                        )?,
                    ))
                })
                .collect::<Result<_>>()?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenSkillDefinition {
    pub skill_id: u32,
    pub skill_type: Option<SkillType>,
    pub name: String,
    pub description: String,
    /// Authored attribute formula, absent when X disables it (ACE AttributeFormula.cs:57).
    pub formula: Option<holtburger_dat::file_type::skill_table::SkillFormula>,
    /// Resolved creation eligibility: the authored flag and ACE's active EOR skill set.
    /// Retired, unimplemented, and unknown definitions remain available for wire-slot lookup.
    pub available_at_creation: bool,
    pub trained_cost: i32,
    /// Raw SkillTable total, including training; interpreted only by skill_costs_for_heritage.
    pub specialization_total_cost: i32,
}

/// Interpreted creation tier charges; consumers never repeat raw total/override conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CharacterGenSkillCosts {
    /// Charge to advance from untrained to trained, or the unavailable-cost sentinel.
    pub trained_cost: i32,
    /// Additional charge after training, or the unavailable-cost sentinel.
    pub specialization_upgrade_cost: i32,
}

#[derive(Debug, Clone)]
pub struct CharacterGenSkillOverride {
    pub skill_id: u32,
    pub skill_type: Option<SkillType>,
    pub trained_cost: i32,
    /// CharGen PrimaryCost is already an additional specialization charge.
    pub specialization_upgrade_cost: i32,
}

#[derive(Debug, Clone)]
pub struct CharacterGenTemplate {
    pub template_option: i32,
    pub name: String,
    pub icon_image: u32,
    pub title_id: u32,
    pub strength: u32,
    pub endurance: u32,
    pub coordination: u32,
    pub quickness: u32,
    pub focus: u32,
    pub self_stat: u32,
    pub normal_skills: Vec<u32>,
    pub primary_skills: Vec<u32>,
}

impl CharacterGenTemplate {
    fn from_asset(template_option: i32, template: &CharacterTemplate) -> Self {
        Self {
            template_option,
            name: template.name.clone(),
            icon_image: template.icon_image,
            title_id: template.title_id,
            strength: template.strength,
            endurance: template.endurance,
            coordination: template.coordination,
            quickness: template.quickness,
            focus: template.focus,
            self_stat: template.self_stat,
            normal_skills: template.normal_skills.clone(),
            primary_skills: template.primary_skills.clone(),
        }
    }

    pub fn attribute_values(&self) -> [(AttributeType, u32); 6] {
        [
            (AttributeType::StrengthAttr, self.strength),
            (AttributeType::EnduranceAttr, self.endurance),
            (AttributeType::CoordinationAttr, self.coordination),
            (AttributeType::QuicknessAttr, self.quickness),
            (AttributeType::FocusAttr, self.focus),
            (AttributeType::SelfAttr, self.self_stat),
        ]
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenGenderDefinition {
    pub gender_id: u32,
    pub name: String,
    pub scale: u32,
    pub setup_id: u32,
    pub sound_table: u32,
    pub icon_image: u32,
    pub base_palette: u32,
    pub skin_palette_set: u32,
    pub physics_table: u32,
    pub motion_table: u32,
    pub combat_table: u32,
    pub appearance: CharacterGenAppearanceOptions,
}

impl CharacterGenGenderDefinition {
    fn from_asset(
        gender_id: u32,
        gender: &CharacterGenGender,
        uses_starter_clothing: bool,
        clothing: &BTreeMap<u32, ClothingTable>,
    ) -> Result<Self> {
        let gear = |items: &[Gear]| -> Result<Vec<CharacterGenGear>> {
            if !uses_starter_clothing {
                return Ok(Vec::new());
            }
            items
                .iter()
                .map(|item| {
                    CharacterGenGear::from_asset(item, &gender.clothing_colors_list, clothing)
                })
                .collect()
        };
        Ok(Self {
            gender_id,
            name: gender.name.clone(),
            scale: gender.scale,
            setup_id: gender.setup_id,
            sound_table: gender.sound_table,
            icon_image: gender.icon_image,
            base_palette: gender.base_palette,
            skin_palette_set: gender.skin_palette_set,
            physics_table: gender.physics_table,
            motion_table: gender.motion_table,
            combat_table: gender.combat_table,
            appearance: CharacterGenAppearanceOptions {
                hair_color_ids: gender.hair_color_list.clone(),
                hair_styles: gender
                    .hair_style_list
                    .iter()
                    .map(CharacterGenHairStyle::from_asset)
                    .collect(),
                eye_color_ids: gender.eye_color_list.clone(),
                eye_strips: gender
                    .eye_strip_list
                    .iter()
                    .map(CharacterGenEyeStrip::from_asset)
                    .collect(),
                nose_strips: gender
                    .nose_strip_list
                    .iter()
                    .map(CharacterGenFaceStrip::from_asset)
                    .collect(),
                mouth_strips: gender
                    .mouth_strip_list
                    .iter()
                    .map(CharacterGenFaceStrip::from_asset)
                    .collect(),
                headgear: gear(&gender.headgear_list)?,
                shirts: gear(&gender.shirt_list)?,
                pants: gear(&gender.pants_list)?,
                footwear: gear(&gender.footwear_list)?,
            },
        })
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenAppearanceOptions {
    pub hair_color_ids: Vec<u32>,
    pub hair_styles: Vec<CharacterGenHairStyle>,
    pub eye_color_ids: Vec<u32>,
    pub eye_strips: Vec<CharacterGenEyeStrip>,
    pub nose_strips: Vec<CharacterGenFaceStrip>,
    pub mouth_strips: Vec<CharacterGenFaceStrip>,
    pub headgear: Vec<CharacterGenGear>,
    pub shirts: Vec<CharacterGenGear>,
    pub pants: Vec<CharacterGenGear>,
    pub footwear: Vec<CharacterGenGear>,
}

#[derive(Debug, Clone)]
pub struct CharacterGenHairStyle {
    pub icon_image: u32,
    pub bald: bool,
    pub alternate_setup: u32,
}

impl CharacterGenHairStyle {
    fn from_asset(style: &HairStyle) -> Self {
        Self {
            icon_image: style.icon_image,
            bald: style.bald,
            alternate_setup: style.alternate_setup,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenEyeStrip {
    pub icon_image: u32,
    pub icon_image_bald: u32,
}

impl CharacterGenEyeStrip {
    fn from_asset(eye_strip: &EyeStrip) -> Self {
        Self {
            icon_image: eye_strip.icon_image,
            icon_image_bald: eye_strip.icon_image_bald,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenFaceStrip {
    pub icon_image: u32,
}

impl CharacterGenFaceStrip {
    fn from_asset(face_strip: &FaceStrip) -> Self {
        Self {
            icon_image: face_strip.icon_image,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenGear {
    pub name: String,
    pub clothing_table: u32,
    pub weenie_default: u32,
    /// Eligible palette-template keys for this garment; key zero means no palette overlay.
    pub palette_template_ids: Vec<u32>,
}

impl CharacterGenGear {
    fn from_asset(
        gear: &Gear,
        whitelist: &[u32],
        clothing: &BTreeMap<u32, ClothingTable>,
    ) -> Result<Self> {
        let table = clothing.get(&gear.clothing_table).with_context(|| {
            format!(
                "creation garment {} has no clothing table 0x{:08X}",
                gear.name, gear.clothing_table
            )
        })?;
        // CharGenState::StoreColorInformation, acclient.c:472586: template keys must occur in
        // the gender whitelist and author palette effects. UI order is independent of the key.
        let mut palette_template_ids = table
            .palette_templates
            .iter()
            .filter(|(key, template)| {
                whitelist.contains(key) && !template.subpal_effects.is_empty()
            })
            .map(|(key, _)| *key)
            .collect::<Vec<_>>();
        if palette_template_ids.is_empty() {
            // Get*PaletteTemplateID returns zero when there are no eligible colors
            // (acclient.c:471845–471878); ClothingTable::BuildObjDesc treats it as no overlay.
            palette_template_ids.push(0);
        }
        Ok(Self {
            name: gear.name.clone(),
            clothing_table: gear.clothing_table,
            weenie_default: gear.weenie_default,
            palette_template_ids,
        })
    }
}

/// Load each required clothing table once per static preparation batch.
fn read_clothing_tables<'a>(
    repository: &crate::ContentRepository,
    genders: impl IntoIterator<Item = &'a CharacterGenGender>,
) -> Result<BTreeMap<u32, ClothingTable>> {
    let mut tables = BTreeMap::new();
    for gender in genders {
        for gear in gender
            .headgear_list
            .iter()
            .chain(&gender.shirt_list)
            .chain(&gender.pants_list)
            .chain(&gender.footwear_list)
        {
            if let std::collections::btree_map::Entry::Vacant(entry) =
                tables.entry(gear.clothing_table)
            {
                entry.insert(crate::material_graph::read_clothing_table(
                    repository,
                    gear.clothing_table,
                )?);
            }
        }
    }
    Ok(tables)
}

#[cfg(test)]
mod skill_availability_tests {
    use super::*;
    use holtburger_dat::file_type::skill_table::{SkillBase, SkillFormula};
    use std::collections::HashMap;

    #[test]
    fn creation_eligibility_combines_authored_flags_with_eor_membership_without_removing_slots() {
        let unknown_id = SkillType::Summoning as u32 + 1;
        let cases = [
            (SkillType::MeleeDefense as u32, 1, true),
            (SkillType::MissileDefense as u32, 0, false),
            (SkillType::Axe as u32, 1, false),
            (SkillType::Gearcraft as u32, 1, false),
            (SkillType::Spellcraft as u32, 1, false),
            (0, 1, false), // The inactive wire slot has no SkillType variant.
            (unknown_id, 1, false),
        ];
        let skills = SkillTable {
            skill_base_hash: cases
                .iter()
                .map(|(id, flag, _)| (*id, skill(*flag)))
                .collect(),
            ..SkillTable::default()
        };
        let char_gen = CharGen {
            id: CharGen::FILE_ID,
            starter_areas: Vec::new(),
            heritage_groups: HashMap::new(),
        };
        let catalog = CharacterGenCatalog::from_assets(&char_gen, &skills, &BTreeMap::new())
            .expect("synthetic catalog should assemble");

        for (id, _, expected) in cases {
            let definition = catalog.skill_definition(id).expect("wire slot must remain");
            assert_eq!(definition.available_at_creation, expected, "skill {id}");
            assert_eq!(definition.trained_cost, 0);
        }
        assert_eq!(catalog.expected_skill_slots, unknown_id as usize + 1);
    }

    #[test]
    fn creation_catalog_preserves_enabled_skill_formulas_and_descriptions() {
        let mut defined = skill(1);
        defined.description = "A DAT skill description".into();
        defined.formula.x = 1;
        defined.formula.z = 3;
        defined.formula.attr1 = AttributeType::StrengthAttr as u32;
        defined.formula.attr2 = AttributeType::CoordinationAttr as u32;
        let table = SkillTable {
            skill_base_hash: HashMap::from([
                (SkillType::MeleeDefense as u32, defined.clone()),
                (SkillType::MissileDefense as u32, skill(1)),
            ]),
            ..SkillTable::default()
        };
        let char_gen = CharGen {
            id: CharGen::FILE_ID,
            starter_areas: Vec::new(),
            heritage_groups: HashMap::new(),
        };
        let catalog =
            CharacterGenCatalog::from_assets(&char_gen, &table, &BTreeMap::new()).unwrap();
        let projected = catalog
            .skill_definition(SkillType::MeleeDefense as u32)
            .unwrap();
        assert_eq!(projected.description, defined.description);
        let formula = projected.formula.as_ref().unwrap();
        assert_eq!(
            (formula.attr1, formula.attr2, formula.z),
            (
                defined.formula.attr1,
                defined.formula.attr2,
                defined.formula.z
            )
        );
        assert!(
            catalog
                .skill_definition(SkillType::MissileDefense as u32)
                .unwrap()
                .formula
                .is_none()
        );
    }

    fn skill(chargen_use: u32) -> SkillBase {
        SkillBase {
            name: "Skill".into(),
            description: String::new(),
            _align1: (),
            _align2: (),
            icon_id: 0,
            // Match the zero-cost definitions synthesized for retired skills by the DAT reader.
            trained_cost: 0,
            specialized_cost: 0,
            category: 0,
            chargen_use,
            min_level: 0,
            formula: SkillFormula {
                w: 0,
                x: 0,
                y: 0,
                z: 0,
                attr1: 0,
                attr2: 0,
            },
            upper_bound: 0.0,
            lower_bound: 0.0,
            learn_mod: 0.0,
        }
    }
}

#[cfg(test)]
mod skill_cost_tests {
    use super::*;

    fn catalog(total: i32) -> CharacterGenCatalog {
        CharacterGenCatalog {
            starter_areas: Vec::new(),
            heritage_groups: BTreeMap::new(),
            skill_definitions: BTreeMap::from([(
                1,
                CharacterGenSkillDefinition {
                    skill_id: 1,
                    skill_type: None,
                    name: "Skill".into(),
                    description: String::new(),
                    formula: None,
                    available_at_creation: true,
                    trained_cost: 6,
                    specialization_total_cost: total,
                },
            )]),
            expected_skill_slots: 2,
        }
    }

    #[test]
    fn base_specialization_total_is_converted_once_to_an_upgrade_charge() {
        let catalog = catalog(10);
        assert_eq!(
            catalog.skill_costs_for_heritage(1, 1),
            Some(CharacterGenSkillCosts {
                trained_cost: 6,
                specialization_upgrade_cost: 4,
            })
        );
        assert_eq!(
            catalog
                .skill_definition(1)
                .unwrap()
                .specialization_total_cost,
            10
        );
    }

    #[test]
    fn heritage_primary_cost_is_already_an_upgrade_and_overrides_both_tiers() {
        let mut catalog = catalog(10);
        catalog.heritage_groups.insert(
            1,
            CharacterGenHeritageGroup {
                heritage_id: 1,
                name: "Heritage".into(),
                icon_image: 0,
                setup_id: 0,
                environment_setup_id: 0,
                attribute_credits: 330,
                skill_credits: 52,
                uses_starter_clothing: true,
                primary_start_area_ids: Vec::new(),
                secondary_start_area_ids: Vec::new(),
                templates: Vec::new(),
                genders: BTreeMap::new(),
                skill_overrides: BTreeMap::from([(
                    1,
                    CharacterGenSkillOverride {
                        skill_id: 1,
                        skill_type: None,
                        trained_cost: 3,
                        specialization_upgrade_cost: 7,
                    },
                )]),
            },
        );
        assert_eq!(
            catalog.skill_costs_for_heritage(1, 1),
            Some(CharacterGenSkillCosts {
                trained_cost: 3,
                specialization_upgrade_cost: 7,
            })
        );
    }

    #[test]
    fn unavailable_specialization_never_becomes_an_affordable_upgrade_after_subtraction() {
        let catalog = catalog(CHARACTER_GEN_UNAVAILABLE_SKILL_COST);
        let costs = catalog.skill_costs_for_heritage(1, 1).unwrap();
        assert_eq!(
            costs.specialization_upgrade_cost,
            CHARACTER_GEN_UNAVAILABLE_SKILL_COST
        );
        assert!(is_unavailable_character_gen_skill_cost(
            costs.specialization_upgrade_cost
        ));
    }
}

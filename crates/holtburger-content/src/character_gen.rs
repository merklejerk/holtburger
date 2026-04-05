use holtburger_common::stats::{AttributeType, SkillType};
use holtburger_dat::file_type::char_gen::{
    CharacterGenGender, CharacterTemplate, EyeStrip, FaceStrip, Gear, HairStyle, HeritageGroup,
    StarterArea, StarterLocation,
};
use holtburger_dat::file_type::{CharGen, SkillTable};
use holtburger_dat::graphics::Frame;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct CharacterGenCatalog {
    pub starter_areas: Vec<CharacterGenStarterArea>,
    pub heritage_groups: BTreeMap<u32, CharacterGenHeritageGroup>,
    pub skill_definitions: BTreeMap<u32, CharacterGenSkillDefinition>,
    pub expected_skill_slots: usize,
}

impl CharacterGenCatalog {
    pub fn from_assets(char_gen: &CharGen, skill_table: &SkillTable) -> Self {
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
                (
                    *heritage_id,
                    CharacterGenHeritageGroup::from_asset(*heritage_id, group),
                )
            })
            .collect();

        let skill_definitions = skill_table
            .skill_base_hash
            .iter()
            .map(|(skill_id, skill)| {
                (
                    *skill_id,
                    CharacterGenSkillDefinition {
                        skill_id: *skill_id,
                        skill_type: SkillType::from_repr(*skill_id),
                        name: skill.name.clone(),
                        description: skill.description.clone(),
                        chargen_use: skill.chargen_use != 0,
                        trained_cost: skill.trained_cost,
                        specialized_cost: skill.specialized_cost,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();

        let expected_skill_slots = skill_definitions
            .keys()
            .next_back()
            .map(|skill_id| *skill_id as usize + 1)
            .unwrap_or(0);

        Self {
            starter_areas,
            heritage_groups,
            skill_definitions,
            expected_skill_slots,
        }
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
            specialized_cost: override_costs
                .map(|costs| costs.specialized_cost)
                .unwrap_or(base.specialized_cost),
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
    pub primary_start_area_ids: Vec<i32>,
    pub secondary_start_area_ids: Vec<i32>,
    pub skill_overrides: BTreeMap<u32, CharacterGenSkillOverride>,
    pub templates: Vec<CharacterGenTemplate>,
    pub genders: BTreeMap<u32, CharacterGenGenderDefinition>,
}

impl CharacterGenHeritageGroup {
    fn from_asset(heritage_id: u32, group: &HeritageGroup) -> Self {
        Self {
            heritage_id,
            name: group.name.clone(),
            icon_image: group.icon_image,
            setup_id: group.setup_id,
            environment_setup_id: group.environment_setup_id,
            attribute_credits: group.attribute_credits,
            skill_credits: group.skill_credits,
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
                            specialized_cost: skill.primary_cost,
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
                .filter_map(|(gender_id, gender)| {
                    u32::try_from(*gender_id).ok().map(|gender_id| {
                        (
                            gender_id,
                            CharacterGenGenderDefinition::from_asset(gender_id, gender),
                        )
                    })
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenSkillDefinition {
    pub skill_id: u32,
    pub skill_type: Option<SkillType>,
    pub name: String,
    pub description: String,
    pub chargen_use: bool,
    pub trained_cost: i32,
    pub specialized_cost: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CharacterGenSkillCosts {
    pub trained_cost: i32,
    pub specialized_cost: i32,
}

#[derive(Debug, Clone)]
pub struct CharacterGenSkillOverride {
    pub skill_id: u32,
    pub skill_type: Option<SkillType>,
    pub trained_cost: i32,
    pub specialized_cost: i32,
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
    fn from_asset(gender_id: u32, gender: &CharacterGenGender) -> Self {
        Self {
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
                headgear: gender
                    .headgear_list
                    .iter()
                    .map(CharacterGenGear::from_asset)
                    .collect(),
                shirts: gender
                    .shirt_list
                    .iter()
                    .map(CharacterGenGear::from_asset)
                    .collect(),
                pants: gender
                    .pants_list
                    .iter()
                    .map(CharacterGenGear::from_asset)
                    .collect(),
                footwear: gender
                    .footwear_list
                    .iter()
                    .map(CharacterGenGear::from_asset)
                    .collect(),
                clothing_color_ids: gender.clothing_colors_list.clone(),
            },
        }
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
    pub clothing_color_ids: Vec<u32>,
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
}

impl CharacterGenGear {
    fn from_asset(gear: &Gear) -> Self {
        Self {
            name: gear.name.clone(),
            clothing_table: gear.clothing_table,
            weenie_default: gear.weenie_default,
        }
    }
}

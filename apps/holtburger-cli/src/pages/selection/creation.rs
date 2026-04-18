use crate::components::text_input::SingleLineTextInput;
use crate::types::{AppAction, AppUiAction, Verb};
use holtburger_common::stats::AttributeType;
use holtburger_content::character_gen::{
    CharacterGenGenderDefinition, CharacterGenHeritageGroup, CharacterGenSkillDefinition,
    CharacterGenStarterArea, CharacterGenTemplate,
};
use holtburger_content::{CharacterGenCatalog, ContentRepository};
use holtburger_core::character_gen::{
    CHARACTER_GEN_MAX_ATTRIBUTE, CHARACTER_GEN_MIN_ATTRIBUTE, custom_template_for_heritage,
    is_unavailable_character_gen_skill_cost, minimum_skill_advancement_for_heritage,
};
use holtburger_core::{CharacterGenBuild, CharacterGenBuilder, CharacterGenValidationError};
use holtburger_dat::file_type::{CharGen, SkillTable};
use holtburger_protocol::messages::SkillAdvancementClass;
use std::collections::BTreeSet;
use std::sync::Arc;

const ATTRIBUTE_ORDER: [(AttributeType, &str); 6] = [
    (AttributeType::StrengthAttr, "Strength"),
    (AttributeType::EnduranceAttr, "Endurance"),
    (AttributeType::CoordinationAttr, "Coordination"),
    (AttributeType::QuicknessAttr, "Quickness"),
    (AttributeType::FocusAttr, "Focus"),
    (AttributeType::SelfAttr, "Self"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterCreationFocus {
    Name,
    Heritage,
    StarterTown,
    Gender,
    Attributes,
    Skills,
    Submit,
}

impl CharacterCreationFocus {
    pub fn step(self, delta: i32) -> Self {
        const ORDER: [CharacterCreationFocus; 7] = [
            CharacterCreationFocus::Name,
            CharacterCreationFocus::Heritage,
            CharacterCreationFocus::StarterTown,
            CharacterCreationFocus::Gender,
            CharacterCreationFocus::Attributes,
            CharacterCreationFocus::Skills,
            CharacterCreationFocus::Submit,
        ];

        let index = ORDER
            .iter()
            .position(|focus| *focus == self)
            .unwrap_or_default() as i32;
        let len = ORDER.len() as i32;
        let next = (index + delta).rem_euclid(len) as usize;
        ORDER[next]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterCreationFeedback {
    pub message: String,
    pub is_error: bool,
}

#[derive(Debug, Clone)]
pub enum CharacterCreationState {
    Unavailable { message: String },
    Ready(Box<CharacterCreationFormState>),
}

impl Default for CharacterCreationState {
    fn default() -> Self {
        Self::Unavailable {
            message: "Character generation data is not loaded.".to_string(),
        }
    }
}

impl CharacterCreationState {
    pub fn from_repository(repository: Option<&Arc<ContentRepository>>) -> Self {
        let Some(repository) = repository else {
            return Self::default();
        };

        let char_gen = match repository.read_asset::<CharGen>("character generator table") {
            Ok(char_gen) => char_gen,
            Err(error) => {
                return Self::Unavailable {
                    message: format!("Could not load character generator table: {}", error),
                };
            }
        };

        let skill_table = match repository.read_asset::<SkillTable>("skill table") {
            Ok(skill_table) => skill_table,
            Err(error) => {
                return Self::Unavailable {
                    message: format!("Could not load skill table: {}", error),
                };
            }
        };

        Self::from_catalog(Arc::new(CharacterGenCatalog::from_assets(
            &char_gen,
            &skill_table,
        )))
    }

    pub fn from_catalog(catalog: Arc<CharacterGenCatalog>) -> Self {
        Self::Ready(Box::new(CharacterCreationFormState::new(catalog)))
    }

    pub fn ready(&self) -> Option<&CharacterCreationFormState> {
        match self {
            Self::Ready(form) => Some(form.as_ref()),
            Self::Unavailable { .. } => None,
        }
    }

    pub fn ready_mut(&mut self) -> Option<&mut CharacterCreationFormState> {
        match self {
            Self::Ready(form) => Some(form.as_mut()),
            Self::Unavailable { .. } => None,
        }
    }

    pub fn unavailable_message(&self) -> Option<&str> {
        match self {
            Self::Unavailable { message } => Some(message.as_str()),
            Self::Ready(_) => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CharacterCreationFormState {
    pub catalog: Arc<CharacterGenCatalog>,
    pub focus: CharacterCreationFocus,
    pub name_input: SingleLineTextInput,
    pub heritage_id: u32,
    pub gender_id: u32,
    pub start_area_id: u32,
    pub attribute_values: [u32; 6],
    pub selected_attribute_index: usize,
    pub skill_advancement_classes: Vec<SkillAdvancementClass>,
    pub selected_skill_id: Option<u32>,
    pub feedback: Option<CharacterCreationFeedback>,
}

impl CharacterCreationFormState {
    pub fn new(catalog: Arc<CharacterGenCatalog>) -> Self {
        let heritage_id = catalog
            .heritage_groups
            .keys()
            .next()
            .copied()
            .unwrap_or_default();

        let mut state = Self {
            catalog,
            focus: CharacterCreationFocus::Name,
            name_input: SingleLineTextInput::default(),
            heritage_id,
            gender_id: 0,
            start_area_id: 0,
            attribute_values: [CHARACTER_GEN_MIN_ATTRIBUTE; 6],
            selected_attribute_index: 0,
            skill_advancement_classes: Vec::new(),
            selected_skill_id: None,
            feedback: None,
        };
        state.reset_for_heritage();
        state
    }

    pub fn verbs(&self) -> Vec<Verb> {
        let mut verbs = vec![Verb::new(
            AppUiAction::OpenCharacterDashboard,
            '\x1b',
            "Back",
        )];
        if self.focus == CharacterCreationFocus::Submit {
            verbs.push(Verb::new(
                AppAction::SubmitCharacterCreation,
                '\r',
                "Create",
            ));
        }
        verbs
    }

    pub fn footer_hint(&self) -> String {
        let mut segments = vec!["[TAB] Next", "[SHIFT+TAB] Previous", "[ESC] Back"];

        match self.focus {
            CharacterCreationFocus::Name => {}
            CharacterCreationFocus::StarterTown
            | CharacterCreationFocus::Heritage
            | CharacterCreationFocus::Gender => {
                segments.push("[LEFT/RIGHT] Cycle");
            }
            CharacterCreationFocus::Attributes => {
                segments.push("[UP/DOWN] Select Attribute");
                segments.push("[LEFT/RIGHT] Adjust");
            }
            CharacterCreationFocus::Skills => {
                segments.push("[UP/DOWN] Select Skill");
                segments.push("[LEFT/RIGHT] Raise/Lower");
            }
            CharacterCreationFocus::Submit => {
                segments.push("[ENTER] Create");
            }
        }

        segments.join("  ")
    }

    pub fn set_feedback(&mut self, message: impl Into<String>, is_error: bool) {
        self.feedback = Some(CharacterCreationFeedback {
            message: message.into(),
            is_error,
        });
    }

    pub fn clear_feedback(&mut self) {
        self.feedback = None;
    }

    pub fn move_focus(&mut self, delta: i32) {
        self.focus = self.focus.step(delta);
    }

    pub fn current_heritage(&self) -> Option<&CharacterGenHeritageGroup> {
        self.catalog.heritage_group(self.heritage_id)
    }

    pub fn current_gender(&self) -> Option<&CharacterGenGenderDefinition> {
        self.current_heritage()?.genders.get(&self.gender_id)
    }

    pub fn current_start_area(&self) -> Option<&CharacterGenStarterArea> {
        self.catalog.starter_area(self.start_area_id)
    }

    pub fn current_template(&self) -> Option<&CharacterGenTemplate> {
        custom_template_for_heritage(self.current_heritage()?)
    }

    pub fn heritage_name(&self) -> &str {
        self.current_heritage()
            .map(|heritage| heritage.name.as_str())
            .unwrap_or("Unavailable")
    }

    pub fn gender_name(&self) -> &str {
        self.current_gender()
            .map(|gender| gender.name.as_str())
            .unwrap_or("Unavailable")
    }

    pub fn start_area_name(&self) -> &str {
        self.current_start_area()
            .map(|area| area.name.as_str())
            .unwrap_or("Unavailable")
    }

    pub fn attribute_budget(&self) -> u32 {
        self.current_heritage()
            .map(|heritage| heritage.attribute_credits)
            .unwrap_or(ATTRIBUTE_ORDER.len() as u32 * CHARACTER_GEN_MIN_ATTRIBUTE)
    }

    pub fn attribute_total(&self) -> u32 {
        self.attribute_values.iter().sum()
    }

    pub fn remaining_attribute_points(&self) -> i64 {
        i64::from(self.attribute_budget()) - i64::from(self.attribute_total())
    }

    pub fn skill_budget(&self) -> i64 {
        self.current_heritage()
            .map(|heritage| i64::from(heritage.skill_credits))
            .unwrap_or_default()
    }

    pub fn spent_skill_points(&self) -> i64 {
        self.catalog
            .skill_definitions
            .values()
            .filter(|definition| definition.chargen_use)
            .map(|definition| {
                self.skill_delta_cost(
                    definition.skill_id,
                    SkillAdvancementClass::Untrained,
                    self.skill_advancement_classes[definition.skill_id as usize],
                )
            })
            .sum()
    }

    pub fn remaining_skill_points(&self) -> i64 {
        self.skill_budget() - self.spent_skill_points()
    }

    pub fn attribute_rows(&self) -> [(&'static str, u32); 6] {
        std::array::from_fn(|index| (ATTRIBUTE_ORDER[index].1, self.attribute_values[index]))
    }

    pub fn heritage_ids(&self) -> Vec<u32> {
        self.catalog.heritage_groups.keys().copied().collect()
    }

    pub fn gender_ids(&self) -> Vec<u32> {
        self.current_heritage()
            .map(|heritage| heritage.genders.keys().copied().collect())
            .unwrap_or_default()
    }

    pub fn starter_area_ids(&self) -> Vec<u32> {
        self.catalog
            .allowed_start_area_ids_for_heritage(self.heritage_id)
            .unwrap_or_default()
    }

    pub fn skill_ids_for_display(&self) -> Vec<u32> {
        let mut skill_ids = self
            .catalog
            .skill_definitions
            .values()
            .filter(|definition| {
                definition.chargen_use
                    && definition
                        .skill_type
                        .is_some_and(|skill_type| skill_type.is_eor())
            })
            .map(|definition| definition.skill_id)
            .collect::<Vec<_>>();

        skill_ids.sort_by(|left, right| {
            let left_definition = self.catalog.skill_definition(*left);
            let right_definition = self.catalog.skill_definition(*right);

            advancement_rank(self.skill_advancement_classes[*left as usize])
                .cmp(&advancement_rank(
                    self.skill_advancement_classes[*right as usize],
                ))
                .then_with(|| {
                    skill_sort_name(left_definition).cmp(&skill_sort_name(right_definition))
                })
        });

        skill_ids
    }

    pub fn selected_skill_display_index(&self) -> Option<usize> {
        let selected_skill_id = self.selected_skill_id?;
        let skill_ids = self.skill_ids_for_display();
        let mut display_index = 0usize;
        let mut previous_group = None;

        for skill_id in skill_ids {
            let current_group = advancement_rank(self.skill_advancement_classes[skill_id as usize]);
            if previous_group != Some(current_group) {
                display_index += 1;
                previous_group = Some(current_group);
            }

            if skill_id == selected_skill_id {
                return Some(display_index);
            }

            display_index += 1;
        }

        None
    }

    pub fn skill_display_rows(&self) -> Vec<CharacterCreationSkillRow> {
        let mut rows = Vec::new();
        let mut previous_group = None;

        for skill_id in self.skill_ids_for_display() {
            let advancement = self.skill_advancement_classes[skill_id as usize];
            if previous_group != Some(advancement) {
                rows.push(CharacterCreationSkillRow::Header(advancement));
                previous_group = Some(advancement);
            }

            let definition = self
                .catalog
                .skill_definition(skill_id)
                .expect("displayed skill should exist");
            let selected = self.selected_skill_id == Some(skill_id);
            rows.push(CharacterCreationSkillRow::Skill {
                skill_id,
                label: skill_label(definition),
                selected,
                advancement,
            });
        }

        rows
    }

    pub fn cycle_heritage(&mut self, delta: i32) -> bool {
        let heritage_ids = self.heritage_ids();
        let Some(next) = stepped_value(&heritage_ids, self.heritage_id, delta) else {
            return false;
        };

        if next == self.heritage_id {
            return false;
        }

        self.heritage_id = next;
        self.reset_for_heritage();
        self.clear_feedback();
        true
    }

    pub fn cycle_gender(&mut self, delta: i32) -> bool {
        let gender_ids = self.gender_ids();
        let Some(next) = stepped_value(&gender_ids, self.gender_id, delta) else {
            return false;
        };

        if next == self.gender_id {
            return false;
        }

        self.gender_id = next;
        self.clear_feedback();
        true
    }

    pub fn cycle_start_area(&mut self, delta: i32) -> bool {
        let start_area_ids = self.starter_area_ids();
        let Some(next) = stepped_value(&start_area_ids, self.start_area_id, delta) else {
            return false;
        };

        if next == self.start_area_id {
            return false;
        }

        self.start_area_id = next;
        self.clear_feedback();
        true
    }

    pub fn move_attribute_selection(&mut self, delta: i32) -> bool {
        let len = ATTRIBUTE_ORDER.len() as i32;
        if len == 0 {
            return false;
        }

        let next = (self.selected_attribute_index as i32 + delta).rem_euclid(len) as usize;
        if next == self.selected_attribute_index {
            return false;
        }

        self.selected_attribute_index = next;
        true
    }

    pub fn adjust_selected_attribute(&mut self, delta: i32) -> bool {
        let remaining_points = self.remaining_attribute_points();
        let value = &mut self.attribute_values[self.selected_attribute_index];
        let new_value = (*value as i64 + delta as i64).clamp(
            CHARACTER_GEN_MIN_ATTRIBUTE as i64,
            CHARACTER_GEN_MAX_ATTRIBUTE as i64,
        ) as u32;
        let spent = i64::from(new_value).saturating_sub(*value as i64);
        if spent > 0 && spent > remaining_points {
            return false;
        }
        if new_value == *value {
            return false;
        }
        *value = new_value;
        self.clear_feedback();
        true
    }

    pub fn maximize_selected_attribute(&mut self) -> bool {
        self.set_selected_attribute(CHARACTER_GEN_MAX_ATTRIBUTE)
    }

    pub fn minimize_selected_attribute(&mut self) -> bool {
        self.set_selected_attribute(CHARACTER_GEN_MIN_ATTRIBUTE)
    }

    fn set_selected_attribute(&mut self, target: u32) -> bool {
        let value = self.attribute_values[self.selected_attribute_index];
        if value == target {
            return false;
        }

        let next = if target > value {
            let remaining_points = self.remaining_attribute_points().max(0) as u32;
            value
                .saturating_add(remaining_points)
                .min(target)
                .min(CHARACTER_GEN_MAX_ATTRIBUTE)
        } else {
            target.max(CHARACTER_GEN_MIN_ATTRIBUTE)
        };

        if next == value {
            return false;
        }

        self.attribute_values[self.selected_attribute_index] = next;
        self.clear_feedback();
        true
    }

    pub fn move_skill_selection(&mut self, delta: i32) -> bool {
        let skill_ids = self.skill_ids_for_display();
        let Some(current) = self
            .selected_skill_id
            .or_else(|| skill_ids.first().copied())
        else {
            return false;
        };

        let Some(next) = stepped_value(&skill_ids, current, delta) else {
            return false;
        };

        if Some(next) == self.selected_skill_id {
            return false;
        }

        self.selected_skill_id = Some(next);
        true
    }

    pub fn raise_selected_skill(&mut self) -> bool {
        let Some(skill_id) = self.selected_skill_id else {
            return false;
        };

        let current = self.skill_advancement_classes[skill_id as usize];
        let Some(costs) = self
            .catalog
            .skill_costs_for_heritage(self.heritage_id, skill_id)
        else {
            self.set_feedback("That skill cannot be raised at character creation.", true);
            return false;
        };

        let next = match current {
            SkillAdvancementClass::Inactive | SkillAdvancementClass::Untrained => {
                SkillAdvancementClass::Trained
            }
            SkillAdvancementClass::Trained => SkillAdvancementClass::Specialized,
            SkillAdvancementClass::Specialized => {
                self.set_feedback("That skill is already specialized.", true);
                return false;
            }
        };

        let next_tier_cost = match current {
            SkillAdvancementClass::Inactive | SkillAdvancementClass::Untrained => {
                costs.trained_cost
            }
            SkillAdvancementClass::Trained => costs.specialized_cost,
            SkillAdvancementClass::Specialized => unreachable!(),
        };

        if is_unavailable_character_gen_skill_cost(next_tier_cost) {
            self.set_feedback(
                "That skill cannot be raised to the next tier at character creation.",
                true,
            );
            return false;
        }

        let delta_cost = self.skill_delta_cost(skill_id, current, next);
        if delta_cost > self.remaining_skill_points() {
            self.set_feedback("Not enough skill points for that raise.", true);
            return false;
        }

        self.skill_advancement_classes[skill_id as usize] = next;
        self.clear_feedback();
        true
    }

    pub fn lower_selected_skill(&mut self) -> bool {
        let Some(skill_id) = self.selected_skill_id else {
            return false;
        };

        let current = self.skill_advancement_classes[skill_id as usize];
        if matches!(
            current,
            SkillAdvancementClass::Untrained | SkillAdvancementClass::Inactive
        ) {
            self.set_feedback("That skill is already untrained.", true);
            return false;
        }

        let minimum = self.minimum_skill_advancement(skill_id);
        let next = match current {
            SkillAdvancementClass::Specialized => SkillAdvancementClass::Trained,
            SkillAdvancementClass::Trained => SkillAdvancementClass::Untrained,
            SkillAdvancementClass::Untrained | SkillAdvancementClass::Inactive => unreachable!(),
        };

        if !matches!(
            minimum,
            SkillAdvancementClass::Untrained | SkillAdvancementClass::Inactive
        ) && advancement_rank(next) > advancement_rank(minimum)
        {
            self.set_feedback("That skill is already at its template minimum.", true);
            return false;
        }

        self.skill_advancement_classes[skill_id as usize] = next;
        self.clear_feedback();
        true
    }

    pub fn build_request(
        &self,
        occupied_slots: impl IntoIterator<Item = u32>,
    ) -> Result<
        holtburger_protocol::messages::CharacterCreateRequestData,
        Vec<CharacterGenValidationError>,
    > {
        let builder = CharacterGenBuilder::new(self.catalog.clone());
        let appearance = builder.randomize_appearance(self.heritage_id, self.gender_id);
        let build = CharacterGenBuild {
            heritage: self.heritage_id,
            gender: self.gender_id,
            appearance,
            template_option: self
                .current_template()
                .map(|template| template.template_option)
                .unwrap_or_default(),
            strength_ability: self.attribute_values[0],
            endurance_ability: self.attribute_values[1],
            coordination_ability: self.attribute_values[2],
            quickness_ability: self.attribute_values[3],
            focus_ability: self.attribute_values[4],
            self_ability: self.attribute_values[5],
            character_slot: first_available_slot(occupied_slots),
            skill_advancement_classes: self.skill_advancement_classes.clone(),
            name: self.name_input.text().trim().to_string(),
            start_area: self.start_area_id,
            is_admin: false,
            is_sentinel: false,
        };

        builder.build_request(build)
    }

    fn reset_for_heritage(&mut self) {
        self.gender_id = self.gender_ids().into_iter().next().unwrap_or_default();
        self.start_area_id = self
            .starter_area_ids()
            .into_iter()
            .next()
            .unwrap_or_default();
        self.attribute_values = self
            .current_template()
            .map(|template| std::array::from_fn(|index| template.attribute_values()[index].1))
            .unwrap_or([CHARACTER_GEN_MIN_ATTRIBUTE; 6]);

        self.skill_advancement_classes =
            vec![SkillAdvancementClass::Inactive; self.catalog.expected_skill_slots];
        for definition in self.catalog.skill_definitions.values() {
            let minimum_advancement = self.minimum_skill_advancement(definition.skill_id);
            if let Some(slot) = self
                .skill_advancement_classes
                .get_mut(definition.skill_id as usize)
            {
                *slot = minimum_advancement;
            }
        }

        self.selected_skill_id = self.skill_ids_for_display().into_iter().next();
        self.selected_attribute_index = 0;
    }

    fn skill_delta_cost(
        &self,
        skill_id: u32,
        current: SkillAdvancementClass,
        next: SkillAdvancementClass,
    ) -> i64 {
        let Some(costs) = self
            .catalog
            .skill_costs_for_heritage(self.heritage_id, skill_id)
        else {
            return 0;
        };

        let current_cost = advancement_cost(current, costs.trained_cost, costs.specialized_cost);
        let next_cost = advancement_cost(next, costs.trained_cost, costs.specialized_cost);
        next_cost - current_cost
    }

    fn minimum_skill_advancement(&self, skill_id: u32) -> SkillAdvancementClass {
        minimum_skill_advancement_for_heritage(self.catalog.as_ref(), self.heritage_id, skill_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CharacterCreationSkillRow {
    Header(SkillAdvancementClass),
    Skill {
        skill_id: u32,
        label: String,
        selected: bool,
        advancement: SkillAdvancementClass,
    },
}

fn advancement_rank(advancement: SkillAdvancementClass) -> u8 {
    match advancement {
        SkillAdvancementClass::Specialized => 0,
        SkillAdvancementClass::Trained => 1,
        SkillAdvancementClass::Untrained => 2,
        SkillAdvancementClass::Inactive => 3,
    }
}

fn advancement_cost(
    advancement: SkillAdvancementClass,
    trained_cost: i32,
    specialized_cost: i32,
) -> i64 {
    match advancement {
        SkillAdvancementClass::Inactive | SkillAdvancementClass::Untrained => 0,
        SkillAdvancementClass::Trained => i64::from(trained_cost),
        SkillAdvancementClass::Specialized => i64::from(trained_cost + specialized_cost),
    }
}

fn skill_label(definition: &CharacterGenSkillDefinition) -> String {
    definition
        .skill_type
        .map(|skill_type| skill_type.to_string())
        .unwrap_or_else(|| definition.name.clone())
}

fn skill_sort_name(definition: Option<&CharacterGenSkillDefinition>) -> String {
    definition
        .map(skill_label)
        .unwrap_or_else(|| "Unknown Skill".to_string())
}

fn stepped_value(values: &[u32], current: u32, delta: i32) -> Option<u32> {
    if values.is_empty() {
        return None;
    }

    let index = values
        .iter()
        .position(|value| *value == current)
        .unwrap_or_default() as i32;
    let len = values.len() as i32;
    Some(values[(index + delta).rem_euclid(len) as usize])
}

fn first_available_slot(occupied_slots: impl IntoIterator<Item = u32>) -> u32 {
    let occupied = occupied_slots.into_iter().collect::<BTreeSet<_>>();
    let mut candidate = 0u32;
    while occupied.contains(&candidate) {
        candidate += 1;
    }
    candidate
}

pub fn format_creation_errors(errors: &[CharacterGenValidationError]) -> String {
    errors
        .iter()
        .map(|error| error.to_string())
        .collect::<Vec<_>>()
        .join("  ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::stats::SkillType;
    use holtburger_content::character_gen::{
        CharacterGenAppearanceOptions, CharacterGenCatalog, CharacterGenEyeStrip,
        CharacterGenFaceStrip, CharacterGenGear, CharacterGenGenderDefinition,
        CharacterGenHeritageGroup, CharacterGenSkillDefinition, CharacterGenStarterArea,
        CharacterGenStarterLocation, CharacterGenTemplate,
    };
    use std::collections::BTreeMap;

    fn test_catalog() -> Arc<CharacterGenCatalog> {
        Arc::new(CharacterGenCatalog {
            starter_areas: vec![CharacterGenStarterArea {
                start_area_id: 0,
                name: "Shoushi".to_string(),
                locations: vec![CharacterGenStarterLocation {
                    obj_cell_id: 1,
                    frame: holtburger_dat::graphics::Frame {
                        origin: Default::default(),
                        orientation: Default::default(),
                    },
                }],
            }],
            heritage_groups: BTreeMap::from([(
                7,
                CharacterGenHeritageGroup {
                    heritage_id: 7,
                    name: "Sho".to_string(),
                    icon_image: 0,
                    setup_id: 0,
                    environment_setup_id: 0,
                    attribute_credits: 66,
                    skill_credits: 8,
                    primary_start_area_ids: vec![0],
                    secondary_start_area_ids: Vec::new(),
                    skill_overrides: BTreeMap::new(),
                    templates: vec![
                        CharacterGenTemplate {
                            template_option: 0,
                            name: "Warrior".to_string(),
                            icon_image: 0,
                            title_id: 0,
                            strength: 30,
                            endurance: 10,
                            coordination: 10,
                            quickness: 10,
                            focus: 10,
                            self_stat: 10,
                            normal_skills: vec![SkillType::Jump as u32],
                            primary_skills: Vec::new(),
                        },
                        CharacterGenTemplate {
                            template_option: 1,
                            name: "Custom".to_string(),
                            icon_image: 0,
                            title_id: 0,
                            strength: 10,
                            endurance: 10,
                            coordination: 10,
                            quickness: 10,
                            focus: 10,
                            self_stat: 10,
                            normal_skills: vec![SkillType::Run as u32],
                            primary_skills: Vec::new(),
                        },
                    ],
                    genders: BTreeMap::from([(
                        1,
                        CharacterGenGenderDefinition {
                            gender_id: 1,
                            name: "Female".to_string(),
                            scale: 0,
                            setup_id: 0,
                            sound_table: 0,
                            icon_image: 0,
                            base_palette: 0,
                            skin_palette_set: 0,
                            physics_table: 0,
                            motion_table: 0,
                            combat_table: 0,
                            appearance: CharacterGenAppearanceOptions {
                                hair_color_ids: vec![0],
                                hair_styles: vec![
                                    holtburger_content::character_gen::CharacterGenHairStyle {
                                        icon_image: 0,
                                        bald: false,
                                        alternate_setup: 0,
                                    },
                                ],
                                eye_color_ids: vec![0],
                                eye_strips: vec![CharacterGenEyeStrip {
                                    icon_image: 0,
                                    icon_image_bald: 0,
                                }],
                                nose_strips: vec![CharacterGenFaceStrip { icon_image: 0 }],
                                mouth_strips: vec![CharacterGenFaceStrip { icon_image: 0 }],
                                headgear: Vec::new(),
                                shirts: vec![CharacterGenGear {
                                    name: "Shirt".to_string(),
                                    clothing_table: 0,
                                    weenie_default: 0,
                                }],
                                pants: vec![CharacterGenGear {
                                    name: "Pants".to_string(),
                                    clothing_table: 0,
                                    weenie_default: 0,
                                }],
                                footwear: vec![CharacterGenGear {
                                    name: "Sandals".to_string(),
                                    clothing_table: 0,
                                    weenie_default: 0,
                                }],
                                clothing_color_ids: vec![0],
                            },
                        },
                    )]),
                },
            )]),
            skill_definitions: BTreeMap::from([
                (
                    SkillType::Axe as u32,
                    CharacterGenSkillDefinition {
                        skill_id: SkillType::Axe as u32,
                        skill_type: Some(SkillType::Axe),
                        name: "Axe".to_string(),
                        description: String::new(),
                        chargen_use: true,
                        trained_cost: 2,
                        specialized_cost: 4,
                    },
                ),
                (
                    SkillType::Run as u32,
                    CharacterGenSkillDefinition {
                        skill_id: SkillType::Run as u32,
                        skill_type: Some(SkillType::Run),
                        name: "Run".to_string(),
                        description: String::new(),
                        chargen_use: true,
                        trained_cost: 2,
                        specialized_cost: 4,
                    },
                ),
                (
                    SkillType::Jump as u32,
                    CharacterGenSkillDefinition {
                        skill_id: SkillType::Jump as u32,
                        skill_type: Some(SkillType::Jump),
                        name: "Jump".to_string(),
                        description: String::new(),
                        chargen_use: true,
                        trained_cost: 2,
                        specialized_cost: 4,
                    },
                ),
            ]),
            expected_skill_slots: SkillType::Run as usize + 1,
        })
    }

    #[test]
    fn initializes_with_first_available_options() {
        let form = CharacterCreationFormState::new(test_catalog());

        assert_eq!(form.heritage_id, 7);
        assert_eq!(form.gender_id, 1);
        assert_eq!(form.start_area_id, 0);
        assert_eq!(form.remaining_attribute_points(), 6);
        assert_eq!(form.remaining_skill_points(), 6);
        assert_eq!(
            form.skill_advancement_classes[SkillType::Run as usize],
            SkillAdvancementClass::Trained
        );
    }

    #[test]
    fn build_request_uses_valid_defaults() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.name_input.set_text("Sho Girl");
        form.attribute_values[5] += 6;
        form.raise_selected_skill();

        let request = form
            .build_request([1, 2])
            .expect("build should produce a valid request");

        assert_eq!(request.name, "Sho Girl");
        assert_eq!(request.character_slot, 0);
        assert_eq!(request.heritage, 7);
        assert_eq!(request.gender, 1);
        assert_eq!(request.start_area, 0);
        assert_eq!(request.template_option, 1);
    }

    #[test]
    fn skill_ids_for_display_filters_to_end_of_retail_skills() {
        let form = CharacterCreationFormState::new(test_catalog());

        let skill_ids = form.skill_ids_for_display();

        assert!(skill_ids.contains(&(SkillType::Run as u32)));
        assert!(skill_ids.contains(&(SkillType::Jump as u32)));
        assert!(!skill_ids.contains(&(SkillType::Axe as u32)));
    }

    #[test]
    fn maximize_selected_attribute_uses_all_remaining_points_up_to_cap() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.attribute_values[0] = CHARACTER_GEN_MIN_ATTRIBUTE;

        assert!(form.maximize_selected_attribute());
        assert_eq!(form.attribute_values[0], 16);
    }

    #[test]
    fn minimize_selected_attribute_resets_to_minimum() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.attribute_values[0] = CHARACTER_GEN_MAX_ATTRIBUTE;

        assert!(form.minimize_selected_attribute());
        assert_eq!(form.attribute_values[0], CHARACTER_GEN_MIN_ATTRIBUTE);
    }

    #[test]
    fn raise_selected_skill_is_blocked_at_specialized() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.selected_skill_id = Some(SkillType::Run as u32);
        form.skill_advancement_classes[SkillType::Run as usize] =
            SkillAdvancementClass::Specialized;

        assert!(!form.raise_selected_skill());
        assert_eq!(
            form.feedback
                .as_ref()
                .map(|feedback| feedback.message.as_str()),
            Some("That skill is already specialized.")
        );
    }

    #[test]
    fn lower_selected_skill_is_blocked_at_untrained() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.selected_skill_id = Some(SkillType::Jump as u32);

        assert!(!form.lower_selected_skill());
        assert_eq!(
            form.feedback
                .as_ref()
                .map(|feedback| feedback.message.as_str()),
            Some("That skill is already untrained.")
        );
    }

    #[test]
    fn lower_selected_skill_is_blocked_at_template_minimum() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.selected_skill_id = Some(SkillType::Run as u32);

        assert!(!form.lower_selected_skill());
        assert_eq!(
            form.feedback
                .as_ref()
                .map(|feedback| feedback.message.as_str()),
            Some("That skill is already at its template minimum.")
        );
    }

    #[test]
    fn lower_selected_skill_can_stop_at_template_minimum() {
        let mut form = CharacterCreationFormState::new(test_catalog());
        form.selected_skill_id = Some(SkillType::Run as u32);
        form.skill_advancement_classes[SkillType::Run as usize] =
            SkillAdvancementClass::Specialized;

        assert!(form.lower_selected_skill());
        assert_eq!(
            form.skill_advancement_classes[SkillType::Run as usize],
            SkillAdvancementClass::Trained
        );
    }

    #[test]
    fn raise_selected_skill_is_blocked_when_next_tier_cost_is_unavailable() {
        let mut catalog = (*test_catalog()).clone();
        catalog.skill_definitions.insert(
            SkillType::Salvaging as u32,
            CharacterGenSkillDefinition {
                skill_id: SkillType::Salvaging as u32,
                skill_type: Some(SkillType::Salvaging),
                name: "Salvaging".to_string(),
                description: String::new(),
                chargen_use: true,
                trained_cost: 8,
                specialized_cost: 999,
            },
        );
        catalog.expected_skill_slots = SkillType::Salvaging as usize + 1;

        let mut form = CharacterCreationFormState::new(Arc::new(catalog));
        form.selected_skill_id = Some(SkillType::Salvaging as u32);
        form.skill_advancement_classes[SkillType::Salvaging as usize] =
            SkillAdvancementClass::Trained;

        assert!(!form.raise_selected_skill());
        assert_eq!(
            form.feedback
                .as_ref()
                .map(|feedback| feedback.message.as_str()),
            Some("That skill cannot be raised to the next tier at character creation.")
        );
    }
}

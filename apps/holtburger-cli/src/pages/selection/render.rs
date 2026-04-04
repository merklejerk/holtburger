use crate::pages::selection::SelectionState;
use crate::pages::selection::render_widgets::render_character_selection;
use crate::state::RenderContext;
use holtburger_content::character_gen::CharacterGenSkillCosts;
use holtburger_protocol::messages::SkillAdvancementClass;
use ratatui::Frame;
use ratatui::layout::Rect;

impl SelectionState {
    pub fn render(&mut self, f: &mut Frame, _area: Rect, _ctx: &RenderContext) {
        // Selection state doesn't need AppState, it renders its own characters.
        render_character_selection(f, self, _area);
    }
}

pub(crate) fn advancement_group_label(advancement: SkillAdvancementClass) -> &'static str {
    match advancement {
        SkillAdvancementClass::Specialized => "Specialized",
        SkillAdvancementClass::Trained => "Trained",
        SkillAdvancementClass::Untrained | SkillAdvancementClass::Inactive => "Untrained",
    }
}

pub(crate) fn skill_raise_cost_label(
    advancement: SkillAdvancementClass,
    costs: Option<CharacterGenSkillCosts>,
) -> String {
    let Some(costs) = costs else {
        return "--".to_string();
    };

    let cost = match advancement {
        SkillAdvancementClass::Specialized => return "MAX".to_string(),
        SkillAdvancementClass::Trained => costs.specialized_cost - costs.trained_cost,
        SkillAdvancementClass::Untrained | SkillAdvancementClass::Inactive => costs.trained_cost,
    };

    match u32::try_from(cost) {
        Ok(cost) => format!("{} SP", cost),
        Err(_) => "--".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::SkillAdvancementClass;

    #[test]
    fn advancement_group_label_is_human_readable() {
        assert_eq!(advancement_group_label(SkillAdvancementClass::Untrained), "Untrained");
        assert_eq!(advancement_group_label(SkillAdvancementClass::Trained), "Trained");
        assert_eq!(advancement_group_label(SkillAdvancementClass::Specialized), "Specialized");
    }

    #[test]
    fn skill_raise_cost_label_uses_next_tier_costs() {
        let costs = Some(CharacterGenSkillCosts {
            trained_cost: 2,
            specialized_cost: 4,
        });

        assert_eq!(skill_raise_cost_label(SkillAdvancementClass::Untrained, costs), "2 SP");
        assert_eq!(skill_raise_cost_label(SkillAdvancementClass::Trained, costs), "2 SP");
        assert_eq!(skill_raise_cost_label(SkillAdvancementClass::Specialized, costs), "MAX");
    }
}

use super::state::AppState;
use super::types::DashboardTab;
use crate::actions::{ActionTarget};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn wrap_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut result = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            result.push(String::new());
            continue;
        }
        let mut current_line = String::new();
        for word in line.split(' ') {
            if current_line.is_empty() {
                if word.len() > width {
                    let mut s = word;
                    while s.len() > width {
                        let (head, tail) = s.split_at(width);
                        result.push(head.to_string());
                        s = tail;
                    }
                    current_line = s.to_string();
                } else {
                    current_line.push_str(word);
                }
            } else if current_line.len() + 1 + word.len() <= width {
                current_line.push(' ');
                current_line.push_str(word);
            } else {
                result.push(current_line);
                if word.len() > width {
                    let mut s = word;
                    while s.len() > width {
                        let (head, tail) = s.split_at(width);
                        result.push(head.to_string());
                        s = tail;
                    }
                    current_line = s.to_string();
                } else {
                    current_line = word.to_string();
                }
            }
        }
        if !current_line.is_empty() {
            result.push(current_line);
        }
    }
    result
}

pub fn render_action_bar(state: &AppState) -> Option<Paragraph<'_>> {
    let target = match state.dashboard_tab {
        DashboardTab::Entities | DashboardTab::Inventory => {
            let entities = state.get_filtered_nearby_tab();
            entities.get(state.selected_dashboard_index)
                .map(|(e, _, _)| ActionTarget::Entity(e))
                .unwrap_or(ActionTarget::None)
        }
        DashboardTab::Effects => {
            let enchants = state.get_effects_list_enchantments();
            enchants.get(state.selected_dashboard_index)
                .map(|(e, _)| ActionTarget::Enchantment(e))
                .unwrap_or(ActionTarget::None)
        }
        _ => ActionTarget::None,
    };

    let actions = crate::actions::get_actions_for_target(&target, &state.entities, state.player_guid);
    if actions.is_empty() {
        return None;
    }

    let mut spans = Vec::new();
    for (i, action) in actions.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw(" "));
        }
        spans.push(Span::raw(action.display_label()));
    }

    Some(Paragraph::new(Line::from(spans)).block(Block::default().borders(Borders::TOP)))
}

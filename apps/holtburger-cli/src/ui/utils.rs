use super::types::{CommandTarget, DashboardTab};
use crate::ui::AppState;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn format_cost(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.3}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.3}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.2}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

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
        DashboardTab::Entities => {
            let entities = state.get_filtered_nearby_tab();
            entities
                .get(state.selected_dashboard_index)
                .map(|(e, _, _)| CommandTarget::Entity(e))
                .unwrap_or(CommandTarget::None)
        }
        DashboardTab::Inventory => {
            let entities = state.get_filtered_inventory_tab();
            entities
                .get(state.selected_dashboard_index)
                .map(|(e, _, _)| CommandTarget::Entity(e))
                .unwrap_or(CommandTarget::None)
        }
        DashboardTab::Character => crate::ui::widgets::stats::get_command_target_at_index(
            state,
            DashboardTab::Character,
            state.selected_dashboard_index,
        )
        .unwrap_or(CommandTarget::None),
    };

    let verbs = crate::entities::verbs::get_verbs_for_target(
        &target,
        &state.entities,
        state.player_guid,
        state.active_interaction,
    );
    if verbs.is_empty() {
        return None;
    }

    let mut spans = Vec::new();
    for (i, verb) in verbs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw(" "));
        }
        spans.push(Span::raw(verb.display_label()));
    }

    Some(Paragraph::new(Line::from(spans)).block(Block::default().borders(Borders::TOP)))
}

pub fn get_next_pane(
    current: super::types::FocusedPane,
    width: u16,
    active_interaction: bool,
) -> super::types::FocusedPane {
    let order = if width < super::types::WIDTH_BREAKPOINT {
        // Portrait: Dashboard -> Context -> Dynamic -> Chat -> Input
        [
            super::types::FocusedPane::Dashboard,
            super::types::FocusedPane::Context,
            super::types::FocusedPane::Dynamic,
            super::types::FocusedPane::Chat,
            super::types::FocusedPane::Input,
        ]
    } else {
        // Landscape: Dashboard -> Chat -> Context -> Dynamic -> Input
        [
            super::types::FocusedPane::Dashboard,
            super::types::FocusedPane::Chat,
            super::types::FocusedPane::Context,
            super::types::FocusedPane::Dynamic,
            super::types::FocusedPane::Input,
        ]
    };

    let current_idx = order.iter().position(|&p| p == current).unwrap_or(0);
    let mut next_idx = (current_idx + 1) % order.len();

    // Skip dynamic if not moving anything
    if order[next_idx] == super::types::FocusedPane::Dynamic && !active_interaction {
        next_idx = (next_idx + 1) % order.len();
    }

    order[next_idx]
}

pub fn get_prev_pane(
    current: super::types::FocusedPane,
    width: u16,
    active_interaction: bool,
) -> super::types::FocusedPane {
    let order = if width < super::types::WIDTH_BREAKPOINT {
        // Portrait: Dashboard -> Context -> Dynamic -> Chat -> Input
        [
            super::types::FocusedPane::Dashboard,
            super::types::FocusedPane::Context,
            super::types::FocusedPane::Dynamic,
            super::types::FocusedPane::Chat,
            super::types::FocusedPane::Input,
        ]
    } else {
        // Landscape: Dashboard -> Chat -> Context -> Dynamic -> Input
        [
            super::types::FocusedPane::Dashboard,
            super::types::FocusedPane::Chat,
            super::types::FocusedPane::Context,
            super::types::FocusedPane::Dynamic,
            super::types::FocusedPane::Input,
        ]
    };

    let current_idx = order.iter().position(|&p| p == current).unwrap_or(0);
    let mut prev_idx = if current_idx == 0 {
        order.len() - 1
    } else {
        current_idx - 1
    };

    // Skip dynamic if not moving anything
    if order[prev_idx] == super::types::FocusedPane::Dynamic && !active_interaction {
        prev_idx = if prev_idx == 0 {
            order.len() - 1
        } else {
            prev_idx - 1
        };
    }

    order[prev_idx]
}

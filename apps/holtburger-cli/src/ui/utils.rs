use ratatui::text::{Line, Span};
use ratatui::widgets::{Borders, Block, Paragraph};
use holtburger_core::world::properties::ObjectDescriptionFlag;
use super::state::AppState;
use super::types::NearbyTab;

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
    let mut tools = Vec::new();

    match state.nearby_tab {
        NearbyTab::Entities | NearbyTab::Inventory => {
            let nearby = state.get_filtered_nearby_entities();
            if let Some((selected_e, _, _)) = nearby.get(state.selected_nearby_index) {
                tools.push(Span::raw("[A]ssess "));
                let flags = selected_e.flags;

                if state.nearby_tab == NearbyTab::Inventory {
                    tools.push(Span::raw("[I]nteract "));
                } else {
                    let is_pickable = !flags.intersects(ObjectDescriptionFlag::STUCK);
                    if is_pickable {
                        tools.push(Span::raw("[I]tem "));
                    }
                }

                if flags.intersects(ObjectDescriptionFlag::ATTACKABLE) {
                    tools.push(Span::raw("[K]ill "));
                }
                tools.push(Span::raw("[D]ebug"));
            }
        }
        NearbyTab::Effects => {
            if !state.player_enchantments.is_empty() {
                tools.push(Span::raw("[D]ebug"));
            }
        }
        NearbyTab::Character => {}
    }

    if tools.is_empty() {
        None
    } else {
        Some(Paragraph::new(Line::from(tools)).block(Block::default().borders(Borders::TOP)))
    }
}

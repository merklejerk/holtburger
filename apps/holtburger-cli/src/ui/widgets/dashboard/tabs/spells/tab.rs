use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use super::super::common::VerbSet;
use super::verbs;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;

pub struct SpellsTab;

impl TabController for SpellsTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        let items = self.get_list_items(state);
        let total = items.len();
        let dashboard_list = List::new(items)
            .highlight_style(Style::default().add_modifier(Modifier::BOLD))
            .highlight_symbol("> ");

        state
            .dashboard_list_state
            .select(Some(state.selected_dashboard_index));
        f.render_stateful_widget(dashboard_list, area, &mut state.dashboard_list_state);

        // Render Scrollbar
        let height = area.height as usize;
        state.last_dashboard_height = height;

        if total > height {
            let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height)).position(
                state
                    .selected_dashboard_index
                    .min(total.saturating_sub(height)),
            );
            f.render_stateful_widget(
                Scrollbar::default()
                    .orientation(ScrollbarOrientation::VerticalRight)
                    .begin_symbol(Some("▲"))
                    .track_symbol(Some(" "))
                    .thumb_symbol("█")
                    .end_symbol(Some("▼"))
                    .style(Style::default().fg(Color::Gray).bg(Color::Black))
                    .track_style(Style::default().fg(Color::DarkGray).bg(Color::Black))
                    .thumb_style(Style::default().fg(Color::White).bg(Color::Black)),
                area,
                &mut scrollbar_state,
            );
        }
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) =
            super::super::common::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        verbs::get_verbs(false)
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let mut spells = state.player_spells.clone();
        spells.sort_by_key(|&sid| {
            state
                .spell_names
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| "".to_string())
        });
        spells
            .get(index)
            .map(|&sid| CommandTarget::Spell(sid))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        state.player_spells.len()
    }
}

impl SpellsTab {
    fn get_list_items(&self, state: &AppState) -> Vec<ListItem<'static>> {
        let mut spells = state.player_spells.clone();
        spells.sort_by_key(|&sid| {
            state
                .spell_names
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| "".to_string())
        });

        spells
            .iter()
            .enumerate()
            .map(|(i, &spell_id)| {
                let name = state
                    .spell_names
                    .get(&spell_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Unknown Spell {}", spell_id));

                let is_selected = i == state.selected_dashboard_index;

                let name_style = if is_selected {
                    Style::default().bg(Color::DarkGray)
                } else {
                    Style::default()
                };

                let power_style = if is_selected {
                    Style::default().bg(Color::DarkGray).fg(Color::Gray)
                } else {
                    Style::default().fg(Color::DarkGray)
                };

                ListItem::new(Line::from(vec![
                    Span::styled(format!("{:<30}", name), name_style),
                    Span::raw(" "),
                    Span::styled(
                        if let Some(info) = state.spell_info.get(&spell_id) {
                            format!("Power: {}", info.power)
                        } else {
                            "".to_string()
                        },
                        power_style,
                    ),
                ]))
            })
            .collect()
    }
}

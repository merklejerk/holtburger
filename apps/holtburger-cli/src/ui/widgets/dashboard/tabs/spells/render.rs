use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use crate::ui::state::GameState;
use crate::ui::theme;

pub fn render_spells_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let items = get_list_items(game);
    let total = items.len();
    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    game.view
        .dashboard_list_state
        .select(Some(game.view.selected_dashboard_index));
    f.render_stateful_widget(dashboard_list, area, &mut game.view.dashboard_list_state);

    // Render Scrollbar
    let height = area.height as usize;
    game.view.last_dashboard_height = height;

    if total > height {
        let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height)).position(
            game.view
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
                .style(theme::scrollbar_style())
                .track_style(theme::scrollbar_track_style())
                .thumb_style(theme::scrollbar_thumb_style()),
            area,
            &mut scrollbar_state,
        );
    }
}

fn get_list_items(game: &GameState) -> Vec<ListItem<'static>> {
    let mut spells = game.data.player_spells.clone();
    spells.sort_by_key(|&sid| {
        game.data
            .spell_names
            .get(&sid)
            .cloned()
            .unwrap_or_else(|| "".to_string())
    });

    spells
        .iter()
        .enumerate()
        .map(|(i, &spell_id)| {
            let name = game
                .data
                .spell_names
                .get(&spell_id)
                .cloned()
                .unwrap_or_else(|| format!("Unknown Spell {}", spell_id));

            let is_selected = i == game.view.selected_dashboard_index;

            let name_style = theme::list_item_style(is_selected);

            let power_style = if is_selected {
                theme::list_item_style(true).fg(Color::Gray)
            } else {
                Style::default().fg(Color::DarkGray)
            };

            ListItem::new(Line::from(vec![
                Span::styled(format!("{:<30}", name), name_style),
                Span::raw(" "),
                Span::styled(
                    if let Some(info) = game.data.spell_info.get(&spell_id) {
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

use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use crate::ui::state::GameState;
use crate::ui::theme;

pub fn render_spells_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let items = get_list_items(game);
    
    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = game.view.selected_dashboard_index();
    game.view
        .dashboard_list_state()
        .select(Some(selected_index));
    f.render_stateful_widget(dashboard_list, area, game.view.dashboard_list_state());

    let height = area.height as usize;
    game.view.last_dashboard_height = height;
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

            let is_selected = i == game.view.selected_dashboard_index();

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

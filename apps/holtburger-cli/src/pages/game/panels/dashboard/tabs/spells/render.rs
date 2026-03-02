use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use crate::pages::game::{GameData, ViewState};
use super::tab::SpellsTab;
use crate::theme;

pub fn render_spells_tab(tab: &mut SpellsTab, f: &mut Frame, data: &GameData, _view: &ViewState, area: Rect) {
    let items = get_list_items(tab.selected_index, data);
    let content_len = items.len();

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = tab.selected_index;
    let list_state = &mut tab.list_state;
    list_state.select(Some(selected_index));

    f.render_stateful_widget(dashboard_list, area, list_state);
    let offset = list_state.offset();
    crate::components::scroll::render_scrollbar(f, area, content_len, offset);

    let _height = area.height as usize;
}

fn get_list_items(selected_index: usize, data: &GameData) -> Vec<ListItem<'static>> {
    let mut spells = data.player_spells.clone();
    spells.sort_by_key(|&sid| {
        data.spell_names
            .get(&sid)
            .cloned()
            .unwrap_or_else(|| "".to_string())
    });

    spells
        .iter()
        .enumerate()
        .map(|(i, &spell_id)| {
            let name = data
                .spell_names
                .get(&spell_id)
                .cloned()
                .unwrap_or_else(|| format!("Unknown Spell {}", spell_id));

            let is_selected = i == selected_index;

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
                    if let Some(info) = data.spell_info.get(&spell_id) {
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

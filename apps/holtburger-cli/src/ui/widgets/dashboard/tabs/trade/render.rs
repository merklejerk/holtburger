use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, List, ListItem, ListState, Paragraph, Scrollbar, ScrollbarOrientation,
    ScrollbarState,
};

use crate::ui::state::GameState;
use crate::ui::theme;
use crate::ui::types::TradeFocus;

pub fn render_trade_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    if let Some(vendor) = &game.data.vendor {
        let items: Vec<ListItem> = vendor
            .items
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let name = m.description.name.as_deref().unwrap_or("Unknown Item");

                // Calculate sell price using vendor multipliers (simplification)
                let price =
                    (m.description.value.unwrap_or(0) as f32 * vendor.buy_multiplier) as u32;

                let is_selected = i == game.view.selected_dashboard_index;

                ListItem::new(Line::from(vec![
                    Span::raw(format!("{:<30}", name)),
                    Span::styled(
                        format!("{:>10}p", price),
                        Style::default().fg(theme::MONEY_FG),
                    ),
                ]))
                .style(theme::list_item_style(is_selected))
            })
            .collect();

        let total = items.len();
        let list = List::new(items)
            .block(Block::default().borders(Borders::ALL).title(format!(
                "Vendor: Sell x{:.2}, Buy x{:.2}",
                vendor.sell_multiplier, vendor.buy_multiplier
            )))
            .highlight_style(theme::selection_style())
            .highlight_symbol(theme::SELECTION_SYMBOL);

        game.view
            .dashboard_list_state
            .select(Some(game.view.selected_dashboard_index));
        game.view.last_dashboard_height = area.height as usize;

        f.render_stateful_widget(list, area, &mut game.view.dashboard_list_state);

        render_scrollbar(f, area, total, game.view.selected_dashboard_index);
    } else if let Some(trade) = &game.data.trade {
        let trade_focus = game.view.trade_focus;
        let partner_name = game
            .data
            .entities
            .get(&trade.partner_guid)
            .map(|e| e.name.as_str())
            .unwrap_or("Partner");

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        game.view
            .dashboard_list_state
            .select(Some(game.view.selected_dashboard_index));

        // Self side
        let self_items: Vec<ListItem> = trade
            .self_side
            .items
            .iter()
            .enumerate()
            .map(|(i, guid)| {
                let name = game
                    .data
                    .entities
                    .get(guid)
                    .map(|e| e.name.as_str())
                    .unwrap_or("Unknown Item");
                let is_selected =
                    trade_focus == TradeFocus::Local && i == game.view.selected_dashboard_index;
                ListItem::new(name.to_string()).style(theme::list_item_style(is_selected))
            })
            .collect();

        // Calculate heights for PageUp/PageDown
        let self_area = chunks[0];
        let self_height = self_area.height as usize;
        game.view.last_dashboard_height = self_height; // Both sides same height in 50/50 split

        let (self_title, self_state) = match trade_focus {
            TradeFocus::Local => (
                Line::from(vec![
                    Span::styled("You", Style::default().add_modifier(Modifier::BOLD)),
                    Span::raw(if trade.self_side.accepted {
                        " (ACCEPTED)"
                    } else {
                        ""
                    }),
                ]),
                &mut game.view.dashboard_list_state,
            ),
            TradeFocus::Partner => (
                Line::from(vec![
                    Span::raw("You"),
                    Span::raw(if trade.self_side.accepted {
                        " (ACCEPTED)"
                    } else {
                        ""
                    }),
                    Span::raw(" ([Z] to switch)"),
                ]),
                &mut ListState::default(),
            ),
        };

        let self_item_count = self_items.len();
        let mut self_list = List::new(self_items).block(
            Block::default()
                .borders(Borders::ALL)
                .title(self_title)
                .border_style(if trade_focus == TradeFocus::Local {
                    Style::default().add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                }),
        );

        if trade_focus == TradeFocus::Local {
            self_list = self_list
                .highlight_style(theme::selection_style())
                .highlight_symbol(theme::SELECTION_SYMBOL);
        }

        f.render_stateful_widget(self_list, self_area, self_state);

        render_scrollbar(
            f,
            self_area,
            self_item_count,
            if trade_focus == TradeFocus::Local {
                game.view.selected_dashboard_index
            } else {
                0
            },
        );

        // Partner side
        let partner_area = chunks[1];
        let partner_items: Vec<ListItem> = trade
            .partner_side
            .items
            .iter()
            .enumerate()
            .map(|(i, guid)| {
                let name = game
                    .data
                    .entities
                    .get(guid)
                    .map(|e| e.name.as_str())
                    .unwrap_or("Unknown Item");
                let is_selected =
                    trade_focus == TradeFocus::Partner && i == game.view.selected_dashboard_index;
                ListItem::new(name.to_string()).style(theme::list_item_style(is_selected))
            })
            .collect();

        let (partner_title, partner_state) = match trade_focus {
            TradeFocus::Partner => (
                Line::from(vec![
                    Span::styled(partner_name, Style::default().add_modifier(Modifier::BOLD)),
                    Span::raw(if trade.partner_side.accepted {
                        " (ACCEPTED)"
                    } else {
                        ""
                    }),
                ]),
                &mut game.view.dashboard_list_state,
            ),
            TradeFocus::Local => (
                Line::from(vec![
                    Span::raw(partner_name),
                    Span::raw(if trade.partner_side.accepted {
                        " (ACCEPTED)"
                    } else {
                        ""
                    }),
                    Span::raw(" ([Z] to switch)"),
                ]),
                &mut ListState::default(),
            ),
        };

        let partner_item_count = partner_items.len();
        let mut partner_list = List::new(partner_items).block(
            Block::default()
                .borders(Borders::ALL)
                .title(partner_title)
                .border_style(if trade_focus == TradeFocus::Partner {
                    Style::default().add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                }),
        );

        if trade_focus == TradeFocus::Partner {
            partner_list = partner_list
                .highlight_style(theme::selection_style())
                .highlight_symbol(theme::SELECTION_SYMBOL);
        }

        f.render_stateful_widget(partner_list, partner_area, partner_state);

        render_scrollbar(
            f,
            partner_area,
            partner_item_count,
            if trade_focus == TradeFocus::Partner {
                game.view.selected_dashboard_index
            } else {
                0
            },
        );
    } else {
        let msg = "No active trade or vendor session. Approach a vendor or trade with a player.";
        let block = Block::default().borders(Borders::ALL).title("Trade");
        let inner = block.inner(area);
        f.render_widget(block, area);
        f.render_widget(Paragraph::new(msg), inner);
    }
}

fn render_scrollbar(f: &mut Frame, area: Rect, item_count: usize, selected_index: usize) {
    let inner_height = area.height.saturating_sub(2) as usize;
    if item_count > inner_height {
        let mut scrollbar_state = ScrollbarState::new(item_count.saturating_sub(inner_height))
            .position(selected_index.min(item_count.saturating_sub(inner_height)));
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

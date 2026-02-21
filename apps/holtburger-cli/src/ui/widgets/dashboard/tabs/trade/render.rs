use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};

use crate::ui::state::GameState;
use crate::ui::types::TradeFocus;

pub fn render_trade_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    if let Some(vendor) = &game.data.vendor {
        let items: Vec<ListItem> = vendor
            .items
            .iter()
            .map(|m| {
                let name = m.description.name.as_deref().unwrap_or("Unknown Item");

                // Calculate sell price using vendor multipliers (simplification)
                let price =
                    (m.description.value.unwrap_or(0) as f32 * vendor.buy_multiplier) as u32;

                ListItem::new(Line::from(vec![
                    Span::raw(format!("{:<30}", name)),
                    Span::styled(
                        format!("{:>10}p", price),
                        Style::default().fg(Color::Yellow),
                    ),
                ]))
            })
            .collect();

        let list = List::new(items)
            .block(Block::default().borders(Borders::ALL).title(format!(
                "Vendor: Sell x{:.2}, Buy x{:.2}",
                vendor.sell_multiplier, vendor.buy_multiplier
            )))
            .highlight_style(
                Style::default()
                    .add_modifier(Modifier::BOLD)
                    .fg(Color::Cyan),
            )
            .highlight_symbol(">> ");

        game.view
            .dashboard_list_state
            .select(Some(game.view.selected_dashboard_index));
        game.view.last_dashboard_height = area.height as usize;

        f.render_stateful_widget(list, area, &mut game.view.dashboard_list_state);
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
            .map(|guid| {
                let name = game
                    .data
                    .entities
                    .get(guid)
                    .map(|e| e.name.as_str())
                    .unwrap_or("Unknown Item");
                ListItem::new(name.to_string())
            })
            .collect();

        // Calculate heights for PageUp/PageDown
        game.view.last_dashboard_height = chunks[0].height as usize; // Assuming both same height in 50/50 split

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
                .highlight_style(
                    Style::default()
                        .add_modifier(Modifier::BOLD)
                        .fg(Color::Cyan),
                )
                .highlight_symbol(">> ");
        }

        f.render_stateful_widget(self_list, chunks[0], self_state);

        // Partner side
        let partner_items: Vec<ListItem> = trade
            .partner_side
            .items
            .iter()
            .map(|guid| {
                let name = game
                    .data
                    .entities
                    .get(guid)
                    .map(|e| e.name.as_str())
                    .unwrap_or("Unknown Item");
                ListItem::new(name.to_string())
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
                .highlight_style(
                    Style::default()
                        .add_modifier(Modifier::BOLD)
                        .fg(Color::Cyan),
                )
                .highlight_symbol(">> ");
        }

        f.render_stateful_widget(partner_list, chunks[1], partner_state);
    } else {
        let msg = "No active trade or vendor session. Approach a vendor or trade with a player.";
        let block = Block::default().borders(Borders::ALL).title("Trade");
        let inner = block.inner(area);
        f.render_widget(block, area);
        f.render_widget(Paragraph::new(msg), inner);
    }
}

use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};

use super::super::classification::{classify_entity, classify_vendor_item, get_entity_color};
use crate::ui::state::GameState;
use crate::ui::theme;
use crate::ui::types::TradeFocus;
use crate::ui::utils::format_item_name;
use holtburger_common::defaults::{DEFAULT_PRICE, PROMISSORY_NOTE_SELL_RATE, VENDOR_CEIL_OFFSET};
use holtburger_common::properties::{ItemType, PropertyInt};
use holtburger_world::context::WorldContextExt;

pub fn render_trade_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    if let Some(trade) = &game.data.trade {
        let trade_focus = game.view.trade_focus;
        let partner_name = game
            .data
            .entities
            .get(&trade.partner_guid)
            .map(|e| e.name())
            .unwrap_or("Partner");

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        let selected_index = game.dashboard.selected_index();
        game.dashboard.list_state().select(Some(selected_index));

        // Self side
        let self_items: Vec<ListItem> = trade
            .self_side
            .items
            .iter()
            .enumerate()
            .map(|(i, guid)| {
                let mut display_name = "Unknown Item".to_string();
                let mut emoji = "❓";
                let mut color = Color::White;
                if let Some(e) = game.data.entities.get(guid) {
                    display_name = format_item_name(e, e.guid);

                    let class = classify_entity(e);
                    emoji = class.emoji();
                    color = get_entity_color(class);
                }
                let is_selected =
                    trade_focus == TradeFocus::Local && i == game.dashboard.selected_index();

                let text = format!("[{}] {}", emoji, display_name);
                ListItem::new(Line::styled(text, Style::default().fg(color)))
                    .style(theme::list_item_style(is_selected))
            })
            .collect();

        // Calculate heights for PageUp/PageDown
        let self_area = chunks[0];
        let self_height = self_area.height as usize;
        game.dashboard.last_height = self_height; // Both sides same height in 50/50 split

        let mut default_self_state = ListState::default();
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
                game.dashboard.list_state(),
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
                &mut default_self_state,
            ),
        };

        let self_content_len = self_items.len();
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
        let offset = self_state.offset();
        crate::ui::widgets::scroll::render_scrollbar(f, self_area, self_content_len, offset);

        let selected_index = game.dashboard.selected_index();

        // Partner side
        let partner_area = chunks[1];
        let partner_items: Vec<ListItem> = trade
            .partner_side
            .items
            .iter()
            .enumerate()
            .map(|(i, guid)| {
                let mut display_name = "Unknown Item".to_string();
                let mut emoji = "❓";
                let mut color = Color::White;
                if let Some(e) = game.data.entities.get(guid) {
                    display_name = format_item_name(e, e.guid);

                    let class = classify_entity(e);
                    emoji = class.emoji();
                    color = get_entity_color(class);
                }
                let is_selected = trade_focus == TradeFocus::Partner && i == selected_index;

                let text = format!("[{}] {}", emoji, display_name);
                ListItem::new(Line::styled(text, Style::default().fg(color)))
                    .style(theme::list_item_style(is_selected))
            })
            .collect();

        let mut default_partner_state = ListState::default();
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
                game.dashboard.list_state(),
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
                &mut default_partner_state,
            ),
        };

        let partner_content_len = partner_items.len();
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
        let offset = partner_state.offset();
        crate::ui::widgets::scroll::render_scrollbar(f, partner_area, partner_content_len, offset);
    } else if let Some(vendor) = &game.data.vendor {
        let vendor_name = game
            .data
            .entities
            .get(&vendor.vendor_guid)
            .map(|e| e.name())
            .unwrap_or("Vendor");

        let block = Block::default().borders(Borders::ALL).title(vendor_name);
        let inner_area = block.inner(area);
        f.render_widget(block, area);

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Min(0)])
            .split(inner_area);

        let summary_area = chunks[0];
        let list_area = chunks[1];

        // Summary Line
        let balance = if vendor.alternate_currency_wcid == 0 {
            format!("{}p", game.data.get_pyreal_balance())
        } else {
            format!(
                "{} {}",
                vendor.alternate_currency_amount, vendor.alternate_currency_name
            )
        };

        let summary = Paragraph::new(Line::from(vec![
            Span::styled("Buy: ", Style::default().fg(theme::SUMMARY_FG)),
            Span::raw(format!("{:.2}x  ", vendor.sell_multiplier)),
            Span::styled("Sell: ", Style::default().fg(theme::SUMMARY_FG)),
            Span::raw(format!("{:.2}x  ", vendor.buy_multiplier)),
            Span::styled("Bal: ", Style::default().fg(theme::SUMMARY_FG)),
            Span::styled(balance, Style::default().fg(theme::MONEY_FG)),
        ]));
        f.render_widget(summary, summary_area);

        let items: Vec<ListItem> = vendor
            .items
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let display_name = format_item_name(m, m.guid);

                let class = classify_vendor_item(m);
                let emoji = class.emoji();
                let color = get_entity_color(class);
                let full_name = format!("[{}] {}", emoji, display_name);

                // Calculate vendor's sell price (player pays this)
                // Ground truth: Math.Max(1, (uint)Math.Ceiling(((float)sellRate * (value ?? 0)) - 0.1))
                // Promissory notes have a special rate.
                let mut sell_rate = vendor.sell_multiplier;
                let item_type_bits = m
                    .properties
                    .ints
                    .get(&PropertyInt::ItemType)
                    .copied()
                    .unwrap_or(0) as u32;

                if item_type_bits & ItemType::PROMISSORY_NOTE.bits() != 0 {
                    sell_rate = PROMISSORY_NOTE_SELL_RATE;
                }

                let base_value = m
                    .properties
                    .ints
                    .get(&PropertyInt::Value)
                    .copied()
                    .unwrap_or(0) as f32;

                let price = ((sell_rate * base_value) - VENDOR_CEIL_OFFSET)
                    .ceil()
                    .max(DEFAULT_PRICE as f32) as u32;

                let is_selected = i == game.dashboard.selected_index();

                let currency_suffix = if vendor.alternate_currency_wcid == 0 {
                    "p".to_string()
                } else {
                    format!(" {}", vendor.alternate_currency_name)
                };

                ListItem::new(Line::from(vec![
                    Span::styled(format!("{:<30}", full_name), Style::default().fg(color)),
                    Span::styled(
                        format!("{:>10}{}", price, currency_suffix),
                        Style::default().fg(theme::MONEY_FG),
                    ),
                ]))
                .style(theme::list_item_style(is_selected))
            })
            .collect();

        let content_len = items.len();
        let list = List::new(items)
            .highlight_style(theme::selection_style())
            .highlight_symbol(theme::SELECTION_SYMBOL);

        let selected_index = game.dashboard.selected_index();
        game.dashboard.list_state().select(Some(selected_index));
        game.dashboard.last_height = list_area.height as usize;

        f.render_stateful_widget(list, list_area, game.dashboard.list_state());
        let offset = game.dashboard.list_state().offset();
        crate::ui::widgets::scroll::render_scrollbar(f, list_area, content_len, offset);
    } else {
        let msg = "No active trade or vendor session. Approach a vendor or trade with a player.";
        let horizontal_margin = 2;
        let wrap_width = area.width.saturating_sub(horizontal_margin * 2);

        let needs_wrap = match &game.view.trade_no_session_msg_cache {
            Some((w, _)) => *w != wrap_width,
            None => true,
        };

        if needs_wrap {
            let wrapped = crate::ui::utils::wrap_text(msg, wrap_width as usize);
            game.view.trade_no_session_msg_cache = Some((wrap_width, wrapped));
        }

        if let Some((_, wrapped)) = &game.view.trade_no_session_msg_cache {
            let lines: Vec<Line> = wrapped.iter().map(|s| Line::from(s.as_str())).collect();
            let msg_height = lines.len() as u16;
            let vertical_margin = area.height.saturating_sub(msg_height) / 2;

            let vertical_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(vertical_margin),
                    Constraint::Length(msg_height),
                    Constraint::Min(0),
                ])
                .split(area);

            f.render_widget(
                Paragraph::new(lines).alignment(Alignment::Center),
                vertical_chunks[1],
            );
        }
    }
}

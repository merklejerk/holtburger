use crate::pages::game::panels::dashboard::DashboardState;
use crate::pages::game::{GameData, ViewState};
use crate::theme::pane_block;
use crate::types::{DashboardTab, FocusedPane, VerbInputState};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use unicode_width::UnicodeWidthStr;

pub fn render_dashboard_pane(
    f: &mut Frame,
    data: &GameData,
    view: &ViewState,
    dashboard: &mut DashboardState,
    area: Rect,
) -> Option<(u16, u16)> {
    let (focused_pane, _dashboard_tab) = (view.focused_pane, dashboard.active_tab);
    let is_focused = focused_pane == FocusedPane::Dashboard;

    let top_tabs = [
        (DashboardTab::Nearby, "1", "Near"),
        (DashboardTab::Inventory, "2", "Inv"),
        (DashboardTab::Character, "3", "Char"),
        (DashboardTab::Spells, "4", "Spells"),
    ];

    let bottom_tabs = [
        (DashboardTab::Equip, "5", "Equip"),
        (DashboardTab::Trade, "6", "Trade"),
    ];

    let create_tab_line = |tabs: &[(DashboardTab, &str, &str)],
                           data: &GameData,
                           view: &ViewState,
                           dashboard: &DashboardState| {
        let mut spans = Vec::new();

        let (_focused, active_tab) = (view.focused_pane, dashboard.active_tab);

        for (i, (tab, key, label)) in tabs.iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw("|"));
            }

            let is_active = active_tab == *tab;
            let is_trade_active =
                *tab == DashboardTab::Trade && (data.trade.is_some() || view.vendor.is_some());

            let mut style = Style::default();
            if is_active {
                style = style.add_modifier(Modifier::BOLD);
            }
            if is_trade_active {
                style = style.fg(Color::Green);
            }

            spans.push(Span::styled(format!(" [{}] {} ", key, label), style));
        }

        Line::from(spans)
    };

    let dashboard_block = pane_block(is_focused)
        .title(create_tab_line(&top_tabs, data, view, dashboard))
        .title_bottom(create_tab_line(&bottom_tabs, data, view, dashboard));

    let inner_area = dashboard_block.inner(area);

    let dashboard_inner_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(3), // Verb bar (1 line border + 2 lines text)
        ])
        .split(inner_area);

    f.render_widget(&dashboard_block, area);

    // Tab-specific rendering
    dashboard
        .active_tab_mut()
        .render(f, data, view, dashboard_inner_chunks[0]);

    if let Some(input_state) = dashboard.active_tab_footer_input() {
        let input_widget = render_footer_text_input(input_state);
        f.render_widget(input_widget, dashboard_inner_chunks[1]);

        let cursor_x =
            dashboard_inner_chunks[1].x + 1 + footer_text_input_cursor_offset(input_state);
        let cursor_y = dashboard_inner_chunks[1].y + 1;
        Some((cursor_x, cursor_y))
    } else {
        let verb_bar = render_verb_bar(dashboard, data, view);
        f.render_widget(verb_bar, dashboard_inner_chunks[1]);
        None
    }
}

fn render_verb_bar(
    dashboard: &DashboardState,
    data: &GameData,
    view: &ViewState,
) -> Paragraph<'static> {
    let footer_header = dashboard.active_tab_footer_header();
    let mut verbs = dashboard
        .active_tab()
        .get_verbs(data, view, &view.active_interaction);

    if footer_header.is_some() {
        verbs.retain(|verb| !(verb.shortcut.eq_ignore_ascii_case(&'f') && verb.label == "Filter"));
    }

    verbs.sort_by(|a, b| a.label.cmp(&b.label));

    let mut spans = Vec::new();
    for (i, verb) in verbs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("   "));
        }
        spans.push(Span::raw(verb.display_label().to_string()));
    }

    let verb_line = Line::from(spans);

    if let Some(header) = footer_header {
        return Paragraph::new(vec![Line::from(header), verb_line])
            .block(Block::default().borders(Borders::TOP));
    }

    Paragraph::new(verb_line)
        .block(Block::default().borders(Borders::TOP))
        .wrap(ratatui::widgets::Wrap { trim: true })
}

fn render_footer_text_input(input: &VerbInputState) -> Paragraph<'static> {
    let prompt = input.prompt.to_string();
    let value = if input.input.is_empty() {
        "_".to_string()
    } else {
        input.input.clone()
    };

    let mut value_spans = vec![
        Span::raw(format!("{}: ", prompt)),
        Span::styled(value, Style::default().add_modifier(Modifier::BOLD)),
    ];

    if let (Some(min), Some(max)) = (input.min, input.max) {
        value_spans.push(Span::raw(format!("  [{}-{}]", min, max)));
    }

    let value_line = Line::from(value_spans);

    let hint_line = Line::from(vec![Span::raw("[ENTER] Submit  [ESC] Cancel")])
        .alignment(ratatui::layout::Alignment::Right);

    Paragraph::new(vec![value_line, hint_line])
        .block(Block::default().borders(Borders::TOP))
        .wrap(ratatui::widgets::Wrap { trim: true })
}

fn footer_text_input_cursor_offset(input: &VerbInputState) -> u16 {
    let prompt_text = format!("{}: ", input.prompt);
    let value = if input.input.is_empty() {
        "_"
    } else {
        input.input.as_str()
    };

    (UnicodeWidthStr::width(prompt_text.as_str()) + UnicodeWidthStr::width(value)) as u16
}

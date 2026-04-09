use crate::pages::game::panels::dashboard::DashboardState;
use crate::pages::game::{GameData, ViewState};
use crate::theme::pane_block;
use crate::types::{DashboardTab, FocusedPane, Verb, VerbInputState};
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
) {
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
        (DashboardTab::Party, "7", "Party"),
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
        render_footer_text_input(
            f,
            input_state,
            dashboard_inner_chunks[1],
            focused_pane == FocusedPane::Dashboard,
        );
    } else {
        let verb_bar = render_verb_bar(dashboard, data, view);
        f.render_widget(verb_bar, dashboard_inner_chunks[1]);
    }
}

fn render_verb_bar(
    dashboard: &DashboardState,
    data: &GameData,
    view: &ViewState,
) -> Paragraph<'static> {
    let footer_header = dashboard.active_tab_footer_header();
    let verbs = visible_footer_verbs(dashboard.active_tab().get_verbs(
        data,
        view,
        &view.active_interaction,
    ));

    let mut spans = Vec::new();
    for (i, verb) in verbs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("   "));
        }
        spans.push(Span::raw(verb.display_label().to_string()));
    }

    let verb_line = Line::from(spans);

    let mut block = Block::default().borders(Borders::TOP);
    if let Some(header) = footer_header {
        block = block
            .title(format!(" {} ", header))
            .title_style(Style::default().italic())
            .title_alignment(ratatui::layout::Alignment::Center);
    }

    Paragraph::new(verb_line)
        .block(block)
        .wrap(ratatui::widgets::Wrap { trim: true })
}

fn visible_footer_verbs(mut verbs: Vec<Verb>) -> Vec<Verb> {
    verbs.retain(Verb::is_visible_in_footer);
    verbs.sort_by(|a, b| a.label.cmp(&b.label));
    verbs
}

fn render_footer_text_input(f: &mut Frame, input: &VerbInputState, area: Rect, focused: bool) {
    let prompt = input.prompt.to_string();
    let suffix = if let (Some(min), Some(max)) = (input.min, input.max) {
        format!("  [{}-{}]", min, max)
    } else {
        String::new()
    };
    let prompt_text = format!("{}: ", prompt);
    let prompt_width = UnicodeWidthStr::width(prompt_text.as_str()) as u16;
    let suffix_width = UnicodeWidthStr::width(suffix.as_str()) as u16;
    let outer_block = Block::default().borders(Borders::TOP);
    let inner_area = outer_block.inner(area);
    f.render_widget(outer_block, area);

    let row_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(1)])
        .split(inner_area);

    let value_width = row_chunks[0]
        .width
        .saturating_sub(prompt_width + suffix_width);
    let col_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(prompt_width),
            Constraint::Length(value_width),
            Constraint::Length(suffix_width),
        ])
        .split(row_chunks[0]);

    f.render_widget(Paragraph::new(prompt_text), col_chunks[0]);

    if value_width > 0 {
        let input_widget = input
            .input
            .rendered(Style::default().add_modifier(Modifier::BOLD), focused);
        f.render_widget(&input_widget, col_chunks[1]);
    }

    if suffix_width > 0 {
        f.render_widget(Paragraph::new(suffix), col_chunks[2]);
    }

    let hint_line = Line::from(vec![Span::raw("[ENTER] Submit  [ESC] Cancel")])
        .alignment(ratatui::layout::Alignment::Right);

    f.render_widget(Paragraph::new(hint_line), row_chunks[1]);
}

#[cfg(test)]
mod tests {
    use super::visible_footer_verbs;
    use crate::types::{AppAction, Verb};

    #[test]
    fn visible_footer_verbs_hides_footer_hidden_verbs() {
        let verbs = vec![
            Verb::new(AppAction::Nothing, 'f', "Filter")
                .with_footer_visibility(crate::types::FooterVerbVisibility::Hidden),
            Verb::new(AppAction::Nothing, 'u', "Use"),
        ];

        let visible = visible_footer_verbs(verbs);

        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].label, "Use");
    }

    #[test]
    fn visible_footer_verbs_keeps_footer_visible_verbs_sorted() {
        let verbs = vec![
            Verb::new(AppAction::Nothing, 'u', "Use"),
            Verb::new(AppAction::Nothing, 'f', "Filter"),
        ];

        let visible = visible_footer_verbs(verbs);

        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].label, "Filter");
        assert_eq!(visible[1].label, "Use");
    }
}

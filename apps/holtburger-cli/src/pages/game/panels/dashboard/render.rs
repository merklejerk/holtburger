use crate::pages::game::panels::dashboard::DashboardState;
use crate::pages::game::{GameData, ViewState};
use crate::theme::pane_block;
use crate::types::{DashboardTab, FocusedPane};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

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
                *tab == DashboardTab::Trade && (data.trade.is_some() || data.vendor.is_some());

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

    let verb_bar = crate::utils::render_verb_bar(dashboard, data, view);
    f.render_widget(verb_bar, dashboard_inner_chunks[1]);
}

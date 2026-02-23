use crate::ui::CommandTarget;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::{DashboardTab, FocusedPane};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders};

pub mod input;
pub mod tabs;

pub use self::tabs::common::{Action, Verb};
pub use self::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, SpellsTab, TradeTab};

pub mod assess;
pub mod debug;
pub mod filter;

pub fn get_verbs_for_tab(game: &GameState, tab: DashboardTab, index: usize) -> Vec<Verb> {
    get_tab_controller(tab).get_verbs(game, index)
}

pub fn get_target_at_index<'a>(
    game: &'a GameState,
    tab: DashboardTab,
    index: usize,
) -> CommandTarget<'a> {
    get_tab_controller(tab).get_target_at_index(game, index)
}

pub fn get_tab_controller(tab: DashboardTab) -> Box<dyn TabController> {
    match tab {
        DashboardTab::Equip => Box::new(EquipTab),
        DashboardTab::Nearby => Box::new(NearbyTab),
        DashboardTab::Inventory => Box::new(InventoryTab),
        DashboardTab::Character => Box::new(CharacterTab),
        DashboardTab::Spells => Box::new(SpellsTab),
        DashboardTab::Trade => Box::new(TradeTab),
    }
}

pub fn render_dashboard_pane(f: &mut Frame, game: &mut GameState, area: Rect) {
    let (focused_pane, dashboard_tab) = (game.view.focused_pane, game.view.dashboard_tab);

    let dashboard_style = if focused_pane == FocusedPane::Dashboard {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

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

    let create_tab_line = |tabs: &[(DashboardTab, &str, &str)], game: &GameState| {
        let mut spans = Vec::new();

        let (focused, active_tab) = (game.view.focused_pane, game.view.dashboard_tab);

        if focused == FocusedPane::Dashboard {
            spans.push(Span::styled(
                ">> ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ));
        }
        for (i, (tab, key, label)) in tabs.iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw("|"));
            }

            let is_active = active_tab == *tab;
            let is_trade_active = *tab == DashboardTab::Trade
                && (game.data.trade.is_some() || game.data.vendor.is_some());

            let mut style = Style::default();
            if is_active {
                style = style.add_modifier(Modifier::BOLD);
            }
            if is_trade_active {
                style = style.fg(Color::Green);
            }

            spans.push(Span::styled(format!(" [{}] {} ", key, label), style));
        }

        if focused == FocusedPane::Dashboard {
            spans.push(Span::styled(
                " <<",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ));
        }
        Line::from(spans)
    };

    let dashboard_block = Block::default()
        .borders(Borders::ALL)
        .title(create_tab_line(&top_tabs, game))
        .title_bottom(create_tab_line(&bottom_tabs, game))
        .border_style(dashboard_style);

    let inner_area = dashboard_block.inner(area);

    let dashboard_inner_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(2), // Tooltip area
        ])
        .split(inner_area);

    f.render_widget(&dashboard_block, area);

    // Tab-specific rendering
    get_tab_controller(dashboard_tab).render(f, game, dashboard_inner_chunks[0]);

    if let Some(action_bar) = crate::ui::utils::render_action_bar(game) {
        f.render_widget(action_bar, dashboard_inner_chunks[1]);
    }
}

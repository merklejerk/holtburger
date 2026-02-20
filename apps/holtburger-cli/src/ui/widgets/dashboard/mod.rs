use super::super::types::{DashboardTab, FocusedPane};
use crate::ui::model::{AppState, GameState};
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders};

pub mod input;
pub mod tabs;

pub use self::tabs::common::{Action, Verb};
pub use self::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, SpellsTab};

pub mod assess;
pub mod debug;
pub mod filter;

pub fn get_verbs_for_tab(
    game: &GameState,
    app: &AppState,
    tab: DashboardTab,
    index: usize,
) -> Vec<Verb> {
    get_tab_controller(tab).get_verbs(game, app, index)
}

pub fn get_target_at_index<'a>(
    game: &'a GameState,
    app: &'a AppState,
    tab: DashboardTab,
    index: usize,
) -> CommandTarget<'a> {
    get_tab_controller(tab).get_target_at_index(game, app, index)
}

pub fn get_tab_controller(tab: DashboardTab) -> Box<dyn TabController> {
    match tab {
        DashboardTab::Equip => Box::new(EquipTab),
        DashboardTab::Nearby => Box::new(NearbyTab),
        DashboardTab::Inventory => Box::new(InventoryTab),
        DashboardTab::Character => Box::new(CharacterTab),
        DashboardTab::Spells => Box::new(SpellsTab),
    }
}

pub fn render_dashboard_pane(f: &mut Frame, game: &mut GameState, app: &mut AppState, area: Rect) {
    let (focused_pane, dashboard_tab) = (game.focused_pane, game.dashboard_tab);

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

    let bottom_tabs = [(DashboardTab::Equip, "5", "Equip")];

    let create_tab_line = |tabs: &[(DashboardTab, &str, &str)], game: &GameState| {
        let mut spans = Vec::new();

        let (focused, active_tab) = (game.focused_pane, game.dashboard_tab);

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
            if is_active {
                spans.push(Span::styled(
                    format!(" [{}] {} ", key, label),
                    Style::default().add_modifier(Modifier::BOLD),
                ));
            } else {
                spans.push(Span::raw(format!(" [{}] {} ", key, label)));
            }
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
    match dashboard_tab {
        DashboardTab::Equip => EquipTab.render(f, game, app, dashboard_inner_chunks[0]),
        DashboardTab::Nearby => NearbyTab.render(f, game, app, dashboard_inner_chunks[0]),
        DashboardTab::Inventory => InventoryTab.render(f, game, app, dashboard_inner_chunks[0]),
        DashboardTab::Character => CharacterTab.render(f, game, app, dashboard_inner_chunks[0]),
        DashboardTab::Spells => SpellsTab.render(f, game, app, dashboard_inner_chunks[0]),
    }

    if let Some(action_bar) = crate::ui::utils::render_action_bar(game, app) {
        f.render_widget(action_bar, dashboard_inner_chunks[1]);
    }
}

use crate::state::GameState;
use crate::ui::theme::pane_block;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use crate::ui::{DashboardTab, FocusedPane};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

pub mod input;
pub mod tabs;

pub use self::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, SpellsTab, TradeTab};
pub use crate::ui::types::Verb;

pub mod assess;
pub mod debug;
pub mod filter;

#[derive(Debug, Clone)]
pub struct DashboardState {
    pub active_tab: DashboardTab,
    pub selected_indices: std::collections::HashMap<DashboardTab, usize>,
    pub list_states: std::collections::HashMap<DashboardTab, ratatui::widgets::ListState>,
    pub last_height: usize,
}

impl Default for DashboardState {
    fn default() -> Self {
        Self {
            active_tab: DashboardTab::Nearby,
            selected_indices: std::collections::HashMap::new(),
            list_states: std::collections::HashMap::new(),
            last_height: 0,
        }
    }
}

impl DashboardState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn selected_index(&self) -> usize {
        self.selected_indices
            .get(&self.active_tab)
            .copied()
            .unwrap_or(0)
    }

    pub fn set_selected_index(&mut self, index: usize) {
        self.selected_indices.insert(self.active_tab, index);
    }

    pub fn list_state(&mut self) -> &mut ratatui::widgets::ListState {
        self.list_states.entry(self.active_tab).or_default()
    }
}

pub fn get_verbs_for_tab(game: &GameState, tab: DashboardTab, index: usize) -> Vec<Verb> {
    let interaction = game.view.active_interaction;
    get_tab_controller(tab).get_verbs(game, &interaction, index)
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
    let (focused_pane, dashboard_tab) = (game.view.focused_pane, game.dashboard.active_tab);
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

    let create_tab_line = |tabs: &[(DashboardTab, &str, &str)], game: &GameState| {
        let mut spans = Vec::new();

        let (_focused, active_tab) = (game.view.focused_pane, game.dashboard.active_tab);

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

        Line::from(spans)
    };

    let dashboard_block = pane_block(is_focused)
        .title(create_tab_line(&top_tabs, game))
        .title_bottom(create_tab_line(&bottom_tabs, game));

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
    get_tab_controller(dashboard_tab).render(f, game, dashboard_inner_chunks[0]);

    let verb_bar = crate::ui::utils::render_verb_bar(game);
    f.render_widget(verb_bar, dashboard_inner_chunks[1]);
}

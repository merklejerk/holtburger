use super::super::types::{DashboardTab, FocusedPane};
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use holtburger_core::world::entity::Entity;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, ListItem};

pub fn get_verbs_for_tab(state: &AppState, tab: DashboardTab, index: usize) -> Vec<Verb> {
    match tab {
        DashboardTab::Equip => EquipTab.get_verbs(state, index),
        DashboardTab::Nearby => NearbyTab.get_verbs(state, index),
        DashboardTab::Inventory => InventoryTab.get_verbs(state, index),
        DashboardTab::Character => CharacterTab.get_verbs(state, index),
        DashboardTab::Spells => SpellsTab.get_verbs(state, index),
    }
}
pub mod tabs;

pub use self::tabs::{CharacterTab, EquipTab, InventoryTab, NearbyTab, SpellsTab};
pub use self::tabs::common::{Action, Verb};

pub mod assess;
pub mod debug;
pub mod filter;

pub fn get_target_at_index<'a>(
    state: &'a AppState,
    tab: DashboardTab,
    index: usize,
) -> CommandTarget<'a> {
    match tab {
        DashboardTab::Equip => EquipTab.get_target_at_index(state, index),
        DashboardTab::Nearby => NearbyTab.get_target_at_index(state, index),
        DashboardTab::Inventory => InventoryTab.get_target_at_index(state, index),
        DashboardTab::Character => CharacterTab.get_target_at_index(state, index),
        DashboardTab::Spells => SpellsTab.get_target_at_index(state, index),
    }
}

pub fn render_dashboard_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let dashboard_style = if state.focused_pane == FocusedPane::Dashboard {
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

    let create_tab_line = |tabs: &[(DashboardTab, &str, &str)], state: &AppState| {
        let mut spans = Vec::new();

        if state.focused_pane == FocusedPane::Dashboard {
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

            let is_active = state.dashboard_tab == *tab;
            if is_active {
                spans.push(Span::styled(
                    format!(" [{}] {} ", key, label),
                    Style::default().add_modifier(Modifier::BOLD),
                ));
            } else {
                spans.push(Span::raw(format!(" [{}] {} ", key, label)));
            }
        }

        if state.focused_pane == FocusedPane::Dashboard {
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
        .title(create_tab_line(&top_tabs, state))
        .title_bottom(create_tab_line(&bottom_tabs, state))
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
    match state.dashboard_tab {
        DashboardTab::Equip => EquipTab.render(f, state, dashboard_inner_chunks[0]),
        DashboardTab::Nearby => NearbyTab.render(f, state, dashboard_inner_chunks[0]),
        DashboardTab::Inventory => InventoryTab.render(f, state, dashboard_inner_chunks[0]),
        DashboardTab::Character => CharacterTab.render(f, state, dashboard_inner_chunks[0]),
        DashboardTab::Spells => SpellsTab.render(f, state, dashboard_inner_chunks[0]),
    }

    if let Some(action_bar) = crate::ui::utils::render_action_bar(state) {
        f.render_widget(action_bar, dashboard_inner_chunks[1]);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn render_entity_list_item(
    e: &Entity,
    dist: Option<f32>,
    depth: usize,
    highlight: bool,
    use_emojis: bool,
    is_equipped: bool,
    prefix: Option<&str>,
    is_dimmed: bool,
) -> ListItem<'static> {
    use self::tabs::classification;
    let class = classification::classify_entity(e);
    let color = get_entity_color(e, class);
    let item_style = if highlight {
        Style::default().bg(Color::DarkGray)
    } else {
        Style::default()
    };

    let mut text_style = Style::default().fg(color);
    if is_dimmed {
        // Use a darker gray for dimmed items instead of the DIM modifier, which can bleed into scrollbars.
        text_style = text_style.fg(Color::Gray);
    }

    let type_marker = if use_emojis {
        class.emoji()
    } else {
        class.label()
    };

    let display_name = if e.name.trim().is_empty() {
        format!("<{:08X}>", e.guid)
    } else if is_equipped {
        format!("{} (EQUIPPED)", e.name)
    } else {
        e.name.clone()
    };

    let indent = "  ".repeat(depth);
    let pre = prefix.unwrap_or("");

    let text = if let Some(d) = dist {
        format!(
            "{}{}[{}] {:<15} [{:.1}m]",
            indent, pre, type_marker, display_name, d
        )
    } else {
        format!("{}{}[{}] {:<15}", indent, pre, type_marker, display_name)
    };

    ListItem::new(Line::styled(text, text_style)).style(item_style)
}

fn get_entity_color(e: &Entity, class: self::tabs::classification::EntityClass) -> Color {
    use holtburger_common::properties::RadarColor;
    use self::tabs::classification::EntityClass;
    if class == EntityClass::Monster {
        return Color::Red;
    }

    if let Some(color) = e.radar_blip_color {
        return match color {
            RadarColor::Blue => Color::Blue,
            RadarColor::Gold => Color::Yellow,
            RadarColor::Purple => Color::Magenta,
            RadarColor::Red => Color::Red,
            RadarColor::Green => Color::Green,
            RadarColor::Yellow => Color::Yellow,
            _ => Color::White,
        };
    }

    Color::White
}

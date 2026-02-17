use super::super::types::{CommandTarget, DashboardTab, FocusedPane};
use crate::entities::classification;
use crate::entities::verbs::get_verbs_for_target;
use crate::ui::AppState;
use holtburger_common::properties::{EquipMask, PropertyInt, RadarColor};
use holtburger_core::world::entity::Entity;
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, List, ListItem, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
};

pub fn render_dashboard_pane(f: &mut Frame, state: &mut AppState, area: Rect) {
    let dashboard_style = if state.focused_pane == FocusedPane::Dashboard {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let tabs = [
        (DashboardTab::Entities, "1", "Near"),
        (DashboardTab::Inventory, "2", "Inv"),
        (DashboardTab::Character, "3", "Char"),
        (DashboardTab::Spells, "4", "Spells"),
    ];

    let mut spans = Vec::new();

    // Add focus indicator at the beginning
    if state.focused_pane == FocusedPane::Dashboard {
        spans.push(ratatui::text::Span::styled(
            ">> ",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ));
    }
    for (i, (tab, key, label)) in tabs.iter().enumerate() {
        if i > 0 {
            spans.push(ratatui::text::Span::raw("|"));
        }

        let is_active = state.dashboard_tab == *tab;
        if is_active {
            spans.push(ratatui::text::Span::styled(
                format!(" [{}] {} ", key, label),
                Style::default().add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(ratatui::text::Span::raw(format!(" [{}] {} ", key, label)));
        }
    }

    // Add focus indicator at the end
    if state.focused_pane == FocusedPane::Dashboard {
        spans.push(ratatui::text::Span::styled(
            " <<",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ));
    }

    let dashboard_block = Block::default()
        .borders(Borders::ALL)
        .title(ratatui::text::Line::from(spans))
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
        DashboardTab::Character => {
            let mut bottom_area = dashboard_inner_chunks[0];

            if let Some(info) = &state.level_info {
                let summary_chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Length(1), Constraint::Min(0)])
                    .split(dashboard_inner_chunks[0]);

                let top_area = summary_chunks[0];
                bottom_area = summary_chunks[1];

                use crate::ui::utils::format_cost;
                let text = if info.xp_for_next_level > 0 {
                    format!(
                        "{} XP until {} | {} XP unspent | {} SP",
                        format_cost(info.xp_for_next_level.saturating_sub(info.xp_into_level)),
                        info.level + 1,
                        format_cost(info.unspent_xp),
                        info.unspent_skill_points
                    )
                } else {
                    format!(
                        "{} total | {} XP unspent | {} SP",
                        info.current_xp,
                        format_cost(info.unspent_xp),
                        info.unspent_skill_points
                    )
                };

                let summary = Paragraph::new(Line::from(vec![
                    Span::styled(
                        text,
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("  "),
                ]))
                .alignment(Alignment::Right);
                f.render_widget(summary, top_area);
            }

            let items = crate::ui::widgets::stats::get_stats_list_items(state);
            let total = items.len();
            let dashboard_list = List::new(items)
                .highlight_style(Style::default().add_modifier(Modifier::BOLD))
                .highlight_symbol("> ");

            state
                .dashboard_list_state
                .select(Some(state.selected_dashboard_index));
            f.render_stateful_widget(dashboard_list, bottom_area, &mut state.dashboard_list_state);

            // Render Scrollbar for List-based tabs
            let height = bottom_area.height as usize;
            state.last_dashboard_height = height;

            if total > height {
                let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height))
                    .position(
                        state
                            .selected_dashboard_index
                            .min(total.saturating_sub(height)),
                    );
                f.render_stateful_widget(
                    Scrollbar::default()
                        .orientation(ScrollbarOrientation::VerticalRight)
                        .begin_symbol(Some("▲"))
                        .end_symbol(Some("▼")),
                    bottom_area,
                    &mut scrollbar_state,
                );
            }
        }
        DashboardTab::Entities | DashboardTab::Inventory | DashboardTab::Spells => {
            // These tabs currently all use a List view
            let items = match state.dashboard_tab {
                DashboardTab::Entities => get_nearby_list_items(state),
                DashboardTab::Inventory => get_inventory_list_items(state),
                DashboardTab::Spells => get_spells_list_items(state),
                _ => unreachable!(),
            };

            let total = items.len();
            let dashboard_list = List::new(items)
                .highlight_style(Style::default().add_modifier(Modifier::BOLD))
                .highlight_symbol("> ");

            state
                .dashboard_list_state
                .select(Some(state.selected_dashboard_index));
            f.render_stateful_widget(
                dashboard_list,
                dashboard_inner_chunks[0],
                &mut state.dashboard_list_state,
            );

            // Render Scrollbar for List-based tabs
            let height = dashboard_inner_chunks[0].height as usize;
            state.last_dashboard_height = height;

            if total > height {
                let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height))
                    .position(
                        state
                            .selected_dashboard_index
                            .min(total.saturating_sub(height)),
                    );
                f.render_stateful_widget(
                    Scrollbar::default()
                        .orientation(ScrollbarOrientation::VerticalRight)
                        .begin_symbol(Some("▲"))
                        .end_symbol(Some("▼")),
                    dashboard_inner_chunks[0],
                    &mut scrollbar_state,
                );
            }
        }
    }

    if let Some(action_bar) = crate::ui::utils::render_action_bar(state) {
        f.render_widget(action_bar, dashboard_inner_chunks[1]);
    }
}

pub fn get_nearby_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let dashboard = state.get_filtered_nearby_tab();
    dashboard
        .iter()
        .enumerate()
        .map(|(i, (e, dist, depth))| {
            let target = CommandTarget::Entity(e);
            let has_verbs = !get_verbs_for_target(
                &target,
                state.player_guid,
                &state.inventory,
                state.active_interaction,
            )
            .is_empty();
            render_entity_list_item(
                e,
                Some(*dist),
                *depth,
                i == state.selected_dashboard_index && has_verbs,
                state.use_emojis,
                e.currently_wielded_location,
            )
        })
        .collect()
}

pub fn get_inventory_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let dashboard = state.get_filtered_inventory_tab();
    dashboard
        .iter()
        .enumerate()
        .map(|(i, (e, _, depth))| {
            let target = CommandTarget::Entity(e);
            let has_verbs = !get_verbs_for_target(
                &target,
                state.player_guid,
                &state.inventory,
                state.active_interaction,
            )
            .is_empty();
            let equipped_mask = state.equipment.get(&e.guid).cloned();
            render_entity_list_item(
                e,
                None,
                *depth,
                i == state.selected_dashboard_index && has_verbs,
                state.use_emojis,
                equipped_mask,
            )
        })
        .collect()
}

pub fn get_spells_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let mut spells = state.player_spells.clone();
    spells.sort_by_key(|&sid| {
        state
            .spell_names
            .get(&sid)
            .cloned()
            .unwrap_or_else(|| "".to_string())
    });

    spells
        .iter()
        .enumerate()
        .map(|(i, &spell_id)| {
            let name = state
                .spell_names
                .get(&spell_id)
                .cloned()
                .unwrap_or_else(|| format!("Unknown Spell {}", spell_id));

            let is_selected = i == state.selected_dashboard_index;

            let name_style = if is_selected {
                Style::default().bg(Color::DarkGray)
            } else {
                Style::default()
            };

            let power_style = if is_selected {
                Style::default().bg(Color::DarkGray).fg(Color::Gray)
            } else {
                Style::default().fg(Color::DarkGray)
            };

            ListItem::new(Line::from(vec![
                Span::styled(format!("{:<30}", name), name_style),
                Span::raw(" "),
                Span::styled(
                    if let Some(info) = state.spell_info.get(&spell_id) {
                        format!("Power: {}", info.power)
                    } else {
                        "".to_string()
                    },
                    power_style,
                ),
            ]))
        })
        .collect()
}

fn render_entity_list_item(
    e: &Entity,
    dist: Option<f32>,
    depth: usize,
    highlight: bool,
    use_emojis: bool,
    equipped_mask: Option<EquipMask>,
) -> ListItem<'static> {
    let color = get_entity_color(e);
    let style = if highlight {
        Style::default().bg(Color::DarkGray).fg(color)
    } else {
        Style::default().fg(color)
    };

    let class = classification::classify_entity(e);
    let type_marker = if use_emojis {
        class.emoji()
    } else {
        class.label()
    };

    let display_name = if e.name.trim().is_empty() {
        format!("<{:08X}>", e.guid)
    } else if let Some(mask) = equipped_mask {
        let slots = mask
            .iter_names()
            .map(|(name, _)| name)
            .collect::<Vec<_>>()
            .join("|");
        if slots.is_empty() {
            format!("{} (E)", e.name)
        } else {
            format!("{} [{}]", e.name, slots)
        }
    } else {
        e.name.clone()
    };

    let indent = "  ".repeat(depth);

    let text = if let Some(d) = dist {
        format!(
            "{}[{}] {:<15} [{:.1}m]",
            indent, type_marker, display_name, d
        )
    } else {
        format!("{}[{}] {:<15}", indent, type_marker, display_name)
    };

    ListItem::new(text).style(style)
}

fn get_entity_color(e: &Entity) -> Color {
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

    let color_val = e
        .int_properties
        .get(&(PropertyInt::RadarBlipColor as u32))
        .cloned()
        .unwrap_or(0);
    match color_val as u8 {
        c if c == RadarColor::Blue as u8 => Color::Blue,
        c if c == RadarColor::Gold as u8 => Color::Yellow,
        c if c == RadarColor::Purple as u8 => Color::Magenta,
        c if c == RadarColor::Red as u8 => Color::Red,
        c if c == RadarColor::Green as u8 => Color::Green,
        c if c == RadarColor::Yellow as u8 => Color::Yellow,
        _ => Color::White,
    }
}

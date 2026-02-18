use super::super::types::{DashboardTab, FocusedPane};
use crate::entities::classification;
use crate::ui::AppState;
use holtburger_common::properties::{PseudoEquipMask, EquipMask, PropertyInt, RadarColor};
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

    let top_tabs = [
        (DashboardTab::Entities, "1", "Near"),
        (DashboardTab::Inventory, "2", "Inv"),
        (DashboardTab::Character, "3", "Char"),
        (DashboardTab::Spells, "4", "Spells"),
    ];

    let bottom_tabs = [(DashboardTab::Equip, "5", "Equip")];

    let create_tab_line = |tabs: &[(DashboardTab, &str, &str)], state: &AppState| {
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
        ratatui::text::Line::from(spans)
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
                        .track_symbol(Some(" "))
                        .thumb_symbol("█")
                        .end_symbol(Some("▼"))
                        .style(Style::default().fg(Color::Gray).bg(Color::Black))
                        .track_style(Style::default().fg(Color::DarkGray).bg(Color::Black))
                        .thumb_style(Style::default().fg(Color::White).bg(Color::Black)),
                    bottom_area,
                    &mut scrollbar_state,
                );
            }
        }
        DashboardTab::Entities
        | DashboardTab::Inventory
        | DashboardTab::Spells
        | DashboardTab::Equip => {
            // These tabs currently all use a List view
            let items = match state.dashboard_tab {
                DashboardTab::Entities => get_nearby_list_items(state),
                DashboardTab::Inventory => get_inventory_list_items(state),
                DashboardTab::Equip => get_equip_list_items(state),
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
                        .track_symbol(Some(" "))
                        .thumb_symbol("█")
                        .end_symbol(Some("▼"))
                        .style(Style::default().fg(Color::Gray).bg(Color::Black))
                        .track_style(Style::default().fg(Color::DarkGray).bg(Color::Black))
                        .thumb_style(Style::default().fg(Color::White).bg(Color::Black)),
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

pub enum EquipTabLine<'a> {
    Header(String, bool),
    Item(&'a Entity, bool, bool, Option<EquipMask>),
}

pub fn get_equip_tab_lines(state: &AppState) -> Vec<EquipTabLine<'_>> {
    let mut lines = Vec::new();

    let categories = [
        (PseudoEquipMask::MAIN_HAND_IMPLEMENTS.into(), "Main Hand", None),
        (
            PseudoEquipMask::OFF_HAND_IMPLEMENTS.into(),
            "Off-Hand",
            Some(PseudoEquipMask::OFF_HAND_SLOT.into()),
        ),
        (PseudoEquipMask::TOP_CLOTHES.into(), "Top Clothes", None),
        (PseudoEquipMask::BOTTOM_CLOTHES.into(), "Bottom Clothes", None),
        (EquipMask::HEAD_WEAR, "Head Wear", None),
        (EquipMask::HAND_WEAR, "Hand Wear", None),
        (EquipMask::FOOT_WEAR, "Foot Wear", None),
        (EquipMask::CHEST_ARMOR, "Chest Armor", None),
        (EquipMask::ABDOMEN_ARMOR, "Abdomen Armor", None),
        (EquipMask::UPPER_ARM_ARMOR, "Upper Arm Armor", None),
        (EquipMask::LOWER_ARM_ARMOR, "Lower Arm Armor", None),
        (EquipMask::UPPER_LEG_ARMOR, "Upper Leg Armor", None),
        (EquipMask::LOWER_LEG_ARMOR, "Lower Leg Armor", None),
        (EquipMask::NECK_WEAR, "Neck Wear", None),
        (EquipMask::WRIST_WEAR_LEFT, "Left Wrist", None),
        (EquipMask::WRIST_WEAR_RIGHT, "Right Wrist", None),
        (EquipMask::FINGER_WEAR_LEFT, "Left Finger", None),
        (EquipMask::FINGER_WEAR_RIGHT, "Right Finger", None),
        (EquipMask::MISSILE_AMMO, "Missile Ammo", None),
        (EquipMask::TRINKET_ONE, "Trinket", None),
        (EquipMask::CLOAK, "Cloak", None),
        (EquipMask::SIGIL_ONE, "Sigil 1", None),
        (EquipMask::SIGIL_TWO, "Sigil 2", None),
        (EquipMask::SIGIL_THREE, "Sigil 3", None),
    ];

    let mut equippable_items: Vec<&Entity> = state
        .inventory
        .iter()
        .filter_map(|guid| state.entities.get(guid))
        .filter(|e| e.valid_locations.is_some_and(|v| !v.is_empty()))
        .collect();

    // Sort all equippable items by name once to keep consistent ordering within buckets
    equippable_items.sort_by(|a, b| a.name.cmp(&b.name));

    for (mask, name, context_mask) in categories {
        let mut items_in_slot: Vec<(&Entity, bool, bool)> = Vec::new();
        let mut is_occupied = false;

        let check_mask = context_mask.unwrap_or(mask);

        for item in &equippable_items {
            let valid = item.valid_locations.unwrap_or(EquipMask::NONE);

            if valid.intersects(mask) {
                let current_mask = state
                    .equipment
                    .get(&item.guid)
                    .cloned()
                    .unwrap_or(EquipMask::NONE);
                let is_equipped_here = current_mask.intersects(check_mask);
                let is_equipped_elsewhere = !current_mask.is_empty() && !is_equipped_here;

                if is_equipped_here {
                    is_occupied = true;
                }
                items_in_slot.push((item, is_equipped_here, is_equipped_elsewhere));
            }
        }

        lines.push(EquipTabLine::Header(name.to_string(), is_occupied));

        if !items_in_slot.is_empty() {
            // Sort: equipped items first
            items_in_slot.sort_by(|(_, a_eq, _), (_, b_eq, _)| b_eq.cmp(a_eq));

            for (item, is_equipped_here, is_equipped_elsewhere) in items_in_slot {
                lines.push(EquipTabLine::Item(
                    item,
                    is_equipped_here,
                    is_equipped_elsewhere,
                    context_mask,
                ));
            }
        }
    }

    lines
}

pub fn get_nearby_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let dashboard = state.get_filtered_nearby_tab();
    dashboard
        .iter()
        .enumerate()
        .map(|(i, (e, dist, depth))| {
            render_entity_list_item(
                e,
                Some(*dist),
                *depth,
                i == state.selected_dashboard_index,
                state.use_emojis,
                false,
                None,
                false,
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
            let is_equipped =
                state.equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;
            render_entity_list_item(
                e,
                None,
                *depth,
                i == state.selected_dashboard_index,
                state.use_emojis,
                is_equipped,
                None,
                false,
            )
        })
        .collect()
}

pub fn get_equip_list_items(state: &AppState) -> Vec<ListItem<'static>> {
    let lines = get_equip_tab_lines(state);
    lines
        .into_iter()
        .enumerate()
        .map(|(i, line)| match line {
            EquipTabLine::Header(name, is_occupied) => {
                let is_selected = i == state.selected_dashboard_index;
                let style = if is_selected {
                    Style::default().bg(Color::DarkGray).fg(Color::Yellow)
                } else {
                    Style::default().fg(Color::Yellow)
                };

                let marker = if state.use_emojis {
                    if is_occupied { "🟢 " } else { "⭕ " }
                } else if is_occupied {
                    "[X] "
                } else {
                    "[ ] "
                };

                ListItem::new(Line::from(vec![
                    Span::styled(marker, style),
                    Span::styled(name, style.add_modifier(Modifier::BOLD)),
                ]))
            }
            EquipTabLine::Item(e, is_equipped_here, is_equipped_elsewhere, _mask) => {
                let is_selected = i == state.selected_dashboard_index;

                let marker = if is_equipped_here {
                    if state.use_emojis { "✅" } else { "*" }
                } else {
                    "  "
                };
                let is_equipped =
                    state.equipment.get(&e.guid).unwrap_or(&EquipMask::NONE) != &EquipMask::NONE;

                render_entity_list_item(
                    e,
                    None,
                    1, // Indent items
                    is_selected,
                    state.use_emojis,
                    is_equipped,
                    Some(marker),
                    is_equipped_elsewhere,
                )
            }
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
#[allow(clippy::too_many_arguments)]
fn render_entity_list_item(
    e: &Entity,
    dist: Option<f32>,
    depth: usize,
    highlight: bool,
    use_emojis: bool,
    is_equipped: bool,
    prefix: Option<&str>,
    is_dimmed: bool,
) -> ListItem<'static> {
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

fn get_entity_color(e: &Entity, class: classification::EntityClass) -> Color {
    if class == classification::EntityClass::Monster {
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

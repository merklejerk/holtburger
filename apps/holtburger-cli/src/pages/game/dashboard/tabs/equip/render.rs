use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use super::super::classification::{classify_entity, get_entity_color};
use crate::ui::state::GameState;
use crate::ui::theme;
use crate::ui::utils::format_item_name;
use holtburger_common::properties::{EquipMask, PseudoEquipMask};
use holtburger_core::client::types::TargetSlot;
use holtburger_world::entity::Entity;

pub enum EquipTabLine<'a> {
    Header(String, bool),
    Item(&'a Entity, bool, bool, Option<TargetSlot>),
}

pub fn render_equip_tab(f: &mut Frame, game: &mut GameState, area: Rect) {
    let items = get_list_items(game);
    let content_len = items.len();

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = game.dashboard.selected_index();
    game.dashboard.list_state().select(Some(selected_index));
    f.render_stateful_widget(dashboard_list, area, game.dashboard.list_state());
    let offset = game.dashboard.list_state().offset();
    crate::ui::widgets::scroll::render_scrollbar(f, area, content_len, offset);

    let height = area.height as usize;
    game.dashboard.last_height = height;
}

fn get_list_items(game: &GameState) -> Vec<ListItem<'static>> {
    let lines = get_lines(game);
    let mut list_items = Vec::new();

    for (i, line) in lines.into_iter().enumerate() {
        let is_selected = i == game.dashboard.selected_index();
        match line {
            EquipTabLine::Header(name, occupied) => {
                let color = if occupied {
                    Color::Green
                } else {
                    Color::DarkGray
                };
                list_items.push(
                    ListItem::new(Line::from(vec![Span::styled(
                        format!("--- {} ---", name),
                        Style::default().fg(color).add_modifier(Modifier::BOLD),
                    )]))
                    .style(theme::list_item_style(is_selected)),
                );
            }
            EquipTabLine::Item(item, is_equipped_here, is_equipped_elsewhere, _) => {
                let mut spans = Vec::new();
                if is_equipped_here {
                    spans.push(Span::styled("[E] ", Style::default().fg(Color::Green)));
                } else if is_equipped_elsewhere {
                    spans.push(Span::styled("[X] ", Style::default().fg(Color::Red)));
                } else {
                    spans.push(Span::raw("    "));
                }

                let name = format_item_name(item, item.guid);

                spans.push(Span::styled(
                    name,
                    Style::default().fg({
                        let class = classify_entity(item);
                        get_entity_color(class)
                    }),
                ));

                list_items.push(
                    ListItem::new(Line::from(spans)).style(theme::list_item_style(is_selected)),
                );
            }
        }
    }

    list_items
}

pub fn get_lines<'a>(game: &'a GameState) -> Vec<EquipTabLine<'a>> {
    let mut lines = Vec::new();

    let categories = [
        (
            PseudoEquipMask::MAIN_HAND_IMPLEMENTS.into(),
            "Main Hand",
            Some(TargetSlot::MainHand),
        ),
        (
            PseudoEquipMask::OFF_HAND_IMPLEMENTS.into(),
            "Off-Hand",
            Some(TargetSlot::OffHand),
        ),
        (
            PseudoEquipMask::TOP_CLOTHES.into(),
            "Top Clothes",
            Some(TargetSlot::TopClothes),
        ),
        (
            PseudoEquipMask::BOTTOM_CLOTHES.into(),
            "Bottom Clothes",
            Some(TargetSlot::BottomClothes),
        ),
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

    let mut equippable_items: Vec<&Entity> = game
        .data
        .inventory
        .iter()
        .filter_map(|guid| game.data.entities.get(guid))
        .filter(|e| !e.valid_locations().is_empty())
        .collect();

    // Sort all equippable items by name once to keep consistent ordering within buckets
    equippable_items.sort_by(|a, b| a.name().cmp(b.name()));

    for (mask, name, target_slot) in categories {
        let mut items_in_slot: Vec<(&Entity, bool, bool)> = Vec::new();
        let mut is_occupied = false;

        // Simplified context mask logic: use the target slot's mask if available, else the category mask
        let check_mask = match target_slot {
            Some(TargetSlot::MainHand) => PseudoEquipMask::MAIN_HAND_IMPLEMENTS.into(),
            Some(TargetSlot::OffHand) => PseudoEquipMask::OFF_HAND_SLOT.into(),
            Some(TargetSlot::TopClothes) => PseudoEquipMask::TOP_CLOTHES.into(),
            Some(TargetSlot::BottomClothes) => PseudoEquipMask::BOTTOM_CLOTHES.into(),
            _ => mask,
        };

        for item in &equippable_items {
            let valid = item.valid_locations();

            if valid.intersects(mask) {
                let current_mask = game
                    .data
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
        for (item, is_here, is_elsewhere) in items_in_slot {
            // Map back to the specific TargetSlot if applicable, otherwise a generic mask
            let context_slot = match target_slot {
                Some(slot) => Some(slot),
                _ => Some(TargetSlot::EquipMask(mask)),
            };
            lines.push(EquipTabLine::Item(
                item,
                is_here,
                is_elsewhere,
                context_slot,
            ));
        }
    }

    lines
}

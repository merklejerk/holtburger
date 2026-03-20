use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use super::super::classification::{classify_entity, get_entity_color};
use super::tab::EquipTab;
use crate::pages::game::{GameData, ViewState};
use crate::theme;
use crate::utils::{active_interaction_subject_guid, format_item_name};
use holtburger_common::properties::{EquipMask, PseudoEquipMask, WorldObjectExt as _};
use holtburger_core::client::types::TargetSlot;
use holtburger_world::entity::Entity;

pub enum EquipTabLine<'a> {
    Header(String, bool),
    Item(&'a Entity, bool, bool, TargetSlot),
}

pub fn render_equip_tab(
    tab: &mut EquipTab,
    f: &mut Frame,
    data: &GameData,
    view: &ViewState,
    area: Rect,
) {
    let items = get_list_items(tab.selected_index, data, view);
    let content_len = items.len();

    let dashboard_list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let selected_index = tab.selected_index;
    let list_state = &mut tab.list_state;
    list_state.select(Some(selected_index));

    f.render_stateful_widget(dashboard_list, area, list_state);
    let offset = list_state.offset();
    crate::components::scroll::render_scrollbar(f, area, content_len, offset);

    let _height = area.height as usize;
}

fn get_list_items(
    selected_index: usize,
    data: &GameData,
    view: &ViewState,
) -> Vec<ListItem<'static>> {
    let lines = get_lines(data);
    let mut list_items = Vec::new();
    let active_subject_guid = active_interaction_subject_guid(view.active_interaction);

    for (i, line) in lines.into_iter().enumerate() {
        let is_selected = i == selected_index;
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
                let decorated_name = if active_subject_guid == Some(item.guid) {
                    format!(">> {} <<", name)
                } else {
                    name
                };

                let mut name_style = Style::default().fg({
                    let class = classify_entity(item);
                    get_entity_color(class)
                });

                if is_equipped_here || is_equipped_elsewhere {
                    name_style = name_style.add_modifier(Modifier::ITALIC);
                }

                if active_subject_guid == Some(item.guid) {
                    name_style = name_style.add_modifier(Modifier::BOLD);
                }

                spans.push(Span::styled(decorated_name, name_style));

                list_items.push(
                    ListItem::new(Line::from(spans)).style(theme::list_item_style(is_selected)),
                );
            }
        }
    }

    list_items
}

pub fn get_lines<'a>(data: &'a GameData) -> Vec<EquipTabLine<'a>> {
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

    let mut equippable_items: Vec<&Entity> = data
        .inventory
        .iter()
        .filter_map(|guid| data.entities.get(guid))
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
                let current_mask = data
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
                Some(slot) => slot,
                _ => TargetSlot::EquipMask(mask),
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

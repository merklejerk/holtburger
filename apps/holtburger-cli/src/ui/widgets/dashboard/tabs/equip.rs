use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Scrollbar, ScrollbarOrientation, ScrollbarState};

use holtburger_common::properties::{EquipMask, PseudoEquipMask};
use holtburger_core::client::types::TargetSlot;
use holtburger_core::world::entity::Entity;

use super::super::verbs;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;

pub struct EquipTab;

pub enum EquipTabLine<'a> {
    Header(String, bool),
    Item(&'a Entity, bool, bool, Option<TargetSlot>),
}

impl TabController for EquipTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        let items = self.get_list_items(state);
        let total = items.len();
        let dashboard_list = List::new(items)
            .highlight_style(Style::default().add_modifier(Modifier::BOLD))
            .highlight_symbol("> ");

        state
            .dashboard_list_state
            .select(Some(state.selected_dashboard_index));
        f.render_stateful_widget(dashboard_list, area, &mut state.dashboard_list_state);

        // Render Scrollbar
        let height = area.height as usize;
        state.last_dashboard_height = height;

        if total > height {
            let mut scrollbar_state = ScrollbarState::new(total.saturating_sub(height)).position(
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
                area,
                &mut scrollbar_state,
            );
        }
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> Vec<verbs::EntityVerb> {
        let lines = self.get_lines(state);
        let target = match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        };

        if let Some(interaction_verbs) =
            verbs::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        match lines.get(index) {
            Some(EquipTabLine::Item(e, is_here, _, slot)) => {
                let mut verbs = verbs::get_base_entity_verbs(e);

                if *is_here {
                    verbs.push(verbs::EntityVerb::Unequip);
                } else if let Some(s) = slot {
                    verbs.push(verbs::EntityVerb::Equip(*s));
                }

                verbs.push(verbs::EntityVerb::Drop);
                verbs.push(verbs::EntityVerb::Debug);
                verbs
            }
            _ => vec![],
        }
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let lines = self.get_lines(state);
        match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        }
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        self.get_lines(state).len()
    }
}

impl EquipTab {
    fn get_lines<'a>(&self, state: &'a AppState) -> Vec<EquipTabLine<'a>> {
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

        let mut equippable_items: Vec<&Entity> = state
            .inventory
            .iter()
            .filter_map(|guid| state.entities.get(guid))
            .filter(|e| e.valid_locations.is_some_and(|v| !v.is_empty()))
            .collect();

        // Sort all equippable items by name once to keep consistent ordering within buckets
        equippable_items.sort_by(|a, b| a.name.cmp(&b.name));

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

    fn get_list_items(&self, state: &AppState) -> Vec<ListItem<'static>> {
        let lines = self.get_lines(state);
        let mut list_items = Vec::new();

        for line in lines {
            match line {
                EquipTabLine::Header(name, occupied) => {
                    let color = if occupied {
                        Color::Green
                    } else {
                        Color::DarkGray
                    };
                    list_items.push(ListItem::new(Line::from(vec![Span::styled(
                        format!("--- {} ---", name),
                        Style::default().fg(color).add_modifier(Modifier::BOLD),
                    )])));
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

                    spans.push(Span::styled(
                        item.name.clone(),
                        Style::default().fg(
                            if let Some(color) = item.radar_blip_color.and_then(|c| {
                                super::super::classification::radar_color_to_tui_color(c)
                            }) {
                                color
                            } else {
                                Color::White
                            },
                        ),
                    ));

                    list_items.push(ListItem::new(Line::from(spans)));
                }
            }
        }

        list_items
    }
}

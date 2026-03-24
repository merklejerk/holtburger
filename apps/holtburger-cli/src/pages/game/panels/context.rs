use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::widgets::{List, ListItem};

use crate::pages::game::panels::dashboard::{assess, debug};
use crate::pages::game::{GameData, ViewState};
use crate::theme::{pane_block, pane_title_style};
use crate::types::{ContextView, InspectTarget};
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_world::inspect::InspectableObject;

// In a fully dismantled view state, Context State should be passed directly here.
pub fn render_context_pane(
    f: &mut Frame,
    context_buffer: &[ratatui::text::Line<'static>],
    context_view: &ContextView,
    scroll_offset: usize,
    is_focused: bool,
    area: Rect,
) {
    let height = area.height.saturating_sub(2) as usize;
    let total_ctx = context_buffer.len();

    let ctx_start = scroll_offset.min(total_ctx.saturating_sub(height));
    let ctx_end = (ctx_start + height).min(total_ctx);

    let mut ctx_items: Vec<ListItem<'static>> = context_buffer[ctx_start..ctx_end]
        .iter()
        .map(|s| ListItem::new(s.clone()))
        .collect();

    if ctx_items.len() < height {
        let pad_count = height - ctx_items.len();
        let padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        ctx_items.extend(padding);
    }

    let base_title = match context_view {
        ContextView::Default => "Context Information",
        ContextView::Assess(_) => "Object Appraisal",
        ContextView::Debug(_) => "Debug Information",
        ContextView::Spell(_) => "Spell Details",
        ContextView::Enchantment(_) => "Enchantment Details",
        ContextView::DebugSpell(_) => "Debug Information",
        ContextView::DebugEnchantment(_) => "Debug Information",
    };

    let ctx_title = format!(" {} ", base_title);

    let ctx_list = List::new(ctx_items).block(
        pane_block(is_focused)
            .title(ctx_title)
            .title_style(pane_title_style(is_focused)),
    );
    f.render_widget(ctx_list, area);

    crate::components::scroll::render_scrollbar(
        f,
        area.inner(ratatui::layout::Margin {
            vertical: 1,
            horizontal: 0,
        }),
        total_ctx,
        ctx_start,
    );
}

pub fn build_context_panel_content(data: &GameData, view: &ViewState) -> Vec<Line<'static>> {
    match view.context_view {
        ContextView::Assess(target) => {
            if let Some(object) = resolve_inspectable_target(data, view, target) {
                return assess::get_assess_info(data, &object, data.spell_catalog.as_deref());
            }
            vec![]
        }
        ContextView::Debug(target) => {
            let player_guid = data.player_guid;
            let player_info = match target {
                InspectTarget::Entity(guid) if Some(guid) == player_guid => {
                    Some(debug::PlayerDebugInfo {
                        attributes: &data.attributes,
                        vitals: &data.vitals,
                        skills: &data.skills,
                        enchantments: &data.player_enchantments,
                    })
                }
                _ => None,
            };

            if resolve_inspectable_target(data, view, target).is_some() {
                return debug::get_debug_info(
                    data,
                    Some(view),
                    target,
                    |id| {
                        data.entities
                            .get(&id)
                            .map(|e| e.name().to_string())
                            .or_else(|| {
                                if Some(id) == player_guid {
                                    Some("You".to_string())
                                } else {
                                    None
                                }
                            })
                    },
                    data.spell_catalog.as_deref(),
                    player_info,
                );
            }
            vec![]
        }
        ContextView::Spell(spell_id) => {
            debug::get_spell_details_info(spell_id, data.spell_catalog.as_deref())
        }
        ContextView::Enchantment(enchant) => {
            debug::get_enchantment_details_info(&enchant, data.spell_catalog.as_deref())
        }
        ContextView::DebugSpell(spell_id) => {
            debug::get_spell_debug_info(spell_id, data.spell_catalog.as_deref())
        }
        ContextView::DebugEnchantment(enchant) => {
            debug::get_enchantment_debug_info(&enchant, data.spell_catalog.as_deref())
        }
        _ => vec![],
    }
}

fn resolve_inspectable_target<'a>(
    data: &'a GameData,
    view: &'a ViewState,
    target: InspectTarget,
) -> Option<InspectableObject<'a>> {
    match target {
        InspectTarget::Entity(guid) => data.entities.get(&guid).map(InspectableObject::from_entity),
        InspectTarget::VendorItem(guid) => view
            .vendor
            .as_ref()
            .and_then(|vendor| vendor.items.iter().find(|item| item.guid == guid))
            .map(InspectableObject::from_vendor_item),
    }
}

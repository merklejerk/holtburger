use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::widgets::{List, ListItem};

use crate::pages::game::panels::dashboard::{assess, debug};
use crate::pages::game::panels::logopolis::LogopolisState;
use crate::pages::game::{GameData, ViewState};
use crate::theme::{pane_block, pane_title_style};
use crate::types::{ContextView, InspectTarget};
use crate::utils::wrap_text;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_world::book::BookData;
use holtburger_world::inspect::InspectableObject;

// In a fully dismantled view state, Context State should be passed directly here.
pub struct ContextPaneRenderArgs<'a> {
    pub data: &'a GameData,
    pub context_buffer: &'a [ratatui::text::Line<'static>],
    pub context_view: &'a ContextView,
    pub logopolis: Option<&'a LogopolisState>,
    pub scroll_offset: usize,
    pub is_focused: bool,
    pub area: Rect,
}

pub fn render_context_pane(f: &mut Frame, args: ContextPaneRenderArgs<'_>) {
    let ContextPaneRenderArgs {
        data,
        context_buffer,
        context_view,
        logopolis,
        scroll_offset,
        is_focused,
        area,
    } = args;

    if let Some(game) = logopolis {
        let height = area.height.saturating_sub(2) as usize;
        let width = area.width.saturating_sub(2) as usize;
        let ctx_items: Vec<ListItem<'static>> = game
            .render_lines(width, height)
            .into_iter()
            .map(ListItem::new)
            .collect();

        let ctx_block = pane_block(is_focused)
            .title(format!(" {} ", game.score_title()))
            .title_style(pane_title_style(is_focused));

        let ctx_list = List::new(ctx_items).block(ctx_block);
        f.render_widget(ctx_list, area);
        return;
    }

    let height = area.height.saturating_sub(2) as usize;
    let display_lines = build_context_display_lines(
        context_buffer,
        context_view,
        area.width.saturating_sub(2) as usize,
    );
    let total_ctx = display_lines.len();

    let ctx_start = scroll_offset.min(total_ctx.saturating_sub(height));
    let ctx_end = (ctx_start + height).min(total_ctx);

    let mut ctx_items: Vec<ListItem<'static>> = display_lines[ctx_start..ctx_end]
        .iter()
        .map(|s| ListItem::new(s.clone()))
        .collect();

    if ctx_items.len() < height {
        let pad_count = height - ctx_items.len();
        let padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        ctx_items.extend(padding);
    }

    let base_title = match context_view {
        ContextView::Default => "Context Information".to_string(),
        ContextView::Assess(_) => "Object Appraisal".to_string(),
        ContextView::Debug(_) => "Debug Information".to_string(),
        ContextView::Book(guid) => data
            .entities
            .get(guid)
            .map(|entity| entity.name().to_string())
            .map(|name| format!("Reading {}", name))
            .unwrap_or_else(|| "Reading".to_string()),
        ContextView::Spell(_) => "Spell Details".to_string(),
        ContextView::Enchantment(_) => "Enchantment Details".to_string(),
        ContextView::DebugSpell(_) => "Debug Information".to_string(),
        ContextView::DebugEnchantment(_) => "Debug Information".to_string(),
        ContextView::Logopolis => "Logopolis".to_string(),
    };

    let ctx_title = format!(" {} ", base_title);

    let ctx_block = pane_block(is_focused)
        .title(ctx_title)
        .title_style(pane_title_style(is_focused));

    let ctx_list = List::new(ctx_items).block(ctx_block);
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

pub fn build_context_display_lines(
    context_buffer: &[Line<'static>],
    context_view: &ContextView,
    width: usize,
) -> Vec<Line<'static>> {
    match context_view {
        ContextView::Book(_) => context_buffer
            .iter()
            .flat_map(|line| {
                wrap_text(&line.to_string(), width)
                    .into_iter()
                    .map(Line::from)
                    .collect::<Vec<_>>()
            })
            .collect(),
        _ => context_buffer.to_vec(),
    }
}

pub fn build_context_panel_content(data: &GameData, view: &ViewState) -> Vec<Line<'static>> {
    match view.context_view {
        ContextView::Assess(target) => {
            let spell_catalog = data.spell_catalog();
            if let Some(object) = resolve_inspectable_target(data, view, target) {
                return assess::get_assess_info(data, &object, spell_catalog.as_deref());
            }
            vec![]
        }
        ContextView::Debug(target) => {
            let spell_catalog = data.spell_catalog();
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
                let projected_sample = match target {
                    InspectTarget::Entity(guid) => data.runtime_sample_for_guid(guid),
                    InspectTarget::VendorItem(_) => None,
                };
                return debug::get_debug_info(
                    data,
                    Some(view),
                    target,
                    projected_sample,
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
                    spell_catalog.as_deref(),
                    player_info,
                );
            }
            vec![]
        }
        ContextView::Spell(spell_id) => {
            let spell_catalog = data.spell_catalog();
            debug::get_spell_details_info(spell_id, spell_catalog.as_deref())
        }
        ContextView::Enchantment(enchant) => {
            let spell_catalog = data.spell_catalog();
            debug::get_enchantment_details_info(&enchant, spell_catalog.as_deref())
        }
        ContextView::DebugSpell(spell_id) => {
            let spell_catalog = data.spell_catalog();
            debug::get_spell_debug_info(spell_id, spell_catalog.as_deref())
        }
        ContextView::DebugEnchantment(enchant) => {
            let spell_catalog = data.spell_catalog();
            debug::get_enchantment_debug_info(&enchant, spell_catalog.as_deref())
        }
        ContextView::Book(guid) => {
            if let Some(entity) = data.entities.get(&guid)
                && let Some(book) = entity.book.as_ref()
            {
                return build_book_content(book);
            }

            vec![Line::from("Reading...")]
        }
        _ => vec![],
    }
}

fn build_book_content(book: &BookData) -> Vec<Line<'static>> {
    let mut combined_text = book
        .pages
        .iter()
        .filter_map(|page| page.page_text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");

    if let Some(author_name) = book_author_name(book) {
        if !combined_text.is_empty() {
            combined_text.push('\n');
        }
        combined_text.push_str("       --  ");
        combined_text.push_str(author_name);
    }

    if combined_text.is_empty() {
        return vec![Line::from("No page contents available yet.")];
    }

    combined_text
        .split('\n')
        .map(|line| Line::from(line.to_string()))
        .collect()
}

fn book_author_name(book: &BookData) -> Option<&str> {
    book.author_name
        .as_deref()
        .filter(|name| !name.is_empty())
        .or_else(|| {
            book.pages
                .iter()
                .map(|page| page.author_name.as_str())
                .find(|name| !name.is_empty())
        })
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

#[cfg(test)]
mod tests {
    use super::{
        book_author_name, build_book_content, build_context_display_lines, render_context_pane,
    };
    use crate::pages::game::GameData;
    use crate::pages::game::panels::logopolis::LogopolisState;
    use crate::types::ContextView;
    use holtburger_common::Guid;
    use holtburger_world::book::{BookData, BookPage};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::text::Line;

    #[test]
    fn build_book_content_concatenates_pages_and_signature() {
        let book = BookData {
            author_name: Some("A. Writer".to_string()),
            pages: vec![
                BookPage {
                    index: 0,
                    author_id: 1,
                    author_name: "A. Writer".to_string(),
                    author_account: "acct".to_string(),
                    flags: 0,
                    text_included: true,
                    ignore_author: false,
                    page_text: Some("First page".to_string()),
                },
                BookPage {
                    index: 1,
                    author_id: 1,
                    author_name: "A. Writer".to_string(),
                    author_account: "acct".to_string(),
                    flags: 0,
                    text_included: true,
                    ignore_author: false,
                    page_text: Some("Second page".to_string()),
                },
            ],
            ..BookData::default()
        };

        let rendered: Vec<String> = build_book_content(&book)
            .into_iter()
            .map(|line| line.to_string())
            .collect();

        assert_eq!(
            rendered,
            vec![
                "First page".to_string(),
                "Second page".to_string(),
                "       --  A. Writer".to_string(),
            ]
        );
        assert_eq!(book_author_name(&book), Some("A. Writer"));
    }

    #[test]
    fn build_context_display_lines_wraps_book_content() {
        let lines = vec![Line::from("This book line is long enough to wrap.")];

        let rendered = build_context_display_lines(&lines, &ContextView::Book(Guid::NULL), 12);

        assert!(rendered.len() > 1, "rendered: {:?}", rendered);
        assert_eq!(rendered[0].to_string(), "This book");
    }

    #[test]
    fn logopolis_renderer_uses_score_title() {
        let area = ratatui::layout::Rect::new(0, 0, 40, 10);
        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("terminal should initialize");
        let data = GameData::new(Guid::NULL, "Player".to_string(), "World".to_string());
        let game = LogopolisState::new();

        terminal
            .draw(|frame| {
                render_context_pane(
                    frame,
                    super::ContextPaneRenderArgs {
                        data: &data,
                        context_buffer: &[],
                        context_view: &ContextView::Logopolis,
                        logopolis: Some(&game),
                        scroll_offset: 0,
                        is_focused: false,
                        area,
                    },
                )
            })
            .expect("game should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("You: 0 - Bael'Zharon: 0"));
        assert!(rendered.contains('█'));
    }
}

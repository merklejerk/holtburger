use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::widgets::{List, ListItem};

use crate::theme::{pane_block, pane_title_style};
use crate::types::ContextView;

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
        ContextView::Custom => "Debug Information",
        ContextView::Assess(_) => "Object Appraisal",
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
        area.inner(&ratatui::layout::Margin {
            vertical: 1,
            horizontal: 0,
        }),
        total_ctx,
        ctx_start,
    );
}

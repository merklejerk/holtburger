use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::widgets::{List, ListItem};

use crate::ui::ContextView;
use crate::ui::theme::{pane_block, pane_title_style};

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

    let effective_ctx_scroll = scroll_offset;
    let ctx_end = total_ctx.saturating_sub(effective_ctx_scroll);
    let ctx_start = ctx_end.saturating_sub(height);

    let mut ctx_items: Vec<ListItem<'static>> = context_buffer[ctx_start..ctx_end]
        .iter()
        .map(|s| ListItem::new(s.clone()))
        .collect();

    if ctx_items.len() < height && effective_ctx_scroll == 0 {
        let pad_count = height - ctx_items.len();
        let mut padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        padding.append(&mut ctx_items);
        ctx_items = padding;
    }

    let base_title = match context_view {
        ContextView::Default => "Context Information",
        ContextView::Custom => "Debug Information",
        ContextView::Assess(_) => "Object Appraisal",
        ContextView::Spell(_) => "Spell Details",
        ContextView::Enchantment(_) => "Enchantment Details",
    };

    let ctx_title = if total_ctx > height {
        format!(
            " {} [{}/{}] ",
            base_title,
            total_ctx.saturating_sub(effective_ctx_scroll),
            total_ctx
        )
    } else {
        format!(" {} ", base_title)
    };

    let ctx_list = List::new(ctx_items).block(
        pane_block(is_focused)
            .title(ctx_title)
            .title_style(pane_title_style(is_focused)),
    );
    f.render_widget(ctx_list, area);

    crate::ui::widgets::scroll::render_scrollbar(f, area.inner(&ratatui::layout::Margin { vertical: 1, horizontal: 0 }), total_ctx, ctx_start);
}

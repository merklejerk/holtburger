use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::widgets::{Scrollbar, ScrollbarOrientation, ScrollbarState};

pub fn render_scrollbar(f: &mut Frame, area: Rect, content_length: usize, offset: usize) {
    if content_length <= area.height as usize {
        return; // No need for scrollbar
    }

    // Ratatui's scrollbar `content_length` represents the maximum position index (+1).
    // For lists that stop scrolling when the last item hits the bottom of the viewport,
    // the max position is `content_length - viewport_height`.
    let max_offset = content_length.saturating_sub(area.height as usize);
    let state_content_length = max_offset.saturating_add(1);

    let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
        .begin_symbol(Some("▲"))
        .end_symbol(Some("▼"))
        .track_symbol(Some(" ")) // we don't need a track symbol if it's too much visual noise
        .thumb_symbol("║");

    let mut scrollbar_state = ScrollbarState::default()
        .content_length(state_content_length)
        .position(offset)
        // Adjust viewport content length based on the area height
        .viewport_content_length(area.height as usize);

    f.render_stateful_widget(scrollbar, area, &mut scrollbar_state);
}

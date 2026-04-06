use ratatui::Frame;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use unicode_width::UnicodeWidthStr;

#[derive(Debug, Clone, Copy)]
pub struct ModalPalette {
    pub border: Color,
    pub background: Color,
    pub foreground: Color,
}

#[derive(Debug, Clone, Copy)]
pub struct ModalCardSpec<'a> {
    pub title: &'a str,
    pub text: &'a str,
    pub palette: ModalPalette,
}

impl<'a> ModalCardSpec<'a> {
    pub fn new(title: &'a str, text: &'a str, palette: ModalPalette) -> Self {
        Self {
            title,
            text,
            palette,
        }
    }
}

impl ModalPalette {
    pub const CONFIRMATION: Self = Self {
        border: Color::Yellow,
        background: Color::Black,
        foreground: Color::White,
    };
}

fn wrapped_line_count(text: &str, inner_width: u16) -> u16 {
    let inner_width = inner_width.max(1) as usize;

    text.lines()
        .map(|line| {
            let width = UnicodeWidthStr::width(line).max(1);
            width.div_ceil(inner_width) as u16
        })
        .sum::<u16>()
        .max(1)
}

pub(crate) fn fit_modal_area(area: Rect, title: &str, text: &str) -> Rect {
    let title = title.trim();
    const MODAL_PADDING: u16 = 3;

    let max_width = area.width.saturating_sub(4).max(1);
    let max_height = area.height.saturating_sub(4).max(1);

    let longest_line = text.lines().map(UnicodeWidthStr::width).max().unwrap_or(0);
    let title_width = UnicodeWidthStr::width(title);
    let desired_width = longest_line
        .max(title_width)
        .saturating_add(MODAL_PADDING as usize) as u16;
    let width = desired_width.clamp(24.min(max_width), max_width);

    let inner_width = width.saturating_sub(2).max(1);
    let content_height = wrapped_line_count(text, inner_width);
    let desired_height = content_height.saturating_add(MODAL_PADDING);
    let height = desired_height.clamp(5.min(max_height), max_height);

    Rect::new(
        area.x + area.width.saturating_sub(width) / 2,
        area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    )
}

pub fn render_modal_card(f: &mut Frame, area: Rect, spec: ModalCardSpec<'_>) {
    let area = fit_modal_area(area, spec.title, spec.text);

    f.render_widget(Clear, area);

    let block = Block::default()
        .title(spec.title)
        .title_alignment(Alignment::Center)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(spec.palette.border))
        .style(Style::default().bg(spec.palette.background));

    let paragraph = Paragraph::new(spec.text)
        .block(block)
        .alignment(Alignment::Center)
        .wrap(Wrap { trim: true })
        .style(
            Style::default()
                .fg(spec.palette.foreground)
                .add_modifier(Modifier::BOLD),
        );

    f.render_widget(paragraph, area);
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_width::UnicodeWidthStr;

    #[test]
    fn modal_area_hugs_short_content() {
        let area = Rect::new(0, 0, 120, 40);
        let fitted = fit_modal_area(
            area,
            " Connection Lost ",
            "Socket dropped\n\nRetrying in 3 seconds...",
        );

        assert!(fitted.width < 60);
        assert!(fitted.height < 12);
        assert!(fitted.width >= 24);
    }

    #[test]
    fn modal_area_uses_tighter_padding() {
        let area = Rect::new(0, 0, 120, 40);
        let title = " Break Allegiance Confirmation ";
        let text = "Break allegiance with Bestie?\nBring the whole stack";
        let fitted = fit_modal_area(area, title, text);

        let trimmed_title_width = UnicodeWidthStr::width(title.trim()) as u16;
        let longest_line_width = text.lines().map(UnicodeWidthStr::width).max().unwrap_or(0) as u16;
        let expected_width = longest_line_width.max(trimmed_title_width) + 3;
        let expected_height = 2 + 3;

        assert_eq!(fitted.width, expected_width);
        assert_eq!(fitted.height, expected_height);
    }
}

use ratatui::Frame;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders, Clear, Padding, Paragraph, Wrap};
use unicode_width::UnicodeWidthStr;

// Each side reserves a border cell and one blank cell around the body.
const MODAL_BODY_PADDING: u16 = 1;
const MODAL_FRAME_SIZE: u16 = 2 * (1 + MODAL_BODY_PADDING);

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

pub(crate) fn fit_modal_area(area: Rect, title: &str, text: &str) -> Rect {
    let title = title.trim();
    let max_width = area.width.saturating_sub(4).max(1);
    let max_height = area.height.saturating_sub(4).max(1);

    let longest_line = text.lines().map(UnicodeWidthStr::width).max().unwrap_or(0);
    let title_width = UnicodeWidthStr::width(title);
    let desired_width = longest_line
        .max(title_width)
        .saturating_add(MODAL_FRAME_SIZE as usize)
        .min(usize::from(max_width)) as u16;
    let width = desired_width.clamp(24.min(max_width), max_width);

    let inner_width = width.saturating_sub(MODAL_FRAME_SIZE).max(1);
    // Measure the same word wrapping used for rendering instead of estimating from line widths.
    let content_height = Paragraph::new(text)
        .wrap(Wrap { trim: true })
        .line_count(inner_width);
    let desired_height = content_height
        .saturating_add(usize::from(MODAL_FRAME_SIZE))
        .min(usize::from(max_height)) as u16;
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
        .padding(Padding::uniform(MODAL_BODY_PADDING))
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
    fn modal_height_accounts_for_word_boundaries_on_narrow_terminals() {
        let text = "123456 123456 123456 123456";
        // Leave room for two words per row by cell count, but only one after word wrapping.
        let body_width = 12;
        let area = Rect::new(0, 0, body_width + MODAL_FRAME_SIZE + 4, 40);
        let fitted = fit_modal_area(area, "Confirm", text);

        assert_eq!(fitted.height, 4 + MODAL_FRAME_SIZE);
    }

    #[test]
    fn modal_body_has_symmetric_padding() {
        use ratatui::Terminal;
        use ratatui::backend::TestBackend;

        let area = Rect::new(0, 0, 120, 40);
        let title = " Exit Holtburger? ";
        let text = "Exit the client?\n\n[Enter] Exit    [Esc] Cancel";
        let fitted = fit_modal_area(area, title, text);

        let longest_line_width = text.lines().map(UnicodeWidthStr::width).max().unwrap_or(0) as u16;
        assert_eq!(fitted.width, longest_line_width + MODAL_FRAME_SIZE);
        assert_eq!(
            fitted.height,
            text.lines().count() as u16 + MODAL_FRAME_SIZE
        );

        let mut terminal = Terminal::new(TestBackend::new(area.width, area.height)).unwrap();
        terminal
            .draw(|frame| {
                render_modal_card(
                    frame,
                    area,
                    ModalCardSpec::new(title, text, ModalPalette::CONFIRMATION),
                );
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        for x in fitted.x + 1..fitted.right() - 1 {
            assert_eq!(buffer[(x, fitted.y + 1)].symbol(), " ");
            assert_eq!(buffer[(x, fitted.bottom() - 2)].symbol(), " ");
        }
        for y in fitted.y + 1..fitted.bottom() - 1 {
            assert_eq!(buffer[(fitted.x + 1, y)].symbol(), " ");
            assert_eq!(buffer[(fitted.right() - 2, y)].symbol(), " ");
        }
        for (row, line) in text.lines().enumerate() {
            let y = fitted.y + 1 + MODAL_BODY_PADDING + row as u16;
            let rendered = (fitted.x + 1..fitted.right() - 1)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>();
            assert_eq!(rendered.trim(), line);
        }
    }
}

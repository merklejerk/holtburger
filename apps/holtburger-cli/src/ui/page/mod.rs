use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders};
use unicode_width::UnicodeWidthStr;

use crate::ui::FocusedPane;
use crate::ui::get_layout;
use crate::ui::layout::PULSE_PANEL_WIDTH;
use crate::ui::state::{AppState, GameState, Page, SelectionState};
use crate::ui::update::UpdateResult;
use crate::ui::widgets::dashboard::render_dashboard_pane;
use crate::ui::widgets::hud::pulse::render_pulse_panel;
use crate::ui::widgets::hud::status::render_status_bar;
use crate::ui::widgets::panels::chat::{render_chat_pane, render_context_pane};
use crate::ui::widgets::panels::dynamic::render_dynamic_pane;
use crate::ui::widgets::selection::render_character_selection;

impl Page {
    pub fn render(&mut self, f: &mut Frame, area: Rect, app: &mut AppState) {
        match self {
            Page::Selection(selection) => selection.render(f, area, app),
            Page::Game(game) => game.render(f, area, app),
        }
    }

    pub fn handle_input(
        &mut self,
        key: KeyEvent,
        app: &mut AppState,
        width: u16,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_input(key),
            Page::Game(game) => game.handle_input(key, app, width, main_chunks),
        }
    }

    pub fn handle_mouse(
        &mut self,
        mouse: crossterm::event::MouseEvent,
        app: &mut AppState,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        match self {
            Page::Selection(_) => UpdateResult::new(),
            Page::Game(game) => game.handle_mouse(mouse, app, main_chunks),
        }
    }
}

impl SelectionState {
    pub fn render(&mut self, f: &mut Frame, _area: Rect, _app: &mut AppState) {
        // Selection state doesn't need AppState, it renders its own characters.
        render_character_selection(f, self, _area);
    }
}

impl GameState {
    pub fn render(&mut self, f: &mut Frame, area: Rect, app: &mut AppState) {
        // The game view uses the shared status bar and the complex multi-pane layout.
        let (chunks, main_chunks_vec, dynamic_chunk) = get_layout(area);
        let chunks = &chunks;

        // Status Area
        render_status_bar(f, self, app, chunks[0]);

        let main_chunks = &main_chunks_vec;

        // Dashboard Pane
        render_dashboard_pane(f, self, app, main_chunks[0]);

        // Chat Pane
        render_chat_pane(f, self, app, main_chunks[1]);

        // Context Pane
        render_context_pane(f, self, app, main_chunks[2]);

        // Dynamic Pane
        render_dynamic_pane(f, self, app, dynamic_chunk);

        // Pulse Panel (Input Area)
        let input_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(0), Constraint::Length(PULSE_PANEL_WIDTH)])
            .split(chunks[2]);

        let focused_pane = self.view.focused_pane;

        let input_style = if focused_pane == FocusedPane::Input {
            Style::default().fg(Color::Yellow)
        } else {
            Style::default()
        };
        let input_title = if focused_pane == FocusedPane::Input {
            ">> Input ([ENTER] to focus) <<"
        } else {
            "Input ([ENTER] to focus)"
        };
        let input_block = Block::default()
            .borders(Borders::ALL)
            .title(input_title)
            .border_style(input_style)
            .title_style(if focused_pane == FocusedPane::Input {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            });
        let input_width = app.input.as_str().width() as u16;
        let max_visible_width = input_chunks[0].width.saturating_sub(2);

        let display_input = if input_width > max_visible_width {
            let mut width = 0;
            let mut start_index = app.input.len();
            for (i, c) in app.input.char_indices().rev() {
                let c_width = UnicodeWidthStr::width(c.to_string().as_str());
                if width + c_width > max_visible_width as usize {
                    break;
                }
                width += c_width;
                start_index = i;
            }
            &app.input[start_index..]
        } else {
            app.input.as_str()
        };

        let input_para = ratatui::widgets::Paragraph::new(display_input).block(input_block);
        f.render_widget(input_para, input_chunks[0]);

        // Pulse Panel
        render_pulse_panel(f, app, input_chunks[1]);

        if app.modal.is_none() && focused_pane == FocusedPane::Input {
            let display_width = UnicodeWidthStr::width(display_input) as u16;
            f.set_cursor(input_chunks[0].x + 1 + display_width, input_chunks[0].y + 1);
        }
    }
}

use holtburger_common::ConfirmationType;
use holtburger_core::ActiveCharacterConfirmation;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::Style;

use crate::components::modal::{ModalCardSpec, ModalPalette, render_modal_card};
use crate::pages::game::GameState;
use crate::pages::game::hud::pulse::render_pulse_panel;
use crate::pages::game::hud::status::render_status_bar;
use crate::pages::game::layout::PULSE_PANEL_WIDTH;
use crate::pages::game::layout::get_layout;
use crate::pages::game::layout::layout_mode_for_size;
use crate::pages::game::panels::chat::render_chat_pane;
use crate::pages::game::panels::context::build_context_display_lines;
use crate::pages::game::panels::context::render_context_pane;
use crate::pages::game::panels::dashboard::render_dashboard_pane;
use crate::pages::game::panels::dynamic::render_dynamic_pane;
use crate::pages::game::state::domains;
use crate::state::RenderContext;
use crate::theme::{pane_block, pane_title_style};
use crate::types::FocusedPane;

fn confirmation_title(confirmation_type: ConfirmationType) -> &'static str {
    match confirmation_type {
        ConfirmationType::CraftInteraction => " Craft Confirmation ",
        _ => " Confirmation ",
    }
}

fn confirmation_body_text(confirmation: &ActiveCharacterConfirmation) -> String {
    match confirmation.confirmation_type {
        ConfirmationType::Fellowship if !confirmation.text.trim().is_empty() => {
            format!(
                "{} invited you to join their fellowship.",
                confirmation.text.trim()
            )
        }
        _ => confirmation.text.clone(),
    }
}

fn render_confirmation_overlay(
    f: &mut Frame,
    area: Rect,
    confirmation: &ActiveCharacterConfirmation,
) {
    let text = format!(
        "{}\n\n[Enter] Accept    [Esc] Decline",
        confirmation_body_text(confirmation)
    );
    render_modal_card(
        f,
        area,
        ModalCardSpec::new(
            confirmation_title(confirmation.confirmation_type),
            &text,
            ModalPalette::CONFIRMATION,
        ),
    );
}

fn render_local_confirmation_overlay(f: &mut Frame, area: Rect, title: &str, text: &str) {
    let text = format!("{}\n\n[Enter] Confirm    [Esc] Cancel", text);
    render_modal_card(
        f,
        area,
        ModalCardSpec::new(title, &text, ModalPalette::CONFIRMATION),
    );
}

impl GameState {
    pub(super) fn main_chunks(&self) -> std::rc::Rc<Vec<Rect>> {
        std::rc::Rc::clone(&self.render_state.layout_cache.main_chunks)
    }

    pub(super) fn layout_mode(&self) -> crate::pages::game::layout::LayoutMode {
        self.render_state.layout_cache.mode
    }

    pub(super) fn set_layout_cache(
        &mut self,
        main_chunks: Vec<Rect>,
        dynamic_chunk: Rect,
        mode: crate::pages::game::layout::LayoutMode,
    ) {
        self.render_state.layout_cache.main_chunks = std::rc::Rc::new(main_chunks);
        self.render_state.layout_cache.dynamic_chunk = dynamic_chunk;
        self.render_state.layout_cache.mode = mode;
    }

    pub fn update_layout(&mut self, area: Rect) {
        let (_chunks, main_chunks_vec, _dynamic_chunk) = get_layout(area);
        let layout_mode = layout_mode_for_size(area.width, area.height);

        // Update layout cache
        self.set_layout_cache(main_chunks_vec.clone(), _dynamic_chunk, layout_mode);

        let context_width = main_chunks_vec[2].width.saturating_sub(2) as usize;
        let context_len = domains::live_context_buffer(self)
            .map(|content| {
                build_context_display_lines(&content, &self.view.context_view, context_width).len()
            })
            .unwrap_or_else(|| {
                build_context_display_lines(
                    domains::context_buffer(self),
                    &self.view.context_view,
                    context_width,
                )
                .len()
            });
        let ctx_h = main_chunks_vec[2].height.saturating_sub(2) as usize;
        let max_ctx_scroll = context_len.saturating_sub(ctx_h);
        self.view.context_scroll_offset = self.view.context_scroll_offset.min(max_ctx_scroll);

        self.chat.update_layout(ratatui::layout::Rect {
            x: main_chunks_vec[1].x,
            y: main_chunks_vec[1].y,
            width: main_chunks_vec[1].width,
            height: main_chunks_vec[1].height,
        });
    }

    pub fn render(&mut self, f: &mut Frame, area: Rect, ctx: &RenderContext) {
        // The game view uses the shared status bar and the complex multi-pane layout.
        let (chunks, main_chunks_vec, dynamic_chunk) = get_layout(area);
        let chunks = &chunks;
        let layout_mode = layout_mode_for_size(area.width, area.height);
        self.set_layout_cache(main_chunks_vec.clone(), dynamic_chunk, layout_mode);

        // Status Area
        render_status_bar(f, &self.data, &self.view, ctx.server_time, chunks[0]);

        let main_chunks = &main_chunks_vec;

        // Dashboard Pane
        render_dashboard_pane(
            f,
            &self.data,
            &self.view,
            &mut self.dashboard,
            main_chunks[0],
        );

        // Chat Pane
        render_chat_pane(
            f,
            &self.chat,
            self.view.focused_pane == FocusedPane::Chat,
            main_chunks[1],
        );

        // Context Pane
        let live_context = domains::live_context_buffer(self);
        let context_buffer = live_context
            .as_deref()
            .unwrap_or_else(|| domains::context_buffer(self));
        render_context_pane(
            f,
            crate::pages::game::panels::context::ContextPaneRenderArgs {
                data: &self.data,
                context_buffer,
                context_view: &self.view.context_view,
                logopolis: domains::logopolis_state(self),
                scroll_offset: self.view.context_scroll_offset,
                is_focused: self.view.focused_pane == FocusedPane::Context,
                area: main_chunks[2],
            },
        );

        // Dynamic Pane
        render_dynamic_pane(f, &self.data, &self.view, dynamic_chunk);

        // Pulse Panel (Input Area)
        let input_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(0), Constraint::Length(PULSE_PANEL_WIDTH)])
            .split(chunks[2]);

        let focused_pane = self.view.focused_pane;
        let is_focused = focused_pane == FocusedPane::Input;
        let input_title = " Input ([ENTER] to focus) ";

        let input_block = pane_block(is_focused)
            .title(input_title)
            .title_style(pane_title_style(is_focused));
        let input_widget =
            self.chat_input
                .input
                .rendered_with_block(input_block, Style::default(), is_focused);
        f.render_widget(&input_widget, input_chunks[0]);

        // Pulse Panel
        render_pulse_panel(f, ctx.client_state, ctx.net_stats, input_chunks[1]);

        if let Some(confirmation) = self.view.local_confirmation.as_ref() {
            render_local_confirmation_overlay(f, area, &confirmation.title, &confirmation.text);
        } else if let Some(confirmation) = self.view.active_confirmation.as_ref() {
            render_confirmation_overlay(f, area, confirmation);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::GameData;
    use crate::state::{NetStats, RenderContext};
    use holtburger_common::Guid;
    use holtburger_core::{ActiveCharacterConfirmation, ClientState};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    #[test]
    fn active_confirmation_overlay_renders_server_text_and_controls() {
        let area = Rect::new(0, 0, 120, 40);
        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.data = GameData::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::CraftInteraction,
            context: 12,
            text: "Chance of success is 75%. Continue?".to_string(),
        });

        let net_stats = NetStats::default();
        let ctx = RenderContext {
            client_state: &ClientState::InWorld,
            net_stats: &net_stats,
            server_time: None,
        };

        terminal
            .draw(|frame| state.render(frame, area, &ctx))
            .expect("game page should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("Craft Confirmation"));
        assert!(rendered.contains("Chance of success is 75%. Continue?"));
        assert!(rendered.contains("[Enter] Accept"));
        assert!(rendered.contains("[Esc] Decline"));
    }

    #[test]
    fn fellowship_confirmation_body_expands_inviter_name() {
        let text = confirmation_body_text(&ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::Fellowship,
            context: 99,
            text: "Bestie".to_string(),
        });

        assert_eq!(text, "Bestie invited you to join their fellowship.");
    }

    #[test]
    fn fellowship_confirmation_overlay_renders_contextual_prompt() {
        let area = Rect::new(0, 0, 120, 40);
        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.data = GameData::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::Fellowship,
            context: 12,
            text: "Bestie".to_string(),
        });

        let net_stats = NetStats::default();
        let ctx = RenderContext {
            client_state: &ClientState::InWorld,
            net_stats: &net_stats,
            server_time: None,
        };

        terminal
            .draw(|frame| state.render(frame, area, &ctx))
            .expect("game page should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("Bestie invited you to join their fellowship."));
        assert!(!rendered.contains("Chance of success is 75%. Continue?"));
    }

    #[test]
    fn unswear_confirmation_overlay_renders_target_and_controls() {
        let area = Rect::new(0, 0, 120, 40);
        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.data = GameData::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.local_confirmation = Some(crate::types::LocalConfirmation {
            title: " Break Allegiance Confirmation ".to_string(),
            text: "Break allegiance with Bestie?".to_string(),
            action: crate::types::AppAction::Unswear {
                target: Guid(0x50000042),
            },
        });

        let net_stats = NetStats::default();
        let ctx = RenderContext {
            client_state: &ClientState::InWorld,
            net_stats: &net_stats,
            server_time: None,
        };

        terminal
            .draw(|frame| state.render(frame, area, &ctx))
            .expect("game page should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("Break Allegiance Confirmation"));
        assert!(rendered.contains("Break allegiance with Bestie?"));
        assert!(rendered.contains("[Enter] Confirm"));
        assert!(rendered.contains("[Esc] Cancel"));
    }

    #[test]
    fn confirmation_overlay_fit_is_content_sized() {
        let fitted = crate::components::modal::fit_modal_area(
            Rect::new(0, 0, 120, 40),
            " Craft Confirmation ",
            "Chance of success is 75%. Continue?\n\n[Enter] Accept    [Esc] Decline",
        );

        assert!(fitted.width < 72);
        assert!(fitted.height < 14);
        assert!(fitted.width >= 24);
    }
}

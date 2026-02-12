use crate::ui::AppState;
use crate::ui::types::{FocusedPane, InteractionMode};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn render_dynamic_pane(f: &mut Frame, state: &AppState, area: Rect) {
    let style = if state.focused_pane == FocusedPane::Dynamic {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_style(style);

    if let Some(interaction) = state.active_interaction {
        let title = match interaction.mode {
            InteractionMode::Moving => " Moving Item | [ESC] to cancel ",
            InteractionMode::Healing => " Healing | [ESC] to cancel ",
        };
        block = block.title(title);

        let entity_info = if let Some(entity) = state.entities.get(&interaction.guid) {
            format!("  {} ({:#010X})", entity.name, entity.guid.0)
        } else {
            format!("  Unknown Entity ({:#010X})", interaction.guid.0)
        };

        let para = Paragraph::new(entity_info).block(block);
        f.render_widget(para, area);
    } else {
        f.render_widget(block, area);
    }
}

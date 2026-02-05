use crate::ui::AppState;
use holtburger_core::ClientState;
use holtburger_core::world::stats::VitalType;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn render_status_bar(f: &mut Frame, state: &AppState, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    // 1. Render Vitals (Left Half)
    let health = state
        .vitals
        .values()
        .find(|v| v.vital_type == VitalType::Health);
    let stamina = state
        .vitals
        .values()
        .find(|v| v.vital_type == VitalType::Stamina);
    let mana = state
        .vitals
        .values()
        .find(|v| v.vital_type == VitalType::Mana);

    let health_str = if let Some(h) = health {
        format!("H {}/{}", h.current, h.buffed_max)
    } else {
        "H --/--".to_string()
    };
    let stamina_str = if let Some(s) = stamina {
        format!("S {}/{}", s.current, s.buffed_max)
    } else {
        "S --/--".to_string()
    };
    let mana_str = if let Some(m) = mana {
        format!("M {}/{}", m.current, m.buffed_max)
    } else {
        "M --/--".to_string()
    };

    let vitals_para = Paragraph::new(Line::from(vec![
        Span::styled(health_str, Style::default().fg(Color::Red)),
        Span::raw("  "),
        Span::styled(stamina_str, Style::default().fg(Color::Yellow)),
        Span::raw("  "),
        Span::styled(mana_str, Style::default().fg(Color::Blue)),
    ]))
    .block(Block::default().borders(Borders::ALL).title("Vitals"));
    f.render_widget(vitals_para, chunks[0]);

    // 2. Render Info (Right Half)
    let pos_info = if let Some(pos) = &state.player_pos {
        pos.to_world_coords().to_string_with_precision(2)
    } else {
        "0.00N, 0.00E".to_string()
    };

    let mut retry_info = String::new();
    let now = std::time::Instant::now();
    if let Some((current, max, next_time)) = state.logon_retry {
        let secs = next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!("[Logon:{}/{} {}s] ", current, max, secs));
    }
    if let Some((current, max, next_time)) = state.enter_retry {
        let secs = next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!("[Enter:{}/{} {}s] ", current, max, secs));
    }

    let status_emoji = match state.core_state {
        ClientState::Connected => "🔌",
        ClientState::CharacterSelection(_) => "👥",
        ClientState::EnteringWorld => "🚪",
        ClientState::InWorld => "🌍",
    };

    let current_char = state.character_name.as_deref().unwrap_or("Selecting...");
    let info_line = format!(
        "{}:{} <{}> {} {}",
        state.account_name, current_char, pos_info, status_emoji, retry_info
    );

    let info_para = Paragraph::new(info_line)
        .block(Block::default().borders(Borders::ALL).title("Status"))
        .alignment(ratatui::layout::Alignment::Right);
    f.render_widget(info_para, chunks[1]);
}

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

    let vitals_block = Block::default().borders(Borders::ALL).title("Vitals");
    let inner_area = vitals_block.inner(chunks[0]);
    f.render_widget(vitals_block, chunks[0]);

    let vitals_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Min(20),    // Bars
            Constraint::Length(15), // Level/XP right aligned
        ])
        .split(inner_area);

    let bars_line = Line::from(vec![
        Span::styled(health_str, Style::default().fg(Color::Red)),
        Span::raw(" "),
        Span::styled(stamina_str, Style::default().fg(Color::Yellow)),
        Span::raw(" "),
        Span::styled(mana_str, Style::default().fg(Color::Blue)),
    ]);
    f.render_widget(Paragraph::new(bars_line), vitals_layout[0]);

    if let Some(info) = &state.level_info {
        let pct = if info.xp_for_next_level > 0 {
            (info.xp_into_level as f64 / info.xp_for_next_level as f64) * 100.0
        } else {
            100.0
        };
        let level_line = Line::from(vec![
            Span::styled(
                format!("Lv {}", info.level),
                Style::default().fg(Color::Cyan),
            ),
            Span::raw(" "),
            Span::styled(format!("({:.2}%)", pct), Style::default().fg(Color::Cyan)),
        ]);
        f.render_widget(
            Paragraph::new(level_line).alignment(ratatui::layout::Alignment::Right),
            vitals_layout[1],
        );
    }

    // 2. Render Info (Right Half)
    let pos_info = if let Some(pos) = &state.player_pos {
        pos.to_world_coords().to_string_with_precision(2)
    } else {
        "0.00N, 0.00E".to_string()
    };

    let mut retry_info = String::new();
    let now = std::time::Instant::now();
    if state.logon_retry.active {
        let secs = state
            .logon_retry
            .next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!(
            "[Logon:{}/{} {}s] ",
            state.logon_retry.attempts, state.logon_retry.max_attempts, secs
        ));
    }
    if state.enter_retry.active {
        let secs = state
            .enter_retry
            .next_time
            .map(|t| t.saturating_duration_since(now).as_secs())
            .unwrap_or(0);
        retry_info.push_str(&format!(
            "[Enter:{}/{} {}s] ",
            state.enter_retry.attempts, state.enter_retry.max_attempts, secs
        ));
    }

    let status_emoji = match state.core_state {
        ClientState::Connected => "🔌",
        ClientState::CharacterSelection(_) => "👥",
        ClientState::EnteringWorld => "🚪",
        ClientState::InWorld => "🌍",
        ClientState::Disconnected => "💀",
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

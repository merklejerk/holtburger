use crate::pages::game::{GameData, ViewState};
use holtburger_world::stats::VitalType;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn render_vitals(f: &mut Frame, data: &GameData, _view: &ViewState, area: Rect) {
    let health = data
        .vitals
        .values()
        .find(|v| v.vital_type == VitalType::Health);
    let stamina = data
        .vitals
        .values()
        .find(|v| v.vital_type == VitalType::Stamina);
    let mana = data
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
    let inner_area = vitals_block.inner(area);
    f.render_widget(vitals_block, area);

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
        Span::styled(stamina_str, Style::default().fg(Color::LightGreen)),
        Span::raw(" "),
        Span::styled(mana_str, Style::default().fg(Color::Blue)),
    ]);
    f.render_widget(Paragraph::new(bars_line), vitals_layout[0]);

    if let Some(info) = data.level_info.as_ref() {
        let mut spans = vec![Span::styled(
            format!("Lv {}", info.level),
            Style::default().fg(Color::Cyan),
        )];

        if info.xp_for_next_level > 0 {
            let pct = (info.xp_into_level as f64 / info.xp_for_next_level as f64) * 100.0;
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                format!("({:.2}%)", pct),
                Style::default().fg(Color::Cyan),
            ));
        }

        f.render_widget(
            Paragraph::new(Line::from(spans)).alignment(ratatui::layout::Alignment::Right),
            vitals_layout[1],
        );
    }
}

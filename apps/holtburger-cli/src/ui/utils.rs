use crate::ui::state::{AppState, GameState};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use unicode_width::UnicodeWidthStr;

pub fn format_cost(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.3}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.3}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.2}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

pub fn wrap_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut result = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            result.push(String::new());
            continue;
        }
        let mut current_line = String::new();
        for word in line.split(' ') {
            let word_width = word.width();
            if current_line.is_empty() {
                if word_width > width {
                    let mut s = word.to_string();
                    while s.width() > width {
                        let mut split_idx = 0;
                        let mut current_w = 0;
                        for (idx, c) in s.char_indices() {
                            let cw = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
                            if current_w + cw > width {
                                break;
                            }
                            current_w += cw;
                            split_idx = idx + c.len_utf8();
                        }
                        if split_idx == 0 {
                            split_idx = s.chars().next().map(|c| c.len_utf8()).unwrap_or(0);
                        }
                        let (head, tail) = s.split_at(split_idx);
                        result.push(head.to_string());
                        s = tail.to_string();
                    }
                    current_line = s;
                } else {
                    current_line.push_str(word);
                }
            } else {
                let current_width = current_line.width();
                if current_width + 1 + word_width <= width {
                    current_line.push(' ');
                    current_line.push_str(word);
                } else {
                    result.push(current_line);
                    let mut s = word.to_string();
                    while s.width() > width {
                        let mut split_idx = 0;
                        let mut current_w = 0;
                        for (idx, c) in s.char_indices() {
                            let cw = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
                            if current_w + cw > width {
                                break;
                            }
                            current_w += cw;
                            split_idx = idx + c.len_utf8();
                        }
                        if split_idx == 0 {
                            split_idx = s.chars().next().map(|c| c.len_utf8()).unwrap_or(0);
                        }
                        let (head, tail) = s.split_at(split_idx);
                        result.push(head.to_string());
                        s = tail.to_string();
                    }
                    current_line = s;
                }
            }
        }
        if !current_line.is_empty() {
            result.push(current_line);
        }
    }
    result
}

pub fn render_action_bar(game: &GameState, app: &AppState) -> Option<Paragraph<'static>> {
    let (tab, index) = (game.view.dashboard_tab, game.view.selected_dashboard_index);

    let verbs = crate::ui::widgets::dashboard::get_verbs_for_tab(game, app, tab, index);
    if verbs.is_empty() {
        return None;
    }

    let mut spans = Vec::new();
    for (i, verb) in verbs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw(" "));
        }
        spans.push(Span::raw(verb.display_label().to_string()));
    }

    Some(Paragraph::new(Line::from(spans)).block(Block::default().borders(Borders::TOP)))
}

pub fn get_adjacent_pane(
    current: crate::ui::FocusedPane,
    width: u16,
    active_interaction: bool,
    delta: i32,
) -> crate::ui::FocusedPane {
    let order = get_pane_order(width);
    let n = order.len() as i32;
    let current_idx = order.iter().position(|&p| p == current).unwrap_or(0) as i32;

    let mut next_idx = (current_idx + delta).rem_euclid(n);

    // Skip dynamic if not moving anything
    if order[next_idx as usize] == crate::ui::FocusedPane::Dynamic && !active_interaction {
        next_idx = (next_idx + delta).rem_euclid(n);
    }

    order[next_idx as usize]
}

fn get_pane_order(width: u16) -> [crate::ui::FocusedPane; 4] {
    if width < crate::ui::layout::WIDTH_BREAKPOINT {
        // Portrait: Dashboard -> Context -> Dynamic -> Chat
        [
            crate::ui::FocusedPane::Dashboard,
            crate::ui::FocusedPane::Context,
            crate::ui::FocusedPane::Dynamic,
            crate::ui::FocusedPane::Chat,
        ]
    } else {
        // Landscape: Dashboard -> Chat -> Context -> Dynamic
        [
            crate::ui::FocusedPane::Dashboard,
            crate::ui::FocusedPane::Chat,
            crate::ui::FocusedPane::Context,
            crate::ui::FocusedPane::Dynamic,
        ]
    }
}

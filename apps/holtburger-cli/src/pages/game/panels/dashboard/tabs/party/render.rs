use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph};

use super::tab::PartyTab;
use crate::pages::game::{GameData, ViewState};
use crate::theme;

fn format_badge(entry: &super::tab::PartyListEntry<'_>) -> String {
    if entry.is_leader {
        "👑".to_string()
    } else {
        "👤".to_string()
    }
}

fn format_distance_suffix(entry: &super::tab::PartyListEntry<'_>) -> String {
    match (entry.distance_m, entry.is_self, entry.nearby) {
        (Some(distance), false, _) => format!("  [{distance:.1}m]"),
        (Some(_), true, _) => String::new(),
        _ => String::new(),
    }
}

fn vital_fraction(current: u32, max: u32) -> f32 {
    if max == 0 {
        return 0.0;
    }

    (current as f32 / max as f32).clamp(0.0, 1.0)
}

fn vital_color(current: u32, max: u32) -> Color {
    let fraction = vital_fraction(current, max);

    if fraction <= 0.25 {
        Color::Red
    } else if fraction <= 0.5 {
        Color::Yellow
    } else if fraction <= 0.75 {
        Color::LightYellow
    } else {
        Color::LightGreen
    }
}

pub fn render_party_tab(
    tab: &mut PartyTab,
    f: &mut Frame,
    data: &GameData,
    _view: &ViewState,
    area: Rect,
) {
    let Some(party) = data.party.as_ref() else {
        f.render_widget(Paragraph::new("Not currently in a party."), area);
        return;
    };

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0)])
        .split(area);

    let party_name = if party.name.trim().is_empty() {
        "(unnamed)"
    } else {
        party.name.trim()
    };
    let leader_name = party
        .members
        .iter()
        .find(|member| member.guid == party.leader_guid)
        .map(|member| member.name.as_str())
        .unwrap_or("Unknown");

    let mut settings_indicators = Vec::new();
    if party.share_xp {
        settings_indicators.push("XP Sharing");
    }
    if party.is_locked {
        settings_indicators.push("Locked");
    }
    if party.open {
        settings_indicators.push("Open");
    }

    let settings_content = if !settings_indicators.is_empty() {
        format!("[{}]", settings_indicators.join(", "))
    } else {
        String::new()
    };

    let summary = Paragraph::new(Line::from(vec![
        Span::styled("Party: ", Style::default().fg(theme::SUMMARY_FG)),
        Span::raw(format!("{}  ", party_name)),
        Span::styled("Leader: ", Style::default().fg(theme::SUMMARY_FG)),
        Span::raw(format!("{}  ", leader_name)),
        Span::raw(settings_content),
    ]));
    f.render_widget(summary, chunks[0]);

    let members = tab.visible_members(data);
    let content_len = members.len();
    let selected_index = tab.clamped_selected_index_for_len(content_len).unwrap_or(0);

    let items: Vec<ListItem<'static>> = members
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let item_style = theme::list_item_style(index == selected_index);
            let badge = format_badge(entry);
            let distance_suffix = format_distance_suffix(entry);

            let line = Line::from(vec![
                Span::raw(format!(
                    "[{}] {:<16}  H ",
                    badge,
                    format!("{} ({})", entry.member.name, entry.member.level),
                )),
                Span::styled(
                    format!(
                        "{:>3}/{:<3}",
                        entry.member.current_health, entry.member.max_health
                    ),
                    Style::default().fg(vital_color(
                        entry.member.current_health,
                        entry.member.max_health,
                    )),
                ),
                Span::raw("  S "),
                Span::styled(
                    format!(
                        "{:>3}/{:<3}",
                        entry.member.current_stamina, entry.member.max_stamina
                    ),
                    Style::default().fg(vital_color(
                        entry.member.current_stamina,
                        entry.member.max_stamina,
                    )),
                ),
                Span::raw("  M "),
                Span::styled(
                    format!(
                        "{:>3}/{:<3}",
                        entry.member.current_mana, entry.member.max_mana
                    ),
                    Style::default().fg(vital_color(
                        entry.member.current_mana,
                        entry.member.max_mana,
                    )),
                ),
                Span::raw(distance_suffix),
            ]);

            ListItem::new(line).style(item_style)
        })
        .collect();

    let list = List::new(items)
        .highlight_style(theme::selection_style())
        .highlight_symbol(theme::SELECTION_SYMBOL);

    let list_state = &mut tab.list_state;
    list_state.select(Some(selected_index));

    f.render_stateful_widget(list, chunks[1], list_state);
    let offset = list_state.offset();
    crate::components::scroll::render_scrollbar(f, chunks[1], content_len, offset);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vital_color_uses_expected_breakpoints() {
        assert_eq!(vital_color(100, 100), Color::LightGreen);
        assert_eq!(vital_color(75, 100), Color::LightYellow);
        assert_eq!(vital_color(50, 100), Color::Yellow);
        assert_eq!(vital_color(25, 100), Color::Red);
        assert_eq!(vital_color(0, 0), Color::Red);
    }

    #[test]
    fn vital_fraction_clamps_overfilled_values() {
        assert_eq!(vital_fraction(150, 100), 1.0);
    }
}

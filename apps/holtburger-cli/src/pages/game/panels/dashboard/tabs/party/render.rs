use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph};

use super::tab::PartyTab;
use crate::pages::game::{GameData, ViewState};
use crate::theme;

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

    let summary = Paragraph::new(Line::from(vec![
        Span::styled("Party: ", Style::default().fg(theme::SUMMARY_FG)),
        Span::raw(format!("{}  ", party_name)),
        Span::styled("Leader: ", Style::default().fg(theme::SUMMARY_FG)),
        Span::raw(format!("{}  ", leader_name)),
        Span::styled("Flags: ", Style::default().fg(theme::SUMMARY_FG)),
        Span::styled(
            format!(
                "{} {} {} {}",
                if party.share_xp { "✨XP" } else { "🚫XP" },
                if party.even_share { "⚖EVEN" } else { "↕FREE" },
                if party.open { "🚪OPEN" } else { "🚪CLOSED" },
                if party.is_locked { "🔒LOCKED" } else { "🔓UNLOCKED" }
            ),
            Style::default().add_modifier(Modifier::BOLD),
        ),
    ]));
    f.render_widget(summary, chunks[0]);

    let members = tab.visible_members(data);
    let content_len = members.len();
    let selected_index = if content_len == 0 {
        0
    } else {
        tab.selected_index.min(content_len - 1)
    };

    let items: Vec<ListItem<'static>> = members
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let item_style = theme::list_item_style(index == selected_index);
            let text = format!(
                "[{}] {:<20} L{:>3}  H {:>3}/{:<3}  S {:>3}/{:<3}  M {:>3}/{:<3}{}",
                entry.badges,
                entry.member.name,
                entry.member.level,
                entry.member.current_health,
                entry.member.max_health,
                entry.member.current_stamina,
                entry.member.max_stamina,
                entry.member.current_mana,
                entry.member.max_mana,
                entry.distance_suffix,
            );
            ListItem::new(text).style(item_style)
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
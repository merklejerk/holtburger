use crate::components::modal::{ModalPalette, fit_modal_area};
use crate::pages::selection::SelectionState;
use crate::pages::selection::state::CharacterScreen;
use crate::theme::{list_item_style, pane_block, pane_title_style};
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph};

pub fn render_character_selection(f: &mut Frame, state: &SelectionState, area: Rect) {
    match state.screen {
        CharacterScreen::Dashboard => render_character_dashboard(f, state, area),
        CharacterScreen::Creation => render_character_creation_placeholder(f, state, area),
    }

    if let Some(confirmation) = state.delete_confirmation.as_ref() {
        render_delete_confirmation_modal(f, area, confirmation);
    }
}

fn render_character_dashboard(f: &mut Frame, state: &SelectionState, area: Rect) {
    let block = pane_block(true)
        .title(Line::from(" Character Dashboard ").style(pane_title_style(true)))
        .title_bottom(Line::from(" [1-9] Quick Select  [UP/DOWN] Move "));
    let inner = block.inner(area);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(3)])
        .split(inner);

    f.render_widget(block, area);

    if state.characters.is_empty() {
        let empty = Paragraph::new(vec![
            Line::from(""),
            Line::from("No characters found on this server. Create a character to begin."),
        ])
        .alignment(Alignment::Center);

        let centered = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(40),
                Constraint::Length(2),
                Constraint::Percentage(40),
            ])
            .split(chunks[0]);

        f.render_widget(empty, centered[1]);
    } else {
        let items: Vec<ListItem> = state
            .characters
            .iter()
            .enumerate()
            .map(|(index, character)| {
                let mut spans = vec![Span::raw(format!("{:>2}. {}", index + 1, character.character.name))];
                if character.character.delete_time != 0 {
                    spans.push(Span::raw("  [pending delete]"));
                }
                ListItem::new(Line::from(spans)).style(list_item_style(index == state.selected_character_index))
            })
            .collect();

        let list = List::new(items)
            .highlight_style(list_item_style(true).add_modifier(Modifier::BOLD))
            .highlight_symbol("» ");
        let mut list_state = ListState::default();
        list_state.select(Some(state.selected_character_index));
        f.render_stateful_widget(list, chunks[0], &mut list_state);
    }

    f.render_widget(render_verb_bar(&state.dashboard_verbs()), chunks[1]);
}

fn render_character_creation_placeholder(f: &mut Frame, state: &SelectionState, area: Rect) {
    let block = pane_block(true)
        .title(Line::from(" Character Creation ").style(pane_title_style(true)));
    let inner = block.inner(area);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(3)])
        .split(inner);

    f.render_widget(block, area);

    let text = Paragraph::new(vec![
        Line::from("Character creation is not wired up yet."),
        Line::from("This screen exists so the dashboard flow and actions are in place."),
    ])
    .alignment(Alignment::Center);

    let centered = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(40),
            Constraint::Length(2),
            Constraint::Percentage(40),
        ])
        .split(chunks[0]);

    f.render_widget(text, centered[1]);
    f.render_widget(render_verb_bar(&state.creation_verbs()), chunks[1]);
}

fn render_verb_bar(verbs: &[crate::types::Verb]) -> Paragraph<'static> {
    let mut spans = Vec::new();
    for (index, verb) in verbs.iter().enumerate() {
        if index > 0 {
            spans.push(Span::raw("   "));
        }
        spans.push(Span::raw(verb.display_label()));
    }

    Paragraph::new(Line::from(spans))
        .block(Block::default().borders(Borders::TOP))
        .alignment(Alignment::Center)
}

fn render_delete_confirmation_modal(
    f: &mut Frame,
    area: Rect,
    confirmation: &crate::pages::selection::state::DeleteCharacterConfirmation,
) {
    let text = format!(
        "Delete '{}' ?\n\nType the character name to confirm. Case and whitespace are ignored.\n\n[ENTER] Delete    [ESC] Cancel",
        confirmation.character_name
    );
    let modal_area = fit_modal_area(area, " Confirm Character Delete ", &text);

    f.render_widget(Clear, modal_area);

    let block = Block::default()
        .title(" Confirm Character Delete ")
        .title_alignment(Alignment::Center)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(ModalPalette::CONFIRMATION.border))
        .style(Style::default().bg(ModalPalette::CONFIRMATION.background));

    let inner = block.inner(modal_area);
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Length(3),
            Constraint::Length(if confirmation.error_message.is_some() { 1 } else { 0 }),
        ])
        .split(inner);

    f.render_widget(block, modal_area);
    f.render_widget(
        Paragraph::new(vec![
            Line::from(format!("Delete '{}' ?", confirmation.character_name)),
            Line::from(""),
            Line::from("Type the character name to confirm. Case and whitespace are ignored."),
            Line::from(""),
            Line::from("[ENTER] Delete    [ESC] Cancel"),
        ])
        .alignment(Alignment::Center)
        .style(Style::default().fg(ModalPalette::CONFIRMATION.foreground)),
        rows[0],
    );

    let input_block = Block::default().borders(Borders::ALL).title(" Confirmation Name ");
    let input_widget = confirmation
        .input
        .rendered_with_block(input_block, Style::default(), true);
    f.render_widget(&input_widget, rows[1]);

    if let Some(error_message) = confirmation.error_message.as_ref() {
        f.render_widget(
            Paragraph::new(error_message.as_str())
                .alignment(Alignment::Center)
                .style(Style::default().fg(ratatui::style::Color::LightRed)),
            rows[2],
        );
    }
}

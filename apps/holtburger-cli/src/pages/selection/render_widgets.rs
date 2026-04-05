use crate::components::modal::{ModalPalette, fit_modal_area};
use crate::pages::selection::SelectionState;
use crate::pages::selection::creation::{
    CharacterCreationFocus, CharacterCreationSkillRow, CharacterCreationState,
};
use crate::pages::selection::presentation_utils::{creation_footer_hint, dashboard_footer_hint};
use crate::pages::selection::render::{advancement_group_label, skill_raise_cost_label};
use crate::pages::selection::state::CharacterScreen;
use crate::theme::{ERROR_FG, SUMMARY_FG, list_item_style, pane_block, pane_title_style};
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph};

pub fn render_character_selection(f: &mut Frame, state: &SelectionState, area: Rect) {
    match state.screen {
        CharacterScreen::Dashboard => render_character_dashboard(f, state, area),
        CharacterScreen::Creation => render_character_creation(f, state, area),
    }

    if let Some(confirmation) = state.delete_confirmation.as_ref() {
        render_delete_confirmation_modal(f, area, confirmation);
    }
}

fn render_character_dashboard(f: &mut Frame, state: &SelectionState, area: Rect) {
    let block = pane_block(true)
        .title(Line::from(" Character Dashboard ").style(pane_title_style(true)))
        .title_bottom(Line::from(format!(" {} ", dashboard_footer_hint(state))));
    let inner = block.inner(area);

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
            .split(inner);

        f.render_widget(empty, centered[1]);
    } else {
        let items: Vec<ListItem> = state
            .characters
            .iter()
            .enumerate()
            .map(|(index, character)| {
                let mut spans = vec![Span::raw(format!(
                    "{:>2}. {}",
                    index + 1,
                    character.character.name
                ))];
                if character.character.delete_time != 0 {
                    spans.push(Span::raw("  [pending delete]"));
                }
                ListItem::new(Line::from(spans))
                    .style(list_item_style(index == state.selected_character_index))
            })
            .collect();

        let list = List::new(items)
            .highlight_style(list_item_style(true).add_modifier(Modifier::BOLD))
            .highlight_symbol("» ");
        let mut list_state = ListState::default();
        list_state.select(Some(state.selected_character_index));
        f.render_stateful_widget(list, inner, &mut list_state);
    }
}

fn render_character_creation(f: &mut Frame, state: &SelectionState, area: Rect) {
    let block = pane_block(true)
        .title(Line::from(" Character Creation ").style(pane_title_style(true)))
        .title_bottom(Line::from(format!(" {} ", creation_footer_hint(state))));
    let inner = block.inner(area);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(2)])
        .split(inner);

    f.render_widget(block, area);

    match &state.creation {
        CharacterCreationState::Unavailable { message } => {
            let text = Paragraph::new(vec![
                Line::from("Character creation is currently unavailable."),
                Line::from(""),
                Line::from(message.as_str()),
            ])
            .alignment(Alignment::Center);

            let centered = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Percentage(35),
                    Constraint::Length(3),
                    Constraint::Percentage(35),
                ])
                .split(chunks[0]);

            f.render_widget(text, centered[1]);
        }
        CharacterCreationState::Ready(form) => {
            let body = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
                .split(chunks[0]);

            let left = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3),
                    Constraint::Length(3),
                    Constraint::Length(3),
                    Constraint::Length(3),
                    Constraint::Min(8),
                ])
                .split(body[0]);

            let right = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(10), Constraint::Length(3)])
                .split(body[1]);

            let name_widget = form.name_input.rendered_with_block(
                pane_block(form.focus == CharacterCreationFocus::Name).title(
                    Line::from(" Name ")
                        .style(pane_title_style(form.focus == CharacterCreationFocus::Name)),
                ),
                Style::default(),
                form.focus == CharacterCreationFocus::Name,
            );
            f.render_widget(&name_widget, left[0]);

            f.render_widget(
                render_picker_control(
                    "Heritage",
                    form.heritage_name(),
                    form.focus == CharacterCreationFocus::Heritage,
                ),
                left[1],
            );
            f.render_widget(
                render_picker_control(
                    "Starter Town",
                    form.start_area_name(),
                    form.focus == CharacterCreationFocus::StarterTown,
                ),
                left[2],
            );
            f.render_widget(
                render_picker_control(
                    "Gender",
                    form.gender_name(),
                    form.focus == CharacterCreationFocus::Gender,
                ),
                left[3],
            );

            let attribute_items = form
                .attribute_rows()
                .into_iter()
                .enumerate()
                .map(|(index, (label, value))| {
                    ListItem::new(Line::from(vec![
                        Span::raw(format!("{label:<13}")),
                        Span::raw(format!("{value:>3}")),
                    ]))
                    .style(list_item_style(
                        form.focus == CharacterCreationFocus::Attributes
                            && index == form.selected_attribute_index,
                    ))
                })
                .collect::<Vec<_>>();
            let attributes_block = pane_block(form.focus == CharacterCreationFocus::Attributes)
                .title(
                    Line::from(format!(
                        " Attributes  {} remaining ",
                        form.remaining_attribute_points()
                    ))
                    .style(pane_title_style(
                        form.focus == CharacterCreationFocus::Attributes,
                    )),
                );
            let mut attributes_state = ListState::default();
            attributes_state.select(Some(form.selected_attribute_index));
            f.render_stateful_widget(
                List::new(attribute_items).block(attributes_block),
                left[4],
                &mut attributes_state,
            );

            let skill_rows = form.skill_display_rows();
            let skill_items = skill_rows
                .iter()
                .map(|row| match row {
                    CharacterCreationSkillRow::Header(advancement) => {
                        ListItem::new(Line::from(vec![Span::styled(
                            advancement_group_label(*advancement),
                            Style::default().add_modifier(Modifier::BOLD).fg(SUMMARY_FG),
                        )]))
                    }
                    CharacterCreationSkillRow::Skill {
                        skill_id,
                        label,
                        selected,
                        advancement,
                        ..
                    } => ListItem::new(Line::from(vec![
                        Span::raw(format!("{label:<24}")),
                        Span::styled(
                            skill_raise_cost_label(
                                *advancement,
                                form.catalog
                                    .skill_costs_for_heritage(form.heritage_id, *skill_id),
                            ),
                            Style::default().fg(if *selected { Color::White } else { Color::Gray }),
                        ),
                    ]))
                    .style(list_item_style(
                        form.focus == CharacterCreationFocus::Skills && *selected,
                    )),
                })
                .collect::<Vec<_>>();
            let mut skill_state = ListState::default();
            skill_state.select(form.selected_skill_display_index());
            f.render_stateful_widget(
                List::new(skill_items).block(
                    pane_block(form.focus == CharacterCreationFocus::Skills).title(
                        Line::from(format!(
                            " Skills  {} points remaining ",
                            form.remaining_skill_points()
                        ))
                        .style(pane_title_style(
                            form.focus == CharacterCreationFocus::Skills,
                        )),
                    ),
                ),
                right[0],
                &mut skill_state,
            );

            let button_style = if form.focus == CharacterCreationFocus::Submit {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            };
            f.render_widget(
                Paragraph::new(Line::from("[ Enter ] Create Character"))
                    .style(button_style)
                    .alignment(Alignment::Center)
                    .block(
                        pane_block(form.focus == CharacterCreationFocus::Submit).title(
                            Line::from(" Submit ").style(pane_title_style(
                                form.focus == CharacterCreationFocus::Submit,
                            )),
                        ),
                    ),
                right[1],
            );

            if let Some(feedback) = form.feedback.as_ref() {
                f.render_widget(
                    Paragraph::new(feedback.message.as_str())
                        .alignment(Alignment::Center)
                        .style(Style::default().fg(if feedback.is_error {
                            ERROR_FG
                        } else {
                            SUMMARY_FG
                        })),
                    chunks[1],
                );
            }
        }
    }
}

fn render_picker_control(title: &str, value: &str, focused: bool) -> Paragraph<'static> {
    Paragraph::new(Line::from(vec![Span::raw(format!("< {} >", value))]))
        .alignment(Alignment::Center)
        .block(
            pane_block(focused)
                .title(Line::from(format!(" {title} ")).style(pane_title_style(focused))),
        )
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
            Constraint::Length(if confirmation.error_message.is_some() {
                1
            } else {
                0
            }),
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

    let input_block = Block::default()
        .borders(Borders::ALL)
        .title(" Confirmation Name ");
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

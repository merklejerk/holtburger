use crate::pages::selection::SelectionState;
use crate::types::{AppAction, AppUiAction, Verb};

pub(super) fn dashboard_verbs(state: &SelectionState) -> Vec<Verb> {
    let mut verbs = vec![Verb::new(
        AppUiAction::OpenCharacterCreationScreen,
        'n',
        "New",
    )];

    if state
        .selected_character()
        .is_some_and(|character| character.character.delete_time == 0)
    {
        verbs.push(Verb::new(
            AppUiAction::OpenDeleteCharacterConfirmation,
            'd',
            "Delete",
        ));
        verbs.push(Verb::new(AppAction::EnterSelectedCharacter, '\r', "World"));
    }

    if state
        .selected_character()
        .is_some_and(|character| character.character.delete_time != 0)
    {
        verbs.push(Verb::new(
            AppAction::RestoreSelectedCharacter,
            'r',
            "Restore",
        ));
    }

    verbs
}

pub(super) fn dashboard_footer_hint(state: &SelectionState) -> String {
    let mut segments = vec![
        "[1-9] Quick Select".to_string(),
        "[UP/DOWN] Move".to_string(),
    ];
    segments.extend(
        dashboard_verbs(state)
            .iter()
            .map(Verb::display_label)
            .collect::<Vec<_>>(),
    );
    segments.join("  ")
}

pub(super) fn creation_footer_hint(state: &SelectionState) -> String {
    state
        .creation
        .ready()
        .map(|creation| creation.footer_hint())
        .unwrap_or_else(|| "[ESC] Back".to_string())
}

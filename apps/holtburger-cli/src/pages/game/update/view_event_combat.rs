use super::*;

pub(super) fn reduce_combat_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    if let ClientViewEvent::CombatFeedback(feedback) = event {
        result.merge(state.handle_combat_feedback(&feedback));
        state.chat.handle_event(
            ClientViewEvent::CombatFeedback(feedback),
            state.data.character_name.as_deref(),
        );
        result.request_redraw(RedrawPriority::Immediate);
    }

    result
}
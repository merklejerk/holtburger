use super::*;
use holtburger_world::progression::{ProgressionIntent, StatTarget};
use holtburger_world::stats::TrainingLevel;

pub(super) fn reduce_action(_state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::SubmitProgression { quote } => {
            UpdateResult::commands(vec![ClientCommand::SubmitProgression(quote)])
        }
        _ => UpdateResult::new(),
    }
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    match event {
        ClientViewEvent::ProgressionEvaluated {
            request_id,
            evaluations,
        } if *request_id == state.data.progression.request_id => {
            state.data.progression.evaluations = evaluations
                .iter()
                .copied()
                .map(|evaluation| (evaluation.intent, evaluation))
                .collect();
            UpdateResult::redraw()
        }
        ClientViewEvent::ProgressionGuardsUpdated { targets } => {
            state.data.progression.guarded_targets = targets.iter().copied().collect();
            UpdateResult::redraw()
        }
        ClientViewEvent::StatusUpdate {
            state:
                holtburger_core::ClientState::Disconnected
                | holtburger_core::ClientState::CharacterSelection(_),
        } => {
            state.data.progression = Default::default();
            UpdateResult::redraw()
        }
        ClientViewEvent::ProgressionFeedback(feedback) => {
            match feedback {
                holtburger_core::ClientProgressionFeedback::Rejected { reason, .. } => {
                    log::warn!("Progression request rejected: {reason:?}");
                }
                holtburger_core::ClientProgressionFeedback::DispatchFailed { message, .. } => {
                    log::warn!("Progression send failed: {message}");
                }
                holtburger_core::ClientProgressionFeedback::Submitted { .. } => {}
            }
            UpdateResult::new()
        }
        _ => UpdateResult::new(),
    }
}

pub(super) fn request_quotes(state: &mut GameState) -> UpdateResult {
    if state.data.player_guid.is_none() {
        return UpdateResult::new();
    }
    let mut intents = Vec::new();
    intents.extend(state.data.attributes.keys().copied().map(|attribute| {
        ProgressionIntent::Raise {
            target: StatTarget::Attribute(attribute),
            ranks: 1,
        }
    }));
    intents.extend(
        state
            .data
            .vitals
            .keys()
            .copied()
            .map(|vital| ProgressionIntent::Raise {
                target: StatTarget::Vital(vital),
                ranks: 1,
            }),
    );
    intents.extend(
        state
            .data
            .skills
            .values()
            .filter_map(|skill| match skill.training {
                TrainingLevel::Untrained => Some(ProgressionIntent::Train {
                    skill: skill.skill_type,
                }),
                TrainingLevel::Trained | TrainingLevel::Specialized => {
                    Some(ProgressionIntent::Raise {
                        target: StatTarget::Skill(skill.skill_type),
                        ranks: 1,
                    })
                }
                TrainingLevel::Unusable => None,
            }),
    );
    intents.sort_by_key(|intent| match intent.target() {
        StatTarget::Attribute(value) => (0, value as u32),
        StatTarget::Vital(value) => (1, value as u32),
        StatTarget::Skill(value) => (2, value as u32),
    });
    if intents.is_empty() {
        return UpdateResult::new();
    }
    let progression = &mut state.data.progression;
    progression.request_id = progression.request_id.wrapping_add(1).max(1);
    progression.evaluations.clear();
    UpdateResult::commands(vec![ClientCommand::EvaluateProgression {
        request_id: progression.request_id,
        intents,
    }])
}

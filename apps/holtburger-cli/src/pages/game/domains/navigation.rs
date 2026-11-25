use super::inventory;
use super::object_interaction;
use super::*;
use holtburger_core::client::motion::steering::{
    DEFAULT_FOLLOW_DISTANCE_M, DEFAULT_STUCK_TIMEOUT_MS, LocalSteeringGoal, LocalSteeringRequest,
};
use holtburger_core::client::movement_types::{Gait, PlayerDriveIntent};
use holtburger_world::project_pose_forward_distance;

const SCOOT_ARRIVAL_DISTANCE_M: f32 = 0.35;
const MAX_SCOOT_DISTANCE_M: f32 = 192.0;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::Approach { guid } => {
            result
                .commands
                .push(ClientCommand::StartLocalSteering(LocalSteeringRequest {
                    goal: LocalSteeringGoal::Approach {
                        target: guid,
                        arrival_distance: None,
                        gait: Gait::Run,
                    },
                    stuck_timeout_ms: DEFAULT_STUCK_TIMEOUT_MS,
                    max_duration_ms: None,
                }));
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged {
                    interaction: Some(Interaction::Approaching { target_guid: guid }),
                },
            });
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::Follow { guid } => {
            result
                .commands
                .push(ClientCommand::StartLocalSteering(LocalSteeringRequest {
                    goal: LocalSteeringGoal::Follow {
                        target: guid,
                        follow_distance: DEFAULT_FOLLOW_DISTANCE_M,
                        gait: Gait::Run,
                    },
                    stuck_timeout_ms: DEFAULT_STUCK_TIMEOUT_MS,
                    max_duration_ms: None,
                }));
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged {
                    interaction: Some(Interaction::Following { target_guid: guid }),
                },
            });
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::Scoot { distance_m } => {
            if distance_m.is_finite()
                && let Some(player_pos) = state.data.runtime_player_position()
            {
                let clamped = distance_m.clamp(-MAX_SCOOT_DISTANCE_M, MAX_SCOOT_DISTANCE_M);
                let destination = project_pose_forward_distance(player_pos, clamped);
                result
                    .commands
                    .push(ClientCommand::StartLocalSteering(LocalSteeringRequest {
                        goal: LocalSteeringGoal::MoveTo {
                            destination,
                            arrival_distance: SCOOT_ARRIVAL_DISTANCE_M,
                            gait: Gait::Run,
                            final_heading: None,
                        },
                        stuck_timeout_ms: DEFAULT_STUCK_TIMEOUT_MS,
                        max_duration_ms: None,
                    }));
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        AppAction::SnapHeading { heading } => {
            result
                .commands
                .push(ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing {
                    heading,
                }));
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::BeginInteraction { interaction } => {
            let replacing_steering = is_steering_interaction(state.view.active_interaction)
                && !is_steering_interaction(Some(interaction));
            if replacing_steering {
                result.commands.push(ClientCommand::StopLocalSteering);
            }
            if interaction == Interaction::Salvaging {
                if !inventory::begin_salvaging_interaction(state, &mut result) {
                    return result;
                }
            } else {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::ActiveInteractionChanged {
                        interaction: Some(interaction),
                    },
                });
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::CancelInteraction => {
            if is_steering_interaction(state.view.active_interaction) {
                result.commands.push(ClientCommand::StopLocalSteering);
            }
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged { interaction: None },
            });
            state.view.salvaging = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::PlayerGroundedUpdated { grounded } => {
            state.data.player_grounded = Some(*grounded);
        }
        ClientViewEvent::SelfMovementKinematicsUpdated { kinematics } => {
            state.data.self_movement_kinematics = kinematics.clone();
        }
        ClientViewEvent::RuntimeBodySnapshot { .. } => {
            object_interaction::refresh_context_buffer(state);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::RuntimeBodyUpserted { body } => {
            if let Some(guid) = body.body_id.authoritative_guid() {
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
            }
            result.request_redraw(RedrawPriority::Motion);
        }
        ClientViewEvent::RuntimeBodyRemoved { body_id } => {
            if let Some(guid) = body_id.authoritative_guid() {
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::RuntimeBodiesReset { .. } => {
            object_interaction::refresh_context_buffer(state);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::LocalNavigationFinished(_)
            if is_steering_interaction(state.view.active_interaction) =>
        {
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged { interaction: None },
            });
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::TeleportStarted { .. } => {
            if is_steering_interaction(state.view.active_interaction) {
                result.commands.push(ClientCommand::StopLocalSteering);
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::ActiveInteractionChanged { interaction: None },
                });
                result.request_redraw(RedrawPriority::Immediate);
            }

            if matches!(
                state.view.active_interaction,
                Some(Interaction::Targeting { .. })
            ) {
                if matches!(
                    state.data.combat_mode,
                    CombatMode::Melee | CombatMode::Missile
                ) {
                    result.commands.push(ClientCommand::StopCombatEngagement {
                        intent_sequence: state.data.next_combat_intent_sequence(),
                    });
                }
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::ActiveInteractionChanged { interaction: None },
                });
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        _ => {}
    }

    result
}

fn is_steering_interaction(interaction: Option<Interaction>) -> bool {
    matches!(
        interaction,
        Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
    )
}

use super::*;

use crate::scripting::{
    TuiScriptClientView, WorkflowProjection, chat_tags_for_style,
    deferred_script_source_for_basename, resolve_deferred_script_source,
    script_event_from_notification, script_event_from_view_event, workflow_events,
    workflow_projection,
};
use crate::types::AppNotification;
use crate::types::{InspectTarget, Interaction};
use anyhow::Result;
use holtburger_core::client::types::TargetSlot;
use holtburger_scripting::{
    ScriptClientIntent, ScriptEquipmentSlotKind, ScriptEvent, ScriptHost, ScriptIntent,
    ScriptLifecycleEvent,
};
use std::time::Duration;

fn script_client_view<'a>(
    data: &'a GameData,
    view: &'a ViewState,
    server_time: Option<(f64, Instant)>,
    script_name: Option<&'a str>,
) -> TuiScriptClientView<'a> {
    TuiScriptClientView {
        data,
        view,
        server_time,
        script_name,
    }
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::RunScript { basename, args } => {
            let mut result = UpdateResult::new();
            state.run_script_command(&basename, args, &mut result);
            result
        }
        AppAction::ScriptCommand { msg } => {
            let mut result = UpdateResult::new();
            let Some(host) = state.script.host.as_mut() else {
                log::error!("Ignoring /script command because no script is running: {msg}");
                result.request_redraw(crate::types::RedrawPriority::Immediate);
                return result;
            };

            let view = script_client_view(
                &state.data,
                &state.view,
                None,
                state.script.running_source_name.as_deref(),
            );
            dispatch_script_event_to_host(&view, host, ScriptEvent::Command { msg }, &mut result);
            result.request_redraw(crate::types::RedrawPriority::Immediate);
            result
        }
        AppAction::UnrunScript => {
            let mut result = UpdateResult::new();
            state.unrun_script_command(&mut result);
            result
        }
        AppAction::Notification {
            notification: AppNotification::PlayerEntityReady { .. },
        } => {
            let mut result = UpdateResult::new();
            state.maybe_start_queued_script_startup(&mut result);
            result
        }
        _ => UpdateResult::new(),
    }
}

impl GameState {
    pub(crate) fn set_queued_script_startup(
        &mut self,
        queued_script_startup: Option<crate::state::QueuedScriptStartup>,
        result: &mut UpdateResult,
    ) {
        self.script.queued_script_startup = queued_script_startup;
        self.maybe_start_queued_script_startup(result);
    }

    fn script_host_is_running(&self) -> bool {
        self.script.host.is_some()
    }

    fn stop_script_host(&mut self, result: &mut UpdateResult) {
        let view = script_client_view(
            &self.data,
            &self.view,
            None,
            self.script.running_source_name.as_deref(),
        );

        let had_host = {
            let Some(host) = self.script.host.as_mut() else {
                return;
            };

            dispatch_script_event_to_host(
                &view,
                host,
                ScriptEvent::Lifecycle(ScriptLifecycleEvent::Stopped),
                result,
            );
            true
        };

        if had_host {
            self.script.host = None;
            self.script.tick_accumulator = Duration::ZERO;
            self.script.running_source_name = None;
        }
    }

    pub(crate) fn maybe_start_queued_script_startup(&mut self, result: &mut UpdateResult) {
        if !self.player_entity_is_ready() {
            return;
        }

        let Some(queued_script_startup) = self.script.queued_script_startup.take() else {
            return;
        };

        self.run_script_command(
            &queued_script_startup.basename,
            queued_script_startup.args,
            result,
        );
    }

    pub(crate) fn run_script_command(
        &mut self,
        basename: &str,
        args: String,
        result: &mut UpdateResult,
    ) {
        if !self.player_entity_is_ready() {
            result.actions.push(AppAction::Log {
                chat_tags: ChatMessageTags::warning(),
                message: format!(
                    "[script] Ignoring /run {basename} because the client is not ready yet"
                ),
            });
            result.request_redraw(crate::types::RedrawPriority::Immediate);
            return;
        }

        let source = match deferred_script_source_for_basename(basename) {
            Ok(source) => source,
            Err(error) => {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] {error}"),
                });
                result.request_redraw(crate::types::RedrawPriority::Immediate);
                return;
            }
        };

        let source = match resolve_deferred_script_source(&source) {
            Ok(source) => source,
            Err(error) => {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] Failed to load script source: {error:?}"),
                });
                result.request_redraw(crate::types::RedrawPriority::Immediate);
                return;
            }
        };

        let loaded_path = source.name.clone();
        let running_source_name = source.name.clone();

        if self.script_host_is_running() {
            self.stop_script_host(result);
        }

        let view = script_client_view(
            &self.data,
            &self.view,
            None,
            Some(running_source_name.as_str()),
        );

        match ScriptHost::spawn_with_config(source, &view, self.script.host_config.clone()) {
            Ok(mut host) => {
                let started_ok = dispatch_script_event_to_host(
                    &view,
                    &mut host,
                    ScriptEvent::Lifecycle(ScriptLifecycleEvent::Started { args }),
                    result,
                );

                if started_ok {
                    self.script.running_source_name = Some(running_source_name);
                    self.script.host = Some(host);
                    self.script.tick_accumulator = Duration::ZERO;
                    result.actions.push(AppAction::Log {
                        chat_tags: ChatMessageTags::info(),
                        message: format!("[script] Loaded {loaded_path}"),
                    });
                }
            }
            Err(error) => {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] Failed to start script host: {error}"),
                });
            }
        }

        result.request_redraw(crate::types::RedrawPriority::Immediate);
    }

    pub(crate) fn unrun_script_command(&mut self, result: &mut UpdateResult) {
        let had_queued_startup = self.script.queued_script_startup.take().is_some();
        let had_running = self.script_host_is_running();
        self.stop_script_host(result);

        let message = match (had_running, had_queued_startup) {
            (true, true) => "[script] Stopped active script and cleared queued startup",
            (true, false) => "[script] Stopped active script",
            (false, true) => "[script] Cleared queued script startup",
            (false, false) => "[script] No active script to stop",
        };

        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::info(),
            message: message.to_string(),
        });
        result.request_redraw(crate::types::RedrawPriority::Immediate);
    }

    fn compile_script_intent(view: &ViewState, intent: ScriptIntent) -> Result<AppAction> {
        match intent {
            ScriptIntent::Print { style, message } => Ok(AppAction::Log {
                chat_tags: chat_tags_for_style(style),
                message,
            }),
            ScriptIntent::Say { message } => Ok(AppAction::SendCommands {
                commands: vec![ClientCommand::Talk(message)],
            }),
            ScriptIntent::Tell { target, message } => Ok(AppAction::SendCommands {
                commands: vec![ClientCommand::Tell { target, message }],
            }),
            ScriptIntent::Use { guid } => Ok(AppAction::Use { guid }),
            ScriptIntent::Emote { message } => Ok(AppAction::Emote { message }),
            ScriptIntent::SoulEmote { token } => Ok(AppAction::SoulEmote { token }),
            ScriptIntent::OpenTrade { guid } => Ok(AppAction::OpenTrade { guid }),
            ScriptIntent::AddToTrade { item } => Ok(AppAction::AddToTrade { guid: item }),
            ScriptIntent::AcceptTrade => Ok(AppAction::AcceptTrade),
            ScriptIntent::DeclineTrade => Ok(AppAction::DeclineTrade),
            ScriptIntent::ResetTrade => Ok(AppAction::ResetTrade),
            ScriptIntent::ExitTrade => Ok(AppAction::ExitTrade),
            ScriptIntent::OpenContainer { guid } => Ok(AppAction::Open { guid }),
            ScriptIntent::CloseContainer { guid } => Ok(AppAction::Close { guid }),
            ScriptIntent::SnapHeading { heading } => Ok(AppAction::SnapHeading { heading }),
            ScriptIntent::Scoot { distance_m } => Ok(AppAction::Scoot { distance_m }),
            ScriptIntent::Combine { source, dest } => Ok(AppAction::UseWith {
                item: source,
                target: dest,
            }),
            ScriptIntent::CastSpell { spell_id, target } => {
                Ok(AppAction::CastSpell { spell_id, target })
            }
            ScriptIntent::MoveItem { item, container } => {
                Ok(AppAction::MoveItem { item, container })
            }
            ScriptIntent::StackItems {
                source,
                destination,
                amount,
            } => Ok(AppAction::StackItems {
                source,
                destination,
                amount,
            }),
            ScriptIntent::SplitItem {
                item,
                container,
                amount,
            } => Ok(AppAction::SplitItem {
                item,
                container,
                amount,
            }),
            ScriptIntent::Salvage { tool, items } => Ok(AppAction::SalvageItems {
                ust_guid: tool,
                item_guids: items,
            }),
            ScriptIntent::Assess { target } => Ok(AppAction::Assess {
                target: InspectTarget::Entity(target),
            }),
            ScriptIntent::Drop { item } => Ok(AppAction::Drop { guid: item }),
            ScriptIntent::Pickup { item, container } => Ok(AppAction::PickUp { item, container }),
            ScriptIntent::Equip { guid, slot } => Ok(AppAction::EquipInSlot {
                guid,
                slot: script_equipment_slot_to_target_slot(slot),
            }),
            ScriptIntent::Unequip { guid } => Ok(AppAction::Unequip { guid }),
            ScriptIntent::RespondToConfirmation { accepted } => {
                if view.active_confirmation.is_some() {
                    return Ok(AppAction::SendCommands {
                        commands: vec![ClientCommand::RespondToConfirmation { accepted }],
                    });
                }

                if view.local_confirmation.is_some() {
                    return Ok(AppAction::UiAction {
                        action: if accepted {
                            AppUiAction::ConfirmLocalConfirmation
                        } else {
                            AppUiAction::DismissLocalConfirmation
                        },
                    });
                }

                anyhow::bail!("no active confirmation to respond to")
            }
            ScriptIntent::SetCombatMode { on } => Ok(AppAction::SetCombatMode { on }),
            ScriptIntent::Client(intent) => match intent {
                ScriptClientIntent::TargetEntity { guid } => Ok(AppAction::BeginInteraction {
                    interaction: Interaction::Targeting { target_guid: guid },
                }),
                ScriptClientIntent::Approach { guid } => Ok(AppAction::Approach { guid }),
                ScriptClientIntent::Follow { guid } => Ok(AppAction::Follow { guid }),
                ScriptClientIntent::CancelInteraction => Ok(AppAction::CancelInteraction),
                ScriptClientIntent::Attack { guid } => Ok(AppAction::Attack { guid }),
            },
        }
    }

    fn drain_script_host_outputs(
        view: &ViewState,
        outputs: Vec<ScriptIntent>,
        result: &mut UpdateResult,
    ) {
        for intent in outputs {
            match Self::compile_script_intent(view, intent) {
                Ok(action) => result.actions.push(action),
                Err(error) => result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: format!("[script] {error}"),
                }),
            }
        }
    }

    pub(crate) fn sync_script_host_for_view_event(
        &mut self,
        server_time: Option<(f64, Instant)>,
        event: &ClientViewEvent,
        before_workflow: &WorkflowProjection,
        result: &mut UpdateResult,
    ) {
        let view = script_client_view(
            &self.data,
            &self.view,
            server_time,
            self.script.running_source_name.as_deref(),
        );
        let after_workflow = workflow_projection(Some(self));

        let Some(host) = self.script.host.as_mut() else {
            return;
        };

        let mut dispatch_failed = false;

        if let Some(script_event) = script_event_from_view_event(event) {
            dispatch_failed |= !dispatch_script_event_to_host(&view, host, script_event, result);
        }

        if !dispatch_failed {
            for workflow_event in workflow_events(before_workflow, &after_workflow) {
                dispatch_failed |= !dispatch_script_event_to_host(
                    &view,
                    host,
                    ScriptEvent::Workflow(workflow_event),
                    result,
                );

                if dispatch_failed {
                    break;
                }
            }
        }

        if dispatch_failed {
            self.script.host = None;
            self.script.running_source_name = None;
            self.script.tick_accumulator = Duration::ZERO;
        }
    }

    pub(crate) fn sync_script_host_for_notification(
        &mut self,
        server_time: Option<(f64, Instant)>,
        notification: &AppNotification,
        result: &mut UpdateResult,
    ) {
        if matches!(notification, AppNotification::PlayerEntityReady { .. }) {
            self.maybe_start_queued_script_startup(result);
        }

        let view = script_client_view(
            &self.data,
            &self.view,
            server_time,
            self.script.running_source_name.as_deref(),
        );

        let Some(host) = self.script.host.as_mut() else {
            return;
        };

        if let Some(script_event) = script_event_from_notification(notification)
            && !dispatch_script_event_to_host(&view, host, script_event, result)
        {
            self.script.host = None;
            self.script.running_source_name = None;
            self.script.tick_accumulator = Duration::ZERO;
        }
    }

    pub(crate) fn sync_script_host_for_tick(
        &mut self,
        server_time: Option<(f64, Instant)>,
        elapsed: f64,
        result: &mut UpdateResult,
    ) {
        let view = script_client_view(
            &self.data,
            &self.view,
            server_time,
            self.script.running_source_name.as_deref(),
        );
        let mut tick_count = 0;

        if self.script.host.is_some() {
            if elapsed > 0.0 {
                self.script.tick_accumulator += Duration::from_secs_f64(elapsed);
            }

            while self.script.tick_accumulator >= crate::pages::game::state::SCRIPT_TICK_INTERVAL {
                self.script.tick_accumulator -= crate::pages::game::state::SCRIPT_TICK_INTERVAL;
                tick_count += 1;
            }
        }

        let host_was_cleared = {
            let Some(host) = self.script.host.as_mut() else {
                return;
            };

            let mut dispatch_failed = !pump_script_host(&view, host, result);

            for _ in 0..tick_count {
                dispatch_failed |= !dispatch_script_event_to_host(
                    &view,
                    host,
                    ScriptEvent::Lifecycle(ScriptLifecycleEvent::Tick {
                        elapsed_seconds: crate::pages::game::state::SCRIPT_TICK_INTERVAL
                            .as_secs_f64(),
                    }),
                    result,
                );

                if dispatch_failed {
                    break;
                }
            }

            dispatch_failed
        };

        if host_was_cleared {
            self.script.host = None;
            self.script.running_source_name = None;
            self.script.tick_accumulator = Duration::ZERO;
        }
    }

    pub(crate) fn script_workflow_projection(&self) -> WorkflowProjection {
        workflow_projection(Some(self))
    }
}

fn dispatch_script_event_to_host(
    view: &TuiScriptClientView<'_>,
    host: &mut ScriptHost,
    event: ScriptEvent,
    result: &mut UpdateResult,
) -> bool {
    let dispatch_result = host.dispatch_event(view, event);
    let outputs = host.drain_outputs();
    GameState::drain_script_host_outputs(view.view, outputs, result);

    if let Err(error) = dispatch_result {
        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::error(),
            message: format!("[script] {error:?}"),
        });
        return false;
    }

    true
}

fn pump_script_host(
    view: &TuiScriptClientView<'_>,
    host: &mut ScriptHost,
    result: &mut UpdateResult,
) -> bool {
    let pump_result = host.pump(view);
    let outputs = host.drain_outputs();
    GameState::drain_script_host_outputs(view.view, outputs, result);

    if let Err(error) = pump_result {
        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::error(),
            message: format!("[script] {error:?}"),
        });
        return false;
    }

    true
}

fn script_equipment_slot_to_target_slot(slot: ScriptEquipmentSlotKind) -> TargetSlot {
    TargetSlot::EquipMask(slot.equip_mask())
}

#[cfg(test)]
mod tests {
    use super::GameState;
    use super::ScriptEquipmentSlotKind;
    use super::ScriptIntent;
    use super::ViewState;
    use crate::state::QueuedScriptStartup;
    use crate::types::AppNotification;
    use crate::types::UpdateResult;
    use crate::types::{AppAction, InspectTarget};
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_core::client::types::TargetSlot;
    use holtburger_world::entity::Entity;

    #[test]
    fn compile_script_intent_maps_new_item_actions() {
        let view = ViewState::default();

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Combine {
                    source: Guid(1),
                    dest: Guid(2),
                },
            )
            .expect("combine should compile"),
            AppAction::UseWith { item, target } if item == Guid(1) && target == Guid(2)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::CastSpell {
                    spell_id: 42,
                    target: None,
                },
            )
            .expect("untargeted cast should compile"),
            AppAction::CastSpell { spell_id, target } if spell_id == 42 && target.is_none()
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::CastSpell {
                    spell_id: 99,
                    target: Some(Guid(7)),
                },
            )
            .expect("targeted cast should compile"),
            AppAction::CastSpell { spell_id, target }
                if spell_id == 99 && target == Some(Guid(7))
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::MoveItem {
                    item: Guid(3),
                    container: Guid(4),
                },
            )
            .expect("move item should compile"),
            AppAction::MoveItem { item, container } if item == Guid(3) && container == Guid(4)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::StackItems {
                    source: Guid(5),
                    destination: Guid(6),
                    amount: 7,
                },
            )
            .expect("stack items should compile"),
            AppAction::StackItems { source, destination, amount }
                if source == Guid(5) && destination == Guid(6) && amount == 7
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::SplitItem {
                    item: Guid(8),
                    container: Guid(9),
                    amount: 10,
                },
            )
            .expect("split item should compile"),
            AppAction::SplitItem { item, container, amount }
                if item == Guid(8) && container == Guid(9) && amount == 10
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Salvage {
                    tool: Guid(3),
                    items: vec![Guid(4), Guid(5)],
                },
            )
            .expect("salvage should compile"),
            AppAction::SalvageItems { ust_guid, item_guids }
                if ust_guid == Guid(3) && item_guids == vec![Guid(4), Guid(5)]
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Assess { target: Guid(6) },
            )
            .expect("assess should compile"),
            AppAction::Assess { target: InspectTarget::Entity(target) } if target == Guid(6)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::SnapHeading { heading: 1.5 },
            )
            .expect("snap heading should compile"),
            AppAction::SnapHeading { heading } if (heading - 1.5).abs() < f32::EPSILON
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Scoot { distance_m: 2.25 },
            )
            .expect("scoot should compile"),
            AppAction::Scoot { distance_m } if (distance_m - 2.25).abs() < f32::EPSILON
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::SetCombatMode { on: true },)
                .expect("set combat mode should compile"),
            AppAction::SetCombatMode { on: true }
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Emote {
                    message: "waves".to_string(),
                },
            )
            .expect("emote should compile"),
            AppAction::Emote { message } if message == "waves"
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::SoulEmote {
                    token: "wave".to_string(),
                },
            )
            .expect("soul emote should compile"),
            AppAction::SoulEmote { token } if token == "wave"
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::OpenTrade { guid: Guid(10) },
            )
            .expect("open trade should compile"),
            AppAction::OpenTrade { guid } if guid == Guid(10)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::AddToTrade { item: Guid(11) },
            )
            .expect("add to trade should compile"),
            AppAction::AddToTrade { guid } if guid == Guid(11)
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::AcceptTrade)
                .expect("accept trade should compile"),
            AppAction::AcceptTrade
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::DeclineTrade)
                .expect("decline trade should compile"),
            AppAction::DeclineTrade
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::ResetTrade)
                .expect("reset trade should compile"),
            AppAction::ResetTrade
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::ExitTrade)
                .expect("exit trade should compile"),
            AppAction::ExitTrade
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::OpenContainer { guid: Guid(14) },
            )
            .expect("open container should compile"),
            AppAction::Open { guid } if guid == Guid(14)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::CloseContainer { guid: Guid(15) },
            )
            .expect("close container should compile"),
            AppAction::Close { guid } if guid == Guid(15)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Equip {
                    guid: Guid(12),
                    slot: ScriptEquipmentSlotKind::ChestWear,
                },
            )
                .expect("equip should compile"),
            AppAction::EquipInSlot { guid, slot }
                if guid == Guid(12)
                    && matches!(slot, TargetSlot::EquipMask(mask) if mask == holtburger_common::properties::EquipMask::CHEST_WEAR)
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::Unequip { guid: Guid(13) })
                .expect("unequip should compile"),
            AppAction::Unequip { guid } if guid == Guid(13)
        ));

        assert!(matches!(
            GameState::compile_script_intent(&view, ScriptIntent::Drop { item: Guid(7) })
                .expect("drop should compile"),
            AppAction::Drop { guid } if guid == Guid(7)
        ));

        assert!(matches!(
            GameState::compile_script_intent(
                &view,
                ScriptIntent::Pickup {
                    item: Guid(8),
                    container: Some(Guid(9)),
                },
            )
            .expect("pickup should compile"),
            AppAction::PickUp { item, container }
                if item == Guid(8) && container == Some(Guid(9))
        ));
    }

    #[test]
    fn queued_script_startup_runs_once_player_entity_is_ready() {
        let player_guid = Guid(0x5000_0001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        let script_basename = format!("queued-startup-test-{}", std::process::id());

        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), WorldPosition::default()),
        );
        state.script.queued_script_startup =
            Some(QueuedScriptStartup::new(&script_basename, "pick up loot"));

        let mut result = UpdateResult::new();
        state.sync_script_host_for_notification(
            None,
            &AppNotification::PlayerEntityReady { guid: player_guid },
            &mut result,
        );

        assert!(state.script.queued_script_startup.is_none());
        assert!(state.script.host.is_none());
    }
}

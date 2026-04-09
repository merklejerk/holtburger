use super::*;

use crate::scripting::{
    DeferredScriptSource, TuiScriptClientView, WorkflowProjection, chat_tags_for_level,
    deferred_script_source_for_basename, resolve_deferred_script_source,
    script_event_from_view_event, workflow_events, workflow_projection,
};
use anyhow::Result;
use holtburger_scripting::{
    ScriptClientIntent, ScriptEvent, ScriptHost, ScriptIntent, ScriptLifecycleEvent,
};

fn script_client_view<'a>(
    state: &'a GameState,
    server_time: Option<(f64, Instant)>,
) -> TuiScriptClientView<'a> {
    TuiScriptClientView {
        game: Some(state),
        server_time,
    }
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::RunScript { basename } => {
            let mut result = UpdateResult::new();
            state.run_script_command(&basename, &mut result);
            result
        }
        AppAction::UnrunScript => {
            let mut result = UpdateResult::new();
            state.unrun_script_command(&mut result);
            result
        }
        _ => unreachable!("unsupported script action"),
    }
}

impl GameState {
    fn pending_script_source(&self) -> Option<&DeferredScriptSource> {
        self.script.pending_source.as_ref()
    }

    fn set_pending_script_source(&mut self, source: Option<DeferredScriptSource>) {
        self.script.pending_source = source;
    }

    fn script_host_is_running(&self) -> bool {
        self.script.host.is_some()
    }

    fn script_player_entity_is_ready(&self) -> bool {
        self.data
            .player_guid
            .is_some_and(|guid| self.data.entities.contains_key(&guid))
    }

    fn take_script_host(&mut self) -> Option<ScriptHost> {
        self.script.host.take()
    }

    fn store_script_host(&mut self, host: ScriptHost) {
        self.script.host = Some(host);
    }

    fn dispatch_script_event_to_host(
        &self,
        server_time: Option<(f64, Instant)>,
        host: &mut ScriptHost,
        event: ScriptEvent,
        result: &mut UpdateResult,
    ) {
        let view = script_client_view(self, server_time);
        if let Err(error) = host.dispatch_event(&view, event) {
            result.actions.push(AppAction::Log {
                chat_tags: ChatMessageTags::error(),
                message: format!("[script] {error}"),
            });
        }

        let outputs = host.drain_outputs();
        self.drain_script_host_outputs(outputs, result);
    }

    fn stop_script_host(&mut self, result: &mut UpdateResult) {
        let Some(mut host) = self.take_script_host() else {
            return;
        };

        self.dispatch_script_event_to_host(
            None,
            &mut host,
            ScriptEvent::Lifecycle(ScriptLifecycleEvent::Stopped),
            result,
        );
        host.shutdown();
    }

    pub(crate) fn run_script_command(&mut self, basename: &str, result: &mut UpdateResult) {
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

        let loaded_path = match &source {
            DeferredScriptSource::Path(path) => path.display().to_string(),
            DeferredScriptSource::Inline(source) => source.name.clone(),
        };

        self.set_pending_script_source(Some(source));
        self.stop_script_host(result);
        self.start_script_host_if_needed(None, result);

        if self.script_host_is_running() {
            result.actions.push(AppAction::Log {
                chat_tags: ChatMessageTags::info(),
                message: format!("[script] Loaded {loaded_path}"),
            });
        }

        result.request_redraw(crate::types::RedrawPriority::Immediate);
    }

    pub(crate) fn unrun_script_command(&mut self, result: &mut UpdateResult) {
        let had_pending = self.pending_script_source().is_some();
        self.set_pending_script_source(None);
        let had_running = self.script_host_is_running();
        self.stop_script_host(result);

        let message = if had_running || had_pending {
            "[script] Stopped active script"
        } else {
            "[script] No active or queued script to stop"
        };

        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::info(),
            message: message.to_string(),
        });
        result.request_redraw(crate::types::RedrawPriority::Immediate);
    }

    fn start_script_host_if_needed(
        &mut self,
        server_time: Option<(f64, Instant)>,
        result: &mut UpdateResult,
    ) {
        if self.script_host_is_running() || !self.script_player_entity_is_ready() {
            return;
        }

        let Some(source) = self.pending_script_source().cloned() else {
            return;
        };

        let source = match resolve_deferred_script_source(&source) {
            Ok(source) => source,
            Err(error) => {
                self.set_pending_script_source(None);
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] Failed to load script source: {error}"),
                });
                return;
            }
        };

        let view = script_client_view(self, server_time);
        match ScriptHost::spawn(source, &view) {
            Ok(mut host) => {
                self.dispatch_script_event_to_host(
                    server_time,
                    &mut host,
                    ScriptEvent::Lifecycle(ScriptLifecycleEvent::Started),
                    result,
                );
                self.store_script_host(host);
            }
            Err(error) => {
                self.set_pending_script_source(None);
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] Failed to start script host: {error}"),
                });
            }
        }
    }

    fn compile_script_intent(&self, intent: ScriptIntent) -> Result<AppAction> {
        match intent {
            ScriptIntent::Log { level, message } => Ok(AppAction::Log {
                chat_tags: chat_tags_for_level(level),
                message,
            }),
            ScriptIntent::Say { message } => Ok(AppAction::SendCommands {
                commands: vec![ClientCommand::Talk(message)],
            }),
            ScriptIntent::Tell { target, message } => Ok(AppAction::SendCommands {
                commands: vec![ClientCommand::Tell { target, message }],
            }),
            ScriptIntent::Use { guid } => Ok(AppAction::Use { guid }),
            ScriptIntent::CastUntargetedSpell { spell_id } => Ok(AppAction::CastSpell {
                spell_id,
                target: None,
            }),
            ScriptIntent::CastTargetedSpell { target, spell_id } => Ok(AppAction::CastSpell {
                spell_id,
                target: Some(target),
            }),
            ScriptIntent::RespondToConfirmation { accepted } => {
                if self.view.active_confirmation.is_some() {
                    return Ok(AppAction::SendCommands {
                        commands: vec![ClientCommand::RespondToConfirmation { accepted }],
                    });
                }

                if self.view.local_confirmation.is_some() {
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
            ScriptIntent::Client(intent) => match intent {
                ScriptClientIntent::TargetEntity { guid } => Ok(AppAction::BeginInteraction {
                    interaction: Interaction::Targeting { target_guid: guid },
                }),
                ScriptClientIntent::Approach { guid } => Ok(AppAction::Approach { guid }),
                ScriptClientIntent::Follow { guid } => Ok(AppAction::Follow { guid }),
                ScriptClientIntent::CancelInteraction => Ok(AppAction::CancelInteraction),
                ScriptClientIntent::Attack { guid } => anyhow::bail!(
                    "script attack intent is not wired in the TUI yet; target first and let existing combat policy drive attacks (guid {guid})"
                ),
            },
        }
    }

    fn drain_script_host_outputs(&self, outputs: Vec<ScriptIntent>, result: &mut UpdateResult) {
        for intent in outputs {
            match self.compile_script_intent(intent) {
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
        let host_was_running = self.script_host_is_running();
        let should_run_after = self.pending_script_source().is_some();

        if !host_was_running && should_run_after {
            self.start_script_host_if_needed(server_time, result);
        }

        let Some(mut host) = self.take_script_host() else {
            return;
        };

        if let Some(script_event) = script_event_from_view_event(event) {
            self.dispatch_script_event_to_host(server_time, &mut host, script_event, result);
        }

        let after_workflow = workflow_projection(Some(self));
        for workflow_event in workflow_events(before_workflow, &after_workflow) {
            self.dispatch_script_event_to_host(
                server_time,
                &mut host,
                ScriptEvent::Workflow(workflow_event),
                result,
            );
        }

        if should_run_after {
            self.store_script_host(host);
        } else {
            self.dispatch_script_event_to_host(
                server_time,
                &mut host,
                ScriptEvent::Lifecycle(ScriptLifecycleEvent::Stopped),
                result,
            );
            host.shutdown();
        }
    }

    pub(crate) fn sync_script_host_for_tick(
        &mut self,
        server_time: Option<(f64, Instant)>,
        elapsed: f64,
        result: &mut UpdateResult,
    ) {
        let host_was_running = self.script_host_is_running();
        let should_run_after = self.pending_script_source().is_some();

        if !host_was_running && should_run_after {
            self.start_script_host_if_needed(server_time, result);
        }

        let Some(mut host) = self.take_script_host() else {
            return;
        };

        self.dispatch_script_event_to_host(
            server_time,
            &mut host,
            ScriptEvent::Lifecycle(ScriptLifecycleEvent::Tick {
                elapsed_seconds: elapsed,
            }),
            result,
        );

        if should_run_after {
            self.store_script_host(host);
        } else {
            host.shutdown();
        }
    }

    pub(crate) fn script_workflow_projection(&self) -> WorkflowProjection {
        workflow_projection(Some(self))
    }
}

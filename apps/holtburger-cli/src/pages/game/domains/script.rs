use super::*;

use crate::scripting::{load_script_source_for_basename, script_storage_for_name};
use crate::types::AppNotification;
use holtburger_scripting::ScriptHost;
use std::time::Duration;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::RunScript { basename, args } => {
            let mut result = UpdateResult::new();
            state.run_script_command(&basename, args, &mut result);
            result
        }
        AppAction::ScriptCommand { msg } => {
            let mut result = UpdateResult::new();
            let Some(host) = state.script.host.as_ref() else {
                log::error!("Ignoring /script command because no script is running: {msg}");
                result.request_redraw(RedrawPriority::Immediate);
                return result;
            };
            host.send_command(msg);
            result.request_redraw(RedrawPriority::Immediate);
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

    pub(crate) fn stop_script_host(&mut self) {
        if let Some(host) = self.script.host.take() {
            host.request_stop();
        }
        self.script.tick_accumulator = Duration::ZERO;
        self.script.running_source_name = None;
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
            result.request_redraw(RedrawPriority::Immediate);
            return;
        }

        let (Some(engine), Some(rt_handle)) = (
            self.script.live_api.clone(),
            self.script.rt_handle.clone(),
        ) else {
            result.actions.push(AppAction::Log {
                chat_tags: ChatMessageTags::error(),
                message: "[script] Live API engine is not attached to this session".to_string(),
            });
            result.request_redraw(RedrawPriority::Immediate);
            return;
        };

        let source = match load_script_source_for_basename(&self.script.directories, basename) {
            Ok(source) => source,
            Err(error) => {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] {error}"),
                });
                result.request_redraw(RedrawPriority::Immediate);
                return;
            }
        };

        let running_source_name = source.name.clone();
        let storage = script_storage_for_name(&self.script.directories, &running_source_name);

        if self.script_host_is_running() {
            self.stop_script_host();
        }

        match ScriptHost::spawn(
            source,
            args,
            engine,
            rt_handle,
            self.script.host_config.clone(),
            storage,
        ) {
            Ok(host) => {
                self.script.running_source_name = Some(running_source_name.clone());
                self.script.host = Some(host);
                self.script.tick_accumulator = Duration::ZERO;
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::info(),
                    message: format!("[script] Loaded {running_source_name}"),
                });
            }
            Err(error) => {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::error(),
                    message: format!("[script] Failed to start script host: {error}"),
                });
            }
        }

        result.request_redraw(RedrawPriority::Immediate);
    }

    pub(crate) fn unrun_script_command(&mut self, result: &mut UpdateResult) {
        let had_queued_startup = self.script.queued_script_startup.take().is_some();
        let had_running = self.script_host_is_running();
        self.stop_script_host();

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
        result.request_redraw(RedrawPriority::Immediate);
    }

    pub(crate) fn sync_script_host_for_tick(&mut self, elapsed: f64, result: &mut UpdateResult) {
        let Some(host) = self.script.host.as_ref() else {
            return;
        };

        if let Some(error) = host.take_last_error() {
            result.actions.push(AppAction::Log {
                chat_tags: ChatMessageTags::error(),
                message: format!("[script] {error}"),
            });
            result.request_redraw(RedrawPriority::Immediate);
        }

        if elapsed > 0.0 {
            self.script.tick_accumulator += Duration::from_secs_f64(elapsed);
        }

        while self.script.tick_accumulator >= crate::pages::game::state::SCRIPT_TICK_INTERVAL {
            self.script.tick_accumulator -= crate::pages::game::state::SCRIPT_TICK_INTERVAL;
            host.tick(crate::pages::game::state::SCRIPT_TICK_INTERVAL.as_secs_f64());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::GameState;
    use crate::state::QueuedScriptStartup;
    use crate::types::{AppAction, AppNotification, UpdateResult};
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_world::entity::Entity;

    #[test]
    fn queued_script_startup_runs_once_player_entity_is_ready() {
        let player_guid = Guid(0x5000_0001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), WorldPosition::default()),
        );
        state.script.queued_script_startup =
            Some(QueuedScriptStartup::new("missing-script", "arg1"));

        let mut result = UpdateResult::new();
        state.maybe_start_queued_script_startup(&mut result);

        assert!(state.script.queued_script_startup.is_none());
        assert!(result.actions.iter().any(|action| matches!(
            action,
            AppAction::Log { message, .. } if message.contains("[script]")
        )));
    }

    #[test]
    fn player_entity_ready_notification_triggers_queued_script() {
        let player_guid = Guid(0x5000_0001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), WorldPosition::default()),
        );
        state.script.queued_script_startup =
            Some(QueuedScriptStartup::new("missing-script", ""));

        let result = state
            .handle_action(AppAction::Notification {
                notification: AppNotification::PlayerEntityReady { guid: player_guid },
            })
            .expect("notification should reduce");

        assert!(state.script.queued_script_startup.is_none());
        assert!(result.actions.iter().any(|action| matches!(
            action,
            AppAction::Log { message, .. } if message.contains("[script]")
        )));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bundled_fighter_and_mage_scripts_boot_and_tick_over_live_api() {
        use holtburger_common::properties::{ItemType, ObjectDescriptionFlag, PropertyInt};
        use holtburger_core::ClientRuntime;
        use holtburger_live_api::{LiveApiEngine, LiveApiEngineConfig};
        use holtburger_scripting::{ScriptHost, ScriptHostConfig, ScriptSource, ScriptStorage};
        use std::sync::Arc;

        let mut client = ClientRuntime::synthetic_in_world("acct", Some("World".into()));
        let player_guid = Guid(0x5000_0001);
        {
            let world = client.world_mut();
            world.player.guid = player_guid;
            let mut player = Entity::new(player_guid, "Bot".into(), WorldPosition::default());
            player.flags = ObjectDescriptionFlag::PLAYER;
            player
                .properties
                .ints
                .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            world.entities.insert(player);
        }
        let handle = client.create_handle();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let rt_task = tokio::spawn(client.run_synthetic(shutdown_rx));

        let selection = Arc::new(crate::live_api::TuiSelectionState::default());
        let (event_tx, _event_rx) = tokio::sync::mpsc::unbounded_channel();
        let ui = Arc::new(crate::live_api::TuiUiHook::new(selection, event_tx));
        let engine = LiveApiEngine::start(
            handle,
            LiveApiEngineConfig {
                client_kind: "holtburger-cli",
                catalogs: None,
                ui: Some(ui),
                hud: None,
            },
        );

        for (name, source) in [
            ("fighter.js", include_str!("../../../../scripts/fighter.js")),
            ("mage.js", include_str!("../../../../scripts/mage.js")),
        ] {
            let host = ScriptHost::spawn(
                ScriptSource::new(name, source),
                String::new(),
                engine.clone(),
                tokio::runtime::Handle::current(),
                ScriptHostConfig::default(),
                ScriptStorage::default(),
            )
            .unwrap_or_else(|err| panic!("{name} failed to spawn: {err}"));

            host.tick(0.1);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let error = host.take_last_error();
            assert!(
                error.is_none(),
                "{name} produced a runtime error on tick: {error:?}"
            );
            host.stop();
        }

        let _ = shutdown_tx.send(());
        let _ = rt_task.await;
    }
}

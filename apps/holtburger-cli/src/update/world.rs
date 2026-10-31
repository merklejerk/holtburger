use crate::pages::selection::creation::CharacterCreationState;
use crate::pages::selection::{CharacterDashboardEntry, SelectionState};
use crate::state::AppState;
use crate::state::EventContext;
use crate::types::{Page, UpdateResult};
use holtburger_core::{ClientCommand, ClientState, ClientViewEvent};
use std::sync::Arc;

impl AppState {
    /// One roster projection serves initial selection, entry refusal, and snapshot recovery.
    fn restore_selection(
        &mut self,
        mut characters: Vec<CharacterDashboardEntry>,
        rejection: Option<String>,
    ) {
        characters.sort_by_key(|entry| entry.character.name.to_lowercase());
        if let Page::Selection(selection) = &mut self.page {
            let selected = selection
                .selected_character()
                .map(|entry| entry.character.guid);
            selection.characters = characters;
            selection.selected_character_index = selected
                .and_then(|guid| {
                    selection
                        .characters
                        .iter()
                        .position(|entry| entry.character.guid == guid)
                })
                .unwrap_or(0);
            selection.entry_rejection = rejection;
            return;
        }
        let character_preference = self
            .character_preference
            .take()
            .filter(|_| rejection.is_none());
        self.page = Page::Selection(Box::new(SelectionState {
            characters,
            selected_character_index: 0,
            character_preference,
            account_name: self.account_name.clone(),
            screen: Default::default(),
            creation: self
                .character_gen_catalog
                .as_ref()
                .map_or_else(CharacterCreationState::default, |catalog| {
                    CharacterCreationState::from_catalog(Arc::clone(catalog))
                }),
            delete_confirmation: None,
            entry_rejection: rejection,
        }));
    }

    fn apply_client_lifecycle(
        &mut self,
        lifecycle: &holtburger_core::ClientLifecycleState,
        result: &mut UpdateResult,
    ) {
        match lifecycle {
            holtburger_core::ClientLifecycleState::CharacterSelection {
                characters,
                rejection,
                ..
            } => {
                self.client_state = ClientState::CharacterSelection;
                self.restore_selection(
                    characters
                        .iter()
                        .map(|character| CharacterDashboardEntry {
                            slot: character.slot,
                            character: holtburger_protocol::messages::CharacterEntry {
                                guid: character.guid,
                                name: character.name.clone(),
                                delete_time: character.delete_time,
                            },
                        })
                        .collect(),
                    rejection.as_ref().map(ToString::to_string),
                );
                result.merge(UpdateResult::redraw());
            }
            holtburger_core::ClientLifecycleState::Exiting { outcome } => {
                self.client_state = ClientState::Disconnected;
                self.remember_disconnect_reason(outcome.diagnostic());
                self.request_disconnect_exit();
                if !self.should_exit_on_disconnect() {
                    self.log(
                        crate::types::ChatMessageTags::error(),
                        self.current_disconnect_chat_message(),
                    );
                }
                result.merge(UpdateResult::redraw());
            }
            _ => {}
        }
    }

    fn handle_setup_event(&mut self, event: &ClientViewEvent, result: &mut UpdateResult) {
        match event {
            ClientViewEvent::ApplicationSnapshot(snapshot) => {
                self.apply_client_lifecycle(&snapshot.lifecycle, result)
            }
            ClientViewEvent::LifecycleChanged(lifecycle) => {
                self.apply_client_lifecycle(lifecycle, result)
            }
            ClientViewEvent::WorldNameUpdated(name) => {
                self.world_name = name.clone();
                if let Page::Game(ref mut game) = self.page {
                    game.data.world_name = name.clone();
                }
            }
            ClientViewEvent::CharacterList(chars) => {
                // Lifecycle owns refusal lifetime; a broad roster notification must not erase it.
                let rejection = match &self.page {
                    Page::Selection(selection) => selection.entry_rejection.clone(),
                    _ => None,
                };
                self.restore_selection(
                    chars
                        .iter()
                        .cloned()
                        .enumerate()
                        .map(|(slot, character)| CharacterDashboardEntry {
                            slot: slot as u32,
                            character,
                        })
                        .collect(),
                    rejection,
                );
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                self.server_time = Some((*time, std::time::Instant::now()))
            }
            _ => {}
        }
    }

    fn handle_client_status_event(&mut self, event: &ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        if let ClientViewEvent::StatusUpdate { state } = event {
            let was_in_world = self.client_state == ClientState::InWorld;
            self.client_state = state.clone();
            match self.client_state {
                ClientState::Disconnected => {
                    self.request_disconnect_exit();
                    if !self.should_exit_on_disconnect() && self.disconnect_reason.is_some() {
                        log::error!("{}", self.current_disconnect_chat_message());
                    }
                }
                _ => {
                    self.clear_disconnect_reason();
                }
            }

            if self.client_state == ClientState::InWorld && !was_in_world {
                result
                    .commands
                    .push(ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true });
            }
        }
        result
    }

    pub(super) fn handle_client_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        // Handle setup and chat events regardless of being locally in-game
        match &event {
            ClientViewEvent::CharacterList(_)
            | ClientViewEvent::ApplicationSnapshot(_)
            | ClientViewEvent::LifecycleChanged(_)
            | ClientViewEvent::ServerTimeUpdated { .. }
            | ClientViewEvent::WorldNameUpdated(_) => {
                self.handle_setup_event(&event, &mut result);
            }

            _ => {}
        }

        // Skip other events if not in-game, unless it's a StatusUpdate or ActionResult
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::CharacterList(_)
                | ClientViewEvent::WorldNameUpdated(_)
                | ClientViewEvent::CharacterManagementResponse { .. }
                | ClientViewEvent::CharacterDeleteResponse
                | ClientViewEvent::StatusUpdate { .. }
                | ClientViewEvent::ActionResult { .. }
                | ClientViewEvent::LogMessage(_)
                | ClientViewEvent::TransientString { .. }
                | ClientViewEvent::PopupString { .. }
                | ClientViewEvent::ServerMessage { .. }
                | ClientViewEvent::Chat { .. }
                | ClientViewEvent::ChannelMessage { .. }
                | ClientViewEvent::Tell { .. }
                | ClientViewEvent::ChatError { .. }
                | ClientViewEvent::Emote { .. }
                | ClientViewEvent::SoulEmote { .. }
                | ClientViewEvent::ItemManaResponse { .. }
                | ClientViewEvent::PingResponse
                | ClientViewEvent::ConnectionUpdated(_)
        ) && self.game_option().is_none()
        {
            return result;
        }

        let ctx = EventContext {
            server_time: self.server_time,
        };

        match event {
            ClientViewEvent::ConnectionUpdated(sample) => {
                self.net_stats.history_in.rotate_left(1);
                if let Some(last) = self.net_stats.history_in.last_mut() {
                    *last = sample.receive_bytes_per_second.round() as u64;
                }
                self.net_stats.history_out.rotate_left(1);
                if let Some(last) = self.net_stats.history_out.last_mut() {
                    *last = sample.send_bytes_per_second.round() as u64;
                }
                result.merge(
                    self.page
                        .handle_view_event(ClientViewEvent::ConnectionUpdated(sample), &ctx),
                );
            }
            ClientViewEvent::StatusUpdate { .. } | ClientViewEvent::ActionResult { .. } => {
                result.merge(self.handle_client_status_event(&event));
                result.merge(self.page.handle_view_event(event, &ctx));
            }
            ClientViewEvent::BusyOperationFinished {
                operation,
                result: busy_result,
            } => {
                result.merge(self.page.handle_view_event(
                    ClientViewEvent::BusyOperationFinished {
                        operation,
                        result: busy_result,
                    },
                    &ctx,
                ));
            }
            _ => {
                // All other entity, player, trade, and combat events delegate completely!
                result.merge(self.page.handle_view_event(event, &ctx));
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::NetStats;
    use crate::types::{AppAction, ChatMessageTags, Page};
    use holtburger_core::ActionResultReason;
    use holtburger_scripting::ScriptHostConfig;

    fn build_test_app_state(client_state: ClientState) -> AppState {
        AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Selection(Box::default()),
            client_state,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: None,
            character_gen_catalog: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            queued_script_startup: None,
            script_host_config: ScriptHostConfig::default(),
        }
    }

    #[test]
    fn entering_world_subscribes_to_fellowship_updates() {
        let mut app_state = build_test_app_state(ClientState::EnteringWorld);

        let result = app_state.handle_client_view_event(ClientViewEvent::StatusUpdate {
            state: ClientState::InWorld,
        });

        assert!(matches!(app_state.client_state, ClientState::InWorld));
        assert_eq!(result.commands.len(), 1);
        assert!(matches!(
            result.commands[0],
            ClientCommand::SetFellowshipUpdatesSubscribed { enabled: true }
        ));
    }

    #[test]
    fn repeated_in_world_status_does_not_resubscribe() {
        let mut app_state = build_test_app_state(ClientState::InWorld);

        let result = app_state.handle_client_view_event(ClientViewEvent::StatusUpdate {
            state: ClientState::InWorld,
        });

        assert!(result.commands.is_empty());
    }

    #[test]
    fn retained_server_failure_drives_disconnect() {
        for quit in [false, true] {
            let mut app_state = build_test_app_state(ClientState::InWorld);
            app_state.quit_on_disconnect = quit;
            app_state.page = Page::Game(Box::new(crate::pages::game::GameState::new(
                holtburger_common::Guid(0x5000_0001),
                "Player".into(),
                "World".into(),
            )));
            let outcome = holtburger_core::ClientExitOutcome {
                cause: holtburger_core::ClientExitCause::ServerDisconnect,
                failure: Some(holtburger_core::ConnectionFailure {
                    state: Some(ClientState::InWorld),
                    cause: holtburger_core::ConnectionFailureCause::AccountBoot(Some(
                        "Server maintenance".into(),
                    )),
                }),
            };
            app_state.handle_client_view_event(ClientViewEvent::LifecycleChanged(
                holtburger_core::ClientLifecycleState::Exiting {
                    outcome: outcome.clone(),
                },
            ));
            assert_eq!(
                app_state.take_pending_exit_message(),
                quit.then(|| outcome.diagnostic())
            );
            assert_eq!(
                app_state.disconnect_reason.as_deref(),
                Some(outcome.diagnostic().as_str())
            );
            if !quit {
                let game = app_state
                    .game_option()
                    .expect("disconnect retains game page");
                assert_eq!(
                    game.chat.messages.last().unwrap().text,
                    format!("Disconnected: {}", outcome.diagnostic())
                );
            }
        }
    }

    #[test]
    fn entry_refusal_rebuilds_selection_from_the_game_page() {
        let mut app_state = build_test_app_state(ClientState::EnteringWorld);
        let guid = holtburger_common::Guid(0x5000_1234);
        app_state.page = Page::Game(Box::new(crate::pages::game::GameState::new(
            guid,
            "Mira".into(),
            "World".into(),
        )));
        let rejection = holtburger_core::ConnectionFailure {
            state: Some(ClientState::EnteringWorld),
            cause: holtburger_core::ConnectionFailureCause::Character(
                holtburger_core::CharacterErrorCode::Known(
                    holtburger_protocol::errors::CharacterError::EnterGameCharacterInWorld,
                ),
            ),
        };
        app_state.handle_client_view_event(ClientViewEvent::LifecycleChanged(
            holtburger_core::ClientLifecycleState::CharacterSelection {
                max_slots: 11,
                characters: vec![holtburger_core::ClientCharacterSummary {
                    guid,
                    name: "Mira".into(),
                    slot: 0,
                    delete_time: 0,
                }],
                rejection: Some(rejection.clone()),
            },
        ));
        let Page::Selection(selection) = &app_state.page else {
            panic!("entry refusal must restore selection")
        };
        assert_eq!(selection.entry_rejection, Some(rejection.to_string()));
        assert!(selection.character_preference.is_none());
        assert_eq!(selection.selected_character().unwrap().character.guid, guid);
    }
    #[test]
    fn roster_notification_preserves_the_authoritative_entry_refusal() {
        let mut app_state = build_test_app_state(ClientState::EnteringWorld);
        let rejection = holtburger_core::ConnectionFailure {
            state: Some(ClientState::EnteringWorld),
            cause: holtburger_core::ConnectionFailureCause::Character(
                holtburger_core::CharacterErrorCode::Known(
                    holtburger_protocol::errors::CharacterError::EnterGameCharacterInWorld,
                ),
            ),
        };
        app_state.handle_client_view_event(ClientViewEvent::LifecycleChanged(
            holtburger_core::ClientLifecycleState::CharacterSelection {
                max_slots: 11,
                characters: vec![],
                rejection: Some(rejection.clone()),
            },
        ));
        app_state.handle_client_view_event(ClientViewEvent::CharacterList(vec![]));
        let Page::Selection(selection) = &app_state.page else {
            panic!("expected selection")
        };
        assert_eq!(selection.entry_rejection, Some(rejection.to_string()));
    }
    #[test]
    fn missing_spell_components_are_surfaced_in_chat() {
        let mut app_state = build_test_app_state(ClientState::InWorld);
        app_state.page = Page::Game(Box::new(crate::pages::game::GameState::new(
            holtburger_common::Guid(0x50000001),
            "Player".to_string(),
            "World".to_string(),
        )));

        let result = app_state.handle_client_view_event(ClientViewEvent::ActionResult {
            source: holtburger_core::client::types::ActionResultSource::Wire,
            reason: ActionResultReason::Weenie(
                holtburger_protocol::errors::WeenieError::YouDontHaveAllTheComponents,
                None,
            ),
        });

        assert!(result.commands.is_empty());
        assert_eq!(result.actions.len(), 1);
        match &result.actions[0] {
            AppAction::Log { chat_tags, message } => {
                assert_eq!(*chat_tags, ChatMessageTags::error());
                assert_eq!(message, "You don't have all the components.");
            }
            other => panic!("expected chat log action, got {:?}", other),
        }
    }
}

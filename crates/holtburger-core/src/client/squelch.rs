//! Shared ignore commands and publication; no refresh or optimistic authority.

use super::types::ClientViewEvent;
use super::{ClientRuntime, ClientState};
use anyhow::{Result, bail};
use holtburger_common::Guid;
use holtburger_protocol::messages::{
    ChatMessageType, GameAction, ModifyAccountSquelchActionData, ModifyCharacterSquelchActionData,
};
use holtburger_world::state::squelch::{SquelchScope, SquelchState};

impl ClientRuntime {
    /// ACE omits the DB at empty login. Establish the empty baseline before early packets.
    pub(super) fn begin_squelch(&mut self) {
        self.world.squelch = Some(SquelchState::default());
        self.emit_squelch_state_updated();
    }
    /// Retire only on character/session exit, never on portal or player description.
    pub(super) fn reset_squelch(&mut self) {
        self.world.squelch = None;
        self.emit_squelch_state_updated();
    }
    /// Recovery publishes retained facts; it does not fetch a server list.
    pub(super) fn emit_squelch_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SquelchStateUpdated {
                squelch: self.world.squelch.clone(),
            });
    }
    /// Add an all-channel restriction through server name resolution.
    pub(super) async fn add_ignore(&mut self, name: String, scope: SquelchScope) -> Result<()> {
        self.modify_squelch(true, Guid(0), name, scope).await
    }
    /// Remove the explicitly requested basic scope using retained identity metadata.
    pub(super) async fn remove_ignore(&mut self, guid: Guid, scope: SquelchScope) -> Result<()> {
        let Some(record) = self
            .world
            .squelch
            .as_ref()
            .and_then(|db| db.characters.get(&guid))
        else {
            bail!("Ignore entry is unavailable");
        };
        if record.management().removal_scope != Some(scope) {
            bail!("Ignore scope cannot be removed by this action");
        }
        self.modify_squelch(false, guid, record.name.clone(), scope)
            .await
    }
    async fn modify_squelch(
        &mut self,
        enabled: bool,
        guid: Guid,
        name: String,
        scope: SquelchScope,
    ) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Ignores can only be changed while in world");
        }
        let name = name.trim();
        if name.is_empty() {
            bail!("Ignore character name is empty");
        }
        let action = match scope {
            SquelchScope::Account => {
                GameAction::ModifyAccountSquelch(Box::new(ModifyAccountSquelchActionData {
                    enabled,
                    name: name.into(),
                }))
            }
            SquelchScope::Character => {
                GameAction::ModifyCharacterSquelch(Box::new(ModifyCharacterSquelchActionData {
                    enabled,
                    guid,
                    name: name.into(),
                    message_type: ChatMessageType::AllChannels as u32,
                }))
            }
        };
        self.send_game_action(action).await
    }
}

#[cfg(test)]
mod tests {
    use super::super::{builder, types::ClientCommand};
    use super::*;
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, SetSquelchDbEventData, SquelchInfo,
    };
    use holtburger_protocol::traits::ProtocolPack;

    #[tokio::test]
    async fn squelch_early_delivery_empty_login_recovery_portals_and_retirement() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let player = Guid(0x50000001);
        client.character_selection.character_id = Some(player);
        client.begin_world_entry_transition().await.unwrap();
        client.state = ClientState::EnteringWorld;
        assert_eq!(
            client.application_snapshot().squelch,
            Some(SquelchState::default())
        );
        let db = SetSquelchDbEventData {
            characters: vec![(
                Guid(42),
                SquelchInfo {
                    words: vec![u32::MAX; 4],
                    name: "Amy".into(),
                    account: true,
                },
            )],
            ..Default::default()
        };
        let mut bytes = vec![];
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: player,
            sequence: 1,
            event: GameEvent::SetSquelchDb(Box::new(db)),
        }))
        .pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        let accepted = client.application_snapshot().squelch.unwrap();
        assert!(accepted.characters[&Guid(42)].account);
        let mut receiver = client.client_view_event_tx.subscribe();
        client.emit_squelch_state_updated();
        assert!(
            matches!(receiver.try_recv().unwrap(), ClientViewEvent::SquelchStateUpdated { squelch: Some(db) } if db == accepted)
        );
        client.state = ClientState::InWorld;
        client.bump_world_generation();
        client.send_status_event();
        assert_eq!(client.application_snapshot().squelch, Some(accepted));
        client.state = ClientState::Disconnected;
        client.send_status_event();
        assert!(client.application_snapshot().squelch.is_none());
        client.handle_message(&bytes).await.unwrap();
        assert!(client.application_snapshot().squelch.is_none());
        client.state = ClientState::EnteringWorld;
        client.begin_world_entry_transition().await.unwrap();
        assert_eq!(
            client.application_snapshot().squelch,
            Some(SquelchState::default())
        );
    }
    #[tokio::test]
    async fn squelch_commands_require_world_and_retained_scope_without_optimistic_changes() {
        use holtburger_world::state::squelch::{SquelchFilter, SquelchRecord};
        let mut client = builder::build_test_client(ClientState::Connected);
        assert!(
            client
                .handle_command(ClientCommand::AddIgnore {
                    name: "Amy".into(),
                    scope: SquelchScope::Account
                })
                .await
                .is_err()
        );
        client.state = ClientState::InWorld;
        assert!(
            client
                .handle_command(ClientCommand::AddIgnore {
                    name: " ".into(),
                    scope: SquelchScope::Character
                })
                .await
                .is_err()
        );
        client.begin_squelch();
        let record = SquelchRecord {
            name: "Amy".into(),
            account: true,
            filter: SquelchFilter {
                words: vec![8, 8, 8, 8],
            },
        };
        client
            .world
            .squelch
            .as_mut()
            .unwrap()
            .characters
            .insert(Guid(42), record);
        assert!(
            client
                .handle_command(ClientCommand::RemoveIgnore {
                    guid: Guid(42),
                    scope: SquelchScope::Character
                })
                .await
                .is_err()
        );
        assert!(
            client
                .handle_command(ClientCommand::RemoveIgnore {
                    guid: Guid(99),
                    scope: SquelchScope::Account
                })
                .await
                .is_err()
        );
        client.world.squelch.as_mut().unwrap().characters.insert(
            Guid(43),
            SquelchRecord {
                name: "Ben".into(),
                account: false,
                filter: SquelchFilter {
                    words: vec![u32::MAX; 4],
                },
            },
        );
        let before = client.application_snapshot().squelch;
        for scope in [SquelchScope::Account, SquelchScope::Character] {
            client
                .handle_command(ClientCommand::AddIgnore {
                    name: " Amy ".into(),
                    scope,
                })
                .await
                .unwrap();
        }
        client
            .handle_command(ClientCommand::RemoveIgnore {
                guid: Guid(42),
                scope: SquelchScope::Account,
            })
            .await
            .unwrap();
        client
            .handle_command(ClientCommand::RemoveIgnore {
                guid: Guid(43),
                scope: SquelchScope::Character,
            })
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 4);
        assert_eq!(client.application_snapshot().squelch, before);
    }
}

//! Shared friend mutation and publication behavior; world owns list reconciliation.

use super::types::ClientViewEvent;
use super::{ClientRuntime, ClientState};
use anyhow::{Result, bail};
use holtburger_common::Guid;
use holtburger_protocol::messages::{AddFriendActionData, GameAction, RemoveFriendActionData};

impl ClientRuntime {
    /// Reset at character entry/retirement, never on portal or player description.
    pub(super) fn reset_friends(&mut self) {
        self.world.friends = None;
        self.emit_friends_state_updated();
    }

    /// Publish the retained list; this does not request a fresh server list.
    pub(super) fn emit_friends_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::FriendsStateUpdated {
                friends: self.world.friends.clone(),
            });
    }

    /// Queue a name-based add without claiming server acceptance or mutating membership.
    pub(super) async fn add_friend(&mut self, name: String) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Friends can only be changed while in world");
        }
        let name = name.trim();
        if name.is_empty() {
            bail!("Friend name is empty");
        }
        self.send_game_action(GameAction::AddFriend(Box::new(AddFriendActionData {
            name: name.into(),
        })))
        .await
    }

    /// Queue removal by the retained server identity.
    pub(super) async fn remove_friend(&mut self, guid: Guid) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Friends can only be changed while in world");
        }
        self.send_game_action(GameAction::RemoveFriend(Box::new(RemoveFriendActionData {
            guid,
        })))
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::builder;
    use super::*;
    use holtburger_protocol::messages::{
        FriendData, FriendsListUpdateEventData, FriendsUpdateType, GameEvent, GameEventMessage,
        GameMessage,
    };
    use holtburger_protocol::traits::ProtocolPack;

    #[tokio::test]
    async fn friends_commands_dispatch_without_mutating_retained_membership() {
        use super::super::types::ClientCommand;
        let mut client = builder::build_test_client(ClientState::Connected);
        assert!(
            client
                .handle_command(ClientCommand::AddFriend { name: "Amy".into() })
                .await
                .is_err()
        );
        client.state = ClientState::InWorld;
        assert!(
            client
                .handle_command(ClientCommand::AddFriend { name: "  ".into() })
                .await
                .is_err()
        );
        assert_eq!(client.session.game_action_sequence, 0);
        client
            .handle_command(ClientCommand::AddFriend {
                name: " Amy ".into(),
            })
            .await
            .unwrap();
        client
            .handle_command(ClientCommand::RemoveFriend { guid: Guid(42) })
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
        assert!(client.world.friends.is_none());
    }

    #[tokio::test]
    async fn friends_early_delivery_recovery_portals_and_retirement() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let player = Guid(0x50000001);
        client.character_selection.character_id = Some(player);
        client.begin_world_entry_transition().await.unwrap();
        client.state = ClientState::EnteringWorld;
        assert!(client.application_snapshot().friends.is_none());
        let mut encoded = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: player,
            sequence: 1,
            event: GameEvent::FriendsListUpdate(Box::new(FriendsListUpdateEventData {
                friends: vec![FriendData {
                    guid: Guid(0x50000042),
                    name: "Amy".into(),
                    online: true,
                    appear_offline: false,
                    friends: vec![],
                    friend_of: vec![],
                }],
                update_type: FriendsUpdateType::Full,
            })),
        }))
        .pack(&mut encoded);
        client.handle_message(&encoded).await.unwrap();
        let accepted = client.application_snapshot().friends.unwrap();
        assert_eq!(accepted.members[&Guid(0x50000042)].name, "Amy");
        let mut receiver = client.client_view_event_tx.subscribe();
        client.emit_friends_state_updated();
        assert!(
            matches!(receiver.try_recv().unwrap(), ClientViewEvent::FriendsStateUpdated { friends: Some(friends) } if friends == accepted)
        );
        client.state = ClientState::InWorld;
        client.bump_world_generation();
        client.send_status_event();
        assert_eq!(client.application_snapshot().friends, Some(accepted));
        client.state = ClientState::Disconnected;
        client.send_status_event();
        assert!(client.application_snapshot().friends.is_none());
        client.handle_message(&encoded).await.unwrap();
        assert!(client.application_snapshot().friends.is_none());
        client.state = ClientState::EnteringWorld;
        client.handle_message(&encoded).await.unwrap();
        client.begin_world_entry_transition().await.unwrap();
        assert!(client.application_snapshot().friends.is_none());
    }
}

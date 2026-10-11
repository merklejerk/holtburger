//! Shared journal publication and server-confirmed abandonment dispatch.

use super::types::ClientViewEvent;
use super::{ClientRuntime, ClientState};
use anyhow::{Result, bail};
use holtburger_protocol::messages::{AbandonContractActionData, GameAction};
use holtburger_world::state::contracts::{ContractsSnapshot, ContractsState};
use std::time::Instant;

impl ClientRuntime {
    /// ACE omits an empty table; character entry supplies the empty baseline.
    pub(super) fn begin_contracts(&mut self) {
        self.world.contracts = Some(ContractsState::default());
        self.emit_contracts_state_updated();
    }

    /// Character retirement clears facts, while portal travel retains them.
    pub(super) fn reset_contracts(&mut self) {
        self.world.contracts = None;
        self.emit_contracts_state_updated();
    }

    /// Sample timers once for both replacement recovery and incremental delivery.
    pub(super) fn contracts_snapshot(&self) -> Option<ContractsSnapshot> {
        self.world
            .contracts
            .as_ref()
            .map(|state| state.resolve(&self.world.contract_catalog, Instant::now()))
    }

    pub(super) fn emit_contracts_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ContractsStateUpdated {
                contracts: self.contracts_snapshot(),
            });
    }

    /// Queue removal without claiming server acceptance or changing membership.
    pub(super) async fn abandon_contract(&mut self, id: u32) -> Result<()> {
        if self.state != ClientState::InWorld {
            bail!("Contracts can only be removed while in world");
        }
        if !self
            .world
            .contracts
            .as_ref()
            .is_some_and(|state| state.contains(id))
        {
            bail!("Contract {id} is not in the character journal");
        }
        self.send_game_action(GameAction::AbandonContract(Box::new(
            AbandonContractActionData { id },
        )))
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::{builder, types::ClientCommand};
    use super::*;
    use holtburger_common::Guid;
    use holtburger_protocol::messages::{
        ContractStage, ContractTracker, ContractTrackerUpdate, GameEvent, GameEventMessage,
        GameMessage,
    };
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_world::state::contracts::ContractRow;

    fn packet(player: Guid, sequence: u32, delete: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: player,
            sequence,
            event: GameEvent::SendClientContractTracker(Box::new(ContractTrackerUpdate {
                tracker: ContractTracker {
                    version: 0,
                    id: 99,
                    stage: ContractStage::Available,
                    deadline_seconds: 0.0,
                    repeat_seconds: 0.0,
                },
                delete,
                set_as_display: false,
            })),
        }))
        .pack(&mut bytes);
        bytes
    }

    #[tokio::test]
    async fn entry_early_events_portals_recovery_retirement_and_late_delivery() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let player = Guid(0x50000001);
        assert!(client.application_snapshot().contracts.is_none());
        client.character_selection.character_id = Some(player);
        client.begin_world_entry_transition().await.unwrap();
        assert!(
            client
                .application_snapshot()
                .contracts
                .unwrap()
                .rows
                .is_empty()
        );
        client.state = ClientState::EnteringWorld;
        client
            .handle_message(&packet(player, 1, false))
            .await
            .unwrap();
        let accepted = client.application_snapshot().contracts.unwrap();
        assert_eq!(accepted.rows, vec![ContractRow::Unresolved { id: 99 }]);
        client.state = ClientState::InWorld;
        client.bump_world_generation();
        client.send_status_event();
        assert_eq!(client.application_snapshot().contracts, Some(accepted));
        let mut receiver = client.client_view_event_tx.subscribe();
        client.emit_contracts_state_updated();
        assert!(
            matches!(receiver.try_recv().unwrap(), ClientViewEvent::ContractsStateUpdated { contracts: Some(snapshot) } if snapshot.rows == vec![ContractRow::Unresolved { id: 99 }])
        );
        client
            .handle_command(ClientCommand::AbandonContract { id: 99 })
            .await
            .unwrap();
        assert!(client.world.contracts.as_ref().unwrap().contains(99));
        client
            .handle_message(&packet(player, 2, true))
            .await
            .unwrap();
        assert!(!client.world.contracts.as_ref().unwrap().contains(99));
        client.state = ClientState::Disconnected;
        client.send_status_event();
        assert!(client.application_snapshot().contracts.is_none());
        client
            .handle_message(&packet(player, 3, false))
            .await
            .unwrap();
        assert!(client.application_snapshot().contracts.is_none());
    }

    #[tokio::test]
    async fn live_membership_activity_excludes_login_tables_duplicates_and_retirement() {
        use holtburger_world::state::contracts::ContractMembershipChangeKind;
        let mut client = builder::build_test_client(ClientState::Connected);
        let player = Guid(0x50000001);
        client.character_selection.character_id = Some(player);
        client.begin_world_entry_transition().await.unwrap();
        let mut receiver = client.client_view_event_tx.subscribe();
        let drain = |receiver: &mut tokio::sync::broadcast::Receiver<ClientViewEvent>| {
            let mut changes = Vec::new();
            while let Ok(event) = receiver.try_recv() {
                if let ClientViewEvent::ContractMembershipChanged(change) = event {
                    assert_eq!(change.id, 99);
                    assert_eq!(change.name, None);
                    changes.push(change.kind);
                }
            }
            changes
        };
        client.state = ClientState::EnteringWorld;
        client
            .handle_message(&packet(player, 1, false))
            .await
            .unwrap();
        assert!(drain(&mut receiver).is_empty());
        client.state = ClientState::InWorld;
        client
            .handle_message(&packet(player, 2, false))
            .await
            .unwrap();
        assert!(drain(&mut receiver).is_empty());
        client
            .handle_message(&packet(player, 3, true))
            .await
            .unwrap();
        assert_eq!(
            drain(&mut receiver),
            vec![ContractMembershipChangeKind::Removed]
        );
        client
            .handle_message(&packet(player, 4, true))
            .await
            .unwrap();
        assert!(drain(&mut receiver).is_empty());
        client
            .handle_message(&packet(player, 5, false))
            .await
            .unwrap();
        assert_eq!(
            drain(&mut receiver),
            vec![ContractMembershipChangeKind::Added]
        );
        let mut table = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: player,
            sequence: 6,
            event: GameEvent::SendClientContractTrackerTable(Box::new(
                holtburger_protocol::messages::ContractTrackerTable {
                    buckets: 32,
                    trackers: Default::default(),
                },
            )),
        }))
        .pack(&mut table);
        client.handle_message(&table).await.unwrap();
        client.emit_contracts_state_updated();
        client.reset_contracts();
        assert!(drain(&mut receiver).is_empty());
    }

    #[tokio::test]
    async fn invalid_mutation_context_or_identity_does_not_dispatch() {
        let mut client = builder::build_test_client(ClientState::Connected);
        assert!(client.begin_world_entry_transition().await.is_err());
        assert!(client.application_snapshot().contracts.is_none());
        assert!(
            client
                .handle_command(ClientCommand::AbandonContract { id: 99 })
                .await
                .is_err()
        );
        client.state = ClientState::InWorld;
        client.begin_contracts();
        assert!(
            client
                .handle_command(ClientCommand::AbandonContract { id: 99 })
                .await
                .is_err()
        );
        assert_eq!(client.session.game_action_sequence, 0);
    }
}

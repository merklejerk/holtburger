//! Guarded item use: semantic preconditions, not frontend confirmation policy.

use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::game_action::{
    GameAction, UseActionData, UseWithTargetActionData,
};
use holtburger_world::context::WorldContextExt;
use holtburger_world::item_use::{
    ItemUseConsequence, ItemUseEvaluation, ItemUseIntent, evaluate_item_use,
};
use serde::{Deserialize, Serialize};

use super::{ClientRuntime, ClientState, types::ClientViewEvent};

/// Read-only compatibility query for one considered combine target.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemUseTargetQuery {
    /// Caller correlation identity, independent of execution requests.
    pub sequence: u32,
    /// Item being used.
    pub source: Guid,
    /// Entity currently considered as its target.
    pub target: Guid,
}

/// Current public-fact eligibility; this does not reserve or execute an operation.
#[derive(Debug, Clone, Serialize)]
pub struct ItemUseTargetResult {
    /// Original query identity, used to discard stale hover responses.
    pub sequence: u32,
    /// True when the same semantic evaluator used at execution accepts this pairing.
    pub eligible: bool,
}

/// Correlated use request bound to the character that originated the interaction.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemUseRequest {
    /// Frontend operation identity; late outcomes cannot start replacement interactions.
    pub sequence: u32,
    /// Expected player identity, checked before evaluating the source or target.
    pub player: Guid,
    /// Expected source ownership; moving an owned source out invalidates the operation.
    pub source_owned: bool,
    /// Explicit source and optional target; never read from mutable UI selection.
    pub intent: ItemUseIntent,
    /// Semantic consequence expected by the caller, independent of its approval policy.
    pub expected: ItemUseConsequence,
}

/// Correlated execution outcome; dispatched does not mean successful on the server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUseResult {
    /// Unmodified originating request identity.
    pub sequence: u32,
    /// Evaluation or dispatch result, without any UI confirmation instruction.
    pub outcome: ItemUseOutcome,
}

/// No pending questions or authorization receipts are retained in core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ItemUseOutcome {
    /// Current world or execution admission rejected the operation.
    Rejected { reason: String },
    /// Expected consequence did not match; no game action was sent.
    ConsequenceChanged { evaluation: ItemUseEvaluation },
    /// Action entered the existing game-action transport.
    Executed,
}

impl ClientRuntime {
    pub(super) fn query_item_use_target(&self, query: ItemUseTargetQuery) {
        let eligible = matches!(self.state, ClientState::InWorld)
            && evaluate_item_use(
                &self.world,
                &ItemUseIntent::Targeted {
                    source: query.source,
                    target: query.target,
                },
            )
            .is_ok();
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ItemUseTargetResult(ItemUseTargetResult {
                sequence: query.sequence,
                eligible,
            }));
    }

    pub(super) async fn submit_item_use(&mut self, request: ItemUseRequest) -> Result<()> {
        let outcome = self.execute_guarded_item_use(&request).await;
        let (outcome, error) = match outcome {
            Ok(outcome) => (outcome, None),
            Err(error) => (
                ItemUseOutcome::Rejected {
                    reason: error.to_string(),
                },
                Some(error),
            ),
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ItemUseResult(ItemUseResult {
                sequence: request.sequence,
                outcome,
            }));
        match error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    async fn execute_guarded_item_use(
        &mut self,
        request: &ItemUseRequest,
    ) -> Result<ItemUseOutcome> {
        let reject = |reason: &str| ItemUseOutcome::Rejected {
            reason: reason.into(),
        };
        if !matches!(self.state, ClientState::InWorld) || self.world.player.guid != request.player {
            return Ok(reject(
                "The originating character is no longer in the world.",
            ));
        }
        if self.equipment_operation.is_some() || self.pack_exchange.is_some() {
            return Ok(reject("An inventory change is still pending."));
        }
        let source = match request.intent {
            ItemUseIntent::Direct { source, .. } | ItemUseIntent::Targeted { source, .. } => source,
        };
        if self.world.is_owned_by_player(source) != request.source_owned {
            return Ok(reject("Source ownership has changed."));
        }
        let evaluation = match evaluate_item_use(&self.world, &request.intent) {
            Ok(evaluation) => evaluation,
            Err(reason) => return Ok(ItemUseOutcome::Rejected { reason }),
        };
        if evaluation.consequence() != request.expected {
            return Ok(ItemUseOutcome::ConsequenceChanged { evaluation });
        }
        if !self.dispatch_item_use(&request.intent).await? {
            return Ok(reject("Your character is busy."));
        }
        Ok(ItemUseOutcome::Executed)
    }

    /// Common wire dispatch and busy admission for guarded and existing callers.
    pub(super) async fn dispatch_item_use(&mut self, intent: &ItemUseIntent) -> Result<bool> {
        if self.active_busy_operation.is_some() {
            return Ok(false);
        }
        if let ItemUseIntent::Direct { source, .. } = intent {
            self.prepare_container_use(*source).await?;
        }
        let (operation, action) = match intent {
            ItemUseIntent::Direct { source, .. } => (
                super::PendingOperation::Use { source: *source },
                GameAction::Use(Box::new(UseActionData { guid: *source })),
            ),
            ItemUseIntent::Targeted { source, target } => (
                super::PendingOperation::UseWithTarget,
                GameAction::UseWithTarget(Box::new(UseWithTargetActionData {
                    item_guid: *source,
                    target_guid: *target,
                })),
            ),
        };
        if !self.arm_busy_operation(operation) {
            return Ok(false);
        }
        // Retail submits Use before progress feedback (acclient.c:414515). Cached lock state
        // must not suppress dispatch or imply a server-side activation failure.
        if let Err(error) = self.send_game_action(action).await {
            self.clear_busy_operation();
            return Err(error);
        }
        if let ItemUseIntent::Direct { source, .. } = intent
            && let Some(feedback) =
                holtburger_world::interaction::describe_entity_use(&self.world, *source)
        {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::EntityUseFeedback(feedback));
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{
        position::WorldPosition,
        properties::{ItemType, PropertyInt, Usable},
    };
    use holtburger_world::entity::Entity;

    fn fixture() -> (ClientRuntime, ItemUseRequest) {
        let mut client = crate::client::builder::build_test_client(ClientState::InWorld);
        client.world.player.guid = Guid(1);
        let mut source = Entity::new(Guid(2), "Mana Stone".into(), WorldPosition::default());
        source
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::MANA_STONE.bits() as i32);
        source.properties.ints.insert(
            PropertyInt::ItemUseable,
            Usable::SOURCE_CONTAINED_TARGET_SELF_OR_CONTAINED.bits() as i32,
        );
        source
            .properties
            .ints
            .insert(PropertyInt::TargetType, ItemType::ARMOR.bits() as i32);
        client.world.add_entity(source);
        let mut target = Entity::new(Guid(3), "Armor".into(), WorldPosition::default());
        target
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::ARMOR.bits() as i32);
        client.world.add_entity(target);
        for (index, id) in [2, 3].into_iter().enumerate() {
            crate::client::equipment_plan::tests::event(
                &mut client.world,
                holtburger_protocol::messages::GameEvent::InventoryPutObjInContainer(Box::new(
                    holtburger_protocol::messages::InventoryPutObjInContainerEventData {
                        item_guid: Guid(id),
                        container_guid: Guid(1),
                        slot: index as u32,
                        container_type: holtburger_common::properties::InventoryEntryKind::Item,
                    },
                )),
            );
        }
        (
            client,
            ItemUseRequest {
                sequence: 1,
                player: Guid(1),
                source_owned: true,
                intent: ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(3),
                },
                expected: ItemUseConsequence::Ordinary,
            },
        )
    }

    #[test]
    fn target_queries_report_compatibility_without_busy_or_execution() {
        let (client, _) = fixture();
        let mut events = client.client_view_event_tx.subscribe();
        for (sequence, target, expected) in [(1, Guid(3), true), (2, Guid(99), false)] {
            client.query_item_use_target(ItemUseTargetQuery {
                sequence,
                source: Guid(2),
                target,
            });
            let ClientViewEvent::ItemUseTargetResult(result) = events.try_recv().unwrap() else {
                panic!("Expected target eligibility result");
            };
            assert_eq!(result.sequence, sequence);
            assert_eq!(result.eligible, expected);
        }
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn unexpected_destruction_returns_facts_without_becoming_busy() {
        let (mut client, mut request) = fixture();
        let result = client.execute_guarded_item_use(&request).await.unwrap();
        assert_eq!(
            result,
            ItemUseOutcome::ConsequenceChanged {
                evaluation: ItemUseEvaluation::DestroyItem {
                    target: Guid(3),
                    amount: 1,
                    name: "Armor".into(),
                }
            }
        );
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation.is_none());
        // Core checks semantics, not proof of a frontend confirmation dialog.
        request.expected = ItemUseConsequence::DestroyItem {
            target: Guid(3),
            amount: 1,
        };
        assert_eq!(
            client.execute_guarded_item_use(&request).await.unwrap(),
            ItemUseOutcome::Executed
        );
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(matches!(
            client.execute_guarded_item_use(&request).await.unwrap(),
            ItemUseOutcome::Rejected { .. }
        ));
        assert_eq!(client.session.game_action_sequence, 1);
    }

    #[tokio::test]
    async fn changed_ownership_and_invalid_target_reject_without_dispatch() {
        let (mut client, mut request) = fixture();
        request.source_owned = false;
        assert_eq!(
            client.execute_guarded_item_use(&request).await.unwrap(),
            ItemUseOutcome::Rejected {
                reason: "Source ownership has changed.".into()
            }
        );
        request.source_owned = true;
        request.intent = ItemUseIntent::Targeted {
            source: Guid(2),
            target: Guid(99),
        };
        assert!(matches!(
            client.execute_guarded_item_use(&request).await.unwrap(),
            ItemUseOutcome::Rejected { .. }
        ));
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn changed_charge_and_character_do_not_execute_old_expectations() {
        let (mut client, mut request) = fixture();
        request.expected = ItemUseConsequence::DestroyItem {
            target: Guid(3),
            amount: 1,
        };
        let mut source = client.world.entities.get(Guid(2)).unwrap().clone();
        source.properties.ints.insert(PropertyInt::UiEffects, 1);
        client.world.add_entity(source);
        assert_eq!(
            client.execute_guarded_item_use(&request).await.unwrap(),
            ItemUseOutcome::ConsequenceChanged {
                evaluation: ItemUseEvaluation::Ordinary
            }
        );
        request.expected = ItemUseConsequence::Ordinary;
        request.player = Guid(99);
        assert!(matches!(
            client.execute_guarded_item_use(&request).await.unwrap(),
            ItemUseOutcome::Rejected { .. }
        ));
        assert_eq!(client.session.game_action_sequence, 0);
    }
}

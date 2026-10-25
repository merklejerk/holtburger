//! Shared salvage evaluation and guarded dispatch; frontends own draft and confirmation policy.

use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::{GameAction, SalvageItemsWithActionData};
use holtburger_world::crafting::salvage::{
    SalvageEvaluation, SalvageReview, SalvageTool, find_salvage_tool,
};
use serde::{Deserialize, Serialize};

use super::{
    ClientRuntime, ClientState,
    types::{ActionResultReason, ActionResultSource, ClientViewEvent},
};

/// Exact ordinary activation or discovery for the selected-item shortcut.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SalvageToolSelection {
    /// Use this tool only; a stale activation must not silently switch tools.
    Exact { guid: Guid },
    /// Prefer the draft's existing tool, then the lowest owned tool GUID.
    Discover { preferred: Option<Guid> },
}

/// Correlated, read-only evaluation of a proposed ordered draft.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvagePreviewRequest {
    /// Frontend request identity.
    pub sequence: u32,
    /// Originating character.
    pub player: Guid,
    /// Explicit selection or discovery policy.
    pub tool: SalvageToolSelection,
    /// Ordered whole-item identities; empty opens an empty work window.
    pub items: Vec<Guid>,
}

/// One coherent evaluation, independently delivered after command enqueue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalvagePreviewResult {
    /// Unmodified caller identity.
    pub sequence: u32,
    /// Latest evaluation; no source is reserved.
    pub evaluation: SalvageEvaluation,
}

/// Submission carries semantic preconditions rather than a frontend approval receipt.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvageSubmitRequest {
    /// Caller identity, used to ignore results from retired drafts.
    pub sequence: u32,
    /// World-normalized inputs reviewed by the caller.
    pub review: SalvageReview,
}

/// Dispatch outcome is not a server processing acknowledgement.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SalvageSubmitOutcome {
    /// Current admission or transport rejected the action.
    Rejected { reason: String },
    /// Current semantics differ; a fresh review is required and nothing was sent.
    Changed { evaluation: SalvageEvaluation },
    /// Game action entered transport; inventory and optional result chat remain authoritative.
    Dispatched,
}

/// Exactly one response to a guarded submission.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalvageSubmitResult {
    /// Original caller identity.
    pub sequence: u32,
    /// Fresh validation/dispatch decision.
    pub outcome: SalvageSubmitOutcome,
}

impl ClientRuntime {
    fn salvage_admission(&self, player: Guid) -> std::result::Result<(), &'static str> {
        if self.state != ClientState::InWorld || self.world.player.guid != player {
            return Err("The originating character is no longer in the world.");
        }
        if self.equipment_change_pending() || self.pack_exchange.is_some() {
            return Err("An inventory change is still pending.");
        }
        if self.active_busy_operation.is_some() {
            return Err("Your character is busy.");
        }
        Ok(())
    }

    pub(super) fn preview_salvage(&self, request: SalvagePreviewRequest) {
        let evaluate = || {
            // Busy actions do not invalidate read-only previews.
            if self.state != ClientState::InWorld || self.world.player.guid != request.player {
                return SalvageEvaluation::Rejected {
                    reason: "The originating character is no longer in the world.".into(),
                };
            }
            let tool = match request.tool {
                SalvageToolSelection::Exact { guid } => {
                    find_salvage_tool(&self.world, Some(guid)).filter(|tool| tool.guid == guid)
                }
                SalvageToolSelection::Discover { preferred } => {
                    find_salvage_tool(&self.world, preferred)
                }
            };
            match tool {
                Some(tool) => self.world.evaluate_salvage(tool, &request.items),
                None => SalvageEvaluation::Rejected {
                    reason: "You do not have an Ust in your inventory.".into(),
                },
            }
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SalvagePreview(SalvagePreviewResult {
                sequence: request.sequence,
                evaluation: evaluate(),
            }));
    }

    pub(super) async fn submit_salvage(&mut self, request: SalvageSubmitRequest) -> Result<()> {
        let outcome = self.execute_salvage(&request.review).await;
        let (outcome, error) = match outcome {
            Ok(outcome) => (outcome, None),
            Err(error) => (
                SalvageSubmitOutcome::Rejected {
                    reason: error.to_string(),
                },
                Some(error),
            ),
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: request.sequence,
                outcome,
            }));
        match error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    async fn execute_salvage(&mut self, expected: &SalvageReview) -> Result<SalvageSubmitOutcome> {
        if let Err(reason) = self.salvage_admission(expected.player) {
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: reason.into(),
            });
        }
        if expected.sources.is_empty() {
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: "The salvage batch is empty.".into(),
            });
        }
        let items: Vec<_> = expected.sources.iter().map(|source| source.guid).collect();
        let evaluation = self.world.evaluate_salvage(expected.tool, &items);
        if !matches!(&evaluation, SalvageEvaluation::Ready { review, .. } if review == expected) {
            return Ok(SalvageSubmitOutcome::Changed { evaluation });
        }
        self.dispatch_salvage(expected.tool, items).await?;
        Ok(SalvageSubmitOutcome::Dispatched)
    }

    async fn dispatch_salvage(&mut self, tool: SalvageTool, items: Vec<Guid>) -> Result<()> {
        self.send_game_action(GameAction::SalvageItemsWith(Box::new(
            SalvageItemsWithActionData {
                tool_guid: tool.guid,
                items,
            },
        )))
        .await
    }

    /// Existing TUI/scripting callers share validation while retaining their own approval policy.
    pub(super) async fn salvage_items_with(&mut self, tool: Guid, items: Vec<Guid>) -> Result<()> {
        let reason = match self.salvage_admission(self.world.player.guid) {
            Err(reason) => reason.into(),
            Ok(()) => {
                let tool =
                    find_salvage_tool(&self.world, Some(tool)).filter(|found| found.guid == tool);
                match tool.map(|tool| self.world.evaluate_salvage(tool, &items)) {
                    Some(SalvageEvaluation::Ready { review, .. }) if !items.is_empty() => {
                        self.dispatch_salvage(review.tool, items).await?;
                        return Ok(());
                    }
                    Some(SalvageEvaluation::PendingDetails { .. }) => {
                        "Examine the queued items to load salvage details.".into()
                    }
                    Some(SalvageEvaluation::Rejected { reason }) => reason,
                    Some(SalvageEvaluation::Ready { .. }) => "The salvage batch is empty.".into(),
                    None => "You do not have an Ust in your inventory.".into(),
                }
            }
        };
        self.emit_action_result(
            ActionResultSource::Client,
            ActionResultReason::General(reason),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{
        ItemType, MaterialType, PropertyInt, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
    };
    use holtburger_world::{crafting::salvage::UST_WCID, entity::Entity};

    fn fixture() -> (ClientRuntime, SalvageReview) {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client
            .world
            .seed_local_player_entity(Guid(1), "Player", Default::default());
        for (guid, name, wcid) in [(Guid(2), "Ust", UST_WCID), (Guid(3), "Sword", 42)] {
            let mut entity = Entity::new(guid, name.into(), Default::default());
            entity.wcid = Some(wcid);
            entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
            entity.set_int_prop(PropertyInt::MaterialType, MaterialType::Steel as i32);
            entity.set_int_prop(PropertyInt::ItemWorkmanship, 7);
            entity.set_int_prop(PropertyInt::NumItemsInMaterial, 1);
            client.world.add_entity(entity);
            client
                .world
                .handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
                    target: Guid(1),
                    sequence: 0,
                    event: GameEvent::InventoryPutObjInContainer(Box::new(
                        InventoryPutObjInContainerEventData {
                            item_guid: guid,
                            container_guid: Guid(1),
                            slot: guid.0,
                            container_type: holtburger_common::properties::InventoryEntryKind::Item,
                        },
                    )),
                })));
        }
        let tool = find_salvage_tool(&client.world, None).unwrap();
        let SalvageEvaluation::Ready { review, .. } =
            client.world.evaluate_salvage(tool, &[Guid(3)])
        else {
            panic!("fixture must be ready");
        };
        (client, review)
    }

    #[tokio::test]
    async fn reviewed_batch_dispatches_once_without_arming_busy_operation() {
        let (mut client, review) = fixture();
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 9,
                review,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 9,
                outcome: SalvageSubmitOutcome::Dispatched,
            })
        ));
        assert!(client.active_busy_operation.is_none());
        assert_eq!(client.session.game_action_sequence, 1);
    }

    #[tokio::test]
    async fn changed_stack_does_not_dispatch_or_silently_approve_a_new_batch() {
        let (mut client, review) = fixture();
        client
            .world
            .entities
            .get_mut(Guid(3))
            .unwrap()
            .set_int_prop(PropertyInt::StackSize, 2);
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 10,
                review,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 10,
                outcome: SalvageSubmitOutcome::Changed { .. },
            })
        ));
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn busy_admission_still_delivers_the_correlated_rejection() {
        let (mut client, review) = fixture();
        assert!(client.arm_busy_operation(super::super::PendingOperation::Use { source: Guid(2) }));
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 12,
                review,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 12,
                outcome: SalvageSubmitOutcome::Rejected { .. },
            })
        ));
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn raw_callers_use_the_same_safety_validation() {
        let (mut client, _) = fixture();
        client
            .salvage_items_with(Guid(2), vec![Guid(3), Guid(3)])
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
        client
            .salvage_items_with(Guid(2), vec![Guid(3)])
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn character_exit_produces_a_correlated_rejection() {
        let (mut client, review) = fixture();
        client.state = ClientState::CharacterSelection;
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 11,
                review,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 11,
                outcome: SalvageSubmitOutcome::Rejected { .. },
            })
        ));
        assert_eq!(client.session.game_action_sequence, 0);
    }
}

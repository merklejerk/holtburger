//! Shared salvage evaluation and guarded dispatch; frontends own draft and confirmation policy.

use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::{GameAction, SalvageItemsWithActionData};
use holtburger_world::crafting::salvage::{
    SalvageEvaluation, SalvagePreviewBag, SalvageReview, SalvageTool, find_salvage_tool,
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

/// Authority-retained salvage evaluation projected across the client boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SalvagePreviewEvaluation {
    /// Coherent estimate and monotonic approval token retained in core.
    Ready {
        revision: u32,
        tool: Guid,
        bags: Vec<SalvagePreviewBag>,
    },
    /// Candidate identities needing Examine; no sources were silently omitted.
    PendingDetails { tool: Guid, items: Vec<Guid> },
    /// The proposed batch cannot be accepted.
    Rejected { reason: String },
}

/// Authority-held approval binding a monotonic preview revision to its exact review.
#[derive(Default)]
pub(super) struct SalvageApproval {
    next_revision: u32,
    approved: Option<(u32, SalvageReview)>,
}

impl SalvageApproval {
    fn record(&mut self, evaluation: SalvageEvaluation) -> SalvagePreviewEvaluation {
        match evaluation {
            SalvageEvaluation::Ready { review, bags } => {
                let Some(revision) = self.next_revision.checked_add(1) else {
                    self.approved = None;
                    return SalvagePreviewEvaluation::Rejected {
                        reason: "Salvage revision space exhausted.".into(),
                    };
                };
                self.next_revision = revision;
                let tool = review.tool.guid;
                self.approved = Some((revision, review));
                SalvagePreviewEvaluation::Ready {
                    revision,
                    tool,
                    bags,
                }
            }
            SalvageEvaluation::PendingDetails { tool, items } => {
                self.approved = None;
                SalvagePreviewEvaluation::PendingDetails {
                    tool: tool.guid,
                    items,
                }
            }
            SalvageEvaluation::Rejected { reason } => {
                self.approved = None;
                SalvagePreviewEvaluation::Rejected { reason }
            }
        }
    }
}

/// One coherent evaluation, independently delivered after command enqueue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalvagePreviewResult {
    /// Unmodified caller identity.
    pub sequence: u32,
    /// Latest evaluation; no source is reserved.
    pub evaluation: SalvagePreviewEvaluation,
}

/// Submission carries the monotonic preview revision rather than an echoed review payload.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvageSubmitRequest {
    /// Caller identity, used to ignore results from retired drafts.
    pub sequence: u32,
    /// Monotonic preview revision retained by core.
    pub revision: u32,
}

/// Dispatch outcome is not a server processing acknowledgement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SalvageSubmitOutcome {
    /// Current admission or transport rejected the action.
    Rejected { reason: String },
    /// Current semantics differ; a fresh review is required and nothing was sent.
    Changed {
        evaluation: SalvagePreviewEvaluation,
    },
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
        if self.conn.state != ClientState::InWorld || self.world.player.guid != player {
            return Err("The originating character is no longer in the world.");
        }
        if self.inventory_change_pending() {
            return Err("An inventory change is still pending.");
        }
        if self.character.active_busy_operation.is_some() {
            return Err("Your character is busy.");
        }
        Ok(())
    }

    pub(super) fn preview_salvage(&mut self, request: SalvagePreviewRequest) {
        let evaluation = {
            // Busy actions do not invalidate read-only previews.
            if self.conn.state != ClientState::InWorld || self.world.player.guid != request.player {
                SalvageEvaluation::Rejected {
                    reason: "The originating character is no longer in the world.".into(),
                }
            } else {
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
            }
        };
        let evaluation = self.character.salvage_approval.record(evaluation);
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SalvagePreview(SalvagePreviewResult {
                sequence: request.sequence,
                evaluation,
            }));
    }

    pub(super) async fn submit_salvage(&mut self, request: SalvageSubmitRequest) -> Result<()> {
        let outcome = self.execute_salvage(request.revision).await;
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

    async fn execute_salvage(&mut self, revision: u32) -> Result<SalvageSubmitOutcome> {
        if let Err(reason) = self.salvage_admission(self.world.player.guid) {
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: reason.into(),
            });
        }
        let Some((stored_revision, expected)) = self.character.salvage_approval.approved.as_ref()
        else {
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: "The salvage batch is no longer current. Review the batch again.".into(),
            });
        };
        if *stored_revision != revision {
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: "The salvage batch is no longer current. Review the batch again.".into(),
            });
        }
        let expected = expected.clone();
        if let Err(reason) = self.salvage_admission(expected.player) {
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: reason.into(),
            });
        }
        if expected.sources.is_empty() {
            self.character.salvage_approval.approved = None;
            return Ok(SalvageSubmitOutcome::Rejected {
                reason: "The salvage batch is empty.".into(),
            });
        }
        let items: Vec<_> = expected.sources.iter().map(|source| source.guid).collect();
        let evaluation = self.world.evaluate_salvage(expected.tool, &items);
        if matches!(&evaluation, SalvageEvaluation::Ready { review, .. } if review == &expected) {
            self.character.salvage_approval.approved = None;
            self.dispatch_salvage(expected.tool, items).await?;
            return Ok(SalvageSubmitOutcome::Dispatched);
        }
        let evaluation = self.character.salvage_approval.record(evaluation);
        Ok(SalvageSubmitOutcome::Changed { evaluation })
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

    /// Direct callers share validation while retaining their own approval policy.
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

    fn fixture() -> (ClientRuntime, u32) {
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
        let mut replies = client.client_view_event_tx.subscribe();
        client.preview_salvage(SalvagePreviewRequest {
            sequence: 1,
            player: Guid(1),
            tool: SalvageToolSelection::Discover { preferred: None },
            items: vec![Guid(3)],
        });
        let ClientViewEvent::SalvagePreview(SalvagePreviewResult {
            evaluation: SalvagePreviewEvaluation::Ready { revision, .. },
            ..
        }) = replies.try_recv().unwrap()
        else {
            panic!("fixture must be ready");
        };
        (client, revision)
    }

    #[tokio::test]
    async fn reviewed_batch_dispatches_once_without_arming_busy_operation() {
        let (mut client, revision) = fixture();
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 9,
                revision,
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
        assert!(client.character.active_busy_operation.is_none());
        assert_eq!(client.session.game_action_sequence, 1);

        // Consumed revision cannot be replayed.
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 10,
                revision,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 10,
                outcome: SalvageSubmitOutcome::Rejected { .. },
            })
        ));
        assert_eq!(client.session.game_action_sequence, 1);
    }

    #[tokio::test]
    async fn changed_stack_does_not_dispatch_and_mints_replacement_revision() {
        let (mut client, revision) = fixture();
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
                revision,
            })
            .await
            .unwrap();
        let ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
            sequence: 10,
            outcome:
                SalvageSubmitOutcome::Changed {
                    evaluation:
                        SalvagePreviewEvaluation::Ready {
                            revision: next_revision,
                            ..
                        },
                },
        }) = replies.try_recv().unwrap()
        else {
            panic!("expected changed ready evaluation");
        };
        assert_ne!(next_revision, revision);
        assert_eq!(client.session.game_action_sequence, 0);

        // Confirming with the newly minted replacement revision dispatches.
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 11,
                revision: next_revision,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 11,
                outcome: SalvageSubmitOutcome::Dispatched,
            })
        ));
        assert_eq!(client.session.game_action_sequence, 1);
    }

    #[tokio::test]
    async fn superseded_revision_is_rejected_without_dispatching() {
        let (mut client, stale_revision) = fixture();
        let mut replies = client.client_view_event_tx.subscribe();
        client.preview_salvage(SalvagePreviewRequest {
            sequence: 2,
            player: Guid(1),
            tool: SalvageToolSelection::Discover { preferred: None },
            items: vec![Guid(3)],
        });
        let ClientViewEvent::SalvagePreview(SalvagePreviewResult {
            evaluation:
                SalvagePreviewEvaluation::Ready {
                    revision: current, ..
                },
            ..
        }) = replies.try_recv().unwrap()
        else {
            panic!("expected second preview");
        };
        assert_ne!(stale_revision, current);
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 3,
                revision: stale_revision,
            })
            .await
            .unwrap();
        assert!(matches!(
            replies.try_recv().unwrap(),
            ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
                sequence: 3,
                outcome: SalvageSubmitOutcome::Rejected { .. },
            })
        ));
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn busy_admission_still_delivers_the_correlated_rejection() {
        let (mut client, revision) = fixture();
        assert!(client.arm_busy_operation(super::super::PendingOperation::Use { source: Guid(2) }));
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 12,
                revision,
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
        assert!(client.character.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn character_exit_produces_a_correlated_rejection() {
        let (mut client, revision) = fixture();
        client.conn.state = ClientState::CharacterSelection;
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .submit_salvage(SalvageSubmitRequest {
                sequence: 11,
                revision,
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

    #[test]
    fn augmentation_bonus_salvage_triggers_character_sheet_update() {
        let (mut client, _) = fixture();
        let mut replies = client.client_view_event_tx.subscribe();
        client.handle_world_event(&holtburger_world::WorldEvent::PropertiesUpdated {
            guid: Guid(1),
            updates: vec![holtburger_common::properties::PropertyUpdate::Int(
                PropertyInt::AugmentationBonusSalvage,
                1,
            )],
        });
        let events: Vec<_> = std::iter::from_fn(|| replies.try_recv().ok()).collect();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, ClientViewEvent::CharacterSheetUpdated(_)))
        );
    }
}

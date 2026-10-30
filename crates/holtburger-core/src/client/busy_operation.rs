//! Operation-specific completion routing over the runtime's single admission owner.

use super::item_use::{ItemUseCompletion, ItemUseFinished};
use super::{BUSY_OPERATION_TIMEOUT, ClientRuntime, PendingBusyOperation, PendingOperation};
use crate::{ActionResultReason, ActionResultSource, BusyOperationKind, BusyOperationResult};
use holtburger_protocol::errors::WeenieError;
use std::time::Instant;

impl ClientRuntime {
    /// Retire local ownership without claiming that the server stopped processing it.
    pub(super) fn clear_busy_operation(&mut self) {
        if let Some(pending) = self.active_busy_operation.take() {
            self.emit_pending_abort(&pending.operation, "Interaction ended".into());
            self.emit_item_use_finished(&pending.operation, ItemUseCompletion::Aborted);
            if matches!(
                pending.operation,
                PendingOperation::Housing(_) | PendingOperation::HousingManagement(_)
            ) {
                self.emit_housing_snapshot();
            }
            self.emit_busy_state_updated();
        }
    }

    pub(super) fn arm_busy_operation(&mut self, operation: PendingOperation) -> bool {
        if let Some(active) = self.active_busy_operation.as_ref() {
            log::warn!(
                "Ignoring busy-tracked {:?} while {:?} is still pending.",
                operation,
                active.operation
            );
            return false;
        }
        self.active_busy_operation = Some(PendingBusyOperation {
            operation,
            deadline: Instant::now() + BUSY_OPERATION_TIMEOUT,
            pending_error: None,
        });
        self.emit_busy_state_updated();
        true
    }

    /// The active operation interprets errors; unrelated feedback retains its ordinary owner.
    pub(super) fn note_busy_error(&mut self, error: WeenieError, parameter: Option<String>) {
        self.reject_housing_access_from_wire(error);
        self.reject_housing_management_from_wire(error);
        if self.reject_housing_from_wire(error, parameter.as_deref()) {
            return;
        }
        if let Some(pending) = &mut self.active_busy_operation
            && !matches!(
                pending.operation,
                PendingOperation::Housing(_) | PendingOperation::HousingManagement(_)
            )
        {
            pending.pending_error = Some((error, parameter));
        }
    }

    /// Route before taking ownership, so a continuation or ignored completion retains its lock.
    pub(super) async fn finish_busy_operation_from_use_done(
        &mut self,
        error: WeenieError,
    ) -> anyhow::Result<()> {
        if self.active_busy_operation.as_ref().is_some_and(|pending| {
            matches!(
                pending.operation,
                PendingOperation::Housing(_) | PendingOperation::HousingManagement(_)
            )
        }) {
            // UseDone may belong to the preceding ordinary Use or an internal recovery Use.
            if error != WeenieError::None {
                self.emit_action_result(
                    ActionResultSource::Wire,
                    ActionResultReason::Weenie(error, None),
                );
            }
            return Ok(());
        }
        if self.finish_vendor_use_done(error).await? {
            return Ok(());
        }
        if let Some(pending) = self.active_busy_operation.take() {
            let (resolved_error, parameter) = if error == WeenieError::None {
                pending.pending_error.unwrap_or((error, None))
            } else {
                (error, None)
            };
            self.emit_item_use_finished(
                &pending.operation,
                ItemUseCompletion::Completed {
                    error: resolved_error,
                    message: crate::errors::format_weenie_error(
                        resolved_error,
                        parameter.as_deref(),
                    ),
                },
            );
            self.publish_busy_completion(
                pending.operation.kind(),
                BusyOperationResult::Completed {
                    error: resolved_error,
                    parameter,
                },
            );
        }
        if error != WeenieError::None {
            self.emit_action_result(
                ActionResultSource::Wire,
                ActionResultReason::Weenie(error, None),
            );
        }
        Ok(())
    }

    fn emit_item_use_finished(&self, operation: &PendingOperation, outcome: ItemUseCompletion) {
        if let PendingOperation::GuardedUse { sequence, .. } = operation {
            let _ = self
                .client_view_event_tx
                .send(super::ClientViewEvent::ItemUseFinished(ItemUseFinished {
                    sequence: *sequence,
                    outcome,
                }));
        }
    }

    /// One publication path for terminal operations; modules publish their own receipts first.
    pub(super) fn publish_busy_completion(
        &self,
        kind: BusyOperationKind,
        result: BusyOperationResult,
    ) {
        if matches!(
            kind,
            BusyOperationKind::HousingPurchase
                | BusyOperationKind::HousingMaintenance
                | BusyOperationKind::HousingManagement
        ) {
            self.emit_housing_snapshot();
        }
        self.emit_busy_state_updated();
        self.emit_busy_operation_finished(kind, result);
    }

    pub(super) fn emit_pending_abort(&mut self, operation: &PendingOperation, message: String) {
        match operation {
            PendingOperation::Vendor(execution) => self.emit_vendor_abort(execution, message),
            PendingOperation::Housing(execution) => self.emit_housing_abort(execution, message),
            PendingOperation::HousingManagement(execution) => {
                self.emit_housing_management_abort(execution, message)
            }
            PendingOperation::Use { .. }
            | PendingOperation::UseWithTarget { .. }
            | PendingOperation::GuardedUse { .. }
            | PendingOperation::SpellCast { .. } => {}
        }
    }

    pub(super) fn expire_busy_operation(&mut self, now: Instant) {
        if let Some(pending) = self
            .active_busy_operation
            .take_if(|pending| now >= pending.deadline)
        {
            self.emit_pending_abort(&pending.operation, "Transaction timed out".into());
            self.emit_item_use_finished(&pending.operation, ItemUseCompletion::TimedOut);
            self.publish_busy_completion(pending.operation.kind(), BusyOperationResult::TimedOut);
        }
    }
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn guarded_receipts_resolve_errors_and_retire_exactly_once() {
        use holtburger_common::Guid;
        use holtburger_world::item_use::ItemUseIntent;
        for terminal in ["completion", "timeout", "abort"] {
            let mut client =
                super::super::builder::build_test_client(super::super::ClientState::InWorld);
            let mut events = client.subscribe_client_view_events();
            client.arm_busy_operation(PendingOperation::GuardedUse {
                sequence: 42,
                spell_target: None,
                intent: ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(3),
                },
            });
            client.note_busy_error(WeenieError::KeyDoesntFitThisLock, None);
            match terminal {
                "completion" => client
                    .finish_busy_operation_from_use_done(WeenieError::None)
                    .await
                    .unwrap(),
                "timeout" => client.expire_busy_operation(Instant::now() + BUSY_OPERATION_TIMEOUT),
                "abort" => client.clear_busy_operation(),
                _ => unreachable!(),
            }
            client
                .finish_busy_operation_from_use_done(WeenieError::None)
                .await
                .unwrap();
            let receipts: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
                .filter_map(|event| {
                    if let super::super::ClientViewEvent::ItemUseFinished(result) = event {
                        Some(result)
                    } else {
                        None
                    }
                })
                .collect();
            assert_eq!(receipts.len(), 1);
            assert_eq!(receipts[0].sequence, 42);
            assert_eq!(
                receipts[0].outcome,
                match terminal {
                    "completion" => ItemUseCompletion::Completed {
                        error: WeenieError::KeyDoesntFitThisLock,
                        message: crate::errors::format_weenie_error(
                            WeenieError::KeyDoesntFitThisLock,
                            None
                        ),
                    },
                    "timeout" => ItemUseCompletion::TimedOut,
                    "abort" => ItemUseCompletion::Aborted,
                    _ => unreachable!(),
                }
            );
            assert!(client.active_busy_operation.is_none());
        }
    }

    use super::*;
    use crate::{ClientExitCause, ClientViewEvent};
    use holtburger_common::Guid;

    #[tokio::test]
    async fn spell_target_level_matches_snapshot_and_all_operation_endings() {
        for target in [None, Some(Guid::NULL), Some(Guid(1)), Some(Guid(2))] {
            for ending in ["success", "fizzle", "timeout", "disconnect", "clear"] {
                for operation in [
                    PendingOperation::SpellCast { target },
                    PendingOperation::UseWithTarget {
                        spell_target: target,
                    },
                    PendingOperation::GuardedUse {
                        sequence: 42,
                        intent: holtburger_world::item_use::ItemUseIntent::Targeted {
                            source: Guid(100),
                            target: Guid(2),
                        },
                        spell_target: target,
                    },
                ] {
                    let mut client = super::super::builder::build_test_client(
                        super::super::ClientState::InWorld,
                    );
                    client.world.player.guid = Guid(1);
                    let mut events = client.subscribe_client_view_events();
                    assert!(client.arm_busy_operation(operation));
                    let expected = target.filter(|guid| *guid == Guid(2));
                    assert_eq!(client.application_snapshot().spell_cast_target, expected);
                    // A refused overlapping operation cannot replace the retained recipient.
                    assert!(!client.arm_busy_operation(PendingOperation::SpellCast {
                        target: Some(Guid(3))
                    }));
                    assert_eq!(client.application_snapshot().spell_cast_target, expected);
                    match ending {
                        "success" => client
                            .finish_busy_operation_from_use_done(WeenieError::None)
                            .await
                            .unwrap(),
                        "fizzle" => client
                            .finish_busy_operation_from_use_done(WeenieError::YourSpellFizzled)
                            .await
                            .unwrap(),
                        "timeout" => {
                            client.expire_busy_operation(Instant::now() + BUSY_OPERATION_TIMEOUT)
                        }
                        "disconnect" => client.set_exit_cause(ClientExitCause::ServerDisconnect),
                        "clear" => client.clear_busy_operation(),
                        _ => unreachable!(),
                    }
                    assert_eq!(client.application_snapshot().spell_cast_target, None);
                    let targets: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
                        .filter_map(|event| {
                            if let ClientViewEvent::SpellCastTargetUpdated { target } = event {
                                Some(target)
                            } else {
                                None
                            }
                        })
                        .collect();
                    assert_eq!(targets, vec![expected, None], "{ending}");
                }
            }
        }
    }

    fn ordinary_operations() -> [PendingOperation; 3] {
        [
            PendingOperation::Use { source: Guid(100) },
            PendingOperation::UseWithTarget { spell_target: None },
            PendingOperation::SpellCast {
                target: Some(Guid(200)),
            },
        ]
    }

    #[tokio::test]
    async fn ordinary_completion_preserves_error_evidence_and_publishes_once() {
        for operation in ordinary_operations() {
            let mut client =
                super::super::builder::build_test_client(super::super::ClientState::InWorld);
            let kind = operation.kind();
            client.arm_busy_operation(operation);
            let mut events = client.subscribe_client_view_events();
            client.note_busy_error(WeenieError::FullInventoryLocation, Some("source".into()));
            client
                .finish_busy_operation_from_use_done(WeenieError::None)
                .await
                .unwrap();
            client
                .finish_busy_operation_from_use_done(WeenieError::None)
                .await
                .unwrap();
            let events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(
                        event,
                        ClientViewEvent::BusyStateUpdated { busy: None }
                    ))
                    .count(),
                1
            );
            let completions: Vec<_> = events
                .iter()
                .filter_map(|event| match event {
                    ClientViewEvent::BusyOperationFinished { operation, result } => {
                        Some((*operation, result))
                    }
                    _ => None,
                })
                .collect();
            assert_eq!(
                completions,
                vec![(
                    kind,
                    &BusyOperationResult::Completed {
                        error: WeenieError::FullInventoryLocation,
                        parameter: Some("source".into()),
                    }
                )]
            );
            assert!(client.active_busy_operation.is_none());
        }
    }

    #[test]
    fn ordinary_timeout_and_exit_release_admission_once() {
        for operation in ordinary_operations() {
            for exiting in [false, true] {
                let mut client =
                    super::super::builder::build_test_client(super::super::ClientState::InWorld);
                let kind = operation.kind();
                client.arm_busy_operation(operation.clone());
                let deadline = client.active_busy_operation.as_ref().unwrap().deadline;
                let mut events = client.subscribe_client_view_events();
                if exiting {
                    client.set_exit_cause(ClientExitCause::ExplicitDisconnect);
                    client.set_exit_cause(ClientExitCause::ExplicitDisconnect);
                } else {
                    client.expire_busy_operation(deadline);
                    client.expire_busy_operation(deadline);
                }
                let events: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
                assert!(client.active_busy_operation.is_none());
                assert_eq!(
                    events
                        .iter()
                        .filter(|event| matches!(
                            event,
                            ClientViewEvent::BusyStateUpdated { busy: None }
                        ))
                        .count(),
                    1
                );
                let completions: Vec<_> = events
                    .iter()
                    .filter_map(|event| match event {
                        ClientViewEvent::BusyOperationFinished { operation, result } => {
                            Some((*operation, result))
                        }
                        _ => None,
                    })
                    .collect();
                if exiting {
                    assert!(completions.is_empty());
                } else {
                    assert_eq!(completions, vec![(kind, &BusyOperationResult::TimedOut)]);
                }
            }
        }
    }
}

//! Operation-specific completion routing over the runtime's single admission owner.

use super::{BUSY_OPERATION_TIMEOUT, ClientRuntime, PendingBusyOperation, PendingOperation};
use crate::{ActionResultReason, ActionResultSource, BusyOperationKind, BusyOperationResult};
use holtburger_protocol::errors::WeenieError;
use std::time::Instant;

impl ClientRuntime {
    /// Retire local ownership without claiming that the server stopped processing it.
    pub(super) fn clear_busy_operation(&mut self) {
        if let Some(pending) = self.active_busy_operation.take() {
            self.emit_pending_abort(&pending.operation, "Interaction ended".into());
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
            | PendingOperation::UseWithTarget
            | PendingOperation::SpellCast { .. } => {}
        }
    }

    pub(super) fn expire_busy_operation(&mut self, now: Instant) {
        if let Some(pending) = self
            .active_busy_operation
            .take_if(|pending| now >= pending.deadline)
        {
            self.emit_pending_abort(&pending.operation, "Transaction timed out".into());
            self.publish_busy_completion(pending.operation.kind(), BusyOperationResult::TimedOut);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientExitCause, ClientViewEvent};
    use holtburger_common::Guid;

    fn ordinary_operations() -> [PendingOperation; 3] {
        [
            PendingOperation::Use { source: Guid(100) },
            PendingOperation::UseWithTarget,
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

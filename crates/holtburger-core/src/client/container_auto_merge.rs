//! Bounded, server-confirmed consolidation of one carried container's partial stacks.

use super::{
    ClientRuntime, ClientState,
    inventory_merge::{MergeSourceAfter, MergeStep, plan_stack_merge},
    inventory_runtime::InventoryOperation,
    inventory_storage::native_container_items,
    types::{ClientCombatControlState, ClientCommand, ClientViewEvent},
};
use holtburger_common::{
    Guid,
    properties::{PropertyInt, WorldObjectExt, WorldObjectPropertyAccessors},
};
use holtburger_world::{
    WorldState,
    entity::Entity,
    state::storage::{PackEntryKind, RosterCoverage, StorageLocation, StorageSlot},
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// Frontend-chosen finite execution budgets, copied at invocation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoMergePolicy {
    /// Maximum wait for a single merge's authoritative consequences.
    pub step_timeout_ms: u64,
    /// Maximum duration of the complete invocation.
    pub operation_timeout_ms: u64,
}

impl AutoMergePolicy {
    fn deadlines(self, now: Instant) -> Result<(Duration, Instant), String> {
        if self.step_timeout_ms == 0 || self.operation_timeout_ms == 0 {
            return Err("Auto-merge timeouts must be positive".into());
        }
        let step = Duration::from_millis(self.step_timeout_ms);
        now.checked_add(step)
            .ok_or("Auto-merge step deadline exceeds the clock range")?;
        let deadline = now
            .checked_add(Duration::from_millis(self.operation_timeout_ms))
            .ok_or("Auto-merge operation deadline exceeds the clock range")?;
        Ok((step, deadline))
    }
}

/// Terminal semantic outcome; presentation chooses toast wording and tone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoMergeOutcome {
    /// No further eligible partial-stack pair remains.
    Completed {
        /// Distinguishes a no-op from transfers which free zero slots.
        changed: bool,
    },
    /// Admission failed before any request was dispatched.
    Rejected(String),
    /// Remaining work was abandoned; only confirmed progress is included in the receipt.
    Stopped(String),
}

/// One invocation's confirmed progress, independent of inventory panel lifetime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoMergeResult {
    /// Only sources whose removal and destination increment both completed.
    pub slots_freed: u32,
    /// Completion or the reason execution did not finish.
    pub outcome: AutoMergeOutcome,
}

/// Stable instance identity used to reject replacement under a reused GUID.
#[derive(Debug, Clone, Copy)]
struct Candidate {
    /// Accepted identity at admission.
    guid: Guid,
    /// Incarnation received in the object's public description.
    instance: u16,
    /// Template changes must not silently select another item.
    template: Option<u32>,
}

impl Candidate {
    fn capture(entity: &Entity) -> Self {
        Self {
            guid: entity.guid,
            instance: entity.instance_sequence(),
            template: entity.wcid,
        }
    }

    fn entity(self, world: &WorldState) -> Result<&Entity, String> {
        world
            .get_visible_entity(self.guid)
            .filter(|entity| {
                entity.instance_sequence() == self.instance && entity.wcid == self.template
            })
            .ok_or_else(|| format!("Inventory item {} disappeared or changed", self.guid))
    }
}

/// Whether a confirmed request may schedule another merge.
#[derive(Debug)]
enum Continuation {
    Continue,
    StopRequested,
}

/// A resolved request and its send budget, returned together to the runtime adapter.
#[derive(Debug, Clone, Copy)]
struct MergeDispatch {
    /// Existing wire decision and exact expected consequences.
    step: MergeStep,
    /// Runtime send timeout uses the same deadline as confirmation polling.
    deadline: Instant,
}

/// A controller decision preserves waiting versus completion for the runtime adapter.
#[derive(Debug)]
enum MergeAdvance {
    /// The existing request still requires authoritative consequences.
    Waiting,
    /// Send exactly this resolved request within its fixed budget.
    Send(MergeDispatch),
    /// Release ownership and publish this terminal outcome.
    Finished(AutoMergeOutcome),
}

/// All facts that depend on one dispatched merge are retained together.
#[derive(Debug)]
struct AwaitingMerge {
    /// Already resolved quantities; consumers never recompute the requested amount.
    step: MergeStep,
    /// Source incarnation selected from the finite admitted scope.
    source: Candidate,
    /// Destination incarnation selected from the same scope.
    destination: Candidate,
    /// Fixed effective deadline, bounded by the invocation deadline.
    deadline: Instant,
    /// Explicit inventory removal is required for a consumed source.
    source_removed: bool,
    /// A conflicting user action abandons only unsent work.
    continuation: Continuation,
}

/// The controller never retains an action queue or more than one outstanding request.
#[derive(Debug)]
enum MergeStage {
    Ready,
    Awaiting(AwaitingMerge),
}

/// Session-owned finite consolidation, with application-chosen absolute deadlines.
#[derive(Debug)]
pub(super) struct ContainerAutoMerge {
    /// Bag incarnation; root identity is checked by the same rule.
    container: Candidate,
    /// Initial direct contents; new arrivals cannot extend the work scope.
    candidates: Vec<Candidate>,
    /// Copied request budget, never read again from frontend tuning.
    step_timeout: Duration,
    /// Absolute invocation deadline, never extended by progress.
    deadline: Instant,
    /// Current request and interruption decision.
    stage: MergeStage,
    /// Terminal receipt counts only fully confirmed source consumption.
    slots_freed: u32,
    /// Completed steps can change quantities without freeing a slot.
    changed: bool,
}

fn require_container(world: &WorldState, container: Guid) -> Result<&Entity, String> {
    let entity = world
        .get_visible_entity(container)
        .ok_or("Container description is incomplete")?;
    let carried = container == world.player.guid
        || matches!(world.storage_location(container),
        Some(StorageLocation::Contained { parent, slot: StorageSlot::Pack { kind: PackEntryKind::Container, .. } })
        if parent == world.player.guid);
    if !carried || !entity.can_hold_items() {
        return Err("Auto-merge requires a carried container".into());
    }
    if world.storage_coverage(container) != Some(RosterCoverage::Announced) {
        return Err("Container contents are incomplete".into());
    }
    if world
        .container_contents(container)
        .any(|(_, slot)| slot == StorageSlot::Pending)
    {
        return Err("Container item positions are incomplete".into());
    }
    Ok(entity)
}

fn stack_count(entity: &Entity) -> Result<u32, String> {
    entity
        .get_int_prop(PropertyInt::StackSize)
        .and_then(|count| u32::try_from(count).ok())
        .filter(|count| *count > 0)
        .ok_or_else(|| format!("Stack quantity for {} is incomplete", entity.guid))
}

fn contained_in(world: &WorldState, item: Guid, container: Guid) -> bool {
    matches!(world.storage_location(item), Some(StorageLocation::Contained { parent, slot: StorageSlot::Item { .. } }) if parent == container)
}

impl ContainerAutoMerge {
    fn new(
        world: &WorldState,
        container: Guid,
        policy: AutoMergePolicy,
        now: Instant,
    ) -> Result<Self, String> {
        let (step_timeout, deadline) = policy.deadlines(now)?;
        let container = Candidate::capture(require_container(world, container)?);
        let candidates = native_container_items(world, container.guid)
            .into_iter()
            .map(|(_, guid)| {
                let entity = world
                    .get_visible_entity(guid)
                    .ok_or("Inventory descriptions are incomplete")?;
                if entity.wcid.is_none() || entity.item_type().is_none() {
                    return Err("Inventory descriptions are incomplete".into());
                }
                if entity.is_stackable() {
                    stack_count(entity)?;
                }
                Ok(Candidate::capture(entity))
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Self {
            container,
            candidates,
            step_timeout,
            deadline,
            stage: MergeStage::Ready,
            slots_freed: 0,
            changed: false,
        })
    }

    pub(super) fn result(&self, outcome: AutoMergeOutcome) -> AutoMergeResult {
        AutoMergeResult {
            slots_freed: self.slots_freed,
            outcome,
        }
    }

    pub(super) fn awaiting_item(&self, guid: Guid) -> bool {
        matches!(&self.stage, MergeStage::Awaiting(pending) if pending.step.source == guid || pending.step.destination == guid)
    }

    fn observe_removal(&mut self, guid: Guid) {
        if let MergeStage::Awaiting(pending) = &mut self.stage
            && pending.step.source == guid
            && pending.step.source_after == MergeSourceAfter::Removed
        {
            pending.source_removed = true;
        }
    }

    /// Polling can settle or expire ownership, but cannot send another request.
    fn poll(
        &mut self,
        world: &WorldState,
        now: Instant,
    ) -> Result<Option<AutoMergeOutcome>, String> {
        self.container.entity(world)?;
        require_container(world, self.container.guid)?;
        if let MergeStage::Awaiting(pending) = &self.stage {
            let destination = pending.destination.entity(world)?;
            if !contained_in(world, destination.guid, self.container.guid) {
                return Err("Merge destination moved during auto-merge".into());
            }
            let destination_count = stack_count(destination)?;
            if destination_count != pending.step.destination_before
                && destination_count != pending.step.destination_after
            {
                return Err("Merge destination quantity changed unexpectedly".into());
            }
            let source_done = match pending.step.source_after {
                MergeSourceAfter::Removed if pending.source_removed => {
                    if world.storage_location(pending.step.source).is_some()
                        || world.get_visible_entity(pending.step.source).is_some()
                    {
                        return Err("Consumed source was replaced during auto-merge".into());
                    }
                    true
                }
                expected => {
                    let source = pending.source.entity(world)?;
                    if !contained_in(world, source.guid, self.container.guid) {
                        return Err("Merge source moved during auto-merge".into());
                    }
                    let count = stack_count(source)?;
                    let after = match expected {
                        MergeSourceAfter::Remaining { count } => Some(count),
                        MergeSourceAfter::Removed => None,
                    };
                    if count != pending.step.source_before && Some(count) != after {
                        return Err("Merge source quantity changed unexpectedly".into());
                    }
                    Some(count) == after
                }
            };
            if source_done && destination_count == pending.step.destination_after {
                self.changed = true;
                if pending.step.source_after == MergeSourceAfter::Removed {
                    self.slots_freed += 1;
                    self.candidates
                        .retain(|item| item.guid != pending.step.source);
                }
                let stopped = matches!(pending.continuation, Continuation::StopRequested);
                self.stage = MergeStage::Ready;
                if stopped {
                    return Ok(Some(AutoMergeOutcome::Stopped(
                        "Interrupted by another action".into(),
                    )));
                }
            }
        }
        let expired = now >= self.deadline
            || matches!(&self.stage, MergeStage::Awaiting(pending) if now >= pending.deadline);
        if expired {
            return Ok(Some(AutoMergeOutcome::Stopped(
                "Timed out waiting for the server; the last request may still complete".into(),
            )));
        }
        Ok(None)
    }

    fn advance(&mut self, world: &WorldState, now: Instant) -> Result<MergeAdvance, String> {
        if let Some(outcome) = self.poll(world, now)? {
            return Ok(MergeAdvance::Finished(outcome));
        }
        if !matches!(self.stage, MergeStage::Ready) {
            return Ok(MergeAdvance::Waiting);
        }
        for candidate in &self.candidates {
            candidate.entity(world)?;
            if !contained_in(world, candidate.guid, self.container.guid) {
                return Err("Inventory contents moved during auto-merge".into());
            }
        }
        let partial = native_container_items(world, self.container.guid)
            .into_iter()
            .filter_map(|(_, guid)| self.candidates.iter().find(|item| item.guid == guid))
            .map(|candidate| {
                let entity = candidate.entity(world)?;
                if !entity.is_stackable() {
                    return Ok(None);
                }
                let count = stack_count(entity)?;
                Ok(entity
                    .max_stack_size()
                    .filter(|maximum| count < *maximum)
                    .map(|_| *candidate))
            })
            .collect::<Result<Vec<_>, String>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        for (index, destination) in partial.iter().enumerate() {
            for source in &partial[index + 1..] {
                if let Some(step) = plan_stack_merge(world, source.guid, destination.guid)
                    .map_err(|error| error.to_string())?
                {
                    let deadline = now
                        .checked_add(self.step_timeout)
                        .ok_or("Auto-merge step deadline exceeds the clock range")?
                        .min(self.deadline);
                    self.stage = MergeStage::Awaiting(AwaitingMerge {
                        step,
                        source: *source,
                        destination: *destination,
                        deadline,
                        source_removed: false,
                        continuation: Continuation::Continue,
                    });
                    return Ok(MergeAdvance::Send(MergeDispatch { step, deadline }));
                }
            }
        }
        Ok(MergeAdvance::Finished(AutoMergeOutcome::Completed {
            changed: self.changed,
        }))
    }
}

impl ClientRuntime {
    pub(super) fn emit_auto_merge_result(&self, result: AutoMergeResult) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::AutoMergeFinished(result));
    }

    pub(super) fn observe_auto_merge_removal(&mut self, guid: Guid) {
        if let Some(InventoryOperation::AutoMerge(operation)) = &mut self.inventory_operation {
            operation.observe_removal(guid);
        }
    }

    /// Timer and command admission share expiry; neither depends on receiving another packet.
    pub(super) fn poll_auto_merge(&mut self, now: Instant) {
        let Some(InventoryOperation::AutoMerge(operation)) = &mut self.inventory_operation else {
            return;
        };
        let outcome = match operation.poll(&self.world, now) {
            Ok(outcome) => outcome,
            Err(reason) => Some(AutoMergeOutcome::Stopped(reason)),
        };
        if let Some(outcome) = outcome {
            let result = operation.result(outcome);
            self.inventory_operation = None;
            self.emit_auto_merge_result(result);
        }
    }

    pub(super) async fn start_auto_merge(
        &mut self,
        container: Guid,
        policy: AutoMergePolicy,
    ) -> anyhow::Result<()> {
        let status = self.combat_engagement.status();
        let admitted = if self.state != ClientState::InWorld || self.activation.is_some() {
            Err("Auto-merge requires an active world".into())
        } else if self.inventory_change_pending() || self.active_busy_operation.is_some() {
            Err("Another inventory operation is still pending".into())
        } else if self.world.trade.is_some() || !self.trade_additions.is_empty() {
            Err("Finish trading before auto-merging".into())
        } else if status.state != ClientCombatControlState::Idle
            || status.desired.is_some()
            || self.combat_engagement.has_sent_sequence()
        {
            Err("Stop attacking before auto-merging".into())
        } else {
            ContainerAutoMerge::new(&self.world, container, policy, Instant::now())
        };
        match admitted {
            Ok(operation) => {
                self.inventory_operation = Some(InventoryOperation::AutoMerge(operation));
                self.advance_auto_merge().await
            }
            Err(reason) => {
                self.emit_auto_merge_result(AutoMergeResult {
                    slots_freed: 0,
                    outcome: AutoMergeOutcome::Rejected(reason),
                });
                Ok(())
            }
        }
    }

    pub(super) async fn advance_auto_merge(&mut self) -> anyhow::Result<()> {
        // A physics tick's timestamp can predate awaited work. Dispatch owns a fresh clock.
        let now = Instant::now();
        let Some(InventoryOperation::AutoMerge(operation)) = &mut self.inventory_operation else {
            return Ok(());
        };
        let MergeDispatch { step, deadline } = match operation.advance(&self.world, now) {
            Ok(MergeAdvance::Waiting) => return Ok(()),
            Ok(MergeAdvance::Send(dispatch)) => dispatch,
            Ok(MergeAdvance::Finished(outcome)) => {
                let result = operation.result(outcome);
                self.inventory_operation = None;
                self.emit_auto_merge_result(result);
                return Ok(());
            }
            Err(reason) => {
                self.stop_inventory_operation(&reason);
                return Ok(());
            }
        };
        // Timeout polls an immediately ready send before its timer. Check before dispatch too,
        // so time spent selecting the next pair cannot send a request past its budget.
        if Instant::now() >= deadline {
            self.stop_inventory_operation("Auto-merge deadline elapsed before dispatch");
            return Ok(());
        }
        self.equipment_set.supersede_item(step.source);
        self.equipment_set.supersede_item(step.destination);
        let sent = tokio::time::timeout_at(
            tokio::time::Instant::from_std(deadline),
            self.send_game_action(step.action()),
        )
        .await;
        match sent {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                self.stop_inventory_operation("Could not send the merge request");
                Err(error)
            }
            Err(_) => {
                self.stop_inventory_operation(
                    "Timed out sending the merge request; it may still complete",
                );
                Ok(())
            }
        }
    }

    /// Return true only while a sent merge still prevents the new mutation.
    pub(super) fn interrupt_auto_merge(&mut self, cmd: &ClientCommand) -> bool {
        let conflicts = super::commands::inventory_command_requires_guard(cmd)
            || matches!(
                cmd,
                ClientCommand::SubmitInventory(_)
                    | ClientCommand::GetAndWield { .. }
                    | ClientCommand::SplitToWield { .. }
                    | ClientCommand::SubmitItemUse(_)
                    | ClientCommand::ApplyEquipmentSet(_)
                    | ClientCommand::SubmitSalvage(_)
                    | ClientCommand::Trade(_)
                    | ClientCommand::BeginCombatEngagement { .. }
                    | ClientCommand::UpdateCombatProfile(_)
            );
        if !conflicts {
            return false;
        }
        let Some(InventoryOperation::AutoMerge(operation)) = &mut self.inventory_operation else {
            return false;
        };
        match &mut operation.stage {
            MergeStage::Ready => {
                self.stop_inventory_operation("Interrupted by another action");
                false
            }
            MergeStage::Awaiting(pending) => {
                pending.continuation = Continuation::StopRequested;
                true
            }
        }
    }
}

#[cfg(test)]
mod tests;

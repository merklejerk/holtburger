//! Shared object-appraisal queue, sliding-window burst pacing, and output gating.

use holtburger_common::Guid;
use holtburger_world::WorldEvent;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};
use thiserror::Error;

use super::object_preview::ObjectPreviewPresentationInputs;

/// Conservative default sliding-window duration for `IdentifyObject` sends (ms).
///
/// Servers only throttle repeated failed assessments of the immediately preceding target; interactive
/// frontends supply tighter burst windows explicitly at startup.
pub const DEFAULT_APPRAISAL_RETRY_INTERVAL_MS: u64 = 550;

/// Default maximum `IdentifyObject` requests permitted per interval and in flight simultaneously.
pub const DEFAULT_APPRAISAL_BURST_LIMIT: usize = 1;

/// Default timeout before an unacknowledged inflight `IdentifyObject` releases its slot (ms).
pub const DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS: u64 = 3_000;

/// Wire/startup shape for client appraisal timing policy.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientAppraisalTuningConfig {
    pub assessment_retry_interval_ms: u64,
    pub burst_limit: usize,
    pub response_timeout_ms: u64,
}

/// Validated object-appraisal scheduling, burst window, and timeout policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientAppraisalTuning {
    assessment_retry_interval_ms: u64,
    burst_limit: usize,
    response_timeout_ms: u64,
}

impl ClientAppraisalTuning {
    /// Validates positive window, burst capacity, and inflight response-timeout bounds.
    pub fn new(
        assessment_retry_interval_ms: u64,
        burst_limit: usize,
        response_timeout_ms: u64,
    ) -> Result<Self, ClientAppraisalTuningError> {
        if assessment_retry_interval_ms == 0 {
            return Err(ClientAppraisalTuningError::InvalidRetryInterval);
        }
        if burst_limit == 0 {
            return Err(ClientAppraisalTuningError::InvalidBurstLimit);
        }
        if response_timeout_ms == 0 {
            return Err(ClientAppraisalTuningError::InvalidResponseTimeout);
        }
        Ok(Self {
            assessment_retry_interval_ms,
            burst_limit,
            response_timeout_ms,
        })
    }

    pub const fn assessment_retry_interval_ms(self) -> u64 {
        self.assessment_retry_interval_ms
    }

    pub const fn burst_limit(self) -> usize {
        self.burst_limit
    }

    pub const fn response_timeout_ms(self) -> u64 {
        self.response_timeout_ms
    }
}

impl Default for ClientAppraisalTuning {
    fn default() -> Self {
        Self {
            assessment_retry_interval_ms: DEFAULT_APPRAISAL_RETRY_INTERVAL_MS,
            burst_limit: DEFAULT_APPRAISAL_BURST_LIMIT,
            response_timeout_ms: DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS,
        }
    }
}

impl TryFrom<ClientAppraisalTuningConfig> for ClientAppraisalTuning {
    type Error = ClientAppraisalTuningError;

    fn try_from(value: ClientAppraisalTuningConfig) -> Result<Self, Self::Error> {
        Self::new(
            value.assessment_retry_interval_ms,
            value.burst_limit,
            value.response_timeout_ms,
        )
    }
}

/// Invalid appraisal tuning supplied at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ClientAppraisalTuningError {
    #[error("appraisal retry interval must be greater than zero")]
    InvalidRetryInterval,
    #[error("appraisal burst limit must be greater than zero")]
    InvalidBurstLimit,
    #[error("appraisal response timeout must be greater than zero")]
    InvalidResponseTimeout,
}

/// Output visibility requested by a client or internal appraisal demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppraisalOutputDemand {
    /// Update world facts/health only; suppress inspection/preview view events.
    FactsOnly,
    /// Deliver full inspection view events (`ObjectInspectionResult` and creature preview).
    Full,
}

/// Scheduling queue class derived from demand provenance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppraisalPriority {
    Background,
    Foreground,
}

#[derive(Debug, Clone, Copy, Default)]
struct GuidDemand {
    foreground_full: bool,
    background_facts: bool,
    core_facts: bool,
    allow_cached_preview: bool,
}

impl GuidDemand {
    const fn any(self) -> bool {
        self.foreground_full || self.background_facts || self.core_facts
    }

    const fn priority(self) -> AppraisalPriority {
        if self.foreground_full {
            AppraisalPriority::Foreground
        } else {
            AppraisalPriority::Background
        }
    }

    const fn output_demand(self) -> AppraisalOutputDemand {
        if self.foreground_full {
            AppraisalOutputDemand::Full
        } else {
            AppraisalOutputDemand::FactsOnly
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct InflightAppraisal {
    instance_sequence: Option<u16>,
    sent_at: Instant,
    deliver_full: bool,
    background_facts: bool,
    allow_cached_preview: bool,
    replacement_followup: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct InspectionDeliveryPolicy {
    pub deliver_full: bool,
    pub allow_cached_preview: bool,
}

/// Coordinates outgoing `IdentifyObject` requests in FIFO priority order with sliding-window burst pacing.
#[derive(Debug)]
pub(super) struct AppraisalSystem {
    tuning: ClientAppraisalTuning,
    demands: HashMap<Guid, GuidDemand>,
    foreground_queue: VecDeque<Guid>,
    background_queue: VecDeque<Guid>,
    inflight: HashMap<Guid, InflightAppraisal>,
    recent_sends: VecDeque<Instant>,
    core_facts_target: Option<Guid>,
    core_facts_settled: Option<(Guid, Option<u16>)>,
    cached_creature_preview: Option<(Guid, ObjectPreviewPresentationInputs)>,
    settled_facts: Vec<Guid>,
}

impl AppraisalSystem {
    pub(super) fn new(tuning: ClientAppraisalTuning) -> Self {
        Self {
            tuning,
            demands: HashMap::new(),
            foreground_queue: VecDeque::new(),
            background_queue: VecDeque::new(),
            inflight: HashMap::new(),
            recent_sends: VecDeque::new(),
            core_facts_target: None,
            core_facts_settled: None,
            cached_creature_preview: None,
            settled_facts: Vec::new(),
        }
    }

    /// Registers a foreground (`Full`) or background (`FactsOnly`) demand, deduplicating by GUID.
    pub(super) fn request(
        &mut self,
        guid: Guid,
        instance_sequence: Option<u16>,
        output: AppraisalOutputDemand,
        allow_cached_preview: bool,
    ) {
        if guid == Guid::NULL {
            return;
        }
        if output == AppraisalOutputDemand::Full && !allow_cached_preview {
            self.clear_preview_cache_for(guid);
        }
        if let Some(inflight) = self.inflight.get_mut(&guid) {
            if inflight.instance_sequence == instance_sequence {
                match output {
                    AppraisalOutputDemand::Full => {
                        inflight.deliver_full = true;
                        inflight.allow_cached_preview &= allow_cached_preview;
                    }
                    AppraisalOutputDemand::FactsOnly => {
                        inflight.background_facts = true;
                    }
                }
                return;
            }
            inflight.replacement_followup = true;
        }

        let entry = self.demands.entry(guid).or_default();
        match output {
            AppraisalOutputDemand::Full => {
                let first_full = !entry.foreground_full;
                entry.foreground_full = true;
                entry.allow_cached_preview = if first_full {
                    allow_cached_preview
                } else {
                    entry.allow_cached_preview && allow_cached_preview
                };
            }
            AppraisalOutputDemand::FactsOnly => {
                entry.background_facts = true;
            }
        }
        self.sync_queue_membership(guid);
    }

    /// Reconciles core's internal pending projectile-supply demand without bypassing queue pacing.
    pub(super) fn set_core_facts_target(&mut self, target: Option<(Guid, Option<u16>)>) {
        let target_guid = target.map(|(guid, _)| guid).filter(|g| *g != Guid::NULL);
        if target.is_none() || self.core_facts_target != target_guid {
            self.core_facts_settled = None;
        }
        if let Some(previous) = self.core_facts_target
            && Some(previous) != target_guid
            && let Some(entry) = self.demands.get_mut(&previous)
        {
            entry.core_facts = false;
            self.sync_queue_membership(previous);
        }
        self.core_facts_target = target_guid;

        let Some((guid, instance_sequence)) = target else {
            return;
        };
        if guid == Guid::NULL || self.core_facts_settled == Some((guid, instance_sequence)) {
            return;
        }
        if let Some(inflight) = self.inflight.get_mut(&guid) {
            if inflight.instance_sequence != instance_sequence {
                inflight.replacement_followup = true;
                let entry = self.demands.entry(guid).or_default();
                entry.core_facts = true;
                self.sync_queue_membership(guid);
            }
            return;
        }
        let entry = self.demands.entry(guid).or_default();
        entry.core_facts = true;
        self.sync_queue_membership(guid);
    }

    /// Cancels or downgrades a client demand for `guid`.
    pub(super) fn cancel_client(&mut self, guid: Guid, output: AppraisalOutputDemand) {
        if guid == Guid::NULL {
            return;
        }
        match output {
            AppraisalOutputDemand::Full => {
                self.clear_preview_cache_for(guid);
                if let Some(inflight) = self.inflight.get_mut(&guid) {
                    inflight.deliver_full = false;
                    if !inflight.background_facts
                        && self.core_facts_target != Some(guid)
                        && !self
                            .demands
                            .get(&guid)
                            .is_some_and(|demand| demand.background_facts || demand.core_facts)
                    {
                        inflight.replacement_followup = false;
                    }
                }
            }
            AppraisalOutputDemand::FactsOnly => {
                if let Some(inflight) = self.inflight.get_mut(&guid) {
                    inflight.background_facts = false;
                    if !inflight.deliver_full
                        && self.core_facts_target != Some(guid)
                        && !self
                            .demands
                            .get(&guid)
                            .is_some_and(|demand| demand.foreground_full || demand.core_facts)
                    {
                        inflight.replacement_followup = false;
                    }
                }
            }
        }
        if let Some(entry) = self.demands.get_mut(&guid) {
            match output {
                AppraisalOutputDemand::Full => {
                    entry.foreground_full = false;
                    entry.allow_cached_preview = false;
                }
                AppraisalOutputDemand::FactsOnly => {
                    entry.background_facts = false;
                }
            }
            self.sync_queue_membership(guid);
        }
    }

    /// Drops stale background/core demands on despawn and flags follow-up on live replacements.
    pub(super) fn observe_world_event(&mut self, event: &WorldEvent) {
        match event {
            WorldEvent::EntityDespawned { guid, .. } => {
                self.clear_preview_cache_for(*guid);
                if self.core_facts_settled.is_some_and(|(g, _)| g == *guid) {
                    self.core_facts_settled = None;
                }
                if self.core_facts_target == Some(*guid) {
                    self.core_facts_target = None;
                }
                let mut had_background_facts = false;
                if let Some(inflight) = self.inflight.get_mut(guid) {
                    had_background_facts |= inflight.background_facts;
                    inflight.background_facts = false;
                    inflight.replacement_followup = false;
                }
                if let Some(removed) = self.demands.remove(guid) {
                    had_background_facts |= removed.background_facts;
                }
                self.remove_from_both_queues(*guid);
                if had_background_facts {
                    self.record_settled_facts(*guid);
                }
            }
            WorldEvent::EntitySpawned(entity) | WorldEvent::EntityReplaced(entity) => {
                let guid = entity.guid;
                if matches!(event, WorldEvent::EntityReplaced(_)) {
                    self.clear_preview_cache_for(guid);
                    if self.core_facts_settled.is_some_and(|(g, _)| g == guid) {
                        self.core_facts_settled = None;
                    }
                }
                let has_demand = self.demands.get(&guid).is_some_and(|d| d.any());
                if let Some(inflight) = self.inflight.get_mut(&guid)
                    && (matches!(event, WorldEvent::EntityReplaced(_))
                        || inflight.instance_sequence != Some(entity.instance_sequence()))
                    && (inflight.deliver_full
                        || inflight.background_facts
                        || self.core_facts_target == Some(guid)
                        || has_demand)
                {
                    inflight.replacement_followup = true;
                }
            }
            _ => {}
        }
    }

    /// Completes any matching inflight/pending request when `ObjectInspectionResult` arrives.
    pub(super) fn complete_inspection(&mut self, guid: Guid) -> InspectionDeliveryPolicy {
        if let Some(inflight) = self.inflight.remove(&guid) {
            self.settle_or_requeue_inflight(guid, inflight);
            return InspectionDeliveryPolicy {
                deliver_full: inflight.deliver_full,
                allow_cached_preview: inflight.allow_cached_preview,
            };
        }

        if let Some(entry) = self.demands.remove(&guid) {
            self.remove_from_both_queues(guid);
            if entry.core_facts && self.core_facts_target == Some(guid) {
                self.core_facts_settled = Some((guid, None));
            }
            if entry.background_facts {
                self.record_settled_facts(guid);
            }
            return InspectionDeliveryPolicy {
                deliver_full: entry.foreground_full,
                allow_cached_preview: entry.allow_cached_preview,
            };
        }

        InspectionDeliveryPolicy {
            deliver_full: false,
            allow_cached_preview: false,
        }
    }

    /// Evaluates whether a cached creature preview matches the active inspection session.
    pub(super) fn should_emit_creature_preview(
        &mut self,
        guid: Guid,
        allow_cached: bool,
        inputs: ObjectPreviewPresentationInputs,
    ) -> bool {
        if allow_cached
            && let Some((cached_guid, cached_inputs)) = &self.cached_creature_preview
            && *cached_guid == guid
            && *cached_inputs == inputs
        {
            return false;
        }
        self.cached_creature_preview = Some((guid, inputs));
        true
    }

    pub(super) fn clear_preview_cache_for(&mut self, guid: Guid) {
        if self
            .cached_creature_preview
            .as_ref()
            .is_some_and(|(cached_guid, _)| *cached_guid == guid)
        {
            self.cached_creature_preview = None;
        }
    }

    /// Drains GUIDs whose `FactsOnly` demand settled since the previous drain.
    pub(super) fn drain_settled_facts(&mut self) -> std::vec::Drain<'_, Guid> {
        self.settled_facts.drain(..)
    }

    /// Pops at most one ready `Guid` when inflight capacity and the sliding burst window allow dispatch.
    pub(super) fn pop_next_dispatch<F>(&mut self, now: Instant, resolve_instance: F) -> Option<Guid>
    where
        F: Fn(Guid) -> Option<u16>,
    {
        self.expire_timed_out_inflight(now);
        if self.inflight.len() >= self.tuning.burst_limit {
            return None;
        }
        let retry_interval = Duration::from_millis(self.tuning.assessment_retry_interval_ms);
        while self
            .recent_sends
            .front()
            .is_some_and(|sent_at| now.saturating_duration_since(*sent_at) >= retry_interval)
        {
            self.recent_sends.pop_front();
        }
        if self.recent_sends.len() >= self.tuning.burst_limit {
            return None;
        }

        loop {
            let next_guid = self.pop_next_non_inflight_guid()?;
            let Some(demand) = self.demands.remove(&next_guid) else {
                continue;
            };
            if !demand.any() {
                continue;
            }
            let instance_sequence = resolve_instance(next_guid);
            if instance_sequence.is_none() && demand.output_demand() != AppraisalOutputDemand::Full
            {
                if self.core_facts_target == Some(next_guid) {
                    self.core_facts_target = None;
                }
                if demand.background_facts {
                    self.record_settled_facts(next_guid);
                }
                continue;
            }
            let deliver_full = demand.output_demand() == AppraisalOutputDemand::Full;
            self.inflight.insert(
                next_guid,
                InflightAppraisal {
                    instance_sequence,
                    sent_at: now,
                    deliver_full,
                    background_facts: demand.background_facts,
                    allow_cached_preview: deliver_full && demand.allow_cached_preview,
                    replacement_followup: false,
                },
            );
            self.recent_sends.push_back(now);
            return Some(next_guid);
        }
    }

    /// Expires hung inflight work after `response_timeout_ms`, re-queuing replacements when needed.
    pub(super) fn expire_timed_out_inflight(&mut self, now: Instant) -> bool {
        let timeout = Duration::from_millis(self.tuning.response_timeout_ms);
        let expired: Vec<Guid> = self
            .inflight
            .iter()
            .filter_map(|(guid, inflight)| {
                (now.saturating_duration_since(inflight.sent_at) >= timeout).then_some(*guid)
            })
            .collect();
        if expired.is_empty() {
            return false;
        }
        for guid in expired {
            if let Some(inflight) = self.inflight.remove(&guid) {
                self.settle_or_requeue_inflight(guid, inflight);
            }
        }
        true
    }

    pub(super) fn reset(&mut self) {
        self.demands.clear();
        self.foreground_queue.clear();
        self.background_queue.clear();
        self.inflight.clear();
        self.recent_sends.clear();
        self.core_facts_target = None;
        self.core_facts_settled = None;
        self.cached_creature_preview = None;
        self.settled_facts.clear();
    }

    fn pop_next_non_inflight_guid(&mut self) -> Option<Guid> {
        for queue in [&mut self.foreground_queue, &mut self.background_queue] {
            if let Some(index) = queue
                .iter()
                .position(|guid| !self.inflight.contains_key(guid))
            {
                return queue.remove(index);
            }
        }
        None
    }

    fn settle_or_requeue_inflight(&mut self, guid: Guid, inflight: InflightAppraisal) {
        if self.core_facts_target == Some(guid) && !inflight.replacement_followup {
            self.core_facts_settled = Some((guid, inflight.instance_sequence));
        }
        if inflight.replacement_followup {
            if inflight.deliver_full {
                let entry = self.demands.entry(guid).or_default();
                entry.foreground_full = true;
                entry.allow_cached_preview = false;
            }
            if inflight.background_facts {
                let entry = self.demands.entry(guid).or_default();
                entry.background_facts = true;
            }
            if self.core_facts_target == Some(guid) {
                let entry = self.demands.entry(guid).or_default();
                entry.core_facts = true;
            }
            self.sync_queue_membership(guid);
        } else if inflight.background_facts {
            self.record_settled_facts(guid);
        }
    }

    fn record_settled_facts(&mut self, guid: Guid) {
        if !self.settled_facts.contains(&guid) {
            self.settled_facts.push(guid);
        }
    }

    fn sync_queue_membership(&mut self, guid: Guid) {
        let Some(demand) = self.demands.get(&guid).copied() else {
            self.remove_from_both_queues(guid);
            return;
        };
        if !demand.any() {
            self.demands.remove(&guid);
            self.remove_from_both_queues(guid);
            return;
        }
        match demand.priority() {
            AppraisalPriority::Foreground => {
                self.background_queue.retain(|queued| *queued != guid);
                if !self.foreground_queue.contains(&guid) {
                    self.foreground_queue.push_back(guid);
                }
            }
            AppraisalPriority::Background => {
                self.foreground_queue.retain(|queued| *queued != guid);
                if !self.background_queue.contains(&guid) {
                    self.background_queue.push_back(guid);
                }
            }
        }
    }

    fn remove_from_both_queues(&mut self, guid: Guid) {
        self.foreground_queue.retain(|queued| *queued != guid);
        self.background_queue.retain(|queued| *queued != guid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tuning_validates_positive_bounds() {
        assert_eq!(
            ClientAppraisalTuning::new(
                0,
                DEFAULT_APPRAISAL_BURST_LIMIT,
                DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS,
            ),
            Err(ClientAppraisalTuningError::InvalidRetryInterval)
        );
        assert_eq!(
            ClientAppraisalTuning::new(
                DEFAULT_APPRAISAL_RETRY_INTERVAL_MS,
                0,
                DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS,
            ),
            Err(ClientAppraisalTuningError::InvalidBurstLimit)
        );
        assert_eq!(
            ClientAppraisalTuning::new(
                DEFAULT_APPRAISAL_RETRY_INTERVAL_MS,
                DEFAULT_APPRAISAL_BURST_LIMIT,
                0,
            ),
            Err(ClientAppraisalTuningError::InvalidResponseTimeout)
        );

        let valid = ClientAppraisalTuning::new(
            DEFAULT_APPRAISAL_RETRY_INTERVAL_MS,
            3,
            DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS,
        )
        .unwrap();
        assert_eq!(
            valid.assessment_retry_interval_ms(),
            DEFAULT_APPRAISAL_RETRY_INTERVAL_MS
        );
        assert_eq!(valid.burst_limit(), 3);
        assert_eq!(
            valid.response_timeout_ms(),
            DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS
        );
    }

    #[test]
    fn foreground_promotes_and_preempts_fifo_background_with_dedup_and_single_slot_pacing() {
        let mut system = AppraisalSystem::new(ClientAppraisalTuning::default());
        let start = Instant::now();
        let retry = Duration::from_millis(DEFAULT_APPRAISAL_RETRY_INTERVAL_MS);
        let bg_a = Guid(10);
        let bg_b = Guid(11);
        let fg = Guid(12);

        system.request(bg_a, Some(1), AppraisalOutputDemand::FactsOnly, false);
        system.request(bg_b, Some(1), AppraisalOutputDemand::FactsOnly, false);
        system.request(bg_b, Some(1), AppraisalOutputDemand::FactsOnly, false);
        system.request(fg, Some(1), AppraisalOutputDemand::Full, false);
        // Promote bg_b to Foreground/Full while queued.
        system.request(bg_b, Some(1), AppraisalOutputDemand::Full, false);

        // Foreground FIFO first: fg then promoted bg_b, then background bg_a.
        assert_eq!(system.pop_next_dispatch(start, |_| Some(1)), Some(fg));
        // Second dispatch blocked while first is inflight even if retry interval elapsed.
        assert_eq!(
            system.pop_next_dispatch(start + retry + Duration::from_millis(50), |_| Some(1)),
            None
        );

        let policy = system.complete_inspection(fg);
        assert!(policy.deliver_full);
        assert!(!policy.allow_cached_preview);
        assert_eq!(system.drain_settled_facts().collect::<Vec<_>>(), vec![]);

        // Blocked before assessment_retry_interval_ms even after completion.
        assert_eq!(
            system.pop_next_dispatch(start + retry - Duration::from_millis(1), |_| Some(1)),
            None
        );
        // Dispatches promoted bg_b at retry boundary; settles its paired background_facts too.
        let t1 = start + retry;
        assert_eq!(system.pop_next_dispatch(t1, |_| Some(1)), Some(bg_b));
        assert!(system.complete_inspection(bg_b).deliver_full);
        assert_eq!(system.drain_settled_facts().collect::<Vec<_>>(), vec![bg_b]);

        // Dispatches background bg_a at next boundary with FactsOnly output gating.
        let t2 = t1 + retry;
        assert_eq!(system.pop_next_dispatch(t2, |_| Some(1)), Some(bg_a));
        assert!(!system.complete_inspection(bg_a).deliver_full);
        assert_eq!(system.drain_settled_facts().collect::<Vec<_>>(), vec![bg_a]);
        assert_eq!(
            system.pop_next_dispatch(t2 + Duration::from_secs(10), |_| Some(1)),
            None
        );
    }

    #[test]
    fn cancellation_timeout_and_replacement_handle_queued_and_inflight_demands() {
        let mut system = AppraisalSystem::new(ClientAppraisalTuning::default());
        let start = Instant::now();
        let retry = Duration::from_millis(DEFAULT_APPRAISAL_RETRY_INTERVAL_MS);
        let timeout = Duration::from_millis(DEFAULT_APPRAISAL_RESPONSE_TIMEOUT_MS);
        let guid = Guid(0x5000_0001);

        // Enqueue both background + foreground, then cancel foreground -> stays in background.
        system.request(guid, Some(1), AppraisalOutputDemand::FactsOnly, false);
        system.request(guid, Some(1), AppraisalOutputDemand::Full, false);
        system.cancel_client(guid, AppraisalOutputDemand::Full);
        assert_eq!(system.pop_next_dispatch(start, |_| Some(1)), Some(guid));

        // Promote inflight background -> Full while waiting for response, then cancel Full.
        system.request(guid, Some(1), AppraisalOutputDemand::Full, false);
        system.cancel_client(guid, AppraisalOutputDemand::Full);
        assert!(!system.complete_inspection(guid).deliver_full);
        assert_eq!(system.drain_settled_facts().collect::<Vec<_>>(), vec![guid]);

        // Background facts replaced while inflight re-queues follow-up before settling.
        let t1 = start + retry;
        system.request(guid, Some(1), AppraisalOutputDemand::FactsOnly, false);
        assert_eq!(system.pop_next_dispatch(t1, |_| Some(1)), Some(guid));
        let replaced =
            holtburger_world::entity::Entity::new(guid, "Replaced".into(), Default::default());
        system.observe_world_event(&WorldEvent::EntityReplaced(Box::new(replaced)));
        assert!(!system.complete_inspection(guid).deliver_full);
        assert!(system.drain_settled_facts().next().is_none());

        let t2 = t1 + retry;
        assert_eq!(system.pop_next_dispatch(t2, |_| Some(2)), Some(guid));
        assert!(!system.complete_inspection(guid).deliver_full);
        assert_eq!(system.drain_settled_facts().collect::<Vec<_>>(), vec![guid]);

        // Hung request expires after response_timeout_ms and permits replacement followup.
        let t3 = t2 + retry;
        system.request(guid, Some(2), AppraisalOutputDemand::Full, false);
        assert_eq!(system.pop_next_dispatch(t3, |_| Some(2)), Some(guid));
        system.request(guid, Some(3), AppraisalOutputDemand::Full, false);
        assert!(!system.expire_timed_out_inflight(t3 + timeout - Duration::from_millis(1)));
        let t4 = t3 + timeout;
        assert_eq!(system.pop_next_dispatch(t4, |_| Some(3)), Some(guid));
        assert!(system.complete_inspection(guid).deliver_full);

        // Unresolvable background facts GUID settles immediately when popped.
        let missing = Guid(0x5000_0099);
        system.request(missing, Some(1), AppraisalOutputDemand::FactsOnly, false);
        assert_eq!(system.pop_next_dispatch(t4 + retry, |_| None), None);
        assert_eq!(
            system.drain_settled_facts().collect::<Vec<_>>(),
            vec![missing]
        );
    }

    #[test]
    fn synthetic_warmup_and_combat_load_never_starves_foreground() {
        for rtt_ms in [120_u64, 400, 800] {
            let mut system = AppraisalSystem::new(ClientAppraisalTuning::default());
            let start = Instant::now();
            let step = Duration::from_millis(25);

            // Enqueue 20 inventory warmup equipment items + 3 combat mobs.
            for index in 0..20_u32 {
                system.request(
                    Guid(0x5000_0100 + index),
                    Some(1),
                    AppraisalOutputDemand::FactsOnly,
                    false,
                );
            }
            for mob in 0..3_u32 {
                system.request(
                    Guid(0x8000_0001 + mob),
                    Some(1),
                    AppraisalOutputDemand::FactsOnly,
                    false,
                );
            }

            // Cancel a stale item mid-warmup before it dispatches.
            let cancelled = Guid(0x5000_0105);
            system.cancel_client(cancelled, AppraisalOutputDemand::FactsOnly);

            let fg = Guid(0x9000_0001);
            let mut fg_requested = false;
            let mut fg_dispatched_at = None;
            let mut dispatched = Vec::<(Instant, Guid)>::new();
            let mut pending_reply: Option<(Instant, Guid)> = None;
            let mut now = start;

            for _ in 0..2_000 {
                if let Some((reply_at, guid)) = pending_reply
                    && now >= reply_at
                {
                    let _ = system.complete_inspection(guid);
                    pending_reply = None;
                }

                // Trigger a foreground click right after the first two background items dispatch.
                if !fg_requested && dispatched.len() == 2 {
                    system.request(fg, Some(1), AppraisalOutputDemand::Full, false);
                    fg_requested = true;
                }

                if let Some(guid) = system.pop_next_dispatch(now, |_| Some(1)) {
                    assert_ne!(guid, cancelled, "cancelled GUID must never dispatch");
                    if guid == fg {
                        fg_dispatched_at = Some(now);
                    }
                    dispatched.push((now, guid));
                    pending_reply = Some((now + Duration::from_millis(rtt_ms), guid));
                }

                if dispatched.len() == 23 && pending_reply.is_none() {
                    break;
                }
                now += step;
            }

            // Every non-cancelled item + mob + foreground click (19 + 3 + 1 = 23) completed.
            assert_eq!(dispatched.len(), 23);
            // Foreground preempted queued warmup/combat entries immediately at slot #3.
            assert_eq!(dispatched[2].1, fg);
            assert!(fg_dispatched_at.is_some());

            // Verify minimum spacing and single-slot RTT serialization.
            let min_gap_ms = DEFAULT_APPRAISAL_RETRY_INTERVAL_MS.max(rtt_ms);
            for window in dispatched.windows(2) {
                assert!(
                    window[1].0.duration_since(window[0].0) >= Duration::from_millis(min_gap_ms),
                    "gap violated single-slot/cooldown invariant for rtt={rtt_ms}ms"
                );
            }
        }
    }

    #[test]
    fn sliding_window_burst_pipelines_up_to_limit_and_caps_rate() {
        let interval = Duration::from_millis(100);
        let timeout = Duration::from_millis(3_000);
        let mut system = AppraisalSystem::new(ClientAppraisalTuning::new(100, 3, 3_000).unwrap());
        let start = Instant::now();
        let guids: Vec<Guid> = (1..=6).map(Guid).collect();
        for &guid in &guids {
            system.request(guid, Some(1), AppraisalOutputDemand::FactsOnly, false);
        }

        // First burst of 3 dispatches immediately at t=0, fourth blocked by both inflight and window.
        assert_eq!(system.pop_next_dispatch(start, |_| Some(1)), Some(Guid(1)));
        assert_eq!(system.pop_next_dispatch(start, |_| Some(1)), Some(Guid(2)));
        assert_eq!(system.pop_next_dispatch(start, |_| Some(1)), Some(Guid(3)));
        assert_eq!(system.pop_next_dispatch(start, |_| Some(1)), None);

        // Completing all 3 at t=20ms frees inflight slots, but window still blocks until t=100ms.
        for guid in [Guid(1), Guid(2), Guid(3)] {
            assert!(!system.complete_inspection(guid).deliver_full);
        }
        assert_eq!(
            system.pop_next_dispatch(start + Duration::from_millis(99), |_| Some(1)),
            None
        );

        // At t=100ms the 3-slot window reopens; dispatch 4 and 5, leaving 1 window slot.
        let t1 = start + interval;
        assert_eq!(system.pop_next_dispatch(t1, |_| Some(1)), Some(Guid(4)));
        assert_eq!(system.pop_next_dispatch(t1, |_| Some(1)), Some(Guid(5)));
        // Replacement for inflight Guid(4) stays queued without double-dispatching Guid(4).
        system.request(Guid(4), Some(2), AppraisalOutputDemand::Full, false);
        assert_eq!(system.pop_next_dispatch(t1, |_| Some(2)), Some(Guid(6)));
        assert_eq!(system.pop_next_dispatch(t1, |_| Some(2)), None);

        // Timeout expires only hung entries (4, 5, 6), re-queueing Guid(4)'s replacement follow-up.
        let t2 = t1 + timeout;
        assert_eq!(system.pop_next_dispatch(t2, |_| Some(2)), Some(Guid(4)));
        assert!(system.complete_inspection(Guid(4)).deliver_full);
    }
}

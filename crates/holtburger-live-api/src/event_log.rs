//! Bounded `seq`-indexed semantic event ring buffer with cursor long-polling and separate live motion feed.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::{
    BusyOperationResult, ChatSpeaker, ClientLifecycleState, CombatFeedback,
};
use serde_json::json;
use tokio::sync::{Notify, broadcast};

use crate::types::{
    ApiEvent, ApiEventEnvelope, ApiEventTopic, AppraisalStatus, ConfirmationView, EventSpeaker,
    EventsPage, LifecyclePhaseView, MAX_WAIT_TIMEOUT_MS, MotionEventFrame, TradeSessionView,
    TradeSideView, TradeView, VendorItemView, VendorValueLimitsView, VendorView, to_camel_json,
};

pub const EVENT_LOG_CAPACITY: usize = 2_048;
const MOTION_CHANNEL_CAPACITY: usize = 256;

struct RingState {
    next_seq: u64,
    dropped_before: Option<u64>,
    buffer: VecDeque<ApiEventEnvelope>,
    /// Last emitted health fraction per entity GUID to suppress redundant unchanged poll events.
    last_health: HashMap<Guid, u32>,
}

/// Thread-safe semantic event store supporting both REST cursor long-polling and live WS fan-out.
#[derive(Clone)]
pub struct EventLog {
    state: Arc<Mutex<RingState>>,
    notify: Arc<Notify>,
    live_tx: broadcast::Sender<ApiEventEnvelope>,
    motion_tx: broadcast::Sender<MotionEventFrame>,
}

impl Default for EventLog {
    fn default() -> Self {
        Self::new()
    }
}

impl EventLog {
    pub fn new() -> Self {
        let (live_tx, _) = broadcast::channel(EVENT_LOG_CAPACITY);
        let (motion_tx, _) = broadcast::channel(MOTION_CHANNEL_CAPACITY);
        Self {
            state: Arc::new(Mutex::new(RingState {
                next_seq: 1,
                dropped_before: None,
                buffer: VecDeque::with_capacity(EVENT_LOG_CAPACITY),
                last_health: HashMap::new(),
            })),
            notify: Arc::new(Notify::new()),
            live_tx,
            motion_tx,
        }
    }

    pub fn latest_seq(&self) -> u64 {
        let guard = self.state.lock().expect("event log mutex poisoned");
        guard.next_seq.saturating_sub(1)
    }

    pub fn push(&self, topic: ApiEventTopic, event: ApiEvent) -> ApiEventEnvelope {
        let envelope = {
            let mut guard = self.state.lock().expect("event log mutex poisoned");
            let seq = guard.next_seq;
            guard.next_seq = guard.next_seq.saturating_add(1);
            let envelope = ApiEventEnvelope {
                seq,
                timestamp_ms: unix_timestamp_ms(),
                topic,
                event,
            };
            if guard.buffer.len() >= EVENT_LOG_CAPACITY
                && let Some(evicted) = guard.buffer.pop_front()
            {
                guard.dropped_before = Some(evicted.seq.saturating_add(1));
            }
            guard.buffer.push_back(envelope.clone());
            envelope
        };
        let _ = self.live_tx.send(envelope.clone());
        self.notify.notify_waiters();
        envelope
    }

    /// Emits `EntityHealthUpdated` only when `health_fraction` actually changed for `guid`.
    pub fn push_health_if_changed(&self, guid: Guid, health_fraction: f32) {
        let bits = health_fraction.to_bits();
        {
            let mut guard = self.state.lock().expect("event log mutex poisoned");
            if guard.last_health.insert(guid, bits) == Some(bits) {
                return;
            }
        }
        self.push(
            ApiEventTopic::EntitiesHealth,
            ApiEvent::EntityHealthUpdated {
                guid,
                health_fraction,
            },
        );
    }

    /// Clears cached health deduplication state when an entity spawns or despawns.
    pub fn clear_entity_health_cache(&self, guid: Guid) {
        self.state
            .lock()
            .expect("event log mutex poisoned")
            .last_health
            .remove(&guid);
    }

    pub fn push_motion(&self, guid: holtburger_common::Guid, position: holtburger_common::position::WorldPosition) {
        if self.motion_tx.receiver_count() == 0 {
            return;
        }
        let _ = self.motion_tx.send(MotionEventFrame {
            guid,
            position,
            timestamp_ms: unix_timestamp_ms(),
        });
    }

    pub fn subscribe_live(&self) -> broadcast::Receiver<ApiEventEnvelope> {
        self.live_tx.subscribe()
    }

    pub fn clear_all_entity_health_cache(&self) {
        self.state
            .lock()
            .expect("event log mutex poisoned")
            .last_health
            .clear();
    }

    pub fn subscribe_motion(&self) -> broadcast::Receiver<MotionEventFrame> {
        self.motion_tx.subscribe()
    }

    /// Reads events with `seq > since`, optionally long-polling up to `wait_ms` when none match.
    pub async fn poll(
        &self,
        since: u64,
        topics: Option<&HashSet<ApiEventTopic>>,
        limit: usize,
        wait_ms: u32,
    ) -> EventsPage {
        let limit = limit.clamp(1, 500);
        let wait_ms = wait_ms.min(MAX_WAIT_TIMEOUT_MS);
        let deadline = tokio::time::Instant::now() + Duration::from_millis(u64::from(wait_ms));

        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            // Register in Notify's waiter list BEFORE reading so concurrent pushes cannot miss wakeup.
            notified.as_mut().enable();
            let page = self.read_since(since, topics, limit);
            if !page.events.is_empty() || wait_ms == 0 {
                return page;
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return page;
            }
            let remaining = deadline.saturating_duration_since(now);
            if tokio::time::timeout(remaining, notified).await.is_err() {
                return self.read_since(since, topics, limit);
            }
        }
    }

    /// Non-blocking snapshot of matching events with `seq > since`.
    pub fn read_since(
        &self,
        since: u64,
        topics: Option<&HashSet<ApiEventTopic>>,
        limit: usize,
    ) -> EventsPage {
        let guard = self.state.lock().expect("event log mutex poisoned");
        let dropped_before = guard
            .dropped_before
            .filter(|&dropped| since > 0 && since.saturating_add(1) < dropped);
        let mut events = Vec::new();
        let mut next_seq = since;

        for env in &guard.buffer {
            if env.seq <= since {
                continue;
            }
            if topics.is_some_and(|filter| !filter.is_empty() && !filter.contains(&env.topic)) {
                next_seq = env.seq;
                continue;
            }
            next_seq = env.seq;
            events.push(env.clone());
            if events.len() >= limit {
                break;
            }
        }
        if events.is_empty() {
            next_seq = guard.next_seq.saturating_sub(1).max(since);
        }

        EventsPage {
            events,
            next_seq,
            dropped_before,
        }
    }
}

pub fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

pub fn project_lifecycle(state: &ClientLifecycleState) -> LifecyclePhaseView {
    match state {
        ClientLifecycleState::Connecting => LifecyclePhaseView::Connecting,
        ClientLifecycleState::Authenticating => LifecyclePhaseView::Authenticating,
        ClientLifecycleState::CharacterSelection {
            rejection,
            max_slots,
            characters,
        } => LifecyclePhaseView::CharacterSelection {
            max_slots: *max_slots,
            characters: characters.clone(),
            rejection: rejection.as_ref().map(ToString::to_string),
        },
        ClientLifecycleState::EnteringWorld { character_guid } => {
            LifecyclePhaseView::EnteringWorld {
                character_guid: *character_guid,
            }
        }
        ClientLifecycleState::PortalSpace {
            world_generation,
            cause,
        } => LifecyclePhaseView::PortalSpace {
            world_generation: *world_generation,
            cause: *cause,
        },
        ClientLifecycleState::InWorld => LifecyclePhaseView::InWorld,
        ClientLifecycleState::LoggingOut => LifecyclePhaseView::LoggingOut,
        ClientLifecycleState::Exiting { outcome } => LifecyclePhaseView::Exiting {
            reason: outcome.diagnostic(),
        },
    }
}

pub fn project_confirmation(
    confirmation: &holtburger_core::ActiveCharacterConfirmation,
) -> ConfirmationView {
    ConfirmationView {
        request_id: confirmation.request_id,
        confirmation_type: format!("{:?}", confirmation.confirmation_type),
        context: confirmation.context,
        text: confirmation.text.clone(),
    }
}

fn project_speaker(speaker: &ChatSpeaker) -> EventSpeaker {
    EventSpeaker {
        name: speaker.name().to_string(),
        kind: speaker.kind(),
        reply_target: speaker.tell_target(),
    }
}

fn project_combat_feedback(feedback: &CombatFeedback) -> serde_json::Value {
    match feedback {
        CombatFeedback::AttackDone { error } => json!({
            "kind": "attack-done",
            "error": format!("{error:?}"),
            "ok": *error == holtburger_protocol::errors::WeenieError::None,
        }),
        CombatFeedback::AttackCommenced => json!({ "kind": "attack-commenced" }),
        CombatFeedback::AttackerNotification {
            defender_name,
            damage_type,
            health_percent,
            damage,
            critical_hit,
            ..
        } => json!({
            "kind": "attacker-notification",
            "defenderName": defender_name,
            "damageType": format!("{damage_type:?}"),
            "healthPercent": health_percent,
            "damage": damage,
            "criticalHit": critical_hit,
        }),
        CombatFeedback::DefenderNotification {
            attacker_name,
            damage_type,
            health_percent,
            damage,
            damage_location,
            critical_hit,
            ..
        } => json!({
            "kind": "defender-notification",
            "attackerName": attacker_name,
            "damageType": format!("{damage_type:?}"),
            "healthPercent": health_percent,
            "damage": damage,
            "damageLocation": format!("{damage_location:?}"),
            "criticalHit": critical_hit,
        }),
        CombatFeedback::EvasionAttackerNotification { defender_name, .. } => json!({
            "kind": "evasion-attacker",
            "defenderName": defender_name,
        }),
        CombatFeedback::EvasionDefenderNotification { attacker_name } => json!({
            "kind": "evasion-defender",
            "attackerName": attacker_name,
        }),
        CombatFeedback::VictimNotification { death_message } => json!({
            "kind": "victim-notification",
            "deathMessage": death_message,
        }),
        CombatFeedback::KillerNotification { death_message } => json!({
            "kind": "killer-notification",
            "deathMessage": death_message,
        }),
        CombatFeedback::PlayerKilled {
            death_message,
            victim_id,
            killer_id,
        } => json!({
            "kind": "player-killed",
            "deathMessage": death_message,
            "victimId": victim_id,
            "killerId": killer_id,
        }),
    }
}

/// Projects core's player-to-player trade snapshot into the typed `camelCase` Live API view.
pub(crate) fn project_trade(
    snapshot: &holtburger_core::client::trade::TradeSnapshot,
) -> TradeView {
    TradeView {
        trade: snapshot.trade.as_ref().map(|t| TradeSessionView {
            revision: t.revision,
            initiator_guid: t.initiator_guid,
            partner_guid: t.partner_guid,
            self_side: TradeSideView {
                guid: t.self_side.guid,
                accepted: t.self_side.accepted,
                items: t.self_side.items.clone(),
            },
            partner_side: TradeSideView {
                guid: t.partner_side.guid,
                accepted: t.partner_side.accepted,
                items: t.partner_side.items.clone(),
            },
        }),
        pending_items: snapshot.pending_items.clone(),
    }
}

/// Projects world's open vendor state into the typed `camelCase` Live API view.
pub(crate) fn project_vendor(vendor: &holtburger_world::vendor::VendorState) -> VendorView {
    VendorView {
        vendor_guid: vendor.vendor_guid,
        buy_multiplier: vendor.buy_multiplier,
        sell_multiplier: vendor.sell_multiplier,
        merchandise_item_types: vendor.merchandise_item_types,
        value_limits: VendorValueLimitsView {
            minimum: vendor.value_limits.minimum,
            maximum: vendor.value_limits.maximum,
        },
        alternate_currency_wcid: vendor.alternate_currency_wcid,
        alternate_currency_amount: vendor.alternate_currency_amount,
        alternate_currency_name: vendor.alternate_currency_name.clone(),
        items: vendor
            .items
            .iter()
            .map(|item| {
                let category = serde_json::to_value(item.category())
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_else(|| "other".into());
                VendorItemView {
                    guid: item.guid,
                    name: item.name().to_string(),
                    wcid: item.wcid,
                    category,
                    value: item.item_value(),
                    unit_buy_price: vendor.purchase_price(item, 1).ok(),
                    stack_count: item.stack_size(),
                    max_stack_size: item.max_stack_size(),
                    vendor_supply: item.vendor_supply,
                }
            })
            .collect(),
    }
}

/// Projects a `ClientViewEvent` into the semantic ring buffer or live motion feed.
pub fn ingest_client_view_event(log: &EventLog, event: &ClientViewEvent) {
    match event {
        ClientViewEvent::EntityMoved { guid, pos } => {
            log.push_motion(*guid, *pos);
        }
        ClientViewEvent::LifecycleChanged(lifecycle) => {
            if matches!(
                lifecycle,
                ClientLifecycleState::PortalSpace { .. }
                    | ClientLifecycleState::LoggingOut
                    | ClientLifecycleState::CharacterSelection { .. }
                    | ClientLifecycleState::Exiting { .. }
            ) {
                log.clear_all_entity_health_cache();
            }
            log.push(
                ApiEventTopic::Lifecycle,
                ApiEvent::LifecycleChanged {
                    lifecycle: project_lifecycle(lifecycle),
                },
            );
        }
        ClientViewEvent::BusyStateUpdated { busy } => {
            log.push(ApiEventTopic::Busy, ApiEvent::BusyStateChanged { busy: *busy });
        }
        ClientViewEvent::BusyOperationFinished { operation, result } => {
            let (succeeded, error, timed_out) = match result {
                BusyOperationResult::Completed { error, parameter } => {
                    let ok = *error == holtburger_protocol::errors::WeenieError::None;
                    let msg = (!ok).then(|| {
                        holtburger_core::errors::format_weenie_error(*error, parameter.as_deref())
                    });
                    (ok, msg, false)
                }
                BusyOperationResult::Failed { message } => (false, Some(message.clone()), false),
                BusyOperationResult::TimedOut => (false, Some("timed out".into()), true),
            };
            log.push(
                ApiEventTopic::Busy,
                ApiEvent::BusyOperationFinished {
                    operation: *operation,
                    succeeded,
                    error,
                    timed_out,
                },
            );
        }
        ClientViewEvent::ActiveCharacterConfirmationUpdated { confirmation } => {
            log.push(
                ApiEventTopic::Confirmations,
                ApiEvent::ConfirmationChanged {
                    confirmation: confirmation.as_ref().map(project_confirmation),
                },
            );
        }
        ClientViewEvent::WeenieError { error, parameter } => {
            log.push(
                ApiEventTopic::Errors,
                ApiEvent::ErrorNotice {
                    source: "weenie".into(),
                    message: holtburger_core::errors::format_weenie_error(
                        *error,
                        parameter.as_deref(),
                    ),
                },
            );
        }
        ClientViewEvent::ActionResult { source, reason } => {
            log.push(
                ApiEventTopic::Errors,
                ApiEvent::ErrorNotice {
                    source: format!("{source:?}").to_lowercase(),
                    message: holtburger_core::errors::format_action_result_message(reason),
                },
            );
        }
        ClientViewEvent::ChatError { message } => {
            log.push(
                ApiEventTopic::Errors,
                ApiEvent::ErrorNotice {
                    source: "chat".into(),
                    message: message.clone(),
                },
            );
        }
        ClientViewEvent::PlayerVitalsUpdated { .. } => {
            log.push(ApiEventTopic::Vitals, ApiEvent::VitalsUpdated);
        }
        ClientViewEvent::PlayerEnchantmentsUpdated { .. } => {
            log.push(ApiEventTopic::Enchantments, ApiEvent::EnchantmentsUpdated);
        }
        ClientViewEvent::PlayerSpellsUpdated { spell_ids } => {
            log.push(
                ApiEventTopic::Spellbook,
                ApiEvent::SpellbookUpdated {
                    spell_ids: spell_ids.clone(),
                },
            );
        }
        ClientViewEvent::CharacterSheetUpdated(_) => {
            log.push(ApiEventTopic::CharacterSheet, ApiEvent::CharacterSheetUpdated);
        }
        ClientViewEvent::EntitySpawned { entity } | ClientViewEvent::EntityReplaced { entity } => {
            log.clear_entity_health_cache(entity.guid);
            log.push(
                ApiEventTopic::EntitiesLifecycle,
                ApiEvent::EntitySpawned {
                    guid: entity.guid,
                    name: entity.name().to_string(),
                    wcid: entity.wcid,
                },
            );
        }
        ClientViewEvent::EntityDespawned { guid } => {
            log.clear_entity_health_cache(*guid);
            log.push(
                ApiEventTopic::EntitiesLifecycle,
                ApiEvent::EntityDespawned { guid: *guid },
            );
        }
        ClientViewEvent::EntityFactsChanged(delta) => {
            let upserted: Vec<_> = delta.upserts.iter().map(|e| e.guid).collect();
            let removed = delta.removed.clone();
            if !upserted.is_empty() || !removed.is_empty() {
                log.push(
                    ApiEventTopic::EntitiesFacts,
                    ApiEvent::EntityFactsChanged { upserted, removed },
                );
            }
        }
        ClientViewEvent::EntityHealthUpdated {
            guid,
            health_fraction,
            ..
        } => {
            log.push_health_if_changed(*guid, *health_fraction);
        }
        ClientViewEvent::AppraisalFactsSettled { guid } => {
            log.push(
                ApiEventTopic::Appraisal,
                ApiEvent::AppraisalCompleted {
                    guid: *guid,
                    facts_only: true,
                    status: AppraisalStatus::FactsOnly,
                    reason: None,
                    inspection: None,
                },
            );
        }
        ClientViewEvent::ObjectInspectionResult(result) => {
            let (status, reason, inspection) = match &result.outcome {
                holtburger_world::inspection::ObjectInspectionOutcome::Ready { inspection } => (
                    AppraisalStatus::Ready,
                    None,
                    to_camel_json(inspection),
                ),
                holtburger_world::inspection::ObjectInspectionOutcome::Rejected => {
                    (AppraisalStatus::Rejected, None, None)
                }
                holtburger_world::inspection::ObjectInspectionOutcome::Missing => {
                    (AppraisalStatus::Missing, None, None)
                }
                holtburger_world::inspection::ObjectInspectionOutcome::Unavailable { reason } => {
                    (AppraisalStatus::Unavailable, Some(reason.clone()), None)
                }
            };
            log.push(
                ApiEventTopic::Appraisal,
                ApiEvent::AppraisalCompleted {
                    guid: result.guid,
                    facts_only: false,
                    status,
                    reason,
                    inspection,
                },
            );
        }
        ClientViewEvent::CombatFeedback(feedback) => {
            log.push(
                ApiEventTopic::Combat,
                ApiEvent::CombatFeedback {
                    detail: project_combat_feedback(feedback),
                },
            );
        }
        ClientViewEvent::CombatStatusUpdated(status) => {
            log.push(
                ApiEventTopic::Combat,
                ApiEvent::CombatStatusUpdated {
                    state: status.state,
                    target: status.desired.map(|d| d.target),
                },
            );
        }
        ClientViewEvent::SpellCastTargetUpdated { target } => {
            log.push(
                ApiEventTopic::Magic,
                ApiEvent::SpellCastTargetUpdated { target: *target },
            );
        }
        ClientViewEvent::ItemUseFinished(finished) => {
            log.push(
                ApiEventTopic::Crafting,
                ApiEvent::ItemUseFinished {
                    sequence: finished.sequence,
                    outcome: to_camel_json(&finished.outcome).unwrap_or(serde_json::Value::Null),
                },
            );
        }
        ClientViewEvent::SalvageSubmitted(submitted) => {
            log.push(
                ApiEventTopic::Crafting,
                ApiEvent::SalvageSubmitted {
                    sequence: submitted.sequence,
                    outcome: to_camel_json(&submitted.outcome).unwrap_or(serde_json::Value::Null),
                },
            );
        }
        ClientViewEvent::TradeStateUpdated(trade) => {
            log.push(
                ApiEventTopic::Trade,
                ApiEvent::TradeUpdated {
                    trade: project_trade(trade),
                },
            );
        }
        ClientViewEvent::VendorApproached { vendor } => {
            log.push(
                ApiEventTopic::Vendor,
                ApiEvent::VendorUpdated {
                    vendor: Some(project_vendor(vendor)),
                },
            );
        }
        ClientViewEvent::VendorStateUpdated { vendor } => {
            log.push(
                ApiEventTopic::Vendor,
                ApiEvent::VendorUpdated {
                    vendor: vendor.as_ref().map(project_vendor),
                },
            );
        }
        ClientViewEvent::VendorTradeFinished(result) => {
            log.push(
                ApiEventTopic::Vendor,
                ApiEvent::VendorTradeFinished {
                    sequence: result.sequence,
                    result: to_camel_json(result).unwrap_or(serde_json::Value::Null),
                },
            );
        }
        ClientViewEvent::Chat {
            speaker, message, ..
        } => {
            log.push(
                ApiEventTopic::Chat,
                ApiEvent::Chat {
                    channel: "say".into(),
                    speaker: Some(project_speaker(speaker)),
                    message: message.clone(),
                },
            );
        }
        ClientViewEvent::Tell {
            speaker, message, ..
        } => {
            log.push(
                ApiEventTopic::Chat,
                ApiEvent::Tell {
                    speaker: project_speaker(speaker),
                    message: message.clone(),
                },
            );
        }
        ClientViewEvent::ChannelMessage {
            channel,
            speaker,
            message,
        } => {
            log.push(
                ApiEventTopic::Chat,
                ApiEvent::ChannelMessage {
                    channel: channel.kind,
                    speaker: project_speaker(speaker),
                    message: message.clone(),
                },
            );
        }
        ClientViewEvent::Emote { speaker, text } => {
            log.push(
                ApiEventTopic::Chat,
                ApiEvent::Chat {
                    channel: "emote".into(),
                    speaker: Some(project_speaker(speaker)),
                    message: text.clone(),
                },
            );
        }
        ClientViewEvent::SoulEmote { speaker, text } => {
            log.push(
                ApiEventTopic::Chat,
                ApiEvent::Chat {
                    channel: "soul-emote".into(),
                    speaker: Some(project_speaker(speaker)),
                    message: text.clone(),
                },
            );
        }
        ClientViewEvent::ServerMessage { message, .. }
        | ClientViewEvent::TransientString { message }
        | ClientViewEvent::PopupString { message } => {
            log.push(
                ApiEventTopic::Chat,
                ApiEvent::Chat {
                    channel: "system".into(),
                    speaker: None,
                    message: message.clone(),
                },
            );
        }
        ClientViewEvent::FellowshipStateUpdated { .. } => {
            log.push(
                ApiEventTopic::Social,
                ApiEvent::SocialUpdated {
                    section: "fellowship".into(),
                },
            );
        }
        ClientViewEvent::AllegianceUpdated(_) => {
            log.push(
                ApiEventTopic::Social,
                ApiEvent::SocialUpdated {
                    section: "allegiance".into(),
                },
            );
        }
        ClientViewEvent::FriendsStateUpdated { .. } => {
            log.push(
                ApiEventTopic::Social,
                ApiEvent::SocialUpdated {
                    section: "friends".into(),
                },
            );
        }
        ClientViewEvent::SquelchStateUpdated { .. } => {
            log.push(
                ApiEventTopic::Social,
                ApiEvent::SocialUpdated {
                    section: "squelch".into(),
                },
            );
        }
        ClientViewEvent::ContractsStateUpdated { .. } => {
            log.push(
                ApiEventTopic::Social,
                ApiEvent::SocialUpdated {
                    section: "contracts".into(),
                },
            );
        }
        ClientViewEvent::LocalNavigationFinished(finished) => {
            log.push(
                ApiEventTopic::Movement,
                ApiEvent::NavigationFinished {
                    finished: *finished,
                },
            );
        }
        ClientViewEvent::TeleportStarted { sequence } => {
            log.push(
                ApiEventTopic::Movement,
                ApiEvent::TeleportStarted {
                    sequence: *sequence,
                },
            );
        }
        ClientViewEvent::ForcedReposition { guid, pos, .. } => {
            log.push(
                ApiEventTopic::Movement,
                ApiEvent::ForcedReposition {
                    guid: *guid,
                    position: *pos,
                },
            );
        }
        ClientViewEvent::AutomationPausedChanged(paused) => {
            log.push(
                ApiEventTopic::Automation,
                ApiEvent::AutomationPausedChanged { paused: *paused },
            );
        }
        _ => {}
    }
}

//! Character game-event stamps order authority independently of fragment completion.

use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

use anyhow::{Result, bail};
use holtburger_common::{Guid, sequence::is_newer_u32};

/// Retail TSRecv::AddEntryBlocking waits for this many blocked entries before skipping a gap.
const RETAIL_BLOCKED_ENTRIES: usize = 20;
/// Retail checks the gap's age on receipt of another out-of-order event, not on an idle timer.
const RETAIL_GAP_WAIT: Duration = Duration::from_secs(300);

/// One selected character's ordered event stream; a world login replaces the entire owner.
pub(super) struct GameEventOrdering {
    /// Target identity used by the inbound message dispatcher.
    target: Guid,
    /// Last delivered or explicitly skipped stamp, with wrapping sequence arithmetic.
    delivered: u32,
    /// Complete messages waiting for an earlier event; payload decoding happens on release.
    pending: BTreeMap<u32, Vec<u8>>,
    /// Start of the current gap's wait, restarted when draining reaches another gap.
    blocked_since: Option<Instant>,
}

impl GameEventOrdering {
    pub(super) fn new(target: Guid) -> Self {
        Self {
            target,
            delivered: 0,
            pending: BTreeMap::new(),
            blocked_since: None,
        }
    }

    pub(super) fn target(&self) -> Guid {
        self.target
    }

    /// Admit a complete envelope once, then release the longest contiguous ready prefix.
    pub(super) fn receive(
        &mut self,
        sequence: u32,
        data: &[u8],
        now: Instant,
    ) -> Result<Vec<Vec<u8>>> {
        if !is_newer_u32(sequence, self.delivered) {
            return Ok(Vec::new());
        }
        if let Some(previous) = self.pending.get(&sequence) {
            if previous != data {
                bail!(
                    "Conflicting game-event payloads for {} at sequence {}",
                    self.target,
                    sequence
                );
            }
            return Ok(Vec::new());
        }
        self.pending.insert(sequence, data.to_vec());
        let mut ready = self.drain_ready();
        if self.pending.is_empty() {
            self.blocked_since = None;
            return Ok(ready);
        }
        if !ready.is_empty() {
            // Retail GetNextReadyEntry (acclient.c:452852-452860) starts a fresh wait
            // when processing the ready prefix reaches another blocked stamp.
            self.blocked_since = Some(now);
        }
        let blocked_since = *self.blocked_since.get_or_insert(now);
        // acclient.c:453013-453071: after >=20 blocked entries and >300 seconds,
        // TSRecv inserts one empty expected stamp and checks the ready queue again.
        // Do not skip on an idle timer or skip an entire missing range at once.
        if ready.is_empty()
            && self.pending.len() >= RETAIL_BLOCKED_ENTRIES
            && now.duration_since(blocked_since) > RETAIL_GAP_WAIT
        {
            self.delivered = self.delivered.wrapping_add(1);
            log::warn!(
                "Skipping missing game event for {} at sequence {} after retail gap wait; affected state may be stale",
                self.target,
                self.delivered
            );
            ready.extend(self.drain_ready());
            if self.pending.is_empty() {
                self.blocked_since = None;
            } else {
                self.blocked_since = Some(now);
            }
        }
        Ok(ready)
    }

    fn drain_ready(&mut self) -> Vec<Vec<u8>> {
        let mut ready = Vec::new();
        while let Some(data) = self.pending.remove(&self.delivered.wrapping_add(1)) {
            self.delivered = self.delivered.wrapping_add(1);
            ready.push(data);
        }
        ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{
        ClientState, builder,
        inventory_plan::{InventoryIntent, InventoryPlan, InventoryTarget, plan_inventory_intent},
    };
    use holtburger_common::properties::InventoryEntryKind;
    use holtburger_protocol::{
        messages::{
            GameEvent, GameEventMessage, GameMessage, ObjectDescriptionData, ViewContentsEventData,
        },
        traits::ProtocolPack,
    };
    use holtburger_world::state::storage::RosterCoverage;

    fn event(target: Guid, sequence: u32, event: GameEvent) -> Vec<u8> {
        let mut data = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target,
            sequence,
            event,
        }))
        .pack(&mut data);
        data
    }

    #[tokio::test]
    async fn login_roster_survives_a_late_baseline_and_admits_inventory_moves() {
        let player = Guid(0x50000002);
        let sack = Guid(0x8000015c);
        let item = Guid(0x8000015b);
        let mut client = builder::build_test_client(ClientState::EnteringWorld);
        client.character_selection.character_id = Some(player);
        client.begin_world_entry_transition().await.unwrap();
        let mut description = holtburger_protocol::messages::PlayerDescriptionEventData::unpack(
            player,
            2,
            holtburger_protocol::test_fixtures::PLAYER_DESCRIPTION_MINIMAL,
            &mut 0,
        )
        .unwrap();
        description.inventory = vec![
            (sack, InventoryEntryKind::Container),
            (item, InventoryEntryKind::Item),
        ];
        client
            .handle_message(&event(
                player,
                5,
                GameEvent::ViewContents(Box::new(ViewContentsEventData {
                    container: sack,
                    items: vec![],
                })),
            ))
            .await
            .unwrap();
        // Independent object descriptions must remain live while game events are blocked.
        for guid in [sack, item] {
            let mut description = ObjectDescriptionData::with_guid(guid);
            description.public_weenie_desc.name = Some("Inventory item".into());
            if guid == sack {
                description.public_weenie_desc.weenie_flags |=
                    holtburger_common::properties::WeenieHeaderFlag::ITEMS_CAPACITY;
                description.public_weenie_desc.items_capacity = Some(24);
            }
            let mut data = Vec::new();
            GameMessage::ObjectCreate(Box::new(description)).pack(&mut data);
            client.handle_message(&data).await.unwrap();
            assert!(client.world.entities.get(guid).is_some());
        }
        client
            .handle_message(&event(
                player,
                2,
                GameEvent::PlayerDescription(Box::new(description)),
            ))
            .await
            .unwrap();
        assert_eq!(
            client.world.storage_coverage(sack),
            Some(RosterCoverage::Awaiting)
        );
        // Unknown payloads still consume their envelope stamps and release later known events.
        for sequence in [4, 3, 1] {
            client
                .handle_message(&event(
                    player,
                    sequence,
                    GameEvent::Unknown(u32::MAX, vec![]),
                ))
                .await
                .unwrap();
        }
        assert_eq!(
            client.world.storage_coverage(sack),
            Some(RosterCoverage::Announced)
        );
        assert!(
            matches!(plan_inventory_intent(&client.world, InventoryIntent {
            item, target: InventoryTarget::Container { guid: sack },
        }, Default::default()), Ok(InventoryPlan::Move(step)) if step.container == sack && step.placement == 0)
        );
        assert!(
            client
                .application_snapshot()
                .entities
                .entities
                .iter()
                .any(|entity| entity.guid == sack && entity.owned_by_player)
        );
    }

    #[tokio::test]
    async fn selecting_the_same_character_restarts_stamps_and_discards_pending_events() {
        let player = Guid(0x50000002);
        let sack = Guid(0x8000015c);
        let mut client = builder::build_test_client(ClientState::EnteringWorld);
        client.character_selection.character_id = Some(player);
        client.begin_world_entry_transition().await.unwrap();
        client
            .handle_message(&event(player, 1, GameEvent::Unknown(u32::MAX, vec![])))
            .await
            .unwrap();
        client
            .handle_message(&event(
                player,
                3,
                GameEvent::ViewContents(Box::new(ViewContentsEventData {
                    container: sack,
                    items: vec![],
                })),
            ))
            .await
            .unwrap();
        client.begin_world_entry_transition().await.unwrap();
        for sequence in [1, 2] {
            client
                .handle_message(&event(
                    player,
                    sequence,
                    GameEvent::Unknown(u32::MAX, vec![]),
                ))
                .await
                .unwrap();
        }
        assert_eq!(client.world.storage_coverage(sack), None);
        assert_eq!(client.event_ordering.as_ref().unwrap().delivered, 2);
    }

    #[test]
    fn arbitrary_disorder_drains_contiguous_prefixes_once() {
        let mut ordering = GameEventOrdering::new(Guid(1));
        let now = Instant::now();
        let mut delivered = Vec::new();
        for sequence in [5_u32, 8, 4, 7, 2, 6, 3, 1, 4, 8] {
            delivered.extend(
                ordering
                    .receive(sequence, &sequence.to_le_bytes(), now)
                    .unwrap(),
            );
        }
        assert_eq!(
            delivered,
            (1_u32..=8)
                .map(|n| n.to_le_bytes().to_vec())
                .collect::<Vec<_>>()
        );
        assert!(ordering.pending.is_empty());
        assert!(ordering.blocked_since.is_none());
    }

    #[test]
    fn wrapping_stamps_keep_the_same_contiguous_contract() {
        let mut ordering = GameEventOrdering::new(Guid(1));
        ordering.delivered = u32::MAX - 2;
        let now = Instant::now();
        assert!(ordering.receive(0, &[0], now).unwrap().is_empty());
        assert!(ordering.receive(u32::MAX, &[2], now).unwrap().is_empty());
        assert_eq!(
            ordering.receive(u32::MAX - 1, &[1], now).unwrap(),
            vec![vec![1], vec![2], vec![0]]
        );
        assert!(ordering.receive(u32::MAX, &[2], now).unwrap().is_empty());
    }

    #[test]
    fn a_duplicate_cannot_replace_a_buffered_payload() {
        let mut ordering = GameEventOrdering::new(Guid(1));
        let now = Instant::now();
        ordering.receive(2, &[2], now).unwrap();
        assert!(ordering.receive(2, &[2], now).unwrap().is_empty());
        assert!(
            ordering
                .receive(2, &[9], now)
                .unwrap_err()
                .to_string()
                .contains("Conflicting game-event payloads")
        );
        assert_eq!(
            ordering.receive(1, &[1], now).unwrap(),
            vec![vec![1], vec![2]]
        );
    }

    #[test]
    fn retail_gap_escape_requires_both_backlog_and_age() {
        let mut ordering = GameEventOrdering::new(Guid(1));
        let now = Instant::now();
        let later = now + RETAIL_GAP_WAIT + Duration::from_nanos(1);
        // Even a very old small backlog must keep waiting for the missing event.
        for sequence in 2..=RETAIL_BLOCKED_ENTRIES as u32 {
            assert!(
                ordering
                    .receive(
                        sequence,
                        &sequence.to_le_bytes(),
                        if sequence == 2 { now } else { later }
                    )
                    .unwrap()
                    .is_empty()
            );
        }
        assert_eq!(ordering.delivered, 0);
        let last = RETAIL_BLOCKED_ENTRIES as u32 + 1;
        let ready = ordering.receive(last, &last.to_le_bytes(), later).unwrap();
        assert_eq!(
            ready,
            (2..=last)
                .map(|n| n.to_le_bytes().to_vec())
                .collect::<Vec<_>>()
        );
        assert!(ordering.blocked_since.is_none());
    }

    #[test]
    fn retail_gap_escape_restarts_the_wait_for_each_missing_stamp() {
        let mut ordering = GameEventOrdering::new(Guid(1));
        let now = Instant::now();
        for sequence in 3..RETAIL_BLOCKED_ENTRIES as u32 + 3 {
            ordering
                .receive(sequence, &sequence.to_le_bytes(), now)
                .unwrap();
        }
        let next = RETAIL_BLOCKED_ENTRIES as u32 + 3;
        // Exactly five minutes is still within retail's waiting window.
        assert!(
            ordering
                .receive(next, &next.to_le_bytes(), now + RETAIL_GAP_WAIT)
                .unwrap()
                .is_empty()
        );
        assert_eq!(ordering.delivered, 0);
        let later = now + RETAIL_GAP_WAIT + Duration::from_nanos(1);
        assert!(
            ordering
                .receive(next + 1, &(next + 1).to_le_bytes(), later)
                .unwrap()
                .is_empty()
        );
        assert_eq!(ordering.delivered, 1);
        assert!(
            ordering
                .receive(next + 2, &(next + 2).to_le_bytes(), later)
                .unwrap()
                .is_empty()
        );
        assert_eq!(ordering.delivered, 1);
        let final_sequence = next + 3;
        let ready = ordering
            .receive(
                final_sequence,
                &final_sequence.to_le_bytes(),
                later + RETAIL_GAP_WAIT + Duration::from_nanos(1),
            )
            .unwrap();
        assert_eq!(
            ready,
            (3..=final_sequence)
                .map(|n| n.to_le_bytes().to_vec())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn receiving_the_missing_stamp_restarts_the_wait_at_the_next_gap() {
        let mut ordering = GameEventOrdering::new(Guid(1));
        let now = Instant::now();
        for sequence in 3..RETAIL_BLOCKED_ENTRIES as u32 + 3 {
            ordering
                .receive(sequence, &sequence.to_le_bytes(), now)
                .unwrap();
        }
        let later = now + RETAIL_GAP_WAIT + Duration::from_nanos(1);
        assert_eq!(ordering.receive(1, &[1], later).unwrap(), vec![vec![1]]);
        let next = RETAIL_BLOCKED_ENTRIES as u32 + 3;
        assert!(
            ordering
                .receive(next, &next.to_le_bytes(), later)
                .unwrap()
                .is_empty()
        );
        assert_eq!(ordering.delivered, 1);
        assert_eq!(ordering.blocked_since, Some(later));
    }
}

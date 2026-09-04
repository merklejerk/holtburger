//! Ordering adapter for server script cues that arrive before their target entity.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use anyhow::Result;
use holtburger_common::Guid;

use super::{ClientRuntime, ClientViewEvent};

/// Retail keeps its missing-object placeholder, including queued network blobs, for 25 seconds.
/// See `CObjectMaint::AddObjectToBeDestroyed` in `acclient.c`.
const RETAIL_MISSING_OBJECT_LIFETIME: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Copy, PartialEq)]
struct PendingDynamicScriptCue {
    cue: u32,
    intensity: f32,
}

#[derive(Debug)]
struct PendingEntityScriptCues {
    /// Refreshed by every early cue, matching retail's missing-object destruction deadline.
    deadline: Instant,
    cues: VecDeque<PendingDynamicScriptCue>,
}

/// Raw pre-entity cues shared by the simulation and presentation dispatch paths.
#[derive(Debug, Default)]
pub(super) struct ClientDynamicScriptInbox {
    by_guid: HashMap<Guid, PendingEntityScriptCues>,
}

impl ClientDynamicScriptInbox {
    fn queue(&mut self, guid: Guid, cue: PendingDynamicScriptCue, now: Instant) {
        let pending = self
            .by_guid
            .entry(guid)
            .or_insert_with(|| PendingEntityScriptCues {
                deadline: now + RETAIL_MISSING_OBJECT_LIFETIME,
                cues: VecDeque::new(),
            });
        pending.deadline = now + RETAIL_MISSING_OBJECT_LIFETIME;
        pending.cues.push_back(cue);
    }

    fn take(&mut self, guid: Guid, now: Instant) -> VecDeque<PendingDynamicScriptCue> {
        self.by_guid
            .remove(&guid)
            .filter(|pending| now < pending.deadline)
            .map_or_else(VecDeque::new, |pending| pending.cues)
    }

    pub(super) fn expire(&mut self, now: Instant) {
        self.by_guid.retain(|_, pending| now < pending.deadline);
    }
}

impl ClientRuntime {
    /// Routes one cue immediately when its entity exists, or retains the raw cue until creation.
    pub(super) fn route_dynamic_script_cue(
        &mut self,
        guid: Guid,
        cue: u32,
        intensity: f32,
    ) -> Result<()> {
        if self.world.entities.get(guid).is_none() {
            self.dynamic_script_inbox.queue(
                guid,
                PendingDynamicScriptCue { cue, intensity },
                Instant::now(),
            );
            return Ok(());
        }
        self.dispatch_dynamic_script_cue(guid, PendingDynamicScriptCue { cue, intensity })
    }

    /// Replays valid early cues in wire order after the entity's runtime consumers are registered.
    pub(super) fn replay_dynamic_script_cues(&mut self, guid: Guid) -> Result<()> {
        let pending = self.dynamic_script_inbox.take(guid, Instant::now());
        for cue in pending {
            self.dispatch_dynamic_script_cue(guid, cue)?;
        }
        Ok(())
    }

    fn dispatch_dynamic_script_cue(
        &mut self,
        guid: Guid,
        cue: PendingDynamicScriptCue,
    ) -> Result<()> {
        let generation = u64::from(
            self.world
                .entities
                .get(guid)
                .expect("dynamic script dispatch requires a registered entity")
                .instance_sequence(),
        );
        self.play_dynamic_scale_cue(guid, cue.cue, cue.intensity)?;
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::DynamicScriptCue(
                crate::ClientDynamicScriptCue {
                    guid,
                    generation,
                    cue: cue.cue,
                    intensity: cue.intensity,
                },
            ));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientState, builder};
    use holtburger_common::position::WorldPosition;
    use holtburger_world::entity::Entity;

    #[test]
    fn pending_cues_preserve_order_and_refresh_retail_deadline() {
        let guid = Guid(0x8000_01AA);
        let started = Instant::now();
        let mut inbox = ClientDynamicScriptInbox::default();
        inbox.queue(
            guid,
            PendingDynamicScriptCue {
                cue: 10,
                intensity: 0.5,
            },
            started,
        );
        inbox.queue(
            guid,
            PendingDynamicScriptCue {
                cue: 20,
                intensity: 1.0,
            },
            started + Duration::from_secs(20),
        );

        let cues = inbox.take(guid, started + Duration::from_secs(30));
        assert_eq!(
            cues.into_iter().map(|cue| cue.cue).collect::<Vec<_>>(),
            vec![10, 20]
        );
    }

    #[test]
    fn pending_cues_expire_with_retail_missing_object_lifetime() {
        let guid = Guid(0x8000_01AA);
        let started = Instant::now();
        let mut inbox = ClientDynamicScriptInbox::default();
        inbox.queue(
            guid,
            PendingDynamicScriptCue {
                cue: 10,
                intensity: 0.5,
            },
            started,
        );

        inbox.expire(started + RETAIL_MISSING_OBJECT_LIFETIME);
        assert!(inbox.take(guid, started).is_empty());
    }

    #[test]
    fn early_cue_replays_against_the_created_entity_generation() {
        let guid = Guid(0x8000_01AA);
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();

        client.route_dynamic_script_cue(guid, 10, 0.5).unwrap();
        assert!(events.try_recv().is_err());

        client.world.add_entity(Entity::new(
            guid,
            "Early target".to_owned(),
            WorldPosition::default(),
        ));
        client.replay_dynamic_script_cues(guid).unwrap();

        assert!(matches!(
            events.try_recv().unwrap(),
            ClientViewEvent::DynamicScriptCue(crate::ClientDynamicScriptCue {
                guid: event_guid,
                generation: 0,
                cue: 10,
                intensity: 0.5,
            }) if event_guid == guid
        ));
    }
}

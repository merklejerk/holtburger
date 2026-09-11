//! Ordering adapter for server entity cues that arrive before their target entity.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use anyhow::Result;
use holtburger_common::Guid;

use super::{ClientRuntime, ClientViewEvent};

/// Retail keeps its missing-object placeholder, including queued network blobs, for 25 seconds.
/// See `CObjectMaint::AddObjectToBeDestroyed` in `acclient.c`.
const RETAIL_MISSING_OBJECT_LIFETIME: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum PendingEntityCue {
    /// Physics-script key and intensity interpreted by simulation and presentation.
    Script { cue: u32, intensity: f32 },
    /// Sound-table key and explicit packet gain interpreted by presentation.
    Sound { sound_id: u32, volume: f32 },
}

#[derive(Debug)]
struct PendingEntityCues {
    /// Refreshed by every early cue, matching retail's missing-object destruction deadline.
    deadline: Instant,
    cues: VecDeque<PendingEntityCue>,
}

/// Raw cues waiting for scene admission, shared by simulation and presentation dispatch.
#[derive(Debug, Default)]
pub(super) struct ClientEntityCueInbox {
    by_guid: HashMap<Guid, PendingEntityCues>,
}

impl ClientEntityCueInbox {
    fn queue(&mut self, guid: Guid, cue: PendingEntityCue, now: Instant) {
        let pending = self
            .by_guid
            .entry(guid)
            .or_insert_with(|| PendingEntityCues {
                deadline: now + RETAIL_MISSING_OBJECT_LIFETIME,
                cues: VecDeque::new(),
            });
        pending.deadline = now + RETAIL_MISSING_OBJECT_LIFETIME;
        pending.cues.push_back(cue);
    }

    fn take(&mut self, guid: Guid, now: Instant) -> VecDeque<PendingEntityCue> {
        self.by_guid
            .remove(&guid)
            .filter(|pending| now < pending.deadline)
            .map_or_else(VecDeque::new, |pending| pending.cues)
    }

    pub(super) fn clear(&mut self) {
        self.by_guid.clear();
    }

    pub(super) fn remove(&mut self, guid: Guid) {
        self.by_guid.remove(&guid);
    }

    pub(super) fn expire(&mut self, now: Instant) {
        self.by_guid.retain(|_, pending| now < pending.deadline);
    }
}

impl ClientRuntime {
    /// Routes one cue when its entity has usable scene placement, or retains it until admission.
    pub(super) fn route_entity_cue(&mut self, guid: Guid, cue: PendingEntityCue) -> Result<()> {
        if matches!(
            self.world.resolve_scene_placement(guid)?,
            holtburger_world::ResolvedScenePlacement::Unresolved(_)
        ) {
            self.entity_cue_inbox.queue(guid, cue, Instant::now());
            return Ok(());
        }
        self.dispatch_entity_cue(guid, cue)
    }

    /// Replays valid early cues in wire order after the entity's runtime consumers are registered.
    pub(super) fn replay_entity_cues(&mut self, guid: Guid) -> Result<()> {
        if matches!(
            self.world.resolve_scene_placement(guid)?,
            holtburger_world::ResolvedScenePlacement::Unresolved(_)
        ) {
            return Ok(());
        }
        let pending = self.entity_cue_inbox.take(guid, Instant::now());
        for cue in pending {
            self.dispatch_entity_cue(guid, cue)?;
        }
        Ok(())
    }

    fn dispatch_entity_cue(&mut self, guid: Guid, cue: PendingEntityCue) -> Result<()> {
        let generation = u64::from(
            self.world
                .entities
                .get(guid)
                .expect("entity cue dispatch requires a registered entity")
                .instance_sequence(),
        );
        let event = match cue {
            PendingEntityCue::Script { cue, intensity } => {
                self.play_dynamic_scale_cue(guid, cue, intensity)?;
                ClientViewEvent::DynamicScriptCue(crate::ClientDynamicScriptCue {
                    guid,
                    generation,
                    cue,
                    intensity,
                })
            }
            PendingEntityCue::Sound { sound_id, volume } => {
                anyhow::ensure!(
                    volume.is_finite() && volume >= 0.0,
                    "server sound volume must be finite and non-negative"
                );
                ClientViewEvent::DynamicSoundCue(crate::ClientDynamicSoundCue {
                    guid,
                    generation,
                    world_generation: self.world_generation,
                    sound_id,
                    volume,
                })
            }
        };
        let _ = self.client_view_event_tx.send(event);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientState, builder};
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::{
        messages::{GameMessage, PlaySoundData},
        traits::ProtocolPack,
    };
    use holtburger_world::entity::Entity;
    use holtburger_world::{WorldEvent, spatial::RuntimeBodyResetCause};

    #[tokio::test]
    async fn wire_sound_repeats_preserve_packet_gain_and_admitted_world_identity() {
        let guid = Guid(7);
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        client.world_generation = 12;
        let mut bytes = Vec::new();
        GameMessage::PlaySound(Box::new(PlaySoundData {
            target: guid,
            sound_id: 0x94,
            volume: 0.8,
        }))
        .pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        client.handle_message(&bytes).await.unwrap();
        assert!(events.try_recv().is_err());
        client.world.add_entity(Entity::new(
            guid,
            "Chest".into(),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            },
        ));
        client.replay_entity_cues(guid).unwrap();
        for _ in 0..2 {
            assert!(
                matches!(events.try_recv().unwrap(), ClientViewEvent::DynamicSoundCue(crate::ClientDynamicSoundCue {
                guid: actual, generation: 0, world_generation: 12, sound_id: 0x94, volume: 0.8,
            }) if actual == guid)
            );
        }
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn removal_and_world_reset_retire_unrealized_sound_cues() {
        let guid = Guid(7);
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        for reset in [false, true] {
            client
                .route_entity_cue(
                    guid,
                    PendingEntityCue::Sound {
                        sound_id: 0x94,
                        volume: 1.0,
                    },
                )
                .unwrap();
            let event = if reset {
                WorldEvent::RuntimeBodiesReset {
                    cause: RuntimeBodyResetCause::TeleportOrWorldReset,
                }
            } else {
                WorldEvent::EntityDespawned {
                    guid,
                    generation: 0,
                }
            };
            client.handle_runtime_world_event(&event);
            client.replay_entity_cues(guid).unwrap();
            while let Ok(event) = events.try_recv() {
                assert!(!matches!(event, ClientViewEvent::DynamicSoundCue(_)));
            }
        }
    }

    #[test]
    fn pending_cues_preserve_order_and_refresh_retail_deadline() {
        let guid = Guid(0x8000_01AA);
        let started = Instant::now();
        let mut inbox = ClientEntityCueInbox::default();
        inbox.queue(
            guid,
            PendingEntityCue::Script {
                cue: 10,
                intensity: 0.5,
            },
            started,
        );
        inbox.queue(
            guid,
            PendingEntityCue::Sound {
                sound_id: 20,
                volume: 1.0,
            },
            started + Duration::from_secs(20),
        );

        let cues = inbox.take(guid, started + Duration::from_secs(30));
        assert_eq!(
            cues.into_iter()
                .map(|cue| match cue {
                    PendingEntityCue::Script { cue, .. } => cue,
                    PendingEntityCue::Sound { sound_id, .. } => sound_id,
                })
                .collect::<Vec<_>>(),
            vec![10, 20]
        );
    }

    #[test]
    fn pending_cues_expire_with_retail_missing_object_lifetime() {
        let guid = Guid(0x8000_01AA);
        let started = Instant::now();
        let mut inbox = ClientEntityCueInbox::default();
        inbox.queue(
            guid,
            PendingEntityCue::Script {
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

        client
            .route_entity_cue(
                guid,
                PendingEntityCue::Script {
                    cue: 10,
                    intensity: 0.5,
                },
            )
            .unwrap();
        assert!(events.try_recv().is_err());

        client.world.add_entity(Entity::new(
            guid,
            "Early target".to_owned(),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            },
        ));
        client.replay_entity_cues(guid).unwrap();

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

//! Entity-cue delivery shared by server feedback and committed local collision callbacks.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use holtburger_common::Guid;
use holtburger_common::properties::{WeenieType, WorldObjectExt};

use super::{ClientRuntime, ClientViewEvent, PendingBusyOperation, PendingOperation};
use crate::{ActionResultReason, ActionResultSource};
use holtburger_world::{CollisionReportOutcome, CollisionReportPhase, WorldState};

/// Resolve committed callback starts while their exact recipient generations are still present.
/// Reporting permission and contact lifetime are scene-owned; core only interprets the callback.
pub(super) fn collision_script_cues(
    world: &WorldState,
    reports: &[CollisionReportOutcome],
) -> Result<Vec<crate::ClientDynamicScriptCue>> {
    let mut cues = Vec::new();
    for report in reports {
        if report.phase != CollisionReportPhase::Started {
            continue;
        }
        let guid = report
            .contact
            .recipient
            .authoritative_guid()
            .context("client collision callback recipient has no entity identity")?;
        let entity = world
            .entities
            .get(guid)
            .context("client collision callback recipient is absent")?;
        if !entity.physics.effective().collision_script_enabled {
            continue;
        }
        let Some(cue) = entity.default_script_cue().filter(|cue| *cue != 0) else {
            continue;
        };
        // Retail PhysicsDesc::UnPack defaults omitted intensity to zero (acclient.c:319096).
        // The absent/zero cue above is its PS_Invalid default, not a missing setup script DID.
        let intensity = entity.default_script_intensity().unwrap_or(0.0) as f32;
        anyhow::ensure!(
            intensity.is_finite(),
            "collision script intensity must be finite"
        );
        cues.push(crate::ClientDynamicScriptCue {
            guid,
            generation: u64::from(entity.instance_sequence()),
            cue,
            intensity,
        });
    }
    Ok(cues)
}

/// ACE.Entity/Enum/Sound.cs: sound-table key shared by locked chests, doors, and denied storage.
const OPEN_FAIL_DUE_TO_LOCK_SOUND: u32 = 0x94;

/// Broadcast sound has no actor identity; matching a live use of this chest is best effort.
fn matches_pending_chest_lock_failure(
    pending: &PendingBusyOperation,
    guid: Guid,
    sound_id: u32,
    kind: Option<WeenieType>,
    now: Instant,
) -> bool {
    sound_id == OPEN_FAIL_DUE_TO_LOCK_SOUND
        && kind == Some(WeenieType::Chest)
        && pending.deadline > now
        && matches!(pending.operation, PendingOperation::Use { source } if source == guid)
}

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
    /// Interpret at packet receipt, before scene admission can delay sound playback past UseDone.
    pub(super) fn observe_use_sound(&mut self, guid: Guid, sound_id: u32) {
        let Some(pending) = self.active_busy_operation.as_ref() else {
            return;
        };
        let Some(entity) = self.world.entities.get(guid) else {
            return;
        };
        let kind = entity.wcid.and_then(|wcid| {
            self.world
                .weenie_types
                .as_ref()
                .and_then(|types| types.get(wcid))
        });
        if matches_pending_chest_lock_failure(pending, guid, sound_id, kind, Instant::now()) {
            // ACE Chest.cs sends this cue on lock rejection. Storage.cs uses the same key for
            // permission denial, so unknown types, storage, and doors retain server feedback.
            // Another player's simultaneous use of the same chest can produce a false match.
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(format!("The {} is locked", entity.name())),
            );
        }
    }

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
                return self.dispatch_script_cue(crate::ClientDynamicScriptCue {
                    guid,
                    generation,
                    cue,
                    intensity,
                });
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

    /// Fan local callbacks and server cues into the same scale and presentation consumers.
    pub(super) fn dispatch_script_cue(&mut self, cue: crate::ClientDynamicScriptCue) -> Result<()> {
        // Local callbacks already name a generation. Never replay them onto a replacement GUID.
        if self
            .world
            .entities
            .get(cue.guid)
            .is_none_or(|entity| u64::from(entity.instance_sequence()) != cue.generation)
        {
            return Ok(());
        }
        self.play_dynamic_script_cue(cue.guid, cue.cue, cue.intensity)?;
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::DynamicScriptCue(cue));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientState, PHYSICS_TICK_MS, builder};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PhysicsState, PropertyDataId, PropertyFloat, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::{
        messages::{GameMessage, PlaySoundData},
        traits::ProtocolPack,
    };
    use holtburger_world::entity::Entity;
    use holtburger_world::{PhysicalCollisionFilter, SpatialBodyId};
    use holtburger_world::{WorldEvent, spatial::RuntimeBodyResetCause};

    fn scripted_entity_client() -> (ClientRuntime, CollisionReportOutcome) {
        let guid = Guid(7);
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut entity = Entity::new(guid, "Projectile".into(), WorldPosition::default());
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::REPORT_COLLISIONS | PhysicsState::SCRIPTED_COLLISION,
            ));
        entity.set_did_prop(PropertyDataId::PhysicsScript, Guid(0x5a));
        client.world.add_entity(entity);
        (
            client,
            CollisionReportOutcome {
                contact: holtburger_world::CollisionReportContact {
                    recipient: holtburger_world::SpatialBodyId::Entity(guid),
                    source: holtburger_world::CollisionReportSource::StaticEnvironment,
                },
                phase: CollisionReportPhase::Started,
            },
        )
    }

    #[test]
    fn collision_callbacks_resolve_wire_defaults_and_ignore_contact_ends() {
        let (mut client, report) = scripted_entity_client();
        let cue = collision_script_cues(&client.world, &[report]).unwrap()[0];
        assert_eq!(
            (cue.guid, cue.generation, cue.cue, cue.intensity),
            (Guid(7), 0, 0x5a, 0.0)
        );
        client
            .world
            .entities
            .get_mut(Guid(7))
            .unwrap()
            .set_float_prop(PropertyFloat::PhysicsScriptIntensity, 0.75);
        let mut peer_report = report;
        peer_report.contact.source = holtburger_world::CollisionReportSource::DynamicBody {
            peer: holtburger_world::SpatialBodyId::Entity(Guid(8)),
            classification: holtburger_world::CollisionReportClassification::Object,
        };
        let cues = collision_script_cues(&client.world, &[report, peer_report]).unwrap();
        assert_eq!(
            cues.len(),
            2,
            "distinct callback starts each invoke the script"
        );
        assert!(cues.iter().all(|cue| cue.intensity == 0.75));
        let ended = CollisionReportOutcome {
            phase: CollisionReportPhase::Ended,
            ..report
        };
        assert!(
            collision_script_cues(&client.world, &[ended])
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn collision_callbacks_require_script_permission_and_a_valid_default_cue() {
        let (mut client, report) = scripted_entity_client();
        let entity = client.world.entities.get_mut(Guid(7)).unwrap();
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::REPORT_COLLISIONS,
            ));
        assert!(
            collision_script_cues(&client.world, &[report])
                .unwrap()
                .is_empty()
        );
        let entity = client.world.entities.get_mut(Guid(7)).unwrap();
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::REPORT_COLLISIONS | PhysicsState::SCRIPTED_COLLISION,
            ));
        entity.set_did_prop(PropertyDataId::PhysicsScript, Guid(0));
        assert!(
            collision_script_cues(&client.world, &[report])
                .unwrap()
                .is_empty()
        );
        client
            .world
            .entities
            .get_mut(Guid(7))
            .unwrap()
            .properties
            .dids
            .0
            .remove(&PropertyDataId::PhysicsScript);
        assert!(
            collision_script_cues(&client.world, &[report])
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn collision_callbacks_reject_nonfinite_intensity() {
        let (mut client, report) = scripted_entity_client();
        for intensity in [f64::NAN, f64::INFINITY, f64::MAX] {
            client
                .world
                .entities
                .get_mut(Guid(7))
                .unwrap()
                .set_float_prop(PropertyFloat::PhysicsScriptIntensity, intensity);
            assert_eq!(
                collision_script_cues(&client.world, &[report])
                    .unwrap_err()
                    .to_string(),
                "collision script intensity must be finite"
            );
        }
    }

    #[test]
    fn local_collision_cues_share_dispatch_and_reject_replaced_generations() {
        let (mut client, report) = scripted_entity_client();
        let cue = collision_script_cues(&client.world, &[report]).unwrap()[0];
        let mut events = client.subscribe_client_view_events();
        client.dispatch_script_cue(cue).unwrap();
        assert!(
            matches!(events.try_recv().unwrap(), ClientViewEvent::DynamicScriptCue(actual)
            if actual.guid == cue.guid && actual.generation == cue.generation && actual.cue == cue.cue)
        );
        let entity = client.world.entities.get_mut(cue.guid).unwrap();
        entity.apply_remote_position_sample(entity.position, 1, 0, 0);
        client.dispatch_script_cue(cue).unwrap();
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn collision_callbacks_require_registered_entity_recipients() {
        let (client, mut report) = scripted_entity_client();
        report.contact.recipient = SpatialBodyId::Entity(Guid(8));
        assert_eq!(
            collision_script_cues(&client.world, &[report])
                .unwrap_err()
                .to_string(),
            "client collision callback recipient is absent"
        );
        report.contact.recipient = SpatialBodyId::Ephemeral(8);
        assert_eq!(
            collision_script_cues(&client.world, &[report])
                .unwrap_err()
                .to_string(),
            "client collision callback recipient has no entity identity"
        );
    }

    #[test]
    fn committed_floor_contacts_trigger_scripts_once_when_reporting_is_enabled() {
        for reporting in [false, true] {
            let (mut client, collision, _) = super::super::tests::floor_contact_publication();
            let guid = client.world.player.guid;
            let mut flags = PhysicsState::SCRIPTED_COLLISION;
            flags.set(PhysicsState::REPORT_COLLISIONS, reporting);
            let entity = client.world.entities.get_mut(guid).unwrap();
            entity
                .physics
                .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                    flags,
                ));
            entity.set_did_prop(PropertyDataId::PhysicsScript, Guid(0x5a));
            let id = SpatialBodyId::LocalPlayer(guid);
            let physical = client
                .world
                .scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap();
            let configuration = physical
                .dynamic_configuration_for_state(
                    client.world.entities.get(guid).unwrap().physics.effective(),
                    holtburger_world::LocalPhysicalDemand {
                        target: holtburger_world::LocalTargetDemand::Retained,
                        integration: holtburger_world::LocalIntegrationDemand::Eligible,
                    },
                )
                .unwrap();
            client
                .world
                .scene
                .set_dynamic_physical_body(
                    id,
                    Some(configuration),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            let mut body = client.world.scene.body(id).unwrap().clone();
            body.retained.velocity = holtburger_common::Vector3::new(0.0, 0.0, -4.0);
            client.world.scene.update_body(body).unwrap();
            let tick = super::super::simulation::tick(
                Instant::now(),
                Duration::from_millis(PHYSICS_TICK_MS),
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            assert_eq!(tick.collision_script_cues.len(), usize::from(reporting));
            let next = super::super::simulation::tick(
                Instant::now(),
                Duration::from_millis(PHYSICS_TICK_MS),
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            assert!(next.collision_script_cues.is_empty());
        }
    }

    #[test]
    fn lock_failure_requires_a_live_direct_use_of_the_same_known_chest() {
        let guid = Guid(7);
        let now = Instant::now();
        let pending = PendingBusyOperation {
            operation: PendingOperation::Use { source: guid },
            deadline: now + super::super::BUSY_OPERATION_TIMEOUT,
            pending_error: None,
        };
        let matches = |pending: &PendingBusyOperation, target, sound, kind, time| {
            matches_pending_chest_lock_failure(pending, target, sound, kind, time)
        };
        assert!(matches(
            &pending,
            guid,
            OPEN_FAIL_DUE_TO_LOCK_SOUND,
            Some(WeenieType::Chest),
            now
        ));
        for kind in [None, Some(WeenieType::Door), Some(WeenieType::Storage)] {
            assert!(!matches(
                &pending,
                guid,
                OPEN_FAIL_DUE_TO_LOCK_SOUND,
                kind,
                now
            ));
        }
        assert!(!matches(
            &pending,
            Guid(8),
            OPEN_FAIL_DUE_TO_LOCK_SOUND,
            Some(WeenieType::Chest),
            now
        ));
        assert!(!matches(&pending, guid, 0, Some(WeenieType::Chest), now));
        assert!(!matches(
            &pending,
            guid,
            OPEN_FAIL_DUE_TO_LOCK_SOUND,
            Some(WeenieType::Chest),
            pending.deadline
        ));
        let targeted = PendingBusyOperation {
            operation: PendingOperation::UseWithTarget,
            ..pending
        };
        assert!(!matches(
            &targeted,
            guid,
            OPEN_FAIL_DUE_TO_LOCK_SOUND,
            Some(WeenieType::Chest),
            now
        ));
    }

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

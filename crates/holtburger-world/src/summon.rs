//! Player summon ownership and observed lifecycle, independent of frontend presentation policy.

use std::time::Instant;

use holtburger_common::{
    Guid,
    properties::{PropertyInt, WorldObjectExt, WorldObjectPropertyAccessors},
};
use serde::{Deserialize, Serialize};

use crate::{WorldEvent, WorldState, entity::Entity};

/// Observed reasons a summon stopped participating; removal does not prove death.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SummonEndCause {
    /// An accepted health or movement observation established death.
    Death,
    /// The server removed the current incarnation from client tracking.
    ServerRemoval,
}

/// Current observation level; recovery never replays an end notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SummonActivity {
    /// No death or applicable server removal has been observed.
    Active,
    /// Death or applicable server removal has been observed.
    Ended,
}

/// Timing knowledge from appraisal; an estimated deadline never establishes death.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SummonLifetime {
    /// No successful appraisal has disclosed timing yet.
    Unobserved,
    /// A successful appraisal omitted remaining lifespan.
    Undisclosed,
    /// Receipt-anchored duration projected into the shared estimated server clock.
    Estimated {
        /// Cosmetic deadline consumed by frontends; expiration may precede actual removal.
        expires_at_server_time: f64,
    },
}

/// Lossless summon relationship plus world-derived activity and timing for client consumers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummonFacts {
    /// Exact incarnation used to scope frontend visual and appraisal interests.
    pub instance_sequence: u16,
    /// Nonzero owning character GUID; that character need not be currently visible.
    pub owner: Guid,
    /// Current semantic level, independent of retained description residency.
    pub activity: SummonActivity,
    /// Optional timing evidence; never inferred from first visibility or total lifespan.
    pub lifetime: SummonLifetime,
}

/// Incarnation-scoped observations and their stable deadline projection live beside the entity.
#[derive(Debug, Clone, Default)]
pub(crate) struct SummonObservation {
    /// End edges are emitted once, even when death is followed by server removal.
    pub ended: bool,
    /// Appraisal disclosure and duration evidence share one lifetime.
    lifetime: LifetimeObservation,
}

/// Appraisal disclosure states retain only the duration evidence they establish.
#[derive(Debug, Clone, Default)]
enum LifetimeObservation {
    /// No successful appraisal has been merged for this incarnation.
    #[default]
    Unobserved,
    /// The latest successful appraisal omitted remaining lifespan.
    Undisclosed,
    /// Remaining seconds and receipt time from the latest successful appraisal.
    Estimated(LifetimeSample),
}

/// Monotonic duration evidence survives server-clock corrections without restarting its timer.
#[derive(Debug, Clone)]
struct LifetimeSample {
    /// Signed server value; zero/negative does not establish actual removal.
    remaining_seconds: i32,
    /// Monotonic receipt anchor, independent of later server time synchronization.
    received_at: Instant,
    /// Stable projected deadline, recomputed only when the server clock is synchronized.
    expires_at_server_time: f64,
}

impl Entity {
    /// Nonzero public pet ownership is sufficient to identify either passive or combat summons.
    pub fn summon_owner(&self) -> Option<Guid> {
        self.pet_owner_id().filter(|owner| !owner.is_null())
    }

    /// Read stable world observations without re-deriving a deadline in each consumer.
    pub fn summon_facts(&self) -> Option<SummonFacts> {
        let owner = self.summon_owner()?;
        let lifetime = match &self.summon_observation.lifetime {
            LifetimeObservation::Unobserved => SummonLifetime::Unobserved,
            LifetimeObservation::Undisclosed => SummonLifetime::Undisclosed,
            LifetimeObservation::Estimated(sample) => SummonLifetime::Estimated {
                expires_at_server_time: sample.expires_at_server_time,
            },
        };
        Some(SummonFacts {
            instance_sequence: self.instance_sequence(),
            owner,
            activity: if self.summon_observation.ended {
                SummonActivity::Ended
            } else {
                SummonActivity::Active
            },
            lifetime,
        })
    }

    /// Replace timing evidence only after a successful appraisal has merged its properties.
    pub(crate) fn observe_summon_lifetime(&mut self, server_time: f64) {
        if self.summon_owner().is_some() {
            self.summon_observation.lifetime =
                match self.get_int_prop(PropertyInt::RemainingLifespan) {
                    Some(remaining_seconds) => LifetimeObservation::Estimated(LifetimeSample {
                        remaining_seconds,
                        received_at: Instant::now(),
                        expires_at_server_time: server_time + f64::from(remaining_seconds),
                    }),
                    None => LifetimeObservation::Undisclosed,
                };
        }
    }

    /// Reproject the same monotonic expiry into a corrected server clock without restarting it.
    pub(crate) fn rebase_summon_lifetime(&mut self, server_time: f64, local_time: Instant) {
        if let LifetimeObservation::Estimated(sample) = &mut self.summon_observation.lifetime {
            let elapsed = if local_time >= sample.received_at {
                local_time.duration_since(sample.received_at).as_secs_f64()
            } else {
                -sample.received_at.duration_since(local_time).as_secs_f64()
            };
            sample.expires_at_server_time =
                server_time + f64::from(sample.remaining_seconds) - elapsed;
        }
    }
}

impl WorldState {
    /// Accept one end edge before eviction; local retention cleanup must not call this method.
    pub(crate) fn end_summon(
        &mut self,
        guid: Guid,
        cause: SummonEndCause,
        events: &mut Vec<WorldEvent>,
    ) {
        let Some(entity) = self.entities.get_mut(guid) else {
            return;
        };
        let Some(owner) = entity.summon_owner() else {
            return;
        };
        if entity.summon_observation.ended {
            return;
        }
        entity.summon_observation.ended = true;
        events.push(WorldEvent::SummonEnded {
            guid,
            instance_sequence: entity.instance_sequence(),
            owner,
            cause,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use holtburger_common::{
        position::WorldPosition,
        properties::{PropertyInstanceId, WorldObjectPropertyAccessorsMut},
    };
    use holtburger_protocol::messages::{
        GameMessage, IdentifyObjectResponseEventData, ObjectDeleteData,
    };

    const OWNER: Guid = Guid(0x5000_0001);
    const SUMMON: Guid = Guid(0x7000_0001);
    const INSTANCE: u16 = 4;

    fn summon(instance: u16) -> Entity {
        let mut entity = Entity::new(SUMMON, "Owner's Golem".into(), WorldPosition::default());
        entity.sequences[crate::entity::OBJECT_INSTANCE_SEQUENCE_INDEX] = instance;
        entity.set_iid_prop(PropertyInstanceId::PetOwner, OWNER);
        entity
    }

    fn delete(world: &mut WorldState, instance: u16, events: &mut Vec<WorldEvent>) {
        assert!(crate::handlers::inventory::handle_message(
            world,
            &GameMessage::ObjectDelete(Box::new(ObjectDeleteData {
                guid: SUMMON,
                instance_sequence: instance,
            })),
            events
        ));
    }

    #[test]
    fn summon_identity_does_not_require_owner_visibility() {
        let mut entity = summon(INSTANCE);
        let local = entity.summon_facts().unwrap();
        assert_eq!(local.owner, OWNER);
        assert_eq!(local.instance_sequence, INSTANCE);
        entity.set_iid_prop(PropertyInstanceId::PetOwner, Guid::NULL);
        assert!(entity.summon_facts().is_none());
    }

    #[test]
    fn summon_dead_description_is_an_ended_baseline_without_feedback() {
        use holtburger_protocol::messages::movement::messages::motion::MovementInvalid;
        use holtburger_protocol::messages::{
            InterpretedMotionCommand, InterpretedMotionState, MovementStateFlags, MovementType,
            ObjectDescriptionData,
        };
        use holtburger_protocol::traits::ProtocolPack;
        let mut movement = vec![MovementType::Invalid as u8, 0];
        0u16.pack(&mut movement);
        MovementInvalid {
            state: InterpretedMotionState {
                flags: MovementStateFlags::FORWARD_COMMAND,
                forward_command: Some(InterpretedMotionCommand::DEAD),
                ..Default::default()
            },
            ..Default::default()
        }
        .pack(&mut movement);
        let mut description = ObjectDescriptionData {
            movement_data: Some(movement),
            ..Default::default()
        };
        description.public_weenie_desc.guid = SUMMON;
        description.public_weenie_desc.pet_owner = Some(OWNER);
        description.sequences[crate::entity::OBJECT_INSTANCE_SEQUENCE_INDEX] = INSTANCE;
        let mut entity = summon(INSTANCE);
        entity.apply_description(&description);
        assert_eq!(
            entity.summon_facts().unwrap().activity,
            SummonActivity::Ended
        );
        let mut world = WorldState::synthetic();
        world.add_entity(entity);
        let mut events = Vec::new();
        world.update_health_fraction(SUMMON, 0.0, &mut events);
        delete(&mut world, INSTANCE, &mut events);
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, WorldEvent::SummonEnded { .. }))
        );
    }

    #[test]
    fn summon_death_and_removal_emit_only_the_first_end_in_either_order() {
        for death_first in [true, false] {
            let mut world = WorldState::synthetic();
            world.add_entity(summon(INSTANCE));
            let mut events = Vec::new();
            if death_first {
                world.update_health_fraction(SUMMON, 0.0, &mut events);
                delete(&mut world, INSTANCE, &mut events);
            } else {
                delete(&mut world, INSTANCE, &mut events);
                world.update_health_fraction(SUMMON, 0.0, &mut events);
            }
            world.update_health_fraction(SUMMON, 0.0, &mut events);
            delete(&mut world, INSTANCE, &mut events);
            let endings: Vec<_> = events
                .iter()
                .filter_map(|event| match event {
                    WorldEvent::SummonEnded {
                        owner,
                        instance_sequence,
                        cause,
                        ..
                    } => Some((*owner, *instance_sequence, *cause)),
                    _ => None,
                })
                .collect();
            assert_eq!(
                endings,
                [(
                    OWNER,
                    INSTANCE,
                    if death_first {
                        SummonEndCause::Death
                    } else {
                        SummonEndCause::ServerRemoval
                    }
                )]
            );
        }
    }

    #[test]
    fn summon_local_eviction_does_not_emit_a_server_removal() {
        let mut world = WorldState::synthetic();
        world.add_entity(summon(INSTANCE));
        world.request_unretained_entity_prune(SUMMON, 0.0);
        let mut events = Vec::new();
        assert!(world.sweep_entity(SUMMON, 1.0, &mut events));
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::EntityDespawned { guid: SUMMON, .. }))
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, WorldEvent::SummonEnded { .. }))
        );
    }

    #[test]
    fn summon_stale_and_future_deletes_do_not_end_current_instance() {
        let mut world = WorldState::synthetic();
        world.add_entity(summon(INSTANCE));
        let mut events = Vec::new();
        delete(&mut world, INSTANCE - 1, &mut events);
        delete(&mut world, INSTANCE + 1, &mut events);
        assert!(events.is_empty());
        assert_eq!(
            world
                .entities
                .get(SUMMON)
                .unwrap()
                .summon_facts()
                .unwrap()
                .activity,
            SummonActivity::Active
        );
        let disposition = world.upsert_entity_from_create(summon(INSTANCE + 1), &mut events);
        assert_eq!(
            disposition,
            crate::state::liveness::EntityCreateDisposition::DeleteRequested
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, WorldEvent::SummonEnded { .. }))
        );
    }

    #[test]
    fn summon_refresh_preserves_end_but_new_instance_can_end_again() {
        let mut world = WorldState::synthetic();
        let mut entity = summon(INSTANCE);
        entity.set_int_prop(PropertyInt::RemainingLifespan, 20);
        entity.observe_summon_lifetime(100.0);
        let timing = entity.summon_facts().unwrap().lifetime;
        world.add_entity(entity);
        let mut events = Vec::new();
        world.update_health_fraction(SUMMON, 0.0, &mut events);
        world.upsert_entity_from_create(summon(INSTANCE), &mut events);
        assert_eq!(
            world
                .entities
                .get(SUMMON)
                .unwrap()
                .summon_facts()
                .unwrap()
                .lifetime,
            timing
        );
        world.update_health_fraction(SUMMON, 0.0, &mut events);
        world.upsert_entity_from_create(summon(INSTANCE + 1), &mut events);
        assert_eq!(
            world
                .entities
                .get(SUMMON)
                .unwrap()
                .summon_facts()
                .unwrap()
                .lifetime,
            SummonLifetime::Unobserved
        );
        world.update_health_fraction(SUMMON, 0.0, &mut events);
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, WorldEvent::SummonEnded { .. }))
                .count(),
            2
        );
    }

    #[test]
    fn summon_appraisal_omission_withdraws_old_timing_and_rejection_preserves_it() {
        use holtburger_protocol::messages::{GameEvent, GameEventMessage};
        let mut world = WorldState::synthetic();
        world.add_entity(summon(INSTANCE));
        let lifetime = |world: &WorldState| {
            world
                .entities
                .get(SUMMON)
                .unwrap()
                .summon_facts()
                .unwrap()
                .lifetime
        };
        let appraise = |world: &mut WorldState, data: IdentifyObjectResponseEventData| {
            world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
                target: OWNER,
                sequence: 1,
                event: GameEvent::IdentifyObjectResponse(Box::new(data)),
            })))
        };
        assert_eq!(lifetime(&world), SummonLifetime::Unobserved);
        let mut appraisal = IdentifyObjectResponseEventData {
            object_guid: SUMMON,
            success: true,
            ..Default::default()
        };
        appraisal
            .properties
            .ints
            .insert(PropertyInt::RemainingLifespan, 20);
        appraise(&mut world, appraisal.clone());
        assert!(matches!(lifetime(&world), SummonLifetime::Estimated { .. }));
        appraisal.success = false;
        appraisal.properties.ints.0.clear();
        appraise(&mut world, appraisal.clone());
        assert!(matches!(lifetime(&world), SummonLifetime::Estimated { .. }));
        appraisal.success = true;
        appraise(&mut world, appraisal);
        assert_eq!(lifetime(&world), SummonLifetime::Undisclosed);
    }

    #[test]
    fn summon_elapsed_lifetime_and_clock_correction_never_establish_death() {
        let mut entity = summon(INSTANCE);
        let anchor = Instant::now();
        entity.summon_observation.lifetime = LifetimeObservation::Estimated(LifetimeSample {
            remaining_seconds: 2,
            received_at: anchor - Duration::from_secs(5),
            expires_at_server_time: 0.0,
        });
        for server_time in [100.0, 500.0] {
            entity.rebase_summon_lifetime(server_time, anchor);
            let facts = entity.summon_facts().unwrap();
            assert_eq!(facts, entity.summon_facts().unwrap());
            let SummonLifetime::Estimated {
                expires_at_server_time,
            } = facts.lifetime
            else {
                panic!("timing must remain estimated")
            };
            assert_eq!(expires_at_server_time, server_time - 3.0);
            assert_eq!(facts.activity, SummonActivity::Active);
        }
    }
}

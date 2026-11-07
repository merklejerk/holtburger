use crate::{WorldEvent, WorldState};
use holtburger_common::Guid;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::SetStateData;

impl WorldState {
    /// Retail behavior is to defer missing/future incarnations and admit only newer state stamps.
    pub(super) fn try_set_state_update(
        &mut self,
        data: &SetStateData,
        events: &mut Vec<WorldEvent>,
    ) -> Result<(), Guid> {
        let Some(entity) = self.entities.get(data.guid) else {
            return Err(data.guid);
        };
        if is_newer_u16(data.instance_sequence, entity.instance_sequence()) {
            return Err(data.guid);
        }
        if data.instance_sequence != entity.instance_sequence()
            || !is_newer_u16(data.state_sequence, entity.state_sequence())
        {
            return Ok(());
        }

        let next = self
            .entities
            .get_mut(data.guid)
            .expect("state admission checked entity presence")
            .apply_physics_state(data.physics_state, data.state_sequence);
        // Session sequencing must not be overwritten by a stale or future object incarnation.
        if data.guid == self.player.guid {
            self.player.instance_sequence = data.instance_sequence;
        }
        if let Some(body_id) = self.runtime_body_id_for_guid(data.guid)
            && self
                .scene
                .body(body_id)
                .and_then(|body| body.physical.as_ref())
                .is_some()
            && let Some(outcome) = self.scene.reconfigure_dynamic_body_for_state(body_id, next)
            && outcome.change != crate::PhysicalBodyReconfiguration::Unchanged
        {
            events.push(WorldEvent::RuntimeBodyChanged { body_id });
        }
        events.push(WorldEvent::EntityStateUpdated {
            guid: data.guid,
            physics_state: data.physics_state,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::entity::{OBJECT_INSTANCE_SEQUENCE_INDEX, OBJECT_STATE_SEQUENCE_INDEX};
    use crate::state::liveness::ACE_DESTRUCTION_TIMEOUT_SECS;
    use crate::{WorldEvent, WorldState};
    use holtburger_common::{
        Guid,
        position::WorldPosition,
        properties::{PhysicsState, PropertyBool},
    };
    use holtburger_protocol::messages::{GameMessage, ObjectDescriptionData, SetStateData};
    use std::time::Instant;

    const SUBJECT: Guid = Guid(0x5000_0001);

    fn create(world: &mut WorldState, instance: u16, state: u16) -> Vec<WorldEvent> {
        let mut data = ObjectDescriptionData::with_guid(SUBJECT);
        data.pos = Some(WorldPosition::default());
        data.sequences[OBJECT_STATE_SEQUENCE_INDEX] = state;
        data.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX] = instance;
        data.physics_state = PhysicsState::HIDDEN;
        world.handle_message(&GameMessage::ObjectCreate(Box::new(data)))
    }

    fn update(world: &mut WorldState, instance: u16, state: u16, hidden: bool) -> Vec<WorldEvent> {
        world.handle_message(&GameMessage::SetState(Box::new(SetStateData {
            guid: SUBJECT,
            instance_sequence: instance,
            state_sequence: state,
            physics_state: if hidden {
                PhysicsState::HIDDEN
            } else {
                PhysicsState::NONE
            },
        })))
    }

    fn assert_visible(world: &WorldState) {
        let entity = world.entities.get(SUBJECT).unwrap();
        assert!(
            !entity
                .physics
                .effective()
                .semantic
                .contains(PhysicsState::HIDDEN)
        );
        assert_eq!(
            entity.properties.bools.get(&PropertyBool::Visibility),
            Some(&false)
        );
    }

    fn state_events(events: &[WorldEvent]) -> usize {
        events
            .iter()
            .filter(|event| matches!(event, WorldEvent::EntityStateUpdated { .. }))
            .count()
    }

    #[test]
    fn older_and_duplicate_states_cannot_hide_a_materialized_entity() {
        let mut world = WorldState::synthetic();
        create(&mut world, 7, 10);
        assert_eq!(state_events(&update(&mut world, 7, 12, false)), 1);
        for sequence in [11, 12] {
            assert_eq!(state_events(&update(&mut world, 7, sequence, true)), 0);
            assert_visible(&world);
        }
    }

    #[test]
    fn state_sequences_wrap_without_accepting_old_incarnations() {
        let mut world = WorldState::synthetic();
        create(&mut world, 0, u16::MAX);
        assert_eq!(state_events(&update(&mut world, 0, 0, false)), 1);
        assert_eq!(state_events(&update(&mut world, 0, u16::MAX, true)), 0);
        assert_eq!(state_events(&update(&mut world, u16::MAX, 1, true)), 0);
        assert_visible(&world);
    }

    #[test]
    fn missing_entity_replays_states_against_the_create_baseline() {
        let mut world = WorldState::synthetic();
        assert_eq!(state_events(&update(&mut world, 7, 12, false)), 0);
        update(&mut world, 7, 11, true);
        let events = create(&mut world, 7, 10);
        assert_eq!(state_events(&events), 1);
        assert_visible(&world);
    }

    #[test]
    fn future_incarnation_survives_old_entity_removal_and_wraps() {
        let mut world = WorldState::synthetic();
        create(&mut world, u16::MAX, 10);
        assert_eq!(state_events(&update(&mut world, 0, 12, false)), 0);
        assert!(
            world
                .entities
                .get(SUBJECT)
                .unwrap()
                .physics
                .effective()
                .semantic
                .contains(PhysicsState::HIDDEN)
        );
        world.remove_entity(SUBJECT);
        assert_eq!(state_events(&create(&mut world, 0, 10)), 1);
        assert_visible(&world);
    }

    #[test]
    fn queued_state_cannot_override_a_newer_create_baseline() {
        let mut world = WorldState::synthetic();
        update(&mut world, 7, 10, false);
        assert_eq!(state_events(&create(&mut world, 7, 11)), 0);
        assert!(
            world
                .entities
                .get(SUBJECT)
                .unwrap()
                .physics
                .effective()
                .semantic
                .contains(PhysicsState::HIDDEN)
        );
    }

    #[test]
    fn local_player_sequence_changes_only_after_state_admission() {
        let mut world = WorldState::synthetic();
        world.player.guid = SUBJECT;
        create(&mut world, 7, 10);
        update(&mut world, 7, 11, false);
        assert_eq!(world.player.instance_sequence, 7);
        for (instance, state, hidden) in [(6, 12, true), (8, 12, false), (7, 10, true)] {
            assert_eq!(
                state_events(&update(&mut world, instance, state, hidden)),
                0
            );
            assert_eq!(world.player.instance_sequence, 7);
            assert_visible(&world);
        }
        create(&mut world, 8, 10);
        assert_eq!(world.player.instance_sequence, 8);
        assert_visible(&world);
    }

    #[test]
    fn missing_entity_state_expires_before_guid_reuse() {
        let mut world = WorldState::synthetic();
        world.set_server_time_sync(0.0, Instant::now());
        update(&mut world, 7, 12, false);
        world.set_server_time_sync(ACE_DESTRUCTION_TIMEOUT_SECS + 1.0, Instant::now());
        assert_eq!(state_events(&create(&mut world, 7, 10)), 0);
        assert!(
            world
                .entities
                .get(SUBJECT)
                .unwrap()
                .physics
                .effective()
                .semantic
                .contains(PhysicsState::HIDDEN)
        );
    }

    #[test]
    fn character_retirement_discards_missing_and_future_states() {
        for described in [false, true] {
            let mut world = WorldState::synthetic();
            if described {
                create(&mut world, 6, 10);
            }
            update(&mut world, 7, 12, false);
            world.retire_character();
            assert_eq!(state_events(&create(&mut world, 7, 10)), 0);
            assert!(
                world
                    .entities
                    .get(SUBJECT)
                    .unwrap()
                    .physics
                    .effective()
                    .semantic
                    .contains(PhysicsState::HIDDEN)
            );
        }
    }
}

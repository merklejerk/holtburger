//! Atomic publication of content-derived selection envelopes.

use holtburger_common::Guid;

use crate::{SelectionEnvelope, WorldState};

impl WorldState {
    /// Invalidates any prior radius before replacement profile preparation leaves the world turn.
    pub fn clear_entity_selection_envelope(&mut self, guid: Guid) {
        if let Some(entity) = self.entities.get_mut(guid) {
            entity.selection_envelope = None;
        }
    }

    /// Installs derived readiness only while the exact entity generation still owns the demand.
    pub fn install_entity_selection_envelope(
        &mut self,
        guid: Guid,
        instance_sequence: u16,
        envelope: SelectionEnvelope,
    ) -> bool {
        let Some(entity) = self.entities.get_mut(guid) else {
            return false;
        };
        if entity.instance_sequence() != instance_sequence {
            return false;
        }
        entity.selection_envelope = Some(envelope);
        true
    }
}

#[cfg(test)]
mod tests {
    use holtburger_common::position::WorldPosition;

    use super::*;
    use crate::{SelectionEnvelope, entity::Entity};

    #[test]
    fn replacement_generation_cannot_observe_or_accept_stale_envelope() {
        let guid = Guid(0x7000_0001);
        let mut world = WorldState::synthetic();
        world.entities.insert(Entity::new(
            guid,
            "first".to_owned(),
            WorldPosition::default(),
        ));
        world.clear_entity_selection_envelope(guid);

        world.entities.get_mut(guid).unwrap().sequences[8] = 1;
        assert!(!world.install_entity_selection_envelope(
            guid,
            0,
            SelectionEnvelope::new(2.0).unwrap(),
        ));

        assert!(
            world
                .entities
                .get(guid)
                .unwrap()
                .selection_envelope
                .is_none()
        );
    }
}

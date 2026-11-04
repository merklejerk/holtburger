//! Atomic entity/body application of world-owned PhysicsScript scale.

use holtburger_common::Guid;

use crate::{EntityScaleError, EntityScaleUpdate, WorldState};

impl WorldState {
    /// Applies one absolute scale target and reports whether its effective value changed now.
    ///
    /// Starting a timed ramp at its current value changes future state but does not yet require a
    /// geometry or projection update.
    pub fn apply_entity_script_scale(
        &mut self,
        guid: Guid,
        end: f32,
        duration_seconds: f32,
        now_seconds: f64,
    ) -> Result<EntityScaleUpdate, EntityScaleError> {
        let Some(entity) = self.entities.get_mut(guid) else {
            return Ok(EntityScaleUpdate {
                effective_changed: false,
                ramp_active: false,
            });
        };
        let before = entity.scale.effective();
        entity
            .scale
            .apply_script_target(end, duration_seconds, now_seconds)?;
        let effective_changed = before.to_bits() != entity.scale.effective().to_bits();
        let ramp_active = entity.scale.is_ramping();
        if effective_changed {
            self.synchronize_entity_body_scale(guid);
        }
        Ok(EntityScaleUpdate {
            effective_changed,
            ramp_active,
        })
    }

    /// Advances one coordinator-tracked scale ramp without scanning unrelated entities.
    pub fn advance_entity_script_scale(
        &mut self,
        guid: Guid,
        now_seconds: f64,
    ) -> Result<EntityScaleUpdate, EntityScaleError> {
        let Some(entity) = self.entities.get_mut(guid) else {
            return Ok(EntityScaleUpdate {
                effective_changed: false,
                ramp_active: false,
            });
        };
        let effective_changed = entity.scale.advance(now_seconds)?;
        let ramp_active = entity.scale.is_ramping();
        if effective_changed {
            self.synchronize_entity_body_scale(guid);
        }
        Ok(EntityScaleUpdate {
            effective_changed,
            ramp_active,
        })
    }

    pub(crate) fn synchronize_entity_body_scale(&mut self, guid: Guid) {
        let Some(scale) = self
            .entities
            .get(guid)
            .map(|entity| entity.scale.effective())
        else {
            return;
        };
        let Some(body_id) = self.runtime_body_id_for_guid(guid) else {
            return;
        };
        self.scene
            .set_dynamic_body_object_scale(body_id, scale)
            .expect("validated entity scale must produce valid scaled body geometry");
    }
}

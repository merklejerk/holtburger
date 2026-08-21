//! Turning an authored rigid offset into a collision-aware solver's actuation.
//!
//! The collision solver takes a planar drive velocity and an absolute world heading, so the
//! authored offset is converted at this boundary — once, by the layer that owns the solver
//! contract. That conversion is arithmetic on an exact per-tick quantity, not a reduction of the
//! content: the offset was composed from ordered authored frames and is discarded after this tick.
//! Retail does the same thing in the other direction, reducing its own accepted path to
//! `cached_velocity` for the following tick.

use holtburger_common::position::WorldPosition;
use holtburger_common::{RigidTransform, Vector3};

use crate::spatial::{
    ContactState, GroundedBodyActuation, PhysicalBodyActuation, PhysicalBodyActuationError,
    gate_authored_offset,
};

/// Builds the actuation one authored offset produces for a grounded body.
///
/// The support gate runs first, so an unsupported body contributes no translation while still
/// turning. The rotation becomes an absolute heading because that is the only rotation the grounded
/// actuation accepts, and every authored root rotation in referenced content is yaw-only — measured
/// at 19 of 19 animations with a maximum tilt axis component of zero.
///
/// The vertical component of the authored translation is dropped. That is not a loss: `solve_grounded`
/// projects the whole displacement into the support plane whenever the body has walkable support,
/// and the support gate has already zeroed the translation when it does not.
pub fn authored_grounded_actuation(
    offset: RigidTransform,
    pose: WorldPosition,
    contact: ContactState,
    object_scale: f32,
    delta_seconds: f32,
) -> Result<PhysicalBodyActuation, PhysicalBodyActuationError> {
    let gated = gate_authored_offset(offset, contact, object_scale);
    let world_delta = pose.rotation.rotate_vector(gated.translation);
    let planar = if delta_seconds > 0.0 {
        Vector3::new(
            world_delta.x / delta_seconds,
            world_delta.y / delta_seconds,
            0.0,
        )
    } else {
        Vector3::zero()
    };

    let heading = pose.rotation.multiply(&gated.rotation).to_heading();
    Ok(PhysicalBodyActuation::Grounded(
        GroundedBodyActuation::drive(planar)?.with_control_heading(heading)?,
    ))
}

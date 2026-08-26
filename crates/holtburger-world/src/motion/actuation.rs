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
    ContactState, GroundedBodyActuation, GroundedLaunch, PhysicalBodyActuation,
    PhysicalBodyActuationError, gate_authored_offset,
};

/// Builds the one grounded actuation consumed by the physical solver.
///
/// Character controllers and authored-motion adapters may disagree about where their planar
/// velocity came from, but they share this boundary: a world-space planar drive, one optional
/// absolute heading, and one one-shot launch become one validated actuation. Keeping that
/// conversion here prevents Explorer and client authorities from growing subtly different
/// `GroundedBodyActuation` construction paths.
pub fn grounded_character_actuation(
    supported_planar_velocity: Vector3,
    control_heading: Option<f32>,
    launch: Option<GroundedLaunch>,
) -> Result<PhysicalBodyActuation, PhysicalBodyActuationError> {
    let mut grounded = GroundedBodyActuation::drive(supported_planar_velocity)?;
    if let Some(heading) = control_heading {
        grounded = grounded.with_control_heading(heading)?;
    }
    if let Some(launch) = launch {
        grounded = grounded.with_launch(launch);
    }
    Ok(PhysicalBodyActuation::Grounded(grounded))
}

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
    grounded_character_actuation(planar, Some(heading), None)
}

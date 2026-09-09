//! One admitted movement decision before contact solving. Ordinary prediction, authority
//! return, and local confirmation compose here; the kernel receives the resolved drive.

use anyhow::{Context, ensure};
use holtburger_common::{Quaternion, RigidTransform, Vector3};

use super::physical_body::predict_reference_motion;
use super::{
    GroundState, PhysicalBodyActuation, PhysicalBodyInput, PhysicalReferenceDomain,
    PhysicalReferenceInput, PoseReconciliationState, PreparedBodyMovement, SpatialBody,
};

/// Return speed tapers proportionally as the physical body approaches its reference.
pub const PHYSICAL_RETURN_GAIN: f32 = 2.0;

/// Current target and source-owned rate resolved once before the physical collection.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StickyBodyTarget {
    /// Target root in its canonical world position; not its future solved pose.
    pub position: holtburger_common::position::WorldPosition,
    /// Sum of actor/target authored scaled radii plus the retail 0.3 m clearance.
    pub clearance: f32,
    /// Maximum ordinary pursuit speed in metres per second.
    pub speed_mps: f32,
    /// Command bearing sampled from the actual actor, shared with the playback timeline.
    pub heading: f32,
}

impl StickyBodyTarget {
    fn project(
        self,
        reference: holtburger_common::position::WorldPosition,
        interval: f32,
    ) -> anyhow::Result<ResolvedAuthoredMotion> {
        ensure!(
            self.clearance.is_finite() && self.clearance >= 0.0,
            "sticky clearance must be finite and nonnegative"
        );
        ensure!(
            self.speed_mps.is_finite() && self.speed_mps > 0.0,
            "sticky speed must be finite and positive"
        );
        let target = self
            .position
            .reanchor_to_landblock_owner(holtburger_common::Guid(
                reference.landblock_id.0 | 0xffff,
            ))?;
        let mut difference = target.coords - reference.coords;
        difference.z = 0.0;
        let distance = difference.length();
        let displacement = if distance > 0.0 {
            difference / distance
                * (distance - self.clearance)
                    .clamp(-self.speed_mps * interval, self.speed_mps * interval)
        } else {
            Vector3::zero()
        };
        // Pursuit is ordinary reference-origin travel. Recomputing it from a blocked actual body
        // would advance the reference indefinitely past its target.
        Ok(ResolvedAuthoredMotion {
            source_offset: RigidTransform::identity(),
            velocity: displacement / interval,
            heading: self.heading,
        })
    }
}

/// One source offset projected for actual movement and grounded reference prediction.
/// Free flight alone also needs the local offset for its independent nominal orientation.
#[derive(Debug, Clone, Copy)]
pub(super) struct ResolvedAuthoredMotion {
    /// Original authored contribution consumed by free-flight nominal prediction only.
    pub source_offset: RigidTransform,
    /// Prepared world velocity shared by actual and nominal grounded motion.
    pub velocity: Vector3,
    /// Absolute source heading consumed by actual actuation.
    pub heading: f32,
}

impl ResolvedAuthoredMotion {
    /// The caller has admitted a positive physical interval before projecting authored travel.
    pub fn project(offset: RigidTransform, rotation: Quaternion, interval: f32) -> Self {
        Self {
            source_offset: offset,
            velocity: rotation.rotate_vector(offset.translation) / interval,
            heading: rotation.multiply(&offset.rotation).to_heading(),
        }
    }
}

impl PhysicalBodyInput {
    /// Prepares ordinary travel once, then resolves authority policy in the transaction's copy.
    /// Only ordinary input advances the reference; the accepted body never supplies return intent.
    pub(crate) fn step(
        &self,
        body: &SpatialBody,
        ground: GroundState,
        interval: f32,
        reconciliation: &mut Option<PoseReconciliationState>,
    ) -> anyhow::Result<PreparedBodyMovement> {
        ensure!(
            interval.is_finite() && interval > 0.0,
            "movement input duration must be finite and positive"
        );
        let physical = body
            .physical
            .as_ref()
            .context("physical input requires body physics")?;
        // Character movement consumes a source-owned frame. Other response domains retain their
        // existing frame/flight rules; fixed root placement never reaches this preparation.
        let frame_policy = body.remote_frame_policy();
        let support = ground.walkable_support();
        let remote = match self.reference {
            Some(PhysicalReferenceInput::Authored { rotation, .. })
                if frame_policy == crate::motion::RemoteFramePolicy::Command =>
            {
                rotation
            }
            _ => None,
        };
        let mut correction = reconciliation
            .as_mut()
            .filter(|state| state.has_physical_correction());
        let reference = match correction.as_ref() {
            Some(state) => state.physical_reference()?,
            None => body.pose,
        };
        let authored = match self.reference {
            Some(PhysicalReferenceInput::Sticky(target)) if support.is_some() => {
                Some(target.project(reference, interval)?)
            }
            _ => self
                .reference
                .and_then(PhysicalReferenceInput::authored_offset)
                .map(|offset| {
                    ResolvedAuthoredMotion::project(
                        offset,
                        remote.unwrap_or(body.pose.rotation),
                        interval,
                    )
                }),
        };
        let sticky_heading = match self.reference {
            Some(PhysicalReferenceInput::Sticky(_)) => authored.map(|motion| motion.heading),
            _ => None,
        };
        let mut heading = sticky_heading.or_else(|| {
            remote.map(|rotation| authored.map_or(rotation.to_heading(), |motion| motion.heading))
        });
        let ordinary = match self.reference {
            Some(_) => Some(predict_reference_motion(
                body,
                &self.actuation,
                interval,
                body.nominal,
                authored,
                reference,
                ground,
            )?),
            None => {
                anyhow::ensure!(
                    correction.is_none(),
                    "physical return requires independent reference input"
                );
                None
            }
        };
        let nominal_velocity = ordinary
            .as_ref()
            .map_or(body.nominal.velocity, |motion| motion.continuation_velocity);
        let mut actuation = self.actuation.contact_step_from_authored(
            physical,
            body.retained.acceleration,
            ground,
            authored,
        )?;
        if let (Some(state), Some(ordinary)) = (correction.as_mut(), ordinary) {
            let authority_heading = state.take_correction_heading();
            // Consume authority once even when explicit sticky facing owns this interval.
            if let Some(rotation) = authority_heading
                && sticky_heading.is_none()
            {
                heading = Some(rotation.to_heading());
            }
            let error = PhysicalReferenceDomain::for_definition(physical.definition)
                .project(state.advance_return_reference(body.pose, ordinary.displacement)?);
            let error = state.select_return_error(
                error,
                matches!(body.id, super::SpatialBodyId::Entity(_))
                    && frame_policy == crate::motion::RemoteFramePolicy::Command
                    && support.is_some(),
            );
            if let Some(rotation) = ordinary.flight_rotation {
                state.advance_flight_reference_heading(rotation);
            }
            actuation = match &self.actuation {
                PhysicalBodyActuation::FreeFlight { .. } => {
                    actuation.with_free_travel_bias(reference_velocity(error))?
                }
                PhysicalBodyActuation::Grounded(input) if input.launch().is_none() => match support
                {
                    Some(support) => {
                        let correction_velocity =
                            reference_velocity(error - support.normal * error.dot(&support.normal));
                        actuation.with_supported_drive(
                            nominal_velocity + correction_velocity,
                            support.normal,
                        )?
                    }
                    None => actuation,
                },
                // Launch already owns the step; fixed placement never reaches contact preparation.
                PhysicalBodyActuation::Grounded(_)
                | PhysicalBodyActuation::FixedPosition { .. } => actuation,
            };
        } else if let Some(state) = reconciliation.as_mut() {
            actuation = actuation.with_confirmation(state, body.pose, ground, interval);
        }
        if let Some(heading) = heading {
            actuation = actuation.with_control_heading(heading)?;
        }
        Ok(PreparedBodyMovement {
            actuation,
            nominal_velocity,
        })
    }
}

/// Proportional return in either response domain; the caller owns error projection.
fn reference_velocity(error: Vector3) -> Vector3 {
    error * PHYSICAL_RETURN_GAIN
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Guid, position::WorldPosition};

    fn position(x: f32, y: f32, z: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x1234_0100),
            coords: Vector3::new(x, y, z),
            rotation: Quaternion::from_heading(0.7),
        }
    }

    #[test]
    fn sticky_reference_stops_at_clearance_when_actual_body_is_blocked() {
        let target = StickyBodyTarget {
            position: position(20.0, 10.0, 0.0),
            clearance: 1.3,
            speed_mps: 5.0,
            heading: position(5.0, 10.0, 0.0).heading_to(&position(20.0, 10.0, 0.0)),
        };
        let blocked = position(5.0, 10.0, 0.0);
        let mut reference = blocked;
        let interval = 1.0 / 30.0;
        for _ in 0..900 {
            let motion = target.project(reference, interval).unwrap();
            reference.coords = reference.coords + motion.velocity * interval;
            assert!(reference.coords.x <= target.position.coords.x - target.clearance + 1e-5);
            assert!((motion.heading - blocked.heading_to(&target.position)).abs() < 1e-5);
        }
        assert!((reference.coords.x - (target.position.coords.x - target.clearance)).abs() < 1e-5);
        assert!(
            target
                .project(reference, interval)
                .unwrap()
                .velocity
                .length()
                < 1e-4
        );
    }
}

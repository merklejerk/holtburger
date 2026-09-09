//! Bounded hard-clearance checks for offset movement spheres during body rotation.

use std::ops::ControlFlow;

use anyhow::{Context, Result, ensure};
use holtburger_common::{Guid, Quaternion, Sphere, Vector3};

use super::{ContactMotionSegment, HardTargets, PhysicalSphereSet, WorkingBody, sweep_body_chords};
use crate::spatial::{
    CollisionQueryError, CollisionScene, GroundState, HardSphereSweepHit,
    bsp_query::CONTACT_EPSILON,
};

/// Shared chord budget for controller/body facing and physical omega in one tick.
pub const MOBILE_CONTACT_ANGULAR_CHORDS: usize = 4;

/// An explicit world-axis rotation; physical turns retain angles beyond a full revolution.
struct AngularArc {
    /// Unit world rotation axis.
    axis: Vector3,
    /// Nonnegative angular travel, in radians.
    angle: f32,
}

impl AngularArc {
    fn between(start: Quaternion, end: Quaternion) -> Option<Self> {
        let mut delta = end.multiply(&start.conjugate());
        if delta.w < 0.0 {
            delta = Quaternion {
                w: -delta.w,
                x: -delta.x,
                y: -delta.y,
                z: -delta.z,
            };
        }
        let vector = Vector3::new(delta.x, delta.y, delta.z);
        let sine = vector.length();
        (sine > f32::EPSILON).then(|| Self {
            axis: vector / sine,
            angle: 2.0 * sine.atan2(delta.w),
        })
    }
}

pub(super) fn advance_orientation(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    delta_seconds: f32,
) -> Result<Option<HardSphereSweepHit>> {
    let desired = crate::spatial::physical_body::resolve_body_facing(
        body.rotation,
        body.observed_travel.ordinary,
        body.mobile.velocity,
        body.policy,
        body.control_heading,
    );
    let mut remaining = MOBILE_CONTACT_ANGULAR_CHORDS;
    if let Some(arc) = AngularArc::between(body.rotation, desired)
        && let ControlFlow::Break(hit) =
            advance_arc(collision, hard, anchor, body, arc, &mut remaining)?
    {
        return Ok(hit);
    }
    let omega = body.source.body.retained.omega;
    let speed = omega.length();
    ensure!(speed.is_finite(), "contact angular velocity must be finite");
    if speed > f32::EPSILON {
        return Ok(advance_arc(
            collision,
            hard,
            anchor,
            body,
            AngularArc {
                axis: omega / speed,
                angle: speed * delta_seconds,
            },
            &mut remaining,
        )?
        .break_value()
        .flatten());
    }
    Ok(None)
}

/// Continues only after admitting the whole arc; breaks retain an optional hard obstruction.
fn advance_arc(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    arc: AngularArc,
    remaining: &mut usize,
) -> Result<ControlFlow<Option<HardSphereSweepHit>>> {
    let root = body.root;
    let reach = body
        .mobile
        .spheres
        .iter()
        .map(|sphere| {
            let offset = sphere.center - root;
            (offset - arc.axis * offset.dot(&arc.axis)).length()
        })
        .fold(0.0_f32, f32::max);
    if reach <= f32::EPSILON {
        // Check axis invariance, not equal endpoints: a full turn can sweep real obstacles.
        let delta = Quaternion::from_axis_angle(arc.axis, arc.angle)
            .context("invalid invariant contact rotation")?;
        body.rotation = delta.multiply(&body.rotation);
        return Ok(ControlFlow::Continue(()));
    }
    // Sagitta bounds the true sphere-center arc's distance from each checked chord.
    // Compute the small-angle subtraction in f64 to avoid cancelling the 0.2 mm allowance.
    let maximum_angle = (2.0
        * (1.0 - f64::from(CONTACT_EPSILON) / f64::from(reach))
            .clamp(-1.0, 1.0)
            .acos())
    .min(std::f64::consts::PI) as f32;
    let mut left = arc.angle;
    while left > 0.0 && *remaining > 0 {
        *remaining -= 1;
        let angle = left.min(maximum_angle);
        let delta = Quaternion::from_axis_angle(arc.axis, angle)
            .context("invalid contact angular chord")?;
        let displacement = |sphere: crate::spatial::GroundedSphere| {
            root + delta.rotate_vector(sphere.center - root) - sphere.center
        };
        let swept = match sweep_body_chords(
            collision,
            hard,
            anchor,
            &body.contact,
            body.mobile.spheres,
            displacement,
        ) {
            Ok(swept) => swept,
            Err(CollisionQueryError::UnavailableOwner { owner }) => {
                body.unavailable_owner = Some(Guid(owner));
                return Ok(ControlFlow::Break(None));
            }
            Err(error) => return Err(error.into()),
        };
        if let Some(hit) = swept.hit {
            // A clipped chord is not itself a point on the rotation arc. Keep the prior sample.
            return Ok(ControlFlow::Break(Some(hit)));
        }
        let rotated = |sphere: crate::spatial::GroundedSphere| Sphere {
            center: sphere.center + displacement(sphere),
            radius: sphere.radius,
        };
        body.mobile.spheres = PhysicalSphereSet::new(
            rotated(body.mobile.spheres.primary()),
            body.mobile.spheres.upper_constraint().map(rotated),
        )?;
        body.rotation = delta.multiply(&body.rotation);
        body.contact.membership = swept.path.membership().clone();
        if let Some(grounded) = &mut body.grounded {
            grounded.ground = GroundState::Airborne;
        }
        body.motion.push(ContactMotionSegment::Rotation {
            path: swept.path,
            rotation: body.rotation,
            fraction: 1.0,
        });
        left -= angle;
    }
    Ok(if left <= 0.0 {
        ControlFlow::Continue(())
    } else {
        ControlFlow::Break(None)
    })
}
